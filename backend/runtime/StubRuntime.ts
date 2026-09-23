import type {
  AgentRuntime,
  RunSpec,
  RuntimeEvent,
  RuntimeEventSink,
} from './AgentRuntime';

// A stand-in AgentRuntime that emits a plausible event stream without any LLM.
// It proves the whole pipe — dispatch -> events -> inbox + animation — and shows
// the exact shape a real provider must produce. The Python service will swap in
// here by implementing the same AgentRuntime interface; nothing upstream changes.

/** Small helper to stamp and forward one event. */
async function emit(
  sink: RuntimeEventSink,
  spec: RunSpec,
  type: RuntimeEvent['type'],
  extra: { body?: string; ref?: string } = {}
): Promise<void> {
  await sink({
    runId: spec.runId,
    threadId: spec.threadId,
    agentKey: spec.agentKey,
    type,
    ...extra,
  });
}

export class StubRuntime implements AgentRuntime {
  async dispatch(spec: RunSpec, sink: RuntimeEventSink): Promise<void> {
    const preview = spec.task.length > 60 ? `${spec.task.slice(0, 57)}…` : spec.task;
    // The tools this run WOULD have — surfaced so the clearance gate is visible
    // even in the stub. A real runtime would actually be limited to these.
    const tools = spec.policy.allowedTools.join(', ') || 'none';

    await emit(sink, spec, 'started');
    await emit(sink, spec, 'status', { body: `picked up: "${preview}"` });
    await emit(sink, spec, 'message', {
      body:
        `On it. (Stub runtime — no LLM yet.) With my current clearance ` +
        `(${spec.policy.clearance}) I'm allowed: ${tools}. Working in ${spec.policy.workingDir}.`,
    });
    await emit(sink, spec, 'result', {
      body: `Done with "${preview}". A real runtime would report actual results here.`,
    });
    await emit(sink, spec, 'done');
  }
}

export const stubRuntime = new StubRuntime();
