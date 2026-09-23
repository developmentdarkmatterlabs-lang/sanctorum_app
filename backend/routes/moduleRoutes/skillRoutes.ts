import { Router } from 'express';
import {
  assignSkill,
  createSkill,
  deleteSkill,
  listSkills,
  skillsForPosition,
  unassignSkill,
  updateSkill,
} from '../../database/moduledb/moduleservices/skillService';

// The skill library + assignment surface. Skills are shared .md playbooks assigned
// to POSITIONS (seats); the run-time injection lives in inboxService.buildRunSpec.
//   GET    /api/skills                         list the library
//   POST   /api/skills                         create a skill
//   PATCH  /api/skills/:id                     edit a skill
//   DELETE /api/skills/:id                     delete a skill (assignments cascade)
//   GET    /api/skills/position/:positionId    skills held by a position
//   POST   /api/skills/position/:positionId    assign { skillId }
//   DELETE /api/skills/position/:positionId/:skillId  unassign

const router = Router();

router.get('/', async (_req, res) => {
  try {
    res.json(await listSkills());
  } catch (error) {
    console.error('GET /api/skills failed:', error);
    res.status(500).json({ error: 'Failed to list skills' });
  }
});

router.post('/', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const body = String(req.body?.body ?? '');
  if (!name || !body.trim()) {
    return res.status(400).json({ error: 'name and body are required' });
  }
  try {
    const result = await createSkill({
      name,
      body,
      description: typeof req.body?.description === 'string' ? req.body.description : undefined,
      minClearance:
        req.body?.minClearance !== undefined ? Number(req.body.minClearance) : undefined,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json(result.skill);
  } catch (error) {
    console.error('POST /api/skills failed:', error);
    res.status(500).json({ error: 'Failed to create skill' });
  }
});

router.patch('/:id', async (req, res) => {
  const update: Parameters<typeof updateSkill>[1] = {};
  if (typeof req.body?.name === 'string') update.name = req.body.name;
  if (typeof req.body?.description === 'string') update.description = req.body.description;
  if (typeof req.body?.body === 'string') update.body = req.body.body;
  if (req.body?.minClearance !== undefined) update.minClearance = Number(req.body.minClearance);
  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'no editable fields supplied' });
  }
  try {
    const result = await updateSkill(req.params.id, update);
    if (result.ok) return res.json(result.skill);
    if ('notFound' in result) return res.status(404).json({ error: 'Skill not found' });
    return res.status(400).json({ error: result.error });
  } catch (error) {
    console.error('PATCH /api/skills/:id failed:', error);
    res.status(500).json({ error: 'Failed to update skill' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteSkill(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Skill not found' });
    res.json({ deleted: true });
  } catch (error) {
    console.error('DELETE /api/skills/:id failed:', error);
    res.status(500).json({ error: 'Failed to delete skill' });
  }
});

router.get('/position/:positionId', async (req, res) => {
  try {
    res.json(await skillsForPosition(req.params.positionId));
  } catch (error) {
    console.error('GET /api/skills/position/:positionId failed:', error);
    res.status(500).json({ error: 'Failed to list position skills' });
  }
});

router.post('/position/:positionId', async (req, res) => {
  const skillId = String(req.body?.skillId ?? '').trim();
  if (!skillId) return res.status(400).json({ error: 'skillId is required' });
  try {
    const result = await assignSkill(req.params.positionId, skillId);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/skills/position/:positionId failed:', error);
    res.status(500).json({ error: 'Failed to assign skill' });
  }
});

router.delete('/position/:positionId/:skillId', async (req, res) => {
  try {
    await unassignSkill(req.params.positionId, req.params.skillId);
    res.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/skills/position/:positionId/:skillId failed:', error);
    res.status(500).json({ error: 'Failed to unassign skill' });
  }
});

export default router;
