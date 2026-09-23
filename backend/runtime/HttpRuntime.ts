import type {
  AgentRuntime,
  ApprovalDecision,
  RunSpec,
  RuntimeEventSink,
} from './AgentRuntime';

// An out-of-process AgentRuntime: it POSTs the RunSpec to the Python AI service's
// /run endpoint and returns as soon as the run is accepted. Results do NOT come
// back through the sink — the Python service streams RuntimeEvents to the
// backend's /api/runtime/events webhook, which is the real ingest path. So the
// sink here is unused (the in-process StubRuntime uses it; this doesn't need to).
//
// Swap it in with setRuntime(httpRuntime) only when the service is configured —
// otherwise the StubRuntime stays the default so dev works with no Python and no
// (paid) LLM calls.

export class HttpRuntime implements AgentRuntime {
  constructor(private readonly baseUrl: string) {}

  async dispatch(spec: RunSpec, _sink: RuntimeEventSink): Promise<void> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/run`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
      });
      if (!res.ok) {
        // Surface the failure into the thread via the sink so the user sees it,
        // rather than a silent no-reply.
        await _sink({
          runId: spec.runId,
          threadId: spec.threadId,
          agentKey: spec.agentKey,
          type: 'error',
          body: `AI service rejected the run (${res.status}).`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await _sink({
        runId: spec.runId,
        threadId: spec.threadId,
        agentKey: spec.agentKey,
        type: 'error',
        body: `could not reach the AI service: ${message}`,
      });
    }
  }

  /** Relay a supervised decision (proceed/stop/edit) to the service; it resumes
   *  or cancels the paused run and streams follow-up events to the webhook. */
  async decide(runId: string, decision: ApprovalDecision): Promise<void> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/runs/${encodeURIComponent(runId)}/decision`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decision),
    });
  }

  /** Hard stop — the dedicated /cancel endpoint, which works whether the run is
   *  paused OR mid-flight (a `stop` decision only lands at an approval pause). */
  async cancel(runId: string): Promise<void> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/runs/${encodeURIComponent(runId)}/cancel`;
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  }
}
