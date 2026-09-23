import { Router } from 'express';
import {
  createTeamThread,
  deleteThread,
  getMessages,
  getOrCreateAgentThread,
  listThreads,
  markThreadRead,
  sendMessage,
  unreadTotal,
} from '../../database/moduledb/moduleservices/inboxService';

const router = Router();

/** All threads with unread counts + previews. */
router.get('/threads', async (_req, res) => {
  try {
    res.json(await listThreads());
  } catch (error) {
    console.error('GET /api/inbox/threads failed:', error);
    res.status(500).json({ error: 'Failed to load threads' });
  }
});

/** Total unread, for the top-level badge. */
router.get('/unread', async (_req, res) => {
  try {
    res.json({ unread: await unreadTotal() });
  } catch (error) {
    console.error('GET /api/inbox/unread failed:', error);
    res.status(500).json({ error: 'Failed to count unread' });
  }
});

/** Open (or create) the DM thread for an agent. */
router.post('/threads/agent/:agentKey', async (req, res) => {
  try {
    res.status(201).json(await getOrCreateAgentThread(req.params.agentKey));
  } catch (error) {
    console.error('POST /api/inbox/threads/agent/:agentKey failed:', error);
    res.status(500).json({ error: 'Failed to open thread' });
  }
});

/** Create a team broadcast thread. */
router.post('/threads/team/:teamId', async (req, res) => {
  const subject = String(req.body?.subject ?? '').trim();
  try {
    res.status(201).json(await createTeamThread(req.params.teamId, subject));
  } catch (error) {
    console.error('POST /api/inbox/threads/team/:teamId failed:', error);
    res.status(500).json({ error: 'Failed to open team thread' });
  }
});

/** Messages in a thread. */
router.get('/threads/:threadId/messages', async (req, res) => {
  try {
    const messages = await getMessages(req.params.threadId);
    if (messages === null) return res.status(404).json({ error: 'Thread not found' });
    res.json(messages);
  } catch (error) {
    console.error('GET /api/inbox/threads/:threadId/messages failed:', error);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

/** Send a message; the (stubbed) agent reply comes back in the returned list. */
router.post('/threads/:threadId/messages', async (req, res) => {
  const body = String(req.body?.body ?? '');
  if (!body.trim()) return res.status(400).json({ error: 'body is required' });
  // Phase 3 (optional): a user-set success criterion for the worker-evaluator
  // loop. Omitted → the AI service derives one from the task.
  const successCriteria =
    typeof req.body?.successCriteria === 'string' && req.body.successCriteria.trim()
      ? req.body.successCriteria.trim()
      : undefined;
  try {
    const result = await sendMessage(req.params.threadId, body, { successCriteria });
    if (!result.ok && result.notFound) return res.status(404).json({ error: 'Thread not found' });
    res.status(201).json(result.messages);
  } catch (error) {
    console.error('POST /api/inbox/threads/:threadId/messages failed:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/** Mark a thread read (clears its unread badge). */
router.patch('/threads/:threadId/read', async (req, res) => {
  try {
    const result = await markThreadRead(req.params.threadId);
    if (!result.ok) return res.status(404).json({ error: 'Thread not found' });
    res.json({ read: true });
  } catch (error) {
    console.error('PATCH /api/inbox/threads/:threadId/read failed:', error);
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

/** Delete a thread. */
router.delete('/threads/:threadId', async (req, res) => {
  try {
    const result = await deleteThread(req.params.threadId);
    if (!result.ok) return res.status(404).json({ error: 'Thread not found' });
    res.json({ deleted: true });
  } catch (error) {
    console.error('DELETE /api/inbox/threads/:threadId failed:', error);
    res.status(500).json({ error: 'Failed to delete thread' });
  }
});

export default router;
