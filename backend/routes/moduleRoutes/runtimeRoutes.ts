import { browserAction, type BrowserAction } from '../../database/moduledb/moduleservices/browserService';
import { Router } from 'express';
import {
  cancelRun,
  decideRun,
  ingestEvent,
  redirectRun,
  sendMessage,
} from '../../database/moduledb/moduleservices/inboxService';
import { delegate } from '../../database/moduledb/moduleservices/delegationService';
import { treeFor } from '../../database/moduledb/moduleservices/runTreeService';
import {
  readMemoryForRun,
  writeMemoryForRun,
} from '../../database/moduledb/moduleservices/memoryService';
import type { ApprovalDecision, RuntimeEvent } from '../../runtime/AgentRuntime';

const router = Router();

// The runtime seam's HTTP surface. `/dispatch` starts a run for a thread (the
// same path the inbox uses on send, exposed for direct/programmatic triggers).
// `/events` is the webhook an out-of-process runtime (the Python service) POSTs
// RuntimeEvents to, which land in the thread exactly as the in-process stub's do.

/** Start a run: append the task to a thread and dispatch it. */
router.post('/dispatch', async (req, res) => {
  const threadId = String(req.body?.threadId ?? '').trim();
  const task = String(req.body?.task ?? '').trim();
  if (!threadId || !task) {
    return res.status(400).json({ error: 'threadId and task are required' });
  }
  try {
    const result = await sendMessage(threadId, task);
    if (!result.ok && result.notFound) return res.status(404).json({ error: 'Thread not found' });
    res.status(202).json({ dispatched: true, messages: result.messages });
  } catch (error) {
    console.error('POST /api/runtime/dispatch failed:', error);
    res.status(500).json({ error: 'Failed to dispatch run' });
  }
});

const EVENT_TYPES = [
  'started',
  'status',
  'message',
  'result',
  'awaiting_approval',
  'criteria',
  'evaluated',
  'done',
  'error',
];

/** Webhook: ingest one RuntimeEvent from an out-of-process runtime. */
router.post('/events', async (req, res) => {
  const e = req.body ?? {};
  if (typeof e.threadId !== 'string' || !EVENT_TYPES.includes(e.type)) {
    return res.status(400).json({ error: 'invalid runtime event' });
  }
  const event: RuntimeEvent = {
    runId: String(e.runId ?? ''),
    threadId: e.threadId,
    agentKey: typeof e.agentKey === 'string' ? e.agentKey : null,
    type: e.type,
    body: typeof e.body === 'string' ? e.body : undefined,
    ref: typeof e.ref === 'string' ? e.ref : undefined,
  };
  try {
    const result = await ingestEvent(event);
    if (!result.ok) return res.status(404).json({ error: 'Thread not found' });
    res.json({ ingested: true });
  } catch (error) {
    console.error('POST /api/runtime/events failed:', error);
    res.status(500).json({ error: 'Failed to ingest event' });
  }
});

/** Answer a supervised run's pause: proceed / stop / edit. Relays to the runtime,
 *  which resumes or cancels the run. */
router.post('/runs/:runId/decision', async (req, res) => {
  const threadId = String(req.body?.threadId ?? '').trim();
  const decisionKind = req.body?.decision;
  if (!threadId || !['proceed', 'stop', 'edit'].includes(decisionKind)) {
    return res.status(400).json({ error: 'threadId and a valid decision are required' });
  }
  const decision: ApprovalDecision = {
    decision: decisionKind,
    ...(decisionKind === 'edit' ? { edited: String(req.body?.edited ?? '') } : {}),
  };
  try {
    const result = await decideRun(req.params.runId, threadId, decision);
    if (!result.ok) return res.status(404).json({ error: 'Thread not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/runtime/runs/:runId/decision failed:', error);
    res.status(500).json({ error: 'Failed to submit decision' });
  }
});

/** Hard stop a run — works whether it's paused or mid-flight (a `stop` decision
 *  only lands at a pause). */
router.post('/runs/:runId/cancel', async (req, res) => {
  const threadId = String(req.body?.threadId ?? '').trim();
  if (!threadId) return res.status(400).json({ error: 'threadId is required' });
  try {
    const result = await cancelRun(req.params.runId, threadId);
    if (!result.ok) return res.status(404).json({ error: 'Thread not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/runtime/runs/:runId/cancel failed:', error);
    res.status(500).json({ error: 'Failed to cancel run' });
  }
});

/** Phase 4 — the AI service calls this when a leader's `delegate` tool fires.
 *  Node validates the target (same team, your report, you lead it) and the
 *  tree's budget, then spawns a child run on the SUBORDINATE'S seat.
 *
 *  A refusal is 200 with `ok:false`: it is a TOOL RESULT the model must read and
 *  adapt to ("not one of your reports", "run limit reached"), not a transport
 *  error. Only a malformed request is a 4xx. */
router.post('/runs/:runId/delegate', async (req, res) => {
  const agentKey = String(req.body?.agentKey ?? '').trim();
  const positionId = String(req.body?.positionId ?? '').trim();
  const task = String(req.body?.task ?? '').trim();
  if (!positionId || !task) {
    return res.status(400).json({ error: 'positionId and task are required' });
  }
  try {
    const result = await delegate({
      parentRunId: req.params.runId,
      callerAgentKey: agentKey,
      targetPositionId: positionId,
      task,
    });
    res.json(result);
  } catch (error) {
    console.error('POST /api/runtime/runs/:runId/delegate failed:', error);
    res.status(500).json({ error: 'Failed to delegate' });
  }
});

/** Browser — the AI service calls this for every `browse` / `click` / `type` /
 *  `scroll` / `back` / `read_page`. The page itself lives in the Electron main
 *  process; this only forwards, exactly as `delegate` does. */
router.post('/runs/:runId/browser', async (req, res) => {
  const action = String(req.body?.action ?? '').trim() as BrowserAction;
  const allowed = ['browse', 'click', 'type', 'scroll', 'back', 'read'];
  if (!allowed.includes(action)) {
    return res.status(400).json({ error: 'unknown browser action' });
  }
  try {
    const text = await browserAction(req.params.runId, action, {
      url: typeof req.body?.url === 'string' ? req.body.url : undefined,
      index: Number.isFinite(Number(req.body?.index)) ? Number(req.body.index) : undefined,
      text: typeof req.body?.text === 'string' ? req.body.text : undefined,
      amount: Number.isFinite(Number(req.body?.amount)) ? Number(req.body.amount) : undefined,
    });
    res.json({ text });
  } catch (error) {
    console.error('POST /api/runtime/runs/:runId/browser failed:', error);
    res.status(500).json({ error: 'Browser action failed' });
  }
});

/** Memory — the AI service calls these when an agent uses `read_memory` /
 *  `write_memory`.
 *
 *  SECURITY: the caller's identity and the owner id come from the RUN, never from
 *  the request body. The agent sends only a SCOPE ('agent' | 'position' | 'team').
 *  If it could name an ownerId it could read another seat's memory, and if it
 *  could name an agentKey it could impersonate a higher-clearance reader — the
 *  row-level filter in `readMemory` is keyed on exactly that identity. */
router.post('/runs/:runId/memory/read', async (req, res) => {
  const scope = String(req.body?.scope ?? '').trim();
  try {
    const result = await readMemoryForRun(req.params.runId, scope);
    res.json(result);
  } catch (error) {
    console.error('POST /api/runtime/runs/:runId/memory/read failed:', error);
    res.status(500).json({ ok: false, error: 'Failed to read memory' });
  }
});

router.post('/runs/:runId/memory/write', async (req, res) => {
  const scope = String(req.body?.scope ?? '').trim();
  const body = String(req.body?.body ?? '').trim();
  const kind = typeof req.body?.kind === 'string' ? req.body.kind : undefined;
  const clearance = Number.isFinite(req.body?.clearance) ? req.body.clearance : undefined;
  if (!body) return res.status(400).json({ ok: false, error: 'body is required' });
  try {
    const result = await writeMemoryForRun(req.params.runId, scope, body, kind, clearance);
    res.json(result);
  } catch (error) {
    console.error('POST /api/runtime/runs/:runId/memory/write failed:', error);
    res.status(500).json({ ok: false, error: 'Failed to write memory' });
  }
});

/** Phase 4 — every run in a delegation tree, for the mission-control view.
 *  NOTE: this literal path is declared BEFORE any `/runs/:runId`-style route
 *  could shadow it. Express matches in order, so a `/:something` declared first
 *  would swallow "trees" as an id. */
router.get('/trees/:rootRunId', async (req, res) => {
  try {
    res.json(await treeFor(req.params.rootRunId));
  } catch (error) {
    console.error('GET /api/runtime/trees/:rootRunId failed:', error);
    res.status(500).json({ error: 'Failed to load run tree' });
  }
});

/** Interrupt-and-redirect: stop the current run (if any) and send a new
 *  instruction. Thread-scoped; `runId` optional (omit if nothing is running).
 *  Returns the thread messages so the terminal shows the new task at once. */
router.post('/threads/:threadId/redirect', async (req, res) => {
  const body = String(req.body?.body ?? '');
  if (!body.trim()) return res.status(400).json({ error: 'body is required' });
  const runId = typeof req.body?.runId === 'string' ? req.body.runId : undefined;
  const supervised = typeof req.body?.supervised === 'boolean' ? req.body.supervised : undefined;
  try {
    const result = await redirectRun(req.params.threadId, body, { runId, supervised });
    if (!result.ok && result.notFound) return res.status(404).json({ error: 'Thread not found' });
    res.json(result.messages ?? []);
  } catch (error) {
    console.error('POST /api/runtime/threads/:threadId/redirect failed:', error);
    res.status(500).json({ error: 'Failed to redirect' });
  }
});

export default router;
