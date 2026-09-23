// The LLM-agnostic contract between Sanctorum and whatever actually runs an
// agent — a stub today, a Python service (Claude / Gemini / OpenAI) later. The
// deal: Node hands the runtime a fully-resolved RunSpec (the task plus the
// clearance-gated ToolPolicy — see ToolPolicy.ts) and the runtime streams back
// RuntimeEvents. Node is the source of truth for permissions; the runtime only
// executes within the policy it is given, and the model never sees a way around
// it. Nothing here is provider-specific.

import type { ToolGrant } from './ToolPolicy';

/** Everything a runtime needs to execute one run. Assembled in Node. */
export type RunSpec = {
  /** Correlates every event of this run; assigned by the caller. */
  runId: string;
  /** The thread this run reports into (inbox). */
  threadId: string;
  /** The agent doing the work (null for a team-broadcast run with no single actor). */
  agentKey: string | null;
  /** The natural-language task from the user. */
  task: string;
  /** The role/persona prompt derived from the agent's position + team. */
  systemPrompt: string;
  /** The resolved capability grant — allowed tools, working dir, env. Enforced
   *  by the runtime, never negotiable by the model. */
  policy: ToolGrant;
  /** Phase 4: the seat this run executes as. Recorded on the run for the audit
   *  trail — clearance comes from THIS seat, never from a delegating leader. */
  positionId?: string | null;
  /** The memory scopes this run may address. Node resolves them from the seat so
   *  the AI service never has to re-derive the org — and, critically, so the
   *  agent cannot NAME a scope it doesn't hold: the read/write routes derive the
   *  caller's identity from the RUN, not from the request body. */
  memoryContext?: {
    /** The agent's own private notes (scope 'agent', ownerId = this key). */
    agentKey: string | null;
    /** The seat's memory — survives reassignment (scope 'position'). */
    positionId: string | null;
    /** The team's shared memory (scope 'team'). */
    teamId: string | null;
  };
  /** The LLM model to use (an OpenRouter model id), resolved by Node from the
   *  cascade: per-task override -> agent override -> global default. Omitted when
   *  none is set, so the AI service falls back to its own configured default. */
  model?: string;
  /** Per-agent image model for `generate_image`; falls back to the global
   *  setting, then the AI service's env default. */
  imageModel?: string;
  /** Per-agent speech model for `generate_speech`; falls back to the global
   *  setting, then the AI service's env default. */
  speechModel?: string;
  /** One-line voice reminder, re-injected on every retry so a long run does not
   *  drift back to the model's default persona. */
  personaReminder?: string;
  /** When true, the run pauses before each consequential step (a tool call) and
   *  waits for the user's decision (proceed/stop/edit) — human-in-the-loop. When
   *  false, it runs to completion. Defaults to false (hands-off). */
  supervised?: boolean;
  /** Phase 4: when true, this run's `delegate` calls skip the approval pause.
   *  Separate from `supervised` on purpose — trusting a leader to fan out is a
   *  different decision from trusting it to write files unattended. Trust removes
   *  the click, never the budget caps or the same-team target check. */
  trustedDelegator?: boolean;
  /** Phase 3 (worker-evaluator loop): the success criterion the agent's answer is
   *  graded against. Omitted → the AI service derives one from the task. */
  successCriteria?: string;
  /** Phase 3: the retry ceiling — how many worker→evaluator rounds before the run
   *  keeps its best attempt and stops. Omitted → the service default (3). */
  maxAttempts?: number;
  /** Phase 3.6: provider API keys entered in the settings panel. The AI service
   *  prefers these over its own env keys. Only non-empty keys are sent. */
  providerKeys?: {
    openrouter?: string;
    serper?: string;
    replicate?: string;
  };
  /** Phase 3.7: external MCP servers assigned to this run's seat, with resolved
   *  auth. The AI service connects to each and merges its tools into the run's tool
   *  list (gated + supervised like every other tool). Only enabled servers. */
  mcpServers?: McpServerConfig[];
};

/** One external MCP server the runtime should connect to for a run. HTTP-first
 *  (url + authToken/headers); stdio (command/args) is the advanced local option. */
export type McpServerConfig = {
  name: string;
  transport: 'http' | 'stdio';
  url?: string;
  authToken?: string;
  /** JSON object string of extra HTTP headers, or ''. */
  headers?: string;
  command?: string;
  /** JSON array string of args, or ''. */
  args?: string;
};

/** The event kinds a runtime streams back. One RuntimeEvent per state change. */
export type RuntimeEventType =
  // The run has started (agent picked up the task).
  | 'started'
  // A human-facing progress line ("reading the ledger…").
  | 'status'
  // A chat message from the agent into the thread.
  | 'message'
  // A produced artifact/result; `ref` may point at a memory id or file path.
  | 'result'
  // PAUSED (supervised): the run is about to take a step and is waiting for the
  // user's decision. `body` describes the proposed step (e.g. the command).
  | 'awaiting_approval'
  // Phase 3: the success criterion this run's answer is graded against. `body`
  // is the criterion text; emitted once, up front.
  | 'criteria'
  // Phase 3: one evaluation of the worker's answer. `body` = "attempt N/M: <verdict>"
  // plus the evaluator's feedback when it didn't pass.
  | 'evaluated'
  // Phase 4: this run handed a piece of work to one of its reports. `body` names
  // who and what.
  | 'delegated'
  // Phase 4: a child run's result flowing back to the leader that delegated it.
  | 'reported'
  // The run finished successfully.
  | 'done'
  // The run failed; `body` carries the reason.
  | 'error';

/** A user's response to an `awaiting_approval` pause. `proceed` runs the step,
 *  `stop` cancels the run, `edit` replaces the pending step's instruction. */
export type ApprovalDecision = {
  decision: 'proceed' | 'stop' | 'edit';
  /** For `edit`: the revised instruction to inject before continuing. */
  edited?: string;
  /** Phase 4: true ONLY when this resume delivers a parked leader its reports.
   *  A human approval never sets it — that is what lets a leader waiting on its
   *  reports ignore stale approvals without ignoring the reports themselves. */
  reportsReady?: boolean;
};

/** A single event in a run's stream. Same shape whatever the provider. */
export type RuntimeEvent = {
  runId: string;
  threadId: string;
  agentKey: string | null;
  type: RuntimeEventType;
  /** Human-readable text for status/message/error; empty for started/done. */
  body?: string;
  /** For result events: a reference to what was produced. */
  ref?: string;
  /** ISO timestamp; assigned by the runtime or on ingest. */
  at?: string;
};

/** How a runtime delivers events back to Node: an in-process callback (StubRuntime)
 *  or, for an out-of-process service, a POST to the /events webhook that calls this. */
export type RuntimeEventSink = (event: RuntimeEvent) => Promise<void> | void;

/**
 * The one method any runtime implements. `dispatch` starts a run and returns
 * once it has been accepted (not once it finishes) — results arrive as events on
 * the sink. `decide` answers a supervised run's `awaiting_approval` pause
 * (proceed/stop/edit), resuming or cancelling it. `cancel` is a hard stop.
 */
export interface AgentRuntime {
  dispatch(spec: RunSpec, sink: RuntimeEventSink): Promise<void>;
  decide?(runId: string, decision: ApprovalDecision): Promise<void>;
  cancel?(runId: string): Promise<void>;
}
