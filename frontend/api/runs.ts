import { get, post } from './client';

// Phase 4 — the delegation tree. One run per agent; `parentRunId` links a report
// to the leader that delegated it, `rootRunId` names the whole task.
//
// IPC: `get`/`post` come from api/client.ts, which routes over Electron IPC when
// running in the desktop shell and falls back to fetch() in the browser. Nothing
// here needs to know which.

/** One run in a delegation tree, as the backend serves it. */
export type RunNode = {
  id: string;
  threadId: string;
  agentKey: string | null;
  parentRunId: string | null;
  rootRunId: string;
  depth: number;
  /** 'running' | 'paused' | 'done' | 'error' | 'cancelled' */
  status: string;
  /** The step THIS run is waiting on, when paused. A pause belongs to the run,
   *  not the thread — at depth 2+ several runs in one tree can be live at once
   *  and only one of them is asking. */
  pendingStep: string | null;
  /** The run's final answer (empty while it is still working). */
  result: string;
  /** USD spent by this run. The tree's total is the sum across its runs. */
  cost: number;
  /** The caps this tree was started with (snapshotted, so editing the settings
   *  mid-flight never changes a task already in progress). */
  maxDepth: number;
  maxRuns: number;
  maxCost: number;
  positionId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Every run in one delegation tree, oldest first. */
export const fetchTree = (rootRunId: string) =>
  get<RunNode[]>(`/api/runtime/trees/${encodeURIComponent(rootRunId)}`);

/** Hard-stop a whole tree: the leader and every report under it. Routed through
 *  the existing per-run cancel, which cascades when the run belongs to a tree. */
export const postCancelTree = (rootRunId: string, threadId: string) =>
  post<{ ok: boolean }>(`/api/runtime/runs/${encodeURIComponent(rootRunId)}/cancel`, {
    threadId,
  });
