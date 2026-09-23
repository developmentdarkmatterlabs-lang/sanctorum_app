import { prisma } from '../../db';
import { effectiveClearanceOf, effectivePosition } from './positionResolve';

// Teams and Positions — the org model. A Team is a department/squad with a
// mission, an optional home floor, and a set of Positions. A Position is a seat
// held by at most one Agent. Reassigning an agent moves them between positions;
// the position (and its memory/skills/MCPs) stays put.
//
// Phase 3.9: a seat REFERENCES a Role and inherits its title/clearance, unless it
// sets an explicit override. Every title/clearance below is the RESOLVED value —
// see positionResolve.effectivePosition().

/** A held position, with who holds it (for the roster/team views). Title and
 *  clearance are RESOLVED (override ?? role); `overridden` says which are
 *  exceptions rather than inherited. */
export type PositionDTO = {
  id: string;
  teamId: string;
  title: string;
  clearance: number;
  isLeader: boolean;
  order: number;
  /** The agent key currently holding this seat, or null if vacant. */
  agentKey: string | null;
  /** The role this seat instantiates, or null if it has none. */
  roleId: string | null;
  roleTitle: string | null;
  /** Which values are per-seat exceptions rather than inherited. */
  overridden: { title: boolean; clearance: boolean };
};

export type TeamDTO = {
  id: string;
  name: string;
  mission: string;
  floorId: string | null;
  /** The home floor's building order, resolved for the frontend, or null. */
  floorOrder: number | null;
  /** The team this one reports into, or null for a top-level team. Makes the org
   *  a tree, which is what lets a leader delegate to a SUB-TEAM's leader. */
  parentTeamId: string | null;
  positions: PositionDTO[];
};

type TeamRow = Awaited<ReturnType<typeof findTeamRows>>[number];

const findTeamRows = () =>
  prisma.team.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      floor: { select: { order: true } },
      positions: {
        orderBy: { order: 'asc' },
        // `role` is required to resolve the seat's effective title/clearance.
        include: { agent: { select: { key: true } }, role: true },
      },
    },
  });

const toDTO = (row: TeamRow): TeamDTO => ({
  id: row.id,
  name: row.name,
  mission: row.mission,
  floorId: row.floorId,
  floorOrder: row.floor?.order ?? null,
  parentTeamId: row.parentTeamId,
  positions: row.positions.map((p) => {
    const eff = effectivePosition(p, p.role);
    return {
      id: eff.id,
      teamId: eff.teamId,
      title: eff.title,
      clearance: eff.clearance,
      isLeader: eff.isLeader,
      order: eff.order,
      agentKey: p.agent?.key ?? null,
      roleId: eff.roleId,
      roleTitle: eff.roleTitle,
      overridden: eff.overridden,
    };
  }),
});

export async function getAllTeams(): Promise<TeamDTO[]> {
  return (await findTeamRows()).map(toDTO);
}

async function teamDTO(id: string): Promise<TeamDTO | null> {
  const row = await prisma.team.findUnique({
    where: { id },
    include: {
      floor: { select: { order: true } },
      positions: {
        orderBy: { order: 'asc' },
        // `role` is required to resolve the seat's effective title/clearance.
        include: { agent: { select: { key: true } }, role: true },
      },
    },
  });
  return row ? toDTO(row) : null;
}

// ---- team CRUD ------------------------------------------------------------

export type TeamResult =
  | { ok: true; team: TeamDTO }
  | { ok: false; notFound: true }
  | { ok: false; error: string };

/** Creates a team, optionally homed on a floor (by Room id). A floor hosts at
 *  most one team, so a taken floor is refused. */
export async function createTeam(
  name: string,
  mission: string,
  floorId: string | null,
  parentTeamId: string | null = null
): Promise<TeamResult> {
  if (floorId) {
    const taken = await prisma.team.findUnique({ where: { floorId } });
    if (taken) return { ok: false, error: 'that floor already hosts a team' };
  }
  if (parentTeamId) {
    const parent = await prisma.team.findUnique({ where: { id: parentTeamId } });
    if (!parent) return { ok: false, error: 'that parent team does not exist' };
  }
  // A brand-new team has no sub-teams, so it cannot close a cycle here.
  const row = await prisma.team.create({ data: { name, mission, floorId, parentTeamId } });
  return { ok: true, team: (await teamDTO(row.id))! };
}

/**
 * True when making `teamId` a child of `candidateParentId` would create a cycle
 * — i.e. the candidate is `teamId` itself, or already sits somewhere beneath it.
 *
 * This guard cannot be expressed as a foreign key, and it is not cosmetic: a
 * loop in the parent chain would make `delegateTargets` (and any ancestor walk)
 * recurse forever. The `seen` set is belt-and-braces in case a cycle already
 * exists in the data from some earlier state.
 */
export async function wouldCycle(teamId: string, candidateParentId: string): Promise<boolean> {
  if (teamId === candidateParentId) return true;
  const seen = new Set<string>([teamId]);
  let cursor: string | null = candidateParentId;
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const row: { parentTeamId: string | null } | null = await prisma.team.findUnique({
      where: { id: cursor },
      select: { parentTeamId: true },
    });
    cursor = row?.parentTeamId ?? null;
  }
  return false;
}

/** Renames / re-missions / re-homes a team. `floorId: undefined` leaves the
 *  floor unchanged; `null` clears it; a string re-homes (if that floor is free). */
export async function updateTeam(
  id: string,
  patch: {
    name?: string;
    mission?: string;
    floorId?: string | null;
    parentTeamId?: string | null;
  }
): Promise<TeamResult> {
  const exists = await prisma.team.findUnique({ where: { id } });
  if (!exists) return { ok: false, notFound: true };

  if (patch.floorId) {
    const taken = await prisma.team.findUnique({ where: { floorId: patch.floorId } });
    if (taken && taken.id !== id) return { ok: false, error: 'that floor already hosts a team' };
  }

  // Reject a cycle BEFORE writing — afterwards the ancestor walk that would
  // detect it is itself the thing that hangs.
  if (patch.parentTeamId) {
    const parent = await prisma.team.findUnique({ where: { id: patch.parentTeamId } });
    if (!parent) return { ok: false, error: 'that parent team does not exist' };
    if (await wouldCycle(id, patch.parentTeamId)) {
      return {
        ok: false,
        error: 'a team cannot report into itself or into one of its own sub-teams',
      };
    }
  }

  await prisma.team.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.mission !== undefined ? { mission: patch.mission } : {}),
      ...(patch.floorId !== undefined ? { floorId: patch.floorId } : {}),
      ...(patch.parentTeamId !== undefined ? { parentTeamId: patch.parentTeamId } : {}),
    },
  });
  return { ok: true, team: (await teamDTO(id))! };
}

/** Deletes a team. Positions cascade; any agents holding them are unassigned
 *  (positionId set null by the FK). */
export async function deleteTeam(id: string): Promise<{ ok: boolean; notFound?: boolean }> {
  const exists = await prisma.team.findUnique({ where: { id } });
  if (!exists) return { ok: false, notFound: true };
  await prisma.team.delete({ where: { id } });
  return { ok: true };
}

// ---- position CRUD --------------------------------------------------------

/** Adds a position to a team. If `isLeader`, any existing leader is demoted so
 *  a team has exactly one leader. `order` defaults to the next slot. */
export async function createPosition(
  teamId: string,
  input: {
    /** The role this seat instantiates; it inherits the role's title/clearance. */
    roleId?: string | null;
    /** Per-seat exceptions. Omit (or null) to inherit from the role. */
    titleOverride?: string | null;
    clearanceOverride?: number | null;
    isLeader?: boolean;
  }
): Promise<TeamResult> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, include: { positions: true } });
  if (!team) return { ok: false, notFound: true };

  const nextOrder = team.positions.reduce((m, p) => Math.max(m, p.order + 1), 0);
  await prisma.$transaction(async (tx) => {
    if (input.isLeader) {
      await tx.position.updateMany({ where: { teamId, isLeader: true }, data: { isLeader: false } });
    }
    await tx.position.create({
      data: {
        teamId,
        roleId: input.roleId ?? null,
        titleOverride: input.titleOverride ?? null,
        clearanceOverride: input.clearanceOverride ?? null,
        isLeader: input.isLeader ?? false,
        order: nextOrder,
      },
    });
  });
  return { ok: true, team: (await teamDTO(teamId))! };
}

/** Edits a position. Promoting to leader demotes the current leader. */
export async function updatePosition(
  positionId: string,
  patch: {
    roleId?: string | null;
    /** Setting a value creates a per-seat exception; passing null CLEARS it, so the
     *  seat goes back to inheriting from its role. */
    titleOverride?: string | null;
    clearanceOverride?: number | null;
    isLeader?: boolean;
  }
): Promise<TeamResult> {
  const pos = await prisma.position.findUnique({ where: { id: positionId } });
  if (!pos) return { ok: false, notFound: true };

  await prisma.$transaction(async (tx) => {
    if (patch.isLeader === true) {
      await tx.position.updateMany({
        where: { teamId: pos.teamId, isLeader: true, id: { not: positionId } },
        data: { isLeader: false },
      });
    }
    await tx.position.update({
      where: { id: positionId },
      data: {
        ...(patch.roleId !== undefined ? { roleId: patch.roleId } : {}),
        ...(patch.titleOverride !== undefined ? { titleOverride: patch.titleOverride } : {}),
        ...(patch.clearanceOverride !== undefined
          ? { clearanceOverride: patch.clearanceOverride }
          : {}),
        ...(patch.isLeader !== undefined ? { isLeader: patch.isLeader } : {}),
      },
    });
  });
  return { ok: true, team: (await teamDTO(pos.teamId))! };
}

/** Deletes a position. Its holder (if any) is unassigned via the FK. */
export async function deletePosition(
  positionId: string
): Promise<{ ok: boolean; notFound?: boolean; teamId?: string }> {
  const pos = await prisma.position.findUnique({ where: { id: positionId } });
  if (!pos) return { ok: false, notFound: true };
  await prisma.position.delete({ where: { id: positionId } });
  return { ok: true, teamId: pos.teamId };
}

// ---- assignment -----------------------------------------------------------

export type AssignResult =
  | { ok: true }
  | { ok: false; notFound: true }
  | { ok: false; error: string };

/**
 * Assigns an agent to a position. One agent per position and one position per
 * agent: the target must be vacant, and the agent leaves whatever position it
 * held (that seat's memory stays behind for the next holder). Clearance now
 * flows from the position — see effectiveClearance.
 */
export async function assignAgent(agentKey: string, positionId: string): Promise<AssignResult> {
  const agent = await prisma.agent.findUnique({ where: { key: agentKey } });
  if (!agent) return { ok: false, notFound: true };

  const position = await prisma.position.findUnique({
    where: { id: positionId },
    include: { agent: { select: { key: true } } },
  });
  if (!position) return { ok: false, notFound: true };

  if (position.agent && position.agent.key !== agentKey) {
    return { ok: false, error: 'that position is already held by another agent' };
  }

  // positionId is unique on Agent; setting it moves the agent, freeing the old
  // seat automatically.
  await prisma.agent.update({ where: { key: agentKey }, data: { positionId } });
  return { ok: true };
}

/** Removes an agent from its position (back to the bench). */
export async function unassignAgent(agentKey: string): Promise<AssignResult> {
  const agent = await prisma.agent.findUnique({ where: { key: agentKey } });
  if (!agent) return { ok: false, notFound: true };
  await prisma.agent.update({ where: { key: agentKey }, data: { positionId: null } });
  return { ok: true };
}

/**
 * An agent's effective clearance: the held position's clearance, or 0 when
 * unassigned (no standing access). Clearance is the seat's, not the character's,
 * so a benched agent carries none. The single source of truth for gating.
 */
export async function effectiveClearance(agentKey: string): Promise<number | null> {
  const agent = await prisma.agent.findUnique({
    where: { key: agentKey },
    // The role is needed to resolve an inherited clearance.
    include: { position: { select: { clearanceOverride: true, role: true } } },
  });
  if (!agent) return null;
  if (!agent.position) return 0;
  return effectiveClearanceOf(agent.position, agent.position.role);
}
