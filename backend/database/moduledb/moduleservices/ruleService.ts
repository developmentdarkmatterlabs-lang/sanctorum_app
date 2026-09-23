import { prisma } from '../../db';

// Standing rules (Phase 3.8) — "how we always work" directives injected into EVERY
// run of the seats they cover. Distinct from Skills (task playbooks, applied
// situationally) and Memory (history/knowledge, clearance-gated).
//
// Targeting is by SCOPE + INHERITANCE, not per-seat assignment: a seat's effective
// rules = global + its team's + its position's, in that order. Write "always answer
// in English" once at global scope and every agent honours it — the same pattern as
// IAM policies, k8s namespaces, git config, and CLAUDE.md. No clearance gate: a
// rule is a directive, not a secret.

export type RuleScope = 'global' | 'team' | 'position';

export type RuleDTO = {
  id: string;
  title: string;
  body: string;
  scope: RuleScope;
  ownerId: string | null;
  order: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Prompt budget: rules are prepended to EVERY run, so cap the total so a growing
 *  ruleset can't bloat (and inflate the cost of) every single prompt. */
const RULES_CHAR_BUDGET = 4000;

const SCOPES: RuleScope[] = ['global', 'team', 'position'];
export const isRuleScope = (s: unknown): s is RuleScope =>
  typeof s === 'string' && (SCOPES as string[]).includes(s);

type RuleRow = {
  id: string;
  title: string;
  body: string;
  scope: string;
  ownerId: string | null;
  order: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const toDTO = (row: RuleRow): RuleDTO => ({
  id: row.id,
  title: row.title,
  body: row.body,
  scope: (row.scope as RuleScope) ?? 'global',
  ownerId: row.ownerId,
  order: row.order,
  enabled: row.enabled,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

// ---- CRUD -----------------------------------------------------------------

/** All rules, newest scope-grouped ordering. Optionally filter by scope/owner. */
export async function listRules(filter?: {
  scope?: RuleScope;
  ownerId?: string | null;
}): Promise<RuleDTO[]> {
  const rows = await prisma.rule.findMany({
    where: {
      ...(filter?.scope ? { scope: filter.scope } : {}),
      ...(filter?.ownerId !== undefined ? { ownerId: filter.ownerId } : {}),
    },
    orderBy: [{ scope: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toDTO);
}

export type RuleInput = {
  title?: string;
  body?: string;
  scope?: RuleScope;
  ownerId?: string | null;
  order?: number;
  enabled?: boolean;
};

export type RuleResult = { ok: true; rule: RuleDTO } | { ok: false; error: string };

export async function createRule(input: RuleInput): Promise<RuleResult> {
  const title = (input.title ?? '').trim();
  const body = (input.body ?? '').trim();
  if (!title) return { ok: false, error: 'title is required' };
  if (!body) return { ok: false, error: 'body is required' };

  const scope: RuleScope = isRuleScope(input.scope) ? input.scope : 'global';
  // A team/position rule needs to say WHICH team/position it belongs to.
  const ownerId = scope === 'global' ? null : (input.ownerId ?? null);
  if (scope !== 'global' && !ownerId) {
    return { ok: false, error: `a ${scope}-scoped rule needs a ${scope} to belong to` };
  }

  const row = await prisma.rule.create({
    data: {
      title,
      body,
      scope,
      ownerId,
      order: input.order ?? 0,
      enabled: input.enabled ?? true,
    },
  });
  return { ok: true, rule: toDTO(row) };
}

export async function updateRule(
  id: string,
  input: RuleInput
): Promise<RuleResult | { ok: false; notFound: true }> {
  const exists = await prisma.rule.findUnique({ where: { id } });
  if (!exists) return { ok: false, notFound: true };

  const scope = isRuleScope(input.scope) ? input.scope : undefined;
  // Moving to global clears the owner; moving to team/position needs one.
  let ownerId = input.ownerId;
  if (scope === 'global') ownerId = null;
  const nextScope = scope ?? (exists.scope as RuleScope);
  const nextOwner = ownerId !== undefined ? ownerId : exists.ownerId;
  if (nextScope !== 'global' && !nextOwner) {
    return { ok: false, error: `a ${nextScope}-scoped rule needs a ${nextScope} to belong to` };
  }

  const row = await prisma.rule.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.body !== undefined ? { body: input.body.trim() } : {}),
      ...(scope ? { scope } : {}),
      ...(ownerId !== undefined ? { ownerId } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    },
  });
  return { ok: true, rule: toDTO(row) };
}

export async function deleteRule(id: string): Promise<boolean> {
  const exists = await prisma.rule.findUnique({ where: { id } });
  if (!exists) return false;
  await prisma.rule.delete({ where: { id } });
  return true;
}

/** Set the order of several rules at once (drag-to-reorder in the UI). */
export async function reorderRules(items: { id: string; order: number }[]): Promise<void> {
  await prisma.$transaction(
    items.map((i) => prisma.rule.update({ where: { id: i.id }, data: { order: i.order } }))
  );
}

// ---- Run-time: the seat's effective rules ---------------------------------

/**
 * The ENABLED rules a seat must follow: global + its team's + its position's, in
 * that order (broad -> specific), each ordered by `order`. This is the inheritance
 * — no per-seat assignment. An unassigned agent (no team/position) still gets the
 * global rules.
 */
export async function rulesForSeat(
  teamId: string | null,
  positionId: string | null
): Promise<RuleDTO[]> {
  const rows = await prisma.rule.findMany({
    where: {
      enabled: true,
      OR: [
        { scope: 'global' },
        ...(teamId ? [{ scope: 'team', ownerId: teamId }] : []),
        ...(positionId ? [{ scope: 'position', ownerId: positionId }] : []),
      ],
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });

  // Broad -> specific, so a narrower rule reads as a refinement of the broader ones.
  const rank: Record<string, number> = { global: 0, team: 1, position: 2 };
  return rows
    .sort((a, b) => (rank[a.scope] ?? 0) - (rank[b.scope] ?? 0) || a.order - b.order)
    .map(toDTO);
}

/**
 * The rules block to prepend to a run's system prompt, or '' when there are none.
 * Trimmed to a character budget so an ever-growing ruleset can't bloat every
 * prompt (rules beyond the budget are dropped, broadest-first kept).
 */
export function renderRulesBlock(rules: RuleDTO[]): string {
  if (rules.length === 0) return '';
  const lines: string[] = [];
  let used = 0;
  for (const r of rules) {
    const line = `- ${r.title}: ${r.body}`;
    if (used + line.length > RULES_CHAR_BUDGET) break;
    lines.push(line);
    used += line.length;
  }
  if (lines.length === 0) return '';
  return (
    'Standing rules — always follow these, in every response and every step:\n' +
    lines.join('\n')
  );
}
