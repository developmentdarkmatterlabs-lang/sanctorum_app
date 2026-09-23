import { prisma } from '../../db';
import { effectiveClearanceOf } from './positionResolve';

// Memory — accumulated knowledge scoped to a team, a position (seat role-memory),
// or an agent. The point of this layer is the READ GATE: what an agent can see
// depends on its current position and effective clearance, enforced here in the
// service, never in a prompt.

export type MemoryScope = 'team' | 'position' | 'agent';
export type MemoryKind = 'task' | 'result' | 'insight' | 'note';

export type MemoryDTO = {
  id: string;
  scope: MemoryScope;
  ownerId: string;
  kind: MemoryKind;
  body: string;
  clearance: number;
  /** Minimum dataType to read this: what you may KNOW, beside clearance's what
   *  you may DO. 1 = Public. */
  dataType: number;
  authorAgentKey: string | null;
  createdAt: string;
};

const toDTO = (row: {
  id: string;
  scope: string;
  ownerId: string;
  kind: string;
  body: string;
  clearance: number;
  dataType: number;
  authorAgentKey: string | null;
  createdAt: Date;
}): MemoryDTO => ({
  id: row.id,
  scope: row.scope as MemoryScope,
  ownerId: row.ownerId,
  kind: row.kind as MemoryKind,
  body: row.body,
  clearance: row.clearance,
  dataType: row.dataType,
  authorAgentKey: row.authorAgentKey,
  createdAt: row.createdAt.toISOString(),
});

const isScope = (s: unknown): s is MemoryScope =>
  s === 'team' || s === 'position' || s === 'agent';
const isKind = (s: unknown): s is MemoryKind =>
  s === 'task' || s === 'result' || s === 'insight' || s === 'note';

/**
 * The requesting agent's access context: its current position (if any), the team
 * that position belongs to, and its effective clearance (position clearance when
 * assigned, else its own fallback). Null if the agent does not exist.
 */
async function accessContext(agentKey: string): Promise<{
  positionId: string | null;
  teamId: string | null;
  clearance: number;
  dataType: number;
} | null> {
  const agent = await prisma.agent.findUnique({
    where: { key: agentKey },
    // SECURITY: `role` is REQUIRED — the seat's clearance may be inherited from it,
    // and that clearance is what gates every position-scoped memory read.
    include: {
      position: {
        select: { id: true, teamId: true, clearanceOverride: true, role: true },
      },
    },
  });
  if (!agent) return null;
  return {
    positionId: agent.position?.id ?? null,
    teamId: agent.position?.teamId ?? null,
    // Clearance is the seat's, RESOLVED (override ?? role): 0 when unassigned
    // (no standing access).
    clearance: agent.position
      ? effectiveClearanceOf(agent.position, agent.position.role)
      : 0,
    // Sensitivity is a property of the AGENT, not the seat: clearance says what
    // it may DO, dataType says what it may KNOW.
    dataType: agent.dataType,
  };
}

/** Whether `agent` (via its context) may read a given memory row. */
function canRead(
  ctx: {
    positionId: string | null;
    teamId: string | null;
    clearance: number;
    dataType: number;
  },
  row: { scope: string; ownerId: string; clearance: number; dataType: number }
): boolean {
  // TWO AXES, BOTH ENFORCED. Sensitivity applies to EVERY scope, including team
  // and agent memory: an Executive-Only note stays invisible to an Internal-level
  // teammate who would otherwise pass the membership check.
  if (ctx.dataType < row.dataType) return false;
  if (row.scope === 'team') return ctx.teamId === row.ownerId;
  if (row.scope === 'agent') return false; // agent memory is fetched by its owner directly
  // position: gated purely by clearance, so a senior seat can read a junior's.
  if (row.scope === 'position') return ctx.clearance >= row.clearance;
  return false;
}

/**
 * Reads memory for one owner, AS a requesting agent — the gate applies. For a
 * team/position owner the agent must clear the rule in `canRead`; for an agent
 * owner only that agent sees it.
 */
export async function readMemory(
  scope: MemoryScope,
  ownerId: string,
  asAgentKey: string
): Promise<{ ok: boolean; error?: string; entries?: MemoryDTO[] }> {
  if (!isScope(scope)) return { ok: false, error: 'unknown scope' };

  // Agent-scoped memory: only the owner reads it, no clearance involved.
  if (scope === 'agent') {
    if (ownerId !== asAgentKey) return { ok: false, error: 'not your memory' };
    const rows = await prisma.memory.findMany({
      where: { scope, ownerId },
      orderBy: { createdAt: 'desc' },
    });
    return { ok: true, entries: rows.map(toDTO) };
  }

  const ctx = await accessContext(asAgentKey);
  if (!ctx) return { ok: false, error: 'requesting agent not found' };

  const rows = await prisma.memory.findMany({
    where: { scope, ownerId },
    orderBy: { createdAt: 'desc' },
  });
  // Filter each row through the gate rather than one blanket check: a team read
  // is all-or-nothing, but position reads drop entries above the reader's clearance.
  const entries = rows.filter((r) => canRead(ctx, r)).map(toDTO);
  return { ok: true, entries };
}

/** Reads memory WITHOUT the gate — for the owner-management UI (team/position
 *  editors) where the operator is the user, not an in-world agent. */
export async function readMemoryUnfiltered(
  scope: MemoryScope,
  ownerId: string
): Promise<{ ok: boolean; error?: string; entries?: MemoryDTO[] }> {
  if (!isScope(scope)) return { ok: false, error: 'unknown scope' };
  const rows = await prisma.memory.findMany({
    where: { scope, ownerId },
    orderBy: { createdAt: 'desc' },
  });
  return { ok: true, entries: rows.map(toDTO) };
}

export type WriteMemoryInput = {
  scope: MemoryScope;
  ownerId: string;
  kind?: MemoryKind;
  body: string;
  clearance?: number;
  dataType?: number;
  authorAgentKey?: string | null;
};

/** Adds a memory entry. Validates the owner exists for its scope. */
export async function writeMemory(
  input: WriteMemoryInput
): Promise<{ ok: boolean; error?: string; entry?: MemoryDTO }> {
  if (!isScope(input.scope)) {
    return { ok: false, error: `unknown scope '${input.scope}'. Use: agent, position, team.` };
  }
  if (input.kind && !isKind(input.kind)) {
    // Name the valid values. A bare "unknown kind" makes a model guess — it cost
    // two wasted tool calls the first time an agent used this.
    return {
      ok: false,
      error: `unknown kind '${input.kind}'. Use one of: task, result, insight, note.`,
    };
  }
  const body = input.body.trim();
  if (!body) return { ok: false, error: 'body is required' };

  // Confirm the owner exists so memory can't dangle.
  const exists = await ownerExists(input.scope, input.ownerId);
  if (!exists) return { ok: false, error: `no ${input.scope} with that id` };

  const row = await prisma.memory.create({
    data: {
      scope: input.scope,
      ownerId: input.ownerId,
      kind: input.kind ?? 'note',
      body,
      clearance: input.scope === 'position' ? Math.max(0, input.clearance ?? 0) : 0,
      // Applies to every scope, unlike clearance. 1 = Public.
      dataType: Math.max(1, input.dataType ?? 1),
      authorAgentKey: input.authorAgentKey ?? null,
    },
  });
  return { ok: true, entry: toDTO(row) };
}

/** Deletes a memory entry. */
export async function deleteMemory(
  id: string
): Promise<{ ok: boolean; notFound?: boolean }> {
  const exists = await prisma.memory.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { ok: false, notFound: true };
  await prisma.memory.delete({ where: { id } });
  return { ok: true };
}

async function ownerExists(scope: MemoryScope, ownerId: string): Promise<boolean> {
  if (scope === 'team') return (await prisma.team.count({ where: { id: ownerId } })) > 0;
  if (scope === 'position') return (await prisma.position.count({ where: { id: ownerId } })) > 0;
  return (await prisma.agent.count({ where: { key: ownerId } })) > 0;
}

// ---------------------------------------------------------------------------
// Agent-facing memory: the `read_memory` / `write_memory` tools land here.
//
// THE SECURITY RULE, and the reason these live in their own functions: the
// caller's identity and the owner id are derived from the RUN, never from what
// the agent sent. An agent supplies only a SCOPE. If it could name an ownerId it
// could read another seat's memory; if it could name an agentKey it could
// impersonate a higher-clearance reader — and that identity is exactly what
// `readMemory`'s row-level filter keys on.
// ---------------------------------------------------------------------------

/** Resolves a scope to its owner id for a given run, from the run's own seat. */
async function ownerForRun(
  runId: string,
  scope: string
): Promise<{ ok: true; scope: MemoryScope; ownerId: string; agentKey: string } | { ok: false; error: string }> {
  if (!isScope(scope)) {
    return { ok: false, error: `unknown scope '${scope}'. Use 'agent', 'position' or 'team'.` };
  }

  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run?.agentKey) return { ok: false, error: 'this run has no agent identity.' };

  const agent = await prisma.agent.findUnique({
    where: { key: run.agentKey },
    include: { position: true },
  });
  if (!agent) return { ok: false, error: 'the running agent no longer exists.' };

  if (scope === 'agent') return { ok: true, scope, ownerId: agent.key, agentKey: agent.key };
  if (scope === 'position') {
    if (!agent.positionId) {
      return { ok: false, error: 'you hold no seat, so you have no seat memory.' };
    }
    return { ok: true, scope, ownerId: agent.positionId, agentKey: agent.key };
  }
  if (!agent.position?.teamId) {
    return { ok: false, error: 'you are not on a team, so you have no team memory.' };
  }
  return { ok: true, scope, ownerId: agent.position.teamId, agentKey: agent.key };
}

/** `read_memory` — entries in one scope, filtered by the READER's clearance. */
export async function readMemoryForRun(
  runId: string,
  scope: string
): Promise<{ ok: boolean; error?: string; entries?: MemoryDTO[] }> {
  const resolved = await ownerForRun(runId, scope);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  // Straight through the SAME gate the UI uses — no second implementation.
  return readMemory(resolved.scope, resolved.ownerId, resolved.agentKey);
}

/** `write_memory` — records an entry, authored by the running agent. */
export async function writeMemoryForRun(
  runId: string,
  scope: string,
  body: string,
  kind?: string,
  clearance?: number,
  dataType?: number
): Promise<{ ok: boolean; error?: string; entry?: MemoryDTO }> {
  const resolved = await ownerForRun(runId, scope);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  // An agent may not classify an entry ABOVE its own clearance — that would let
  // a junior seat write something it could never read back, and hide it from
  // everyone below that level. `accessContext` is the same resolver the read
  // gate uses, so the two can never disagree.
  const ctx = await accessContext(resolved.agentKey);
  const requested = Number.isFinite(clearance) ? Number(clearance) : 0;
  const capped = Math.max(0, Math.min(requested, ctx?.clearance ?? 0));

  // Same reasoning as clearance: an agent may not classify above its own level,
  // which would hide an entry from itself and from everyone below it.
  const wantType = Number.isFinite(dataType) ? Number(dataType) : 1;
  const cappedType = Math.max(1, Math.min(wantType, ctx?.dataType ?? 1));

  return writeMemory({
    scope: resolved.scope,
    ownerId: resolved.ownerId,
    kind: (kind as MemoryKind) ?? 'insight',
    body,
    clearance: capped,
    dataType: cappedType,
    authorAgentKey: resolved.agentKey,
  });
}
