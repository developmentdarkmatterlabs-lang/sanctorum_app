import { Router } from 'express';
import {
  createPersonality,
  deletePersonality,
  listPersonalities,
  updatePersonality,
  type PersonalityInput,
} from '../../database/moduledb/moduleservices/personalityService';

// Personalities — who an agent is and how it speaks. Assigned to the AGENT (see
// agentRoutes' personalityId), not the seat.
//   GET    /api/personalities        list
//   POST   /api/personalities        create
//   PATCH  /api/personalities/:id    edit
//   DELETE /api/personalities/:id    delete (frees every agent wearing it)

const router = Router();

function readInput(body: Record<string, unknown>): PersonalityInput {
  const input: PersonalityInput = {};
  if (typeof body.name === 'string') input.name = body.name;
  if (typeof body.summary === 'string') input.summary = body.summary;
  if (typeof body.body === 'string') input.body = body.body;
  if (typeof body.stance === 'string') input.stance = body.stance;
  if (typeof body.enabled === 'boolean') input.enabled = body.enabled;
  return input;
}

router.get('/', async (_req, res) => {
  try {
    res.json(await listPersonalities());
  } catch (error) {
    console.error('GET /api/personalities failed:', error);
    res.status(500).json({ error: 'Failed to list personalities' });
  }
});

router.post('/', async (req, res) => {
  try {
    const result = await createPersonality(readInput(req.body ?? {}));
    if (!result.ok) {
      res.status(400).json({ error: 'error' in result ? result.error : 'invalid personality' });
      return;
    }
    res.status(201).json(result.personality);
  } catch (error) {
    console.error('POST /api/personalities failed:', error);
    res.status(500).json({ error: 'Failed to create personality' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const result = await updatePersonality(req.params.id, readInput(req.body ?? {}));
    if (!result.ok) {
      if ('notFound' in result) {
        res.status(404).json({ error: 'Personality not found' });
        return;
      }
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result.personality);
  } catch (error) {
    console.error('PATCH /api/personalities/:id failed:', error);
    res.status(500).json({ error: 'Failed to update personality' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const removed = await deletePersonality(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Personality not found' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    console.error('DELETE /api/personalities/:id failed:', error);
    res.status(500).json({ error: 'Failed to delete personality' });
  }
});

export default router;
