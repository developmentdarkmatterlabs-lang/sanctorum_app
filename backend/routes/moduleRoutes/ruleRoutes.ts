import { Router } from 'express';
import {
  createRule,
  deleteRule,
  isRuleScope,
  listRules,
  reorderRules,
  rulesForSeat,
  updateRule,
  type RuleInput,
} from '../../database/moduledb/moduleservices/ruleService';

// Standing rules — "how we always work", injected into every run of the seats in
// scope. Scope-based (global | team | position) with inheritance; no per-seat
// assignment, no clearance gate.
//   GET    /api/rules                 list (?scope=&ownerId=)
//   GET    /api/rules/effective       the rules a seat follows (?teamId=&positionId=)
//   POST   /api/rules                 create
//   PATCH  /api/rules/reorder         [{ id, order }]
//   PATCH  /api/rules/:id             edit
//   DELETE /api/rules/:id             delete

const router = Router();

function readInput(body: Record<string, unknown>): RuleInput {
  const input: RuleInput = {};
  if (typeof body.title === 'string') input.title = body.title;
  if (typeof body.body === 'string') input.body = body.body;
  if (isRuleScope(body.scope)) input.scope = body.scope;
  if (typeof body.ownerId === 'string' || body.ownerId === null)
    input.ownerId = body.ownerId as string | null;
  if (body.order !== undefined) input.order = Number(body.order);
  if (typeof body.enabled === 'boolean') input.enabled = body.enabled;
  return input;
}

router.get('/', async (req, res) => {
  try {
    const scope = isRuleScope(req.query.scope) ? req.query.scope : undefined;
    const ownerId = typeof req.query.ownerId === 'string' ? req.query.ownerId : undefined;
    res.json(await listRules({ scope, ...(ownerId !== undefined ? { ownerId } : {}) }));
  } catch (error) {
    console.error('GET /api/rules failed:', error);
    res.status(500).json({ error: 'Failed to list rules' });
  }
});

/** The rules a given seat actually follows (global + team + position, inherited).
 *  Used by the dossier's read-only "Rules in effect" panel. */
router.get('/effective', async (req, res) => {
  const teamId = typeof req.query.teamId === 'string' ? req.query.teamId : null;
  const positionId = typeof req.query.positionId === 'string' ? req.query.positionId : null;
  try {
    res.json(await rulesForSeat(teamId, positionId));
  } catch (error) {
    console.error('GET /api/rules/effective failed:', error);
    res.status(500).json({ error: 'Failed to resolve rules' });
  }
});

router.post('/', async (req, res) => {
  const input = readInput(req.body ?? {});
  try {
    const result = await createRule(input);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json(result.rule);
  } catch (error) {
    console.error('POST /api/rules failed:', error);
    res.status(500).json({ error: 'Failed to create rule' });
  }
});

/** Bulk reorder — must be declared before '/:id' so it isn't captured by it. */
router.patch('/reorder', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items) return res.status(400).json({ error: 'items array is required' });
  const clean = items
    .filter((i: unknown): i is { id: string; order: number } =>
      typeof (i as { id?: unknown })?.id === 'string'
    )
    .map((i: { id: string; order: number }) => ({ id: i.id, order: Number(i.order) || 0 }));
  try {
    await reorderRules(clean);
    res.json({ ok: true });
  } catch (error) {
    console.error('PATCH /api/rules/reorder failed:', error);
    res.status(500).json({ error: 'Failed to reorder rules' });
  }
});

router.patch('/:id', async (req, res) => {
  const input = readInput(req.body ?? {});
  if (Object.keys(input).length === 0) {
    return res.status(400).json({ error: 'no editable fields supplied' });
  }
  try {
    const result = await updateRule(req.params.id, input);
    if (result.ok) return res.json(result.rule);
    if ('notFound' in result) return res.status(404).json({ error: 'Rule not found' });
    return res.status(400).json({ error: result.error });
  } catch (error) {
    console.error('PATCH /api/rules/:id failed:', error);
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteRule(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Rule not found' });
    res.json({ deleted: true });
  } catch (error) {
    console.error('DELETE /api/rules/:id failed:', error);
    res.status(500).json({ error: 'Failed to delete rule' });
  }
});

export default router;
