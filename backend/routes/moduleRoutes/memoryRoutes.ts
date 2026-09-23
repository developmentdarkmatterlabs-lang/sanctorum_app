import { Router } from 'express';
import {
  deleteMemory,
  readMemory,
  readMemoryUnfiltered,
  writeMemory,
  type MemoryScope,
} from '../../database/moduledb/moduleservices/memoryService';

const router = Router();

const SCOPES: MemoryScope[] = ['team', 'position', 'agent'];
const isScope = (s: string): s is MemoryScope => (SCOPES as string[]).includes(s);

/**
 * Read memory for an owner. With `?as=<agentKey>`, the clearance/membership gate
 * applies (what that agent may see). Without it, the management view returns
 * everything unfiltered (the operator is the user, not an in-world agent).
 */
router.get('/:scope/:ownerId', async (req, res) => {
  const { scope, ownerId } = req.params;
  if (!isScope(scope)) return res.status(400).json({ error: 'unknown scope' });
  const asAgent = typeof req.query.as === 'string' ? req.query.as : null;
  try {
    const result = asAgent
      ? await readMemory(scope, ownerId, asAgent)
      : await readMemoryUnfiltered(scope, ownerId);
    if (!result.ok) return res.status(403).json({ error: result.error });
    res.json(result.entries);
  } catch (error) {
    console.error('GET /api/memory/:scope/:ownerId failed:', error);
    res.status(500).json({ error: 'Failed to read memory' });
  }
});

/** Add a memory entry to an owner. */
router.post('/:scope/:ownerId', async (req, res) => {
  const { scope, ownerId } = req.params;
  if (!isScope(scope)) return res.status(400).json({ error: 'unknown scope' });
  const body = String(req.body?.body ?? '');
  const kind = req.body?.kind;
  const clearance = req.body?.clearance;
  const authorAgentKey = req.body?.authorAgentKey ?? null;
  try {
    const result = await writeMemory({
      scope,
      ownerId,
      body,
      kind,
      clearance: clearance === undefined ? undefined : Number(clearance),
      authorAgentKey,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json(result.entry);
  } catch (error) {
    console.error('POST /api/memory/:scope/:ownerId failed:', error);
    res.status(500).json({ error: 'Failed to write memory' });
  }
});

/** Delete a memory entry. */
router.delete('/:id', async (req, res) => {
  try {
    const result = await deleteMemory(req.params.id);
    if (!result.ok) return res.status(404).json({ error: 'Memory not found' });
    res.json({ deleted: true });
  } catch (error) {
    console.error('DELETE /api/memory/:id failed:', error);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

export default router;
