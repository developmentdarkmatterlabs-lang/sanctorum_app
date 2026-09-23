import { randomUUID } from 'crypto';
import { prisma } from '../../db';
import type {
  AgentRuntime,
  ApprovalDecision,
  RunSpec,
  RuntimeEvent,
} from '../../../runtime/AgentRuntime';
import { stubRuntime } from '../../../runtime/StubRuntime';
import { isWebMode, toolPolicy, type WorkspaceOverride } from '../../../runtime/ToolPolicy';
import { skillsForPosition } from './skillService';
import { getProviderKeys } from './settingsService';
import { mcpsForPositionWithSecrets } from './mcpService';
import { renderRulesBlock, rulesForSeat } from './ruleService';
import {
  personalityForAgent,
  renderPersonaReminder,
  renderPersonalityBlock,
} from './personalityService';
import { effectivePosition } from './positionResolve';
import {
  finishRun,
  getRun,
  recordCost,
  recordRun,
  setRunPending,
  trace,
} from './runTreeService';
import { delegateTargets } from './delegationService';

// Inbox — threads and messages. A thread is a conversation with one agent (DM)
// or a team (broadcast). The user sends a task; the runtime runs it and streams
// events back, which become messages here. The runtime is INJECTABLE (stub now,
// the Python service later) — inbox code never changes when the provider does.

// The active runtime. Swapped by setRuntime() when a real provider is wired.
let runtime: AgentRuntime = stubRuntime;
export function setRuntime(next: AgentRuntime): void {
  runtime = next;
}

export type Sender = 'user' | 'agent' | 'system';

export type MessageDTO = {
  id: string;
  threadId: string;
  sender: Sender;
  agentKey: string | null;
  body: string;
  resultRef: string | null;
  readAt: string | null;
  createdAt: string;
};

export type ThreadDTO = {
  id: string;
  agentKey: string | null;
  teamId: string | null;
  subject: string;
  createdAt: string;
  updatedAt: string;
  /** Unread agent/system messages (drives the badge). */
  unread: number;
  /** Preview of the most recent message. */
  lastMessage: string | null;
  lastAt: string | null;
  /** When a supervised run is paused: the run to decide against + the proposed
   *  step. Both null when nothing is awaiting approval. */
  pendingRunId: string | null;
  pendingStep: string | null;
  /** The run currently in flight on this thread (for a hard stop), or null when
   *  idle. Set even when the run isn't paused. */
  activeRunId: string | null;
  /** Phase 4 — the root of the delegation tree running on this thread, or null.
   *  One pointer per thread, which is what makes a cascading cancel atomic. */
  rootRunId: string | null;
};

const msgDTO = (m: {
  id: string;
  threadId: string;
  sender: string;
  agentKey: string | null;
  body: string;
  resultRef: string | null;
  readAt: Date | null;
  createdAt: Date;
}): MessageDTO => ({
  id: m.id,
  threadId: m.threadId,
  sender: m.sender as Sender,
  agentKey: m.agentKey,
  body: m.body,
  resultRef: m.resultRef,
  readAt: m.readAt ? m.readAt.toISOString() : null,
  createdAt: m.createdAt.toISOString(),
});

/** All threads, newest activity first, each with its unread count and preview. */
export async function listThreads(): Promise<ThreadDTO[]> {
  const threads = await prisma.thread.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      _count: {
        select: { messages: { where: { readAt: null, sender: { not: 'user' } } } },
      },
    },
  });
  return threads.map((t) => ({
    id: t.id,
    agentKey: t.agentKey,
    teamId: t.teamId,
    subject: t.subject,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    unread: t._count.messages,
    lastMessage: t.messages[0]?.body ?? null,
    lastAt: t.messages[0]?.createdAt.toISOString() ?? null,
    pendingRunId: t.pendingRunId,
    pendingStep: t.pendingStep,
    activeRunId: t.activeRunId,
    rootRunId: t.rootRunId,
  }));
}

/** Total unread across all threads, for the top-level badge. */
export async function unreadTotal(): Promise<number> {
  return prisma.message.count({ where: { readAt: null, sender: { not: 'user' } } });
}

/** Messages in a thread, oldest first. */
export async function getMessages(threadId: string): Promise<MessageDTO[] | null> {
  const thread = await prisma.thread.findUnique({ where: { id: threadId } });
  if (!thread) return null;
  const rows = await prisma.message.findMany({
    where: { threadId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(msgDTO);
}

/**
 * Finds the existing DM thread for an agent, or creates one. Threads are 1:1
 * with an agent so the conversation stays continuous.
 */
export async function getOrCreateAgentThread(agentKey: string): Promise<ThreadDTO> {
  const existing = await prisma.thread.findFirst({ where: { agentKey } });
  const thread =
    existing ??
    (await prisma.thread.create({ data: { agentKey, subject: '' } }));
  const [dto] = (await listThreads()).filter((t) => t.id === thread.id);
  return dto;
}

/** Creates a team broadcast thread. */
export async function createTeamThread(teamId: string, subject: string): Promise<ThreadDTO> {
  const thread = await prisma.thread.create({ data: { teamId, subject } });
  const [dto] = (await listThreads()).filter((t) => t.id === thread.id);
  return dto;
}

/**
 * Appends the user's task, then dispatches a run through the active runtime.
 * The runtime streams RuntimeEvents to `ingestEvent`, which writes them into the
 * thread as messages. With the in-process StubRuntime this all completes before
 * dispatch resolves, so the returned list already holds the reply; an
 * out-of-process runtime returns immediately and events arrive on the webhook.
 */
export async function sendMessage(
  threadId: string,
  body: string,
  opts: {
    supervised?: boolean;
    successCriteria?: string;
    maxAttempts?: number;
    /** Phase 4: run as THIS agent rather than the thread's own. A delegated
     *  child runs on the same thread as its leader, in its own lane (messages
     *  carry `agentKey`), which keeps one delegation tree in one thread. */
    asAgentKey?: string;
    /** Phase 4: the run that delegated this one — sets the tree edge. */
    parentRunId?: string;
  } = {}
): Promise<{ ok: boolean; notFound?: boolean; messages?: MessageDTO[]; runId?: string }> {
  const thread = await prisma.thread.findUnique({ where: { id: threadId } });
  if (!thread) return { ok: false, notFound: true };

  const text = body.trim();
  if (!text) return { ok: false, notFound: false, messages: await getMessages(threadId) ?? [] };

  // Who actually does the work: a delegated child runs as the subordinate, so
  // its grant, skills, MCPs, rules and model all come from THAT seat.
  const actorKey = opts.asAgentKey ?? thread.agentKey;

  // A delegated task is written into the thread as coming from the leader, so
  // the lane reads "the lead asked X to do this" rather than looking user-typed.
  await prisma.message.create({
    data: {
      threadId,
      sender: opts.parentRunId ? 'system' : 'user',
      agentKey: opts.parentRunId ? actorKey : null,
      body: opts.parentRunId ? `⇩ delegated: ${text}` : text,
    },
  });

  // Supervision is a property of the AGENT (its `supervised` flag), resolved in
  // buildRunSpec. A caller may still override per-run; undefined means "use the
  // agent's setting."
  const spec = await buildRunSpec(thread.id, actorKey, text, undefined, opts.supervised, {
    successCriteria: opts.successCriteria,
    maxAttempts: opts.maxAttempts,
  });

  // Phase 4 — record the run in the delegation tree BEFORE dispatching. A run
  // can finish before `dispatch` resolves (the in-process StubRuntime always
  // does), and if its row doesn't exist yet the terminal event can't be recorded
  // against it. A solo run is simply a tree of one: its own root, at depth 0.
  await recordRun({
    runId: spec.runId,
    threadId,
    agentKey: actorKey,
    positionId: spec.positionId ?? null,
    parentRunId: opts.parentRunId ?? null,
  });

  // The sink is void; ingestEvent's result matters only to the webhook route.
  await runtime.dispatch(spec, async (event) => {
    await ingestEvent(event);
  });

  await prisma.thread.update({
    where: { id: threadId },
    data: {
      updatedAt: new Date(),
      // Phase 4 — a ROOT run owns the thread's delegation tree. One pointer per
      // thread is what makes a cascading cancel atomic (a team run has many
      // concurrent runs, which the singular activeRunId cannot represent).
      ...(opts.parentRunId ? {} : { rootRunId: spec.runId }),
    },
  });
  return { ok: true, messages: (await getMessages(threadId)) ?? [], runId: spec.runId };
}

/**
 * Answers a supervised run's pause: proceed / stop / edit. Records the decision
 * as a system line for the thread history, then relays it to the runtime, which
 * resumes (or cancels) the run and streams follow-up events to the webhook.
 */
export async function decideRun(
  runId: string,
  threadId: string,
  decision: ApprovalDecision
): Promise<{ ok: boolean; notFound?: boolean }> {
  const thread = await prisma.thread.findUnique({ where: { id: threadId } });
  if (!thread) return { ok: false, notFound: true };

  const label =
    decision.decision === 'edit'
      ? `you edited the step: "${(decision.edited ?? '').slice(0, 80)}"`
      : `you chose to ${decision.decision}`;
  await prisma.message.create({
    data: { threadId, sender: 'user', agentKey: thread.agentKey, body: `▹ ${label}` },
  });
  await prisma.thread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });

  if (runtime.decide) await runtime.decide(runId, decision);
  return { ok: true };
}

/**
 * Hard stop a run whether it's paused OR mid-flight. Unlike `decideRun('stop')`,
 * which only takes effect at an approval pause, this hits the runtime's dedicated
 * cancel path — useful to interrupt a long auto-approved read loop. Records a
 * system line; the runtime streams the terminal `done` to the webhook, which
 * clears the thread's pending state.
 */
export async function cancelRun(
  runId: string,
  threadId: string
): Promise<{ ok: boolean; notFound?: boolean }> {
  const thread = await prisma.thread.findUnique({ where: { id: threadId } });
  if (!thread) return { ok: false, notFound: true };

  await prisma.message.create({
    data: { threadId, sender: 'user', agentKey: thread.agentKey, body: '▹ you stopped the run' },
  });
  await prisma.thread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });

  // Phase 4 — if this run belongs to a delegation tree with other live runs,
  // stopping it must stop the WHOLE tree. Otherwise the leader dies and its
  // reports keep working, burning budget with no button left to press.
  const run = await getRun(runId);
  if (run) {
    await cancelTree(run.rootRunId);
  } else if (runtime.cancel) {
    await runtime.cancel(runId);
  }
  return { ok: true };
}

/**
 * Phase 4 — hard-stops every live run in a delegation tree.
 *
 * ORDER MATTERS TWICE, and both are load-bearing:
 *
 *  1. Mark every row `cancelled` in ONE update BEFORE relaying any stop. A child
 *     that finishes mid-teardown would otherwise fire maybeResumeParent and wake
 *     the leader we are in the middle of killing.
 *  2. Relay stops DEEPEST-FIRST, for the same reason: a parent cancelled before
 *     its children can still be woken by one of them finishing.
 */
export async function cancelTree(rootRunId: string): Promise<void> {
  const all = await prisma.run.findMany({ where: { rootRunId } });
  const live = all.filter((r) => r.status === 'running' || r.status === 'paused');
  if (live.length === 0) return;

  await prisma.run.updateMany({
    where: { id: { in: live.map((r) => r.id) } },
    data: { status: 'cancelled' },
  });

  for (const r of [...live].sort((a, b) => b.depth - a.depth)) {
    if (runtime.cancel) {
      await runtime.cancel(r.id).catch(() => undefined);
    }
  }

  await prisma.thread.updateMany({
    where: { rootRunId },
    data: { rootRunId: null, activeRunId: null, pendingRunId: null, pendingStep: null },
  });
}

/**
 * Interrupt a running agent and redirect it: hard-stop the current run, then send
 * a fresh task with the new instruction (which starts a new run). This is the
 * "pause and tell it something else" flow from the interactive terminal. Simpler
 * and more predictable than splicing into the live graph — the old run stops
 * cleanly, the new instruction starts fresh. `runId` is optional: if nothing is
 * running, it just sends the message.
 */
export async function redirectRun(
  threadId: string,
  body: string,
  opts: { runId?: string; supervised?: boolean } = {}
): Promise<{ ok: boolean; notFound?: boolean; messages?: MessageDTO[] }> {
  const thread = await prisma.thread.findUnique({ where: { id: threadId } });
  if (!thread) return { ok: false, notFound: true };

  const text = body.trim();
  if (!text) return { ok: false, messages: (await getMessages(threadId)) ?? [] };

  // Stop whatever's in flight first (best-effort; a missing/finished run is fine).
  if (opts.runId && runtime.cancel) {
    await prisma.message.create({
      data: { threadId, sender: 'user', agentKey: thread.agentKey, body: '▹ you redirected the agent' },
    });
    await runtime.cancel(opts.runId);
  }

  // Then send the new instruction as a fresh task.
  return sendMessage(threadId, text, { supervised: opts.supervised });
}

/**
 * Assembles a RunSpec: resolves the agent's position + floor into the
 * clearance-gated ToolPolicy and a role prompt. Node owns this — the runtime
 * only executes within the grant it is handed. Unassigned agents get the lowest
 * (read-only) grant.
 */
async function buildRunSpec(
  threadId: string,
  agentKey: string | null,
  task: string,
  taskModel?: string,
  supervised?: boolean,
  loop?: { successCriteria?: string; maxAttempts?: number }
): Promise<RunSpec> {
  let position = null as Parameters<typeof toolPolicy>[0];
  let floor = null as Parameters<typeof toolPolicy>[1];
  let systemPrompt = 'You are an agent in the Sanctorum facility.';
  let agentModel: string | null = null;
  // Per-agent override for `generate_image` (a separate cascade from `model`).
  let agentImageModel: string | null = null;
  // Per-agent override for `generate_speech` (a third, separate cascade).
  let agentSpeechModel: string | null = null;
  // Which web tools this agent is offered; null = the global default.
  let agentWebMode: string | null = null;
  // The agent's own supervision setting; a per-run override (supervised param)
  // takes precedence, else this, else supervised-by-default.
  let agentSupervised = true;
  // Phase 4 — trusted delegator: this leader's `delegate` calls skip the pause.
  let agentTrustedDelegator = false;

  let workspace: WorkspaceOverride | null = null;
  // External MCP servers assigned to the seat (Phase 3.7); ride the run.
  let mcpServers: Awaited<ReturnType<typeof mcpsForPositionWithSecrets>> = [];
  // The seat's team/position, for resolving inherited standing rules (Phase 3.8).
  let seatTeamId: string | null = null;
  let seatPositionId: string | null = null;

  if (agentKey) {
    const agent = await prisma.agent.findUnique({
      where: { key: agentKey },
      // `role` is REQUIRED: the seat's clearance/title may be inherited from it,
      // and that clearance is what toolPolicy turns into the capability grant.
      include: { position: { include: { team: { include: { floor: true } }, role: true } } },
    });
    agentModel = agent?.model ?? null;
    agentImageModel = agent?.imageModel ?? null;
    agentSpeechModel = agent?.speechModel ?? null;
    agentWebMode = agent?.webMode ?? null;
    if (agent) {
      agentSupervised = agent.supervised;
      agentTrustedDelegator = agent.trustedDelegator;
    }
    // A real-folder mount overrides the sandbox working directory. Read-only by
    // default: the agent gets observe-only tools, so it can look but not touch.
    if (agent?.workspaceDir?.trim()) {
      workspace = { dir: agent.workspaceDir.trim(), readOnly: agent.workspaceReadOnly };
    }
    if (agent?.position) {
      const p = agent.position;
      // SECURITY: resolve the seat's effective title/clearance (override ?? role)
      // through the single resolver — this clearance becomes the ToolGrant.
      const eff = effectivePosition(p, p.role);
      position = { id: eff.id, title: eff.title, clearance: eff.clearance, teamId: eff.teamId };
      seatTeamId = p.teamId;
      seatPositionId = p.id;
      const f = p.team.floor;
      if (f) floor = { id: f.id, name: f.name, order: f.order };
      systemPrompt =
        `You are ${agent.name}, ${eff.title} on the ${p.team.name} team` +
        `${p.team.floor ? ` (based on the ${p.team.floor.name} floor)` : ''}. ` +
        `Mission: ${p.team.mission || 'unspecified'}. Act within your clearance.`;

      // Phase 3.5 — inject the seat's assigned skills (.md playbooks) so the agent
      // knows how to do those tasks. Capability lives on the seat, so these come
      // from the position, not the agent.
      const skills = await skillsForPosition(p.id);
      if (skills.length > 0) {
        const blocks = skills
          .map((s) => `## Skill: ${s.name}\n${s.description ? s.description + '\n' : ''}${s.body}`)
          .join('\n\n');
        systemPrompt +=
          `\n\nYou have the following skills — playbooks for specific kinds of ` +
          `tasks. Follow the relevant one when it applies:\n\n${blocks}`;
      }

      // Phase 3.7 — the seat's assigned external MCP servers ride the run; the AI
      // service connects to each and merges its tools into the run's tool list.
      mcpServers = await mcpsForPositionWithSecrets(p.id);
    } else if (agent) {
      systemPrompt = `You are ${agent.name}, currently unassigned to a team.`;
    }
    if (workspace) {
      systemPrompt +=
        ` You are working inside the directory ${workspace.dir}` +
        (workspace.readOnly ? ' in READ-ONLY mode (you can read but not modify it).' : '.');
    }
  }

  // Phase 3.8 — STANDING RULES ("how we always work") are PREPENDED, ahead of the
  // role prompt and skills: they always apply, so they outrank situational
  // playbooks. Inherited by scope: global + the seat's team + the seat's position.
  // An unassigned agent still gets the global rules.
  // The capability grant. Computed here (rather than inline at return) because
  // the delegation roster below must only be offered to a run that actually
  // holds the `delegate` tool.
  // Read here, not at the model cascade below: the grant needs the web mode.
  const settings = await prisma.appSettings.findUnique({ where: { id: 'default' } });
  const webMode = agentWebMode ?? settings?.webMode ?? 'fetch';

  const policy = toolPolicy(position, floor, workspace, isWebMode(webMode) ? webMode : 'fetch');

  // Phase 4 — a LEADER holding `delegate` gets its reports listed by seat id, so
  // it can name a real one. This roster is a HINT for the model, never the gate:
  // delegationService re-derives the legal targets server-side on every call, so
  // a hallucinated or copied seat id is refused.
  if (agentKey && policy.allowedTools.includes('delegate')) {
    const targets = await delegateTargets(agentKey);
    if (targets.length > 0) {
      // A sub-team's LEADER is a different kind of target from an individual
      // report: hand it a whole objective and it will break the work down across
      // its own team. Saying so keeps the model from treating a department head
      // as one more pair of hands.
      const roster = targets
        .map((t) =>
          t.viaTeam
            ? `- ${t.positionId} — ${t.agentName}, ${t.title}, who LEADS the ${t.viaTeam} team ` +
              `(clearance ${t.clearance}; they will delegate across their own team)`
            : `- ${t.positionId} — ${t.agentName}, ${t.title} (clearance ${t.clearance})`
        )
        .join('\n');
      const hasSubTeams = targets.some((t) => t.viaTeam);
      systemPrompt +=
        `\n\nYou lead this team and may DELEGATE work with the \`delegate\` tool. ` +
        `You may delegate to:\n${roster}\n` +
        `Delegate whole, self-contained pieces of work, and say what "done" looks ` +
        `like. Each one works at ITS OWN clearance, which may be lower than ` +
        `yours — if a task needs a tool they lack it will be refused, so give that ` +
        `work to someone who can do it, or do it yourself. Their reports come back ` +
        `to you for review: accept the work, or delegate a revision with specific ` +
        `notes. Delegating costs budget, so prefer doing small things yourself.` +
        (hasSubTeams
          ? ` Where a target LEADS a team, give them the OBJECTIVE rather than a ` +
            `single step — they will split it across their own people and report ` +
            `back once with the result.`
          : '');
    }
  }

  // Tell the agent its memory exists. Without this it never calls `read_memory`
  // — the same lesson as the delegation roster: an unlisted capability is an
  // unused one. The SCOPES are named, never ids: the tool sends a scope and Node
  // resolves the owner from the run.
  if (policy.allowedTools.includes('read_memory')) {
    const scopes: string[] = [];
    if (agentKey) scopes.push('`agent` — your own private notes');
    if (seatPositionId) scopes.push('`position` — this seat\'s memory, kept when the seat changes hands');
    if (seatTeamId) scopes.push('`team` — shared with everyone on your team');
    if (scopes.length > 0) {
      systemPrompt +=
        `\n\nYou have MEMORY that persists between runs. Scopes available to you:\n` +
        scopes.map((s) => `- ${s}`).join('\n') +
        `\nCall \`read_memory\` with a scope BEFORE starting work that might have ` +
        `prior context — decisions already made, conventions agreed, things that ` +
        `went wrong last time.` +
        (policy.allowedTools.includes('write_memory')
          ? ` When you learn something worth keeping — a decision, a correction, a ` +
            `reusable insight — call \`write_memory\` so the next run starts ahead ` +
            `of where you did. Record conclusions, not transcripts.`
          : '');
    }
  }

  const rules = await rulesForSeat(seatTeamId, seatPositionId);
  const rulesBlock = renderRulesBlock(rules);
  if (rulesBlock) systemPrompt = `${rulesBlock}\n\n${systemPrompt}`;

  // Personality leads everything: identity before instruction reads better to
  // every model. personaReminder is re-injected on each retry (see build.py).
  const persona = agentKey ? await personalityForAgent(agentKey) : null;
  const personaBlock = renderPersonalityBlock(persona);
  if (personaBlock) systemPrompt = `${personaBlock}\n\n${systemPrompt}`;
  const personaReminder = renderPersonaReminder(persona);

  // Model cascade: per-task override -> agent override -> global default. Empty
  // strings count as unset. Omitted entirely if nothing is chosen, so the AI
  // service uses its own env default.
  const model =
    taskModel?.trim() || agentModel?.trim() || settings?.defaultModel?.trim() || undefined;

  // The IMAGE cascade, one rung shorter (no per-task override). Separate from the
  // model above on purpose: that one must support tool calling, this one must
  // produce pictures, and almost no model does both.
  const imageModel = agentImageModel?.trim() || settings?.imageModel?.trim() || undefined;

  // The SPEECH cascade, same shape as the image one above and separate for the
  // same reason — a model that talks is rarely one that reasons or draws.
  const speechModel = agentSpeechModel?.trim() || settings?.speechModel?.trim() || undefined;

  // Provider keys from the settings panel ride the run; the AI service prefers
  // them over its own env. Only include non-empty ones.
  const keys = await getProviderKeys();
  const providerKeys: Record<string, string> = {};
  if (keys.openrouter) providerKeys.openrouter = keys.openrouter;
  if (keys.serper) providerKeys.serper = keys.serper;
  if (keys.replicate) providerKeys.replicate = keys.replicate;

  return {
    runId: randomUUID(),
    threadId,
    agentKey,
    task,
    systemPrompt,
    policy,
    // Phase 4 — the seat this run executes as, recorded on the run for audit.
    positionId: seatPositionId,
    // The memory scopes this run may address. Resolved HERE from the seat, so the
    // agent can only ever name a scope it actually holds.
    memoryContext: {
      agentKey,
      positionId: seatPositionId,
      teamId: seatTeamId,
    },
    ...(model ? { model } : {}),
    ...(imageModel ? { imageModel } : {}),
    ...(speechModel ? { speechModel } : {}),
    ...(personaReminder ? { personaReminder } : {}),
    // Per-run override wins; otherwise the agent's own supervised flag.
    supervised: supervised ?? agentSupervised,
    // Only meaningful for a run that actually holds `delegate`; harmless otherwise.
    trustedDelegator: agentTrustedDelegator,
    ...(loop?.successCriteria?.trim() ? { successCriteria: loop.successCriteria.trim() } : {}),
    ...(loop?.maxAttempts ? { maxAttempts: loop.maxAttempts } : {}),
    ...(Object.keys(providerKeys).length ? { providerKeys } : {}),
    ...(mcpServers.length ? { mcpServers } : {}),
  };
}

/**
 * Consumes one RuntimeEvent into the thread. This is the single place events
 * become messages, so it serves both the in-process stub and the out-of-process
 * webhook identically. `started`/`done` are quiet control events (no message);
 * status/message/result/error become visible lines.
 */
export async function ingestEvent(event: RuntimeEvent): Promise<{ ok: boolean; notFound?: boolean }> {
  const thread = await prisma.thread.findUnique({ where: { id: event.threadId } });
  if (!thread) return { ok: false, notFound: true };

  // Phase 4 — `Thread.activeRunId`/`pendingRunId` are SINGULAR, but a delegation
  // tree puts a leader AND its reports on one thread. Only the ROOT run may touch
  // that shared state; a child's events must not, or a report finishing would
  // clear the thread while the leader is still working (or paused), and the
  // chat's approval bar would vanish mid-run. Children are tracked in `Run`.
  const isChild = event.runId ? Boolean((await getRun(event.runId))?.parentRunId) : false;

  // `started` marks the thread as having a live run — the UI can offer a hard stop
  // from here on, even before (or without) any pause.
  if (event.type === 'started') {
    if (!isChild) {
      await prisma.thread.update({
        where: { id: event.threadId },
        data: { activeRunId: event.runId || null, updatedAt: new Date() },
      });
    }
    return { ok: true };
  }

  // A pause sets the thread's pending state (so the UI shows proceed/stop/edit);
  // any other event means the run has moved past a pause, so clear it.
  if (event.type === 'awaiting_approval') {
    await prisma.message.create({
      data: {
        threadId: event.threadId,
        sender: 'system',
        agentKey: event.agentKey ?? null,
        body: `⏸ awaiting your approval: ${event.body ?? 'proposed step'}`,
      },
    });
    // Record the pause on the RUN itself, at every depth. This is what lets a
    // middle manager (depth 1+ with its own reports) own its pause: it is both a
    // child and a parent, so the thread-level pointer below cannot represent it,
    // and without this its approval request was silently dropped and attributed
    // to the root.
    if (event.runId) await setRunPending(event.runId, event.body ?? '');

    // The THREAD pointer still tracks the root only — it drives the existing
    // solo-run chat UI, which assumes one pausable run per thread.
    if (!isChild) {
      await prisma.thread.update({
        where: { id: event.threadId },
        data: {
          pendingRunId: event.runId || null,
          pendingStep: event.body ?? '',
          updatedAt: new Date(),
        },
      });
    }
    return { ok: true };
  }

  const map: Partial<Record<RuntimeEvent['type'], Sender>> = {
    status: 'system',
    message: 'agent',
    result: 'agent',
    error: 'system',
    // Phase 3 loop observability — both render as system lines, prefixed below.
    criteria: 'system',
    evaluated: 'system',
    // Phase 4 delegation — system lines in the delegating agent's lane.
    delegated: 'system',
    reported: 'system',
  };
  const sender = map[event.type];
  if (sender && (event.body || event.ref)) {
    // Prefix the loop events so the UI can spot and style them.
    let body = event.body ?? '';
    if (event.type === 'criteria') body = `🎯 success criteria: ${body}`;
    else if (event.type === 'evaluated') body = `⚖ ${body}`;
    else if (event.type === 'delegated') body = `⇩ ${body}`;
    else if (event.type === 'reported') body = `⇧ ${body}`;
    await prisma.message.create({
      data: {
        threadId: event.threadId,
        sender,
        agentKey: event.agentKey ?? null,
        body,
        resultRef: event.ref ?? null,
      },
    });
  }
  // Any non-pause event clears a prior pause (proceeding, done, error, etc.). A
  // terminal event (done/error) also clears the active run — the thread is idle
  // again; status/message/result keep the run active (it's still working).
  const terminal = event.type === 'done' || event.type === 'error';

  // This run has moved past whatever it was waiting on (it produced output, or
  // finished). Clear ITS pause regardless of depth — the thread-level clear
  // further down only covers the root.
  if (event.runId) {
    await setRunPending(event.runId, null);
    // A non-terminal event means it is working again, not paused.
    if (!terminal) {
      await prisma.run
        .updateMany({
          where: { id: event.runId, status: 'paused' },
          data: { status: 'running' },
        })
        .catch(() => undefined);
    }
  }

  // Phase 4 — close the run's row in the delegation tree and bank what it cost.
  // The AI service reports the spend on `done` ("cost: $0.0123 (3 call(s), …)");
  // a tree's total is the SUM over its runs, and that is what gates further
  // delegation. Without this the cost ceiling would read $0.00 forever and be
  // silently unlimited.
  if (terminal && event.runId) {
    const cost = /\$([0-9]*\.?[0-9]+)/.exec(event.body ?? '');
    if (cost) await recordCost(event.runId, Number(cost[1]));

    const run = await getRun(event.runId);
    // A cancelled run stays cancelled: a cascading stop marks the whole tree
    // before relaying stops, and a late `done` must not resurrect it (nor wake
    // the leader we just killed).
    if (run && run.status !== 'cancelled') {
      // The run's answer = its last agent message, which is what a waiting
      // leader reads as its report.
      const last = await prisma.message.findFirst({
        where: { threadId: event.threadId, sender: 'agent', agentKey: event.agentKey ?? undefined },
        orderBy: { createdAt: 'desc' },
      });
      await finishRun(
        event.runId,
        event.type === 'done' ? 'done' : 'error',
        last?.body ?? ''
      );
      if (run.parentRunId) await maybeResumeParent(run.parentRunId);
    }
  }
  // Only the ROOT run drives the thread's shared run state. A child's `done`
  // clearing `activeRunId` here is exactly what made a paused leader look idle
  // (the chat's approval bar disappeared while the fleet tile still showed it).
  // A child still gets its message written above — it just can't touch the
  // thread-level pointers.
  if (isChild) {
    await prisma.thread.update({
      where: { id: event.threadId },
      data: { updatedAt: new Date() },
    });
    return { ok: true };
  }

  await prisma.thread.update({
    where: { id: event.threadId },
    data: {
      pendingRunId: null,
      pendingStep: null,
      ...(terminal ? { activeRunId: null, rootRunId: null } : {}),
      updatedAt: new Date(),
    },
  });
  return { ok: true };
}

// Child runs whose result has already been delivered to their leader. Keyed on
// the CHILD, not the parent: a leader delegates in rounds, so "all children
// finished" becomes true once per round, and each round must deliver only its
// own new reports. It also makes the delivery idempotent — two children
// finishing in the same tick can't double-deliver or double-count the budget.
// In-memory is sufficient: a restart can only lose the fact that we delivered,
// and the parked leader is recoverable from its manifest.
const deliveredChildren = new Set<string>();

/**
 * Phase 4 — wakes a leader once ALL of its reports have finished.
 *
 * THE KEY REUSE: a leader waiting on its reports is mechanically identical to a
 * leader waiting on YOU. Both park the graph before the `tools` node with an
 * unanswered tool call. So we resume through the EXISTING decision path rather
 * than inventing a second one — which means the checkpointer, the run manifest
 * and restart-safe resume all keep working with no new durability code.
 *
 * We send `edit`, not `proceed`, because `edit` is the one path that already
 * knows how to answer a parked tool call with a ToolMessage before injecting new
 * text (a tool-calling turn MUST be followed by a tool result, or the provider
 * rejects the history). Reports are exactly that shape.
 */
async function maybeResumeParent(parentRunId: string): Promise<void> {
  const siblings = await prisma.run.findMany({ where: { parentRunId } });
  if (siblings.length === 0) return;

  // Still work in flight — whoever finishes last does the waking.
  const live = siblings.filter((s) => s.status === 'running' || s.status === 'paused');
  if (live.length > 0) {
    trace(parentRunId, 'RESUME-skip', `${live.length}/${siblings.length} child(ren) still live`);
    return;
  }

  // A leader delegates in ROUNDS, and every round's children hang off the same
  // parent. So "have all children finished?" is true again at the end of every
  // round — we must deliver only the children NOT yet reported, and a latch
  // keyed on the parent alone would fire once and never again (which is what
  // silently killed rounds 3 and 4 of the four-step chain).
  const fresh = siblings.filter((s) => !deliveredChildren.has(s.id));
  if (fresh.length === 0) {
    trace(parentRunId, 'RESUME-dup', 'all children already delivered');
    return;
  }
  for (const c of fresh) deliveredChildren.add(c.id);

  const parent = await getRun(parentRunId);
  if (!parent || parent.status === 'cancelled') {
    trace(parentRunId, 'RESUME-abort', `parent ${parent?.status ?? 'missing'}`);
    return;
  }
  trace(parentRunId, 'RESUME', `delivering ${fresh.length} report(s)`);

  const digest = fresh
    .map((c) => {
      const who = c.agentKey ?? 'a report';
      const outcome = c.status === 'done' ? '' : ` [${c.status}]`;
      return `[${who}]${outcome} ${c.result || '(no output)'}`;
    })
    .join('\n\n');

  await prisma.message.create({
    data: {
      threadId: parent.threadId,
      sender: 'system',
      agentKey: parent.agentKey,
      body: `⇧ reports received from ${fresh.length} report(s)`,
    },
  });

  if (runtime.decide) {
    await runtime.decide(parentRunId, {
      decision: 'edit',
      // THE reports-delivering resume: this is the only decide() that may step a
      // parked leader (see supervise.decide's awaiting_reports guard).
      reportsReady: true,
      edited:
        `Your reports have returned:\n\n${digest}\n\n` +
        `Review this work against the task you were given. If it is complete and ` +
        `correct, produce your final answer. If not, delegate a revision with ` +
        `specific notes about what must change.`,
    });
  }
}

/** Marks every message in a thread as read (clears its unread badge). */
export async function markThreadRead(
  threadId: string
): Promise<{ ok: boolean; notFound?: boolean }> {
  const thread = await prisma.thread.findUnique({ where: { id: threadId } });
  if (!thread) return { ok: false, notFound: true };
  await prisma.message.updateMany({
    where: { threadId, readAt: null, sender: { not: 'user' } },
    data: { readAt: new Date() },
  });
  return { ok: true };
}

/** Deletes a thread and its messages. */
export async function deleteThread(
  threadId: string
): Promise<{ ok: boolean; notFound?: boolean }> {
  const thread = await prisma.thread.findUnique({ where: { id: threadId } });
  if (!thread) return { ok: false, notFound: true };
  await prisma.thread.delete({ where: { id: threadId } });
  return { ok: true };
}
