import { Router } from 'express';
import {
  createRole,
  deleteRole,
  listRoles,
  updateRole,
  type RoleInput,
} from '../../database/moduledb/moduleservices/roleService';

// The role catalog (job architecture). A role is defined once and referenced by
// many seats, which inherit its title/clearance live.
//   GET    /api/roles       the catalog (each with its seat count)
//   POST   /api/roles       create
//   PATCH  /api/roles/:id   edit (propagates to inheriting seats)
//   DELETE /api/roles/:id   delete — 409 while any seat holds it

const router = Router();

function readInput(body: Record<string, unknown>): RoleInput {
  const input: RoleInput = {};
  if (typeof body.title === 'string') input.title = body.title;
  if (body.level !== undefined) input.level = Number(body.level);
  if (typeof body.discipline === 'string') input.discipline = body.discipline;
  if (typeof body.description === 'string') input.description = body.description;
  if (body.defaultClearance !== undefined) {
    input.defaultClearance = Number(body.defaultClearance);
  }
  return input;
}

router.get('/', async (_req, res) => {
  try {
    res.json(await listRoles());
  } catch (error) {
    console.error('GET /api/roles failed:', error);
    res.status(500).json({ error: 'Failed to list roles' });
  }
});

router.post('/', async (req, res) => {
  const input = readInput(req.body ?? {});
  if (!input.title?.trim()) return res.status(400).json({ error: 'title is required' });
  try {
    const result = await createRole(input);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json(result.role);
  } catch (error) {
    console.error('POST /api/roles failed:', error);
    res.status(500).json({ error: 'Failed to create role' });
  }
});

router.patch('/:id', async (req, res) => {
  const input = readInput(req.body ?? {});
  if (Object.keys(input).length === 0) {
    return res.status(400).json({ error: 'no editable fields supplied' });
  }
  try {
    const result = await updateRole(req.params.id, input);
    if (result.ok) return res.json(result.role);
    if ('notFound' in result) return res.status(404).json({ error: 'Role not found' });
    return res.status(400).json({ error: result.error });
  } catch (error) {
    console.error('PATCH /api/roles/:id failed:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await deleteRole(req.params.id);
    if (result.ok) return res.json({ deleted: true });
    if ('notFound' in result) return res.status(404).json({ error: 'Role not found' });
    // In use → 409 Conflict, with the seat count so the UI can be specific.
    return res.status(409).json({ error: result.error, seatCount: result.seatCount });
  } catch (error) {
    console.error('DELETE /api/roles/:id failed:', error);
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

export default router;
