import { prisma } from '../../db';

// Phase 4 delegation tracing. The loop spans two processes (leader graph in
// Python, child spawn + resume in Node), so a duplicate child or a leader that
// never wakes shows its symptom in one and its cause in the other. Enable with
// SANCTORUM_TRACE=1 to get a timestamped, run-id-tagged line from both sides.
export function trace(runId: string | null, event: string, detail = ''): void {
  const on = (process.env.SANCTORUM_TRACE ?? '').trim();
  if (on === '' || on === '0' || on === 'false') return;
  const t = new Date().toISOString().slice(11, 23);
  const short = (runId ?? '--------').slice(0, 8);
  console.log(`[trace ${t}] ${short} ${event}${detail ? ` | ${detail}` : ''}`);
}

// Phase 4 — the delegation TREE: bookkeeping and the budget gate.
//
// Every run is recorded here, including solo runs (a solo run is a tree of one),
// so nothing in Phases 1-3.9 is special-cased. The tree is linked by
// parentRunId (who delegated this) and rootRunId (the origin), which gives us
// three things a flat run list can't:
//
//   1. A BUDGET that spans a whole task (depth, run count, cost).
//   2. A single owning row per tree, so a cascading cancel is atomic.
//   3. The parent/child edges a waiting leader resumes on.
//
// Every guard lives in THIS file so the delegate tool and the cancel path can
// never disagree about what the limits mean.

/** The delegation limits, as resolved for a tree. */
export type TreeLimits = {
  maxDepth: number;
  maxRuns: number;
  maxCost: number;
};

/**
 * Clamps a limits patch to sane bounds before it is stored.
 *
 * Depth is clamped to 1-10 and has NO "unlimited" value: it is the only
 * STRUCTURAL guard against a delegation cycle (a lead delegating to a report who
 * delegates back). The run and cost caps would stop such a loop eventually, but
 * only after burning the entire budget on nonsense. Runs and cost are budget
 * dials and take 0 = unlimited; depth is an invariant.
 */
export function clampLimits(input: {
  maxDelegationDepth?: number;
  maxRunsPerTree?: number;
  maxCostPerTree?: number;
}): {
  maxDelegationDepth?: number;
  maxRunsPerTree?: number;
  maxCostPerTree?: number;
} {
  const out: {
    maxDelegationDepth?: number;
    maxRunsPerTree?: number;
    maxCostPerTree?: number;
  } = {};

  if (input.maxDelegationDepth !== undefined) {
    const n = Math.trunc(Number(input.maxDelegationDepth));
    out.maxDelegationDepth = Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 3;
  }
  if (input.maxRunsPerTree !== undefined) {
    const n = Math.trunc(Number(input.maxRunsPerTree));
    out.maxRunsPerTree = Number.isFinite(n) ? Math.max(0, n) : 12;
  }
  if (input.maxCostPerTree !== undefined) {
    const n = Number(input.maxCostPerTree);
    out.maxCostPerTree = Number.isFinite(n) ? Math.max(0, n) : 2.0;
  }
  return out;
}

/**
 * Records a run in the tree.
 *
 * A ROOT run is its own root at depth 0 and SNAPSHOTS the current settings caps.
 * A CHILD inherits the parent's snapshot, so editing the limits while a tree is
 * running never changes that tree's budget — the next tree picks up the new
 * values. (Otherwise lowering a cap mid-flight would abort work in progress,
 * which reads as a bug.)
 *
 * Best-effort: a failure to record must not break the run itself, so callers
 * don't need to guard. The one real consequence of a missed row is that the run
 * won't appear in the tree view.
 */
export async function recordRun(input: {
  runId: string;
  threadId: string;
  agentKey: string | null;
  positionId?: string | null;
  parentRunId?: string | null;
}): Promise<void> {
  try {
    const parent = input.parentRunId
      ? await prisma.run.findUnique({ where: { id: input.parentRunId } })
      : null;

    let limits: TreeLimits;
    if (parent) {
      limits = { maxDepth: parent.maxDepth, maxRuns: parent.maxRuns, maxCost: parent.maxCost };
    } else {
      const settings = await prisma.appSettings.findUnique({ where: { id: 'default' } });
      limits = {
        maxDepth: settings?.maxDelegationDepth ?? 3,
        maxRuns: settings?.maxRunsPerTree ?? 12,
        maxCost: settings?.maxCostPerTree ?? 2.0,
      };
    }

    await prisma.run.create({
      data: {
        id: input.runId,
        threadId: input.threadId,
        agentKey: input.agentKey,
        positionId: input.positionId ?? null,
        parentRunId: parent?.id ?? null,
        rootRunId: parent?.rootRunId ?? input.runId,
        depth: parent ? parent.depth + 1 : 0,
        status: 'running',
        ...limits,
      },
    });
  } catch {
    // Never let tree bookkeeping break a run that is otherwise fine.
  }
}

export type BudgetVerdict =
  | { ok: true; remaining: number }
  | { ok: false; reason: string };

/**
 * Everything a run has spent, itself plus every descendant.
 *
 * WHY THIS IS NOT ONE QUERY. The tree is stored as parent pointers, and SQLite
 * through Prisma has no recursive CTE available here — so the descendants are
 * collected by walking down level by level. That is cheap at the depths this
 * app permits (maxDelegationDepth is clamped to 10, and in practice is 3), and
 * the whole tree is usually a handful of rows.
 *
 * The walk is breadth-first with a `seen` set. The set is not paranoia about
 * cycles — `checkBudget`'s depth gate makes a cycle impossible — it is what
 * stops a malformed row (a run whose parent is itself, say) from looping
 * forever inside a budget check.
 */
async function subtreeSpend(rootOfSubtree: string, treeRootId: string): Promise<number> {
  // One read of the whole tree, then the walk happens in memory. The
  // alternative — a query per level — would be several round trips to answer a
  // question asked before every single delegation.
  const all = await prisma.run.findMany({
    where: { rootRunId: treeRootId },
    select: { id: true, parentRunId: true, cost: true },
  });

  const childrenOf = new Map<string, typeof all>();
  const costOf = new Map<string, number>();
  for (const run of all) {
    costOf.set(run.id, run.cost);
    if (!run.parentRunId) continue;
    const siblings = childrenOf.get(run.parentRunId) ?? [];
    siblings.push(run);
    childrenOf.set(run.parentRunId, siblings);
  }

  let spent = 0;
  const seen = new Set<string>();
  const queue = [rootOfSubtree];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    spent += costOf.get(id) ?? 0;
    for (const child of childrenOf.get(id) ?? []) queue.push(child.id);
  }
  return spent;
}

/**
 * THE budget gate — called before every delegation.
 *
 * TWO CEILINGS, BOTH ENFORCED, THE LOWER ONE BINDING.
 *
 *   1. THE TREE'S. Depth, run count and cost against the ROOT's snapshot, so a
 *      whole task shares one budget no matter how wide it fans out.
 *   2. THE AGENT'S. `Agent.maxCost`, covering that agent's own subtree — itself
 *      plus everything it delegates. Null means inherit, i.e. no extra bound.
 *
 * The second is the org-chart reading of a budget: a department cannot outspend
 * the company, AND a manager given a tighter budget than the company's is bound
 * by their own. Neither ceiling is a replacement for the other, which is why
 * both are checked here rather than one overwriting the other.
 *
 * WRITTEN ONCE, HERE. Like the depth comparison below, these checks must never
 * be inlined anywhere else: two copies of a budget gate is exactly how one
 * silently stops guarding.
 *
 * `remaining` is surfaced to the delegating agent (-1 = unlimited): a model that
 * knows it has three runs left behaves differently from one that doesn't.
 */
export async function checkBudget(parentRunId: string): Promise<BudgetVerdict> {
  const parent = await prisma.run.findUnique({ where: { id: parentRunId } });
  if (!parent) return { ok: false, reason: 'the delegating run is unknown.' };

  // maxDepth counts LEVELS: maxDepth 3 permits depths 0, 1 and 2. So a child at
  // depth = parent.depth + 1 is legal only while that is <= maxDepth - 1.
  // This comparison is written ONCE, here — never inline it anywhere else, or
  // the cycle guard silently stops guarding in one of the two copies.
  const childDepth = parent.depth + 1;
  if (childDepth > parent.maxDepth - 1) {
    return {
      ok: false,
      reason:
        `delegation depth limit reached (${parent.maxDepth} levels). ` +
        `You cannot delegate further — do this work yourself.`,
    };
  }

  const tree = await prisma.run.findMany({
    where: { rootRunId: parent.rootRunId },
    select: { cost: true },
  });
  const used = tree.length;
  const spent = tree.reduce((sum, r) => sum + r.cost, 0);

  if (parent.maxRuns > 0 && used >= parent.maxRuns) {
    return {
      ok: false,
      reason: `run limit reached (${used}/${parent.maxRuns} runs in this task). Finish with what you have.`,
    };
  }
  if (parent.maxCost > 0 && spent >= parent.maxCost) {
    return {
      ok: false,
      reason:
        `cost ceiling reached ($${spent.toFixed(4)} of $${parent.maxCost.toFixed(2)}). ` +
        `Finish with what you have.`,
    };
  }

  // --- The delegating AGENT's own ceiling ---------------------------------
  // Read live from the Agent row rather than snapshotted onto the Run like the
  // tree's caps are. The difference is deliberate: the tree's limits are frozen
  // when the root starts so that editing settings mid-flight cannot change a
  // task already running, but an agent's budget is a standing property of that
  // agent — lowering it should bind the next delegation, not the next tree.
  if (parent.agentKey) {
    const agent = await prisma.agent.findUnique({
      where: { key: parent.agentKey },
      select: { maxCost: true, name: true },
    });

    // Null = inherit: the tree ceiling above is the only bound. 0 is treated as
    // unlimited for consistency with maxRuns/maxCost, so a cleared field reads
    // as "no extra limit" rather than "may spend nothing".
    const cap = agent?.maxCost ?? 0;
    if (cap > 0) {
      const own = await subtreeSpend(parent.id, parent.rootRunId);
      if (own >= cap) {
        return {
          ok: false,
          reason:
            `your own budget is spent ($${own.toFixed(4)} of $${cap.toFixed(2)} for ` +
            `${agent?.name ?? 'you'} and your reports). Finish with what you have.`,
        };
      }
    }
  }

  return { ok: true, remaining: parent.maxRuns > 0 ? parent.maxRuns - used : -1 };
}

/** Every run in a tree, oldest first — what the mission-control view renders. */
export async function treeFor(rootRunId: string) {
  return prisma.run.findMany({ where: { rootRunId }, orderBy: { createdAt: 'asc' } });
}

/** One run, or null. */
export async function getRun(runId: string) {
  return prisma.run.findUnique({ where: { id: runId } });
}

/**
 * Marks a run terminal and stores its answer, so a waiting parent can read its
 * reports back. Best-effort: a run we never recorded must not break ingest.
 */
export async function finishRun(
  runId: string,
  status: 'done' | 'error' | 'cancelled',
  result = ''
): Promise<void> {
  await prisma.run
    .update({
      where: { id: runId },
      data: { status, ...(result ? { result } : {}) },
    })
    .catch(() => undefined);

  // Every terminal state passes through here, so this is the one place a
  // leaked browser view can be closed. Imported lazily to avoid a cycle.
  const { closeBrowser } = await import('./browserService');
  await closeBrowser(runId).catch(() => undefined);
}

/**
 * Marks a run paused on a step, or clears the pause.
 *
 * The pause lives on the RUN, not the thread: in a tree deeper than one level a
 * middle manager is at once a child and a parent, so a single thread-level
 * pointer cannot say WHICH live run is asking. Every level owns its own.
 */
export async function setRunPending(runId: string, step: string | null): Promise<void> {
  await prisma.run
    .update({
      where: { id: runId },
      data: {
        pendingStep: step,
        // Keep `status` in step with it so one field answers "is this run
        // waiting on me?" — but never resurrect a run that has already ended.
        ...(step ? { status: 'paused' } : {}),
      },
    })
    .catch(() => undefined);
}

/** Records what a run cost (reported by the AI service on `done`). */
export async function recordCost(runId: string, cost: number): Promise<void> {
  if (!Number.isFinite(cost) || cost <= 0) return;
  await prisma.run.update({ where: { id: runId }, data: { cost } }).catch(() => undefined);
}
