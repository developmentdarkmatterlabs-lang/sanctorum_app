// THE resolver for live role inheritance (Phase 3.9).
//
// A seat (Position) references a Role and INHERITS its title/clearance. A seat may
// set an explicit override when it genuinely differs:
//
//   effective title     = seat.titleOverride     ?? role.title            ?? '(untitled seat)'
//   effective clearance = seat.clearanceOverride ?? role.defaultClearance ?? 0
//
// Null override = inherit. Set = a deliberate, visible exception.
//
// EVERY read of a seat's title/clearance goes through here — the DTOs, the dossier,
// the skill/MCP assignment guardrails, and (critically) the two SECURITY gates: the
// tool grant in buildRunSpec and the memory read gate. Keeping the rule in one file
// is what guarantees those two agree. Do not inline `?? role.x` anywhere else.

/** The seat fields this resolver needs. Matches the Prisma row shape. */
export type ResolvablePosition = {
  id: string;
  teamId: string;
  roleId: string | null;
  titleOverride: string | null;
  clearanceOverride: number | null;
  isLeader: boolean;
  order: number;
};

/** The role fields this resolver needs (null when the seat has no role). */
export type ResolvableRole = {
  id: string;
  title: string;
  defaultClearance: number;
  level?: number;
  discipline?: string;
} | null;

/** A seat's effective values, plus which of them are overridden (so the UI can
 *  show an exception rather than letting it drift invisibly). */
export type EffectivePosition = {
  id: string;
  teamId: string;
  title: string;
  clearance: number;
  roleId: string | null;
  /** The role's own title, for "inherits from X" display. Null when unassigned. */
  roleTitle: string | null;
  isLeader: boolean;
  order: number;
  overridden: { title: boolean; clearance: boolean };
};

/** A seat with no role and no override still needs a title to render. */
const UNTITLED = '(untitled seat)';

/**
 * Resolve one seat against its role. `role` may be null (seat has no role yet, or
 * the caller didn't include it) — then only the overrides apply, and clearance
 * falls back to 0 (no standing access), which is the safe default.
 */
export function effectivePosition(
  position: ResolvablePosition,
  role: ResolvableRole
): EffectivePosition {
  const title = position.titleOverride ?? role?.title ?? UNTITLED;
  // Clearance defaults to 0, never 1: an unresolvable seat must not silently grant
  // more than "no standing access".
  const clearance = position.clearanceOverride ?? role?.defaultClearance ?? 0;

  return {
    id: position.id,
    teamId: position.teamId,
    title,
    clearance,
    roleId: position.roleId,
    roleTitle: role?.title ?? null,
    isLeader: position.isLeader,
    order: position.order,
    overridden: {
      title: position.titleOverride !== null,
      clearance: position.clearanceOverride !== null,
    },
  };
}

/** Just the clearance — the hot path for the gates (tool grant, memory read,
 *  skill/MCP assignment). Same rule as above; never diverges from it. */
export function effectiveClearanceOf(
  position: Pick<ResolvablePosition, 'clearanceOverride'>,
  role: Pick<NonNullable<ResolvableRole>, 'defaultClearance'> | null
): number {
  return position.clearanceOverride ?? role?.defaultClearance ?? 0;
}

/** Just the title, for prompts/labels. */
export function effectiveTitleOf(
  position: Pick<ResolvablePosition, 'titleOverride'>,
  role: Pick<NonNullable<ResolvableRole>, 'title'> | null
): string {
  return position.titleOverride ?? role?.title ?? UNTITLED;
}
