import { fetchTree, postCancelTree } from '@/api/runs';
import { useRunStore } from '@/store/runStore';

/**
 * The delegation tree (Phase 4). Follows Component -> Hook -> Service -> API,
 * patching the run store so the mission-control view re-renders.
 *
 * A tree is polled while it is open, because its runs finish asynchronously —
 * the leader's reports come back over seconds or minutes.
 */
export class RunService {
  /** Load one delegation tree into the store. */
  async loadTree(rootRunId: string): Promise<void> {
    if (!rootRunId) return;
    useRunStore.getState().setLoading(true);
    try {
      useRunStore.getState().setTree(rootRunId, await fetchTree(rootRunId));
    } catch {
      // A failed refresh keeps the last good tree rather than blanking the view.
      useRunStore.getState().setLoading(false);
    }
  }

  /** Refresh whichever tree is currently open (used by the poll). */
  async refresh(): Promise<void> {
    const { rootRunId } = useRunStore.getState();
    if (rootRunId) await this.loadTree(rootRunId);
  }

  /**
   * Hard-stop the whole tree — the leader and every report under it. The backend
   * cascades: it marks the tree cancelled before relaying stops, so no child
   * finishing mid-teardown can wake a leader that is being killed.
   */
  async cancelTree(rootRunId: string, threadId: string): Promise<void> {
    await postCancelTree(rootRunId, threadId);
    await this.loadTree(rootRunId);
  }

  /** Close the mission-control view. */
  close(): void {
    useRunStore.getState().clear();
  }
}

export const runService = new RunService();
