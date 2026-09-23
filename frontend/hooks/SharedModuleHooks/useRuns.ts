import { useCallback, useEffect } from 'react';
import { runService } from '@/services/runService';
import { useRunStore } from '@/store/runStore';

const POLL_MS = 2500;

/**
 * Hook seam for the delegation tree (Component -> Hook -> Service -> API).
 *
 * While a tree is open it POLLS, because its runs finish asynchronously: a
 * leader's reports come back over seconds or minutes, and the tree's shape
 * changes as they do. The poll stops as soon as nothing in the tree is live, so
 * a finished tree isn't refetched forever.
 */
export function useRuns() {
  const rootRunId = useRunStore((s) => s.rootRunId);
  const tree = useRunStore((s) => s.tree);
  const loading = useRunStore((s) => s.loading);

  const live = tree.some((r) => r.status === 'running' || r.status === 'paused');

  useEffect(() => {
    if (!rootRunId || !live) return;
    const id = setInterval(() => void runService.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [rootRunId, live]);

  return {
    rootRunId,
    tree,
    loading,
    /** Total USD across the tree — what the cost ceiling is measured against. */
    totalCost: tree.reduce((sum, r) => sum + (r.cost || 0), 0),
    /** True while any run in the tree is still working. */
    live,
    openTree: useCallback((id: string) => runService.loadTree(id), []),
    cancelTree: useCallback(
      (id: string, threadId: string) => runService.cancelTree(id, threadId),
      []
    ),
    close: useCallback(() => runService.close(), []),
  };
}
