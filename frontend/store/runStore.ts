import { create } from 'zustand';
import type { RunNode } from '@/api/runs';

// Phase 4 — the delegation tree currently being viewed. Kept out of the main
// office store on purpose: a tree is viewed on demand (when you open mission
// control), not carried by every render, exactly like the model catalogue.

type RunState = {
  /** The tree's root run id, or null when nothing is open. */
  rootRunId: string | null;
  /** Every run in that tree, oldest first. */
  tree: RunNode[];
  /** True while a tree load is in flight, so the view can show progress. */
  loading: boolean;

  setTree: (rootRunId: string, tree: RunNode[]) => void;
  setLoading: (loading: boolean) => void;
  clear: () => void;
};

export const useRunStore = create<RunState>((set) => ({
  rootRunId: null,
  tree: [],
  loading: false,

  setTree: (rootRunId, tree) => set({ rootRunId, tree, loading: false }),
  setLoading: (loading) => set({ loading }),
  clear: () => set({ rootRunId: null, tree: [], loading: false }),
}));
