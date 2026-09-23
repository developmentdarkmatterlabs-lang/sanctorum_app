import { prisma } from '../../db';

// Roles (Phase 3.9) — the job architecture. A Role is defined ONCE in a central
// catalog ("Sales Representative", "Staff Software Engineer") and referenced by
// MANY seats: one role, N headcount. Seats INHERIT the role's title and
// defaultClearance live (see positionResolve), so editing a role moves every seat
// holding it — the professional model (job profiles in Workday/SAP, roles in IAM).
//
// DELETE IS BLOCKED while any seat references the role: you must reassign those
// seats first. That's enforced here AND by the FK (onDelete: Restrict), so a stray
// query can't orphan a seat either.

export type RoleDTO = {
  id: string;
  title: string;
  /** Seniority band (0 = unbanded). */
  level: number;
  /** Free text: Engineering / Design / Ops / Sales … */
  discipline: string;
  description: string;
  /** The clearance seats inherit unless they override it. */
  defaultClearance: number;
  /** How many seats currently instantiate this role (headcount). */
  seatCount: number;
  createdAt: string;
  updatedAt: string;
};

type RoleRow = {
  id: string;
  title: string;
  level: number;
  discipline: string;
  description: string;
  defaultClearance: number;
  createdAt: Date;
  updatedAt: Date;
  _count?: { positions: number };
};

const toDTO = (row: RoleRow): RoleDTO => ({
  id: row.id,
  title: row.title,
  level: row.level,
  discipline: row.discipline,
  description: row.description,
  defaultClearance: row.defaultClearance,
  seatCount: row._count?.positions ?? 0,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const clampClearance = (n: number | undefined): number =>
  n === undefined || Number.isNaN(n) ? 1 : Math.max(0, Math.min(8, Math.trunc(n)));

const clampLevel = (n: number | undefined): number =>
  n === undefined || Number.isNaN(n) ? 0 : Math.max(0, Math.trunc(n));

// ---- CRUD -----------------------------------------------------------------

/** The catalog, with each role's current headcount. */
export async function listRoles(): Promise<RoleDTO[]> {
  const rows = await prisma.role.findMany({
    orderBy: [{ discipline: 'asc' }, { level: 'desc' }, { title: 'asc' }],
    include: { _count: { select: { positions: true } } },
  });
  return rows.map(toDTO);
}

/** How many seats hold this role. 0 means it can be deleted. */
/**
 * Does a role with this exact title exist in the catalog?
 *
 * REPLACES a check against the hardcoded taxonomy. `isRole` in utils/taxonomy.ts
 * tested membership of ROLE_SET — the 217 seeded titles — which stopped being the
 * source of truth the moment roles moved into the database. Every role created in
 * the Roles tab, and every mythic role the shipped cast wears, failed it: the
 * dossier OFFERED "Archmage" and the route then rejected the save with
 * `role "Archmage" is not a known role`, taking the rest of the patch
 * (workspaceDir, supervision) down with it.
 *
 * Checking the table is also stricter in the direction that matters: a role you
 * DELETED still passes the static list forever, because a constant cannot know.
 *
 * This gate grants nothing. `Agent.role` is a descriptive label — capability comes
 * from the seat, resolved by positionResolve — so this only keeps the field
 * referentially honest.
 */
export async function roleExists(title: unknown): Promise<boolean> {
  if (typeof title !== 'string' || !title.trim()) return false;
  const row = await prisma.role.findUnique({
    where: { title: title.trim() },
    select: { id: true },
  });
  return row !== null;
}

export async function roleUsage(id: string): Promise<number> {
  return prisma.position.count({ where: { roleId: id } });
}

export type RoleInput = {
  title?: string;
  level?: number;
  discipline?: string;
  description?: string;
  defaultClearance?: number;
};

export type RoleResult = { ok: true; role: RoleDTO } | { ok: false; error: string };

export async function createRole(input: RoleInput): Promise<RoleResult> {
  const title = (input.title ?? '').trim();
  if (!title) return { ok: false, error: 'title is required' };

  const clash = await prisma.role.findUnique({ where: { title } });
  if (clash) return { ok: false, error: `a role titled "${title}" already exists` };

  const row = await prisma.role.create({
    data: {
      title,
      level: clampLevel(input.level),
      discipline: input.discipline?.trim() ?? '',
      description: input.description?.trim() ?? '',
      defaultClearance: clampClearance(input.defaultClearance),
    },
    include: { _count: { select: { positions: true } } },
  });
  return { ok: true, role: toDTO(row) };
}

/**
 * Edit a role. NOTE: changing `title`/`defaultClearance` propagates LIVE to every
 * seat that inherits them (that's the point of the catalog) — seats with an
 * explicit override are unaffected.
 */
export async function updateRole(
  id: string,
  input: RoleInput
): Promise<RoleResult | { ok: false; notFound: true }> {
  const exists = await prisma.role.findUnique({ where: { id } });
  if (!exists) return { ok: false, notFound: true };

  const title = input.title?.trim();
  if (title && title !== exists.title) {
    const clash = await prisma.role.findUnique({ where: { title } });
    if (clash) return { ok: false, error: `a role titled "${title}" already exists` };
  }

  const row = await prisma.role.update({
    where: { id },
    data: {
      ...(title ? { title } : {}),
      ...(input.level !== undefined ? { level: clampLevel(input.level) } : {}),
      ...(input.discipline !== undefined ? { discipline: input.discipline.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.defaultClearance !== undefined
        ? { defaultClearance: clampClearance(input.defaultClearance) }
        : {}),
    },
    include: { _count: { select: { positions: true } } },
  });
  return { ok: true, role: toDTO(row) };
}

export type DeleteRoleResult =
  | { ok: true }
  | { ok: false; notFound: true }
  | { ok: false; error: string; seatCount: number };

/**
 * Delete a role — REFUSED while any seat holds it. Deleting a job that people
 * occupy is exactly what real HR systems forbid; reassign those seats to another
 * role first. (The FK's onDelete: Restrict is the backstop.)
 */
export async function deleteRole(id: string): Promise<DeleteRoleResult> {
  const exists = await prisma.role.findUnique({ where: { id } });
  if (!exists) return { ok: false, notFound: true };

  const seatCount = await roleUsage(id);
  if (seatCount > 0) {
    return {
      ok: false,
      seatCount,
      error: `${seatCount} ${seatCount === 1 ? 'seat holds' : 'seats hold'} this role; reassign ${seatCount === 1 ? 'it' : 'them'} first`,
    };
  }

  await prisma.role.delete({ where: { id } });
  return { ok: true };
}
