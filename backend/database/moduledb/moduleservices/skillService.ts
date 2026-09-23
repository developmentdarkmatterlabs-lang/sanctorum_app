import { prisma } from '../../db';
import { effectiveClearanceOf } from './positionResolve';

// Skills — a shared library of .md playbooks that teach an agent how to do a
// certain kind of task. Assigned to POSITIONS (seats), so whoever holds the seat
// inherits them, mirroring how clearance and memory live on the seat. At run time
// buildRunSpec loads a position's skills and injects them into the system prompt.
// A skill's `minClearance` gates assignment: a seat below it can't be granted the
// skill (enforced here, in the service).

export type SkillDTO = {
  id: string;
  name: string;
  description: string;
  body: string;
  minClearance: number;
  createdAt: string;
  updatedAt: string;
};

const toDTO = (row: {
  id: string;
  name: string;
  description: string;
  body: string;
  minClearance: number;
  createdAt: Date;
  updatedAt: Date;
}): SkillDTO => ({
  id: row.id,
  name: row.name,
  description: row.description,
  body: row.body,
  minClearance: row.minClearance,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

// ---- Library CRUD ---------------------------------------------------------

export async function listSkills(): Promise<SkillDTO[]> {
  const rows = await prisma.skill.findMany({ orderBy: { name: 'asc' } });
  return rows.map(toDTO);
}

export type CreateSkillInput = {
  name: string;
  description?: string;
  body: string;
  minClearance?: number;
};

export type SkillResult =
  | { ok: true; skill: SkillDTO }
  | { ok: false; error: string };

export async function createSkill(input: CreateSkillInput): Promise<SkillResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'name is required' };
  if (!input.body.trim()) return { ok: false, error: 'body is required' };

  const clash = await prisma.skill.findUnique({ where: { name } });
  if (clash) return { ok: false, error: `a skill named "${name}" already exists` };

  const row = await prisma.skill.create({
    data: {
      name,
      description: input.description?.trim() ?? '',
      body: input.body,
      minClearance: clampClearance(input.minClearance),
    },
  });
  return { ok: true, skill: toDTO(row) };
}

export type UpdateSkillInput = {
  name?: string;
  description?: string;
  body?: string;
  minClearance?: number;
};

export async function updateSkill(
  id: string,
  input: UpdateSkillInput
): Promise<SkillResult | { ok: false; notFound: true }> {
  const exists = await prisma.skill.findUnique({ where: { id } });
  if (!exists) return { ok: false, notFound: true };

  const name = input.name?.trim();
  if (name && name !== exists.name) {
    const clash = await prisma.skill.findUnique({ where: { name } });
    if (clash) return { ok: false, error: `a skill named "${name}" already exists` };
  }

  const row = await prisma.skill.update({
    where: { id },
    data: {
      ...(name ? { name } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.minClearance !== undefined
        ? { minClearance: clampClearance(input.minClearance) }
        : {}),
    },
  });
  return { ok: true, skill: toDTO(row) };
}

export async function deleteSkill(id: string): Promise<boolean> {
  const exists = await prisma.skill.findUnique({ where: { id } });
  if (!exists) return false;
  // The join rows cascade (onDelete: Cascade), so assignments clear with it.
  await prisma.skill.delete({ where: { id } });
  return true;
}

// ---- Assignment (skill <-> position) --------------------------------------

/** The skills a position holds, ordered by name. Used at run time and by the UI. */
export async function skillsForPosition(positionId: string): Promise<SkillDTO[]> {
  const links = await prisma.positionSkill.findMany({
    where: { positionId },
    include: { skill: true },
  });
  return links
    .map((l) => toDTO(l.skill))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type AssignResult =
  | { ok: true }
  | { ok: false; error: string };

/** Grant a skill to a position. Refused if the seat's clearance is below the
 *  skill's minClearance (the assignment guardrail). Idempotent. */
export async function assignSkill(
  positionId: string,
  skillId: string
): Promise<AssignResult> {
  const [position, skill] = await Promise.all([
    // The role is needed to resolve an inherited clearance (Phase 3.9).
    prisma.position.findUnique({ where: { id: positionId }, include: { role: true } }),
    prisma.skill.findUnique({ where: { id: skillId } }),
  ]);
  if (!position) return { ok: false, error: 'position not found' };
  if (!skill) return { ok: false, error: 'skill not found' };
  const seatClearance = effectiveClearanceOf(position, position.role);
  if (seatClearance < skill.minClearance) {
    return {
      ok: false,
      error: `this seat's clearance (${seatClearance}) is below the skill's minimum (${skill.minClearance})`,
    };
  }
  await prisma.positionSkill.upsert({
    where: { positionId_skillId: { positionId, skillId } },
    update: {},
    create: { positionId, skillId },
  });
  return { ok: true };
}

/** Remove a skill from a position. Idempotent. */
export async function unassignSkill(positionId: string, skillId: string): Promise<void> {
  await prisma.positionSkill.deleteMany({ where: { positionId, skillId } });
}

function clampClearance(n: number | undefined): number {
  if (n === undefined || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(8, Math.trunc(n)));
}
