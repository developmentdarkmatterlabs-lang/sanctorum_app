import { prisma } from '../../db';

// Personality — who an agent IS and how it speaks. Distinct from Rules (how we
// always work), Skills (task playbooks) and Memory (what happened before).
//
// Assigned to the AGENT, not the seat: the one deliberate exception to
// seat-derived capability. Move Ebon to another desk and its clearance, skills
// and MCP servers all change; its voice should not.

export type PersonalityDTO = {
  id: string;
  name: string;
  summary: string;
  body: string;
  stance: string;
  enabled: boolean;
  /** How many agents currently wear it — a delete is never silent. */
  agentCount: number;
  createdAt: string;
  updatedAt: string;
};

/** Prompt budget: the block leads EVERY run, so a long voice would inflate the
 *  cost of every prompt. */
const BODY_CHAR_BUDGET = 3000;

/** Used when a personality leaves `stance` blank. Honest, one sentence, and it
 *  keeps the character rather than surrendering to the assistant default. */
export const DEFAULT_STANCE =
  'If asked directly whether you are an AI, say so plainly in one sentence and ' +
  'continue in character. Never claim to be human, and never lecture about it.';

type Row = {
  id: string;
  name: string;
  summary: string;
  body: string;
  stance: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count?: { agents: number };
};

const toDTO = (row: Row): PersonalityDTO => ({
  id: row.id,
  name: row.name,
  summary: row.summary,
  body: row.body,
  stance: row.stance,
  enabled: row.enabled,
  agentCount: row._count?.agents ?? 0,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

// ---- CRUD -----------------------------------------------------------------

export async function listPersonalities(): Promise<PersonalityDTO[]> {
  const rows = await prisma.personality.findMany({
    orderBy: [{ name: 'asc' }],
    include: { _count: { select: { agents: true } } },
  });
  return rows.map(toDTO);
}

export type PersonalityInput = {
  name?: string;
  summary?: string;
  body?: string;
  stance?: string;
  enabled?: boolean;
};

export type PersonalityResult =
  | { ok: true; personality: PersonalityDTO }
  | { ok: false; error: string }
  | { ok: false; notFound: true };

export async function createPersonality(input: PersonalityInput): Promise<PersonalityResult> {
  const name = (input.name ?? '').trim();
  const body = (input.body ?? '').trim();
  if (!name) return { ok: false, error: 'name is required' };
  if (!body) return { ok: false, error: 'a voice is required' };

  const row = await prisma.personality.create({
    data: {
      name,
      summary: (input.summary ?? '').trim(),
      body,
      stance: (input.stance ?? '').trim(),
      enabled: input.enabled ?? true,
    },
    include: { _count: { select: { agents: true } } },
  });
  return { ok: true, personality: toDTO(row) };
}

export async function updatePersonality(
  id: string,
  input: PersonalityInput
): Promise<PersonalityResult> {
  const exists = await prisma.personality.findUnique({ where: { id } });
  if (!exists) return { ok: false, notFound: true };

  const name = input.name !== undefined ? input.name.trim() : undefined;
  const body = input.body !== undefined ? input.body.trim() : undefined;
  if (name !== undefined && !name) return { ok: false, error: 'name is required' };
  if (body !== undefined && !body) return { ok: false, error: 'a voice is required' };

  const row = await prisma.personality.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(input.summary !== undefined ? { summary: input.summary.trim() } : {}),
      ...(input.stance !== undefined ? { stance: input.stance.trim() } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    },
    include: { _count: { select: { agents: true } } },
  });
  return { ok: true, personality: toDTO(row) };
}

/** Deleting frees every agent wearing it (Agent.personalityId is SetNull), so an
 *  agent is never deleted along with its voice. */
export async function deletePersonality(id: string): Promise<boolean> {
  const exists = await prisma.personality.findUnique({ where: { id } });
  if (!exists) return false;
  await prisma.personality.delete({ where: { id } });
  return true;
}

// ---- Prompt ---------------------------------------------------------------

/**
 * The block that leads the system prompt.
 *
 * Ahead of rules and the role: identity before instruction reads better to every
 * model, and the reply that prompted this feature — an agent answering "who are
 * you?" as a language model rather than as itself — is what happens when the
 * persona is a label instead of an instruction.
 */
export function renderPersonalityBlock(p: {
  name: string;
  body: string;
  stance: string;
} | null): string {
  if (!p) return '';
  const body = p.body.length > BODY_CHAR_BUDGET ? p.body.slice(0, BODY_CHAR_BUDGET) : p.body;
  const stance = p.stance.trim() || DEFAULT_STANCE;
  return `You are ${p.name}. This is who you are and how you speak:\n${body}\n\n${stance}`;
}

/**
 * A SHORT reminder re-injected on every retry.
 *
 * `_worker_system_prompt` rebuilds the prompt each attempt, but it stacks the
 * success criterion and the evaluator's feedback AFTER the system prompt — so by
 * attempt three the voice is buried under corrections and the model drifts back
 * to its defaults. This is the last thing it reads before working.
 */
export function renderPersonaReminder(p: { name: string; stance: string } | null): string {
  if (!p) return '';
  return `Answer as ${p.name}, in your own voice. ${p.stance.trim() || DEFAULT_STANCE}`;
}

/** The personality an agent wears, or null. */
export async function personalityForAgent(agentKey: string) {
  const agent = await prisma.agent.findUnique({
    where: { key: agentKey },
    include: { personality: true },
  });
  const p = agent?.personality;
  // A disabled personality is off for everyone wearing it, without unassigning.
  return p && p.enabled ? p : null;
}
