import { useMemo, useState } from 'react';
import type { RunNode } from '@/api/runs';
import { StatusPill } from '@/components/ui';
import type { RunStatus } from '@/components/ui/StatusPill';

// Phase 4 — mission control: the delegation tree of one task.
//
// A node is a RUN (a leader or one of its reports), indented by depth, showing
// who did it, what state it is in and what it cost. Clicking a node opens that
// agent's existing terminal — this view does not re-implement a console.
//
// It DOES answer approvals, though, and has to: a delegated child runs on its
// LEADER's thread, so `thread.pendingRunId` only ever names the root run. The
// inbox and the fleet tile both read that, which means a middle manager's pause
// (depth 1+ with its own reports) is invisible to them — it showed up under the
// root agent, or not at all. The tree is the one view that knows which run is
// actually asking, so the proceed/stop buttons live here.
//
// Theme: colours come from tokens only (--surface-*, --content-*, --accent-*,
// --semantic-*), so the light/dark presets apply without changes here.

type RunTreeProps = {
  /** Every run in the tree, oldest first (as the API serves it). */
  tree: RunNode[];
  totalCost: number;
  live: boolean;
  loading: boolean;
  /** Resolve an agent key to a display name; falls back to the key. */
  nameFor: (agentKey: string | null) => string;
  /** Open that agent's terminal (the Phase 1.3 component). */
  onOpenTerminal: (agentKey: string) => void;
  /** Hard-stop the whole tree — leader and every report under it. */
  onCancelTree: () => void;
  /** Answer the pause on ONE run in the tree. Needed here because a delegated
   *  child runs on its LEADER's thread, so `thread.pendingRunId` only ever names
   *  the root — the inbox and fleet tile cannot surface a middle manager's
   *  approval at all. The tree is the only view that knows which run is asking. */
  onDecide: (
    threadId: string,
    runId: string,
    decision: 'proceed' | 'stop'
  ) => Promise<unknown>;
  onClose: () => void;
};

/** Orders runs so each report sits directly under the leader that delegated it. */
function ordered(tree: RunNode[]): RunNode[] {
  const byParent = new Map<string | null, RunNode[]>();
  for (const run of tree) {
    const key = run.parentRunId;
    byParent.set(key, [...(byParent.get(key) ?? []), run]);
  }
  const out: RunNode[] = [];
  const walk = (parentId: string | null) => {
    for (const run of byParent.get(parentId) ?? []) {
      out.push(run);
      walk(run.id);
    }
  };
  walk(null);
  // Any run whose parent isn't in this tree (shouldn't happen) still shows up.
  return out.length === tree.length ? out : tree;
}

export default function RunTree({
  tree,
  totalCost,
  live,
  loading,
  nameFor,
  onOpenTerminal,
  onCancelTree,
  onDecide,
  onClose,
}: RunTreeProps) {
  const [deciding, setDeciding] = useState<string | null>(null);

  const answer = async (run: RunNode, decision: 'proceed' | 'stop') => {
    if (deciding) return;
    setDeciding(run.id);
    try {
      await onDecide(run.threadId, run.id, decision);
    } finally {
      setDeciding(null);
    }
  };
  const rows = useMemo(() => ordered(tree), [tree]);
  const caps = tree[0];

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[560px] max-h-full w-[720px] max-w-full flex-col overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--surface-primary)] shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-primary)] bg-[var(--surface-secondary)] px-3 py-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
            delegation — {rows.length} run{rows.length === 1 ? '' : 's'}
          </span>
          <span className="font-mono text-[10px] text-[var(--content-tertiary)]">
            ${totalCost.toFixed(4)}
            {caps && caps.maxCost > 0 ? ` / $${caps.maxCost.toFixed(2)}` : ' / unlimited'}
            {caps && caps.maxRuns > 0 ? ` · ${rows.length}/${caps.maxRuns} runs` : ''}
          </span>
          {live && (
            <button
              type="button"
              onClick={onCancelTree}
              className="ml-auto cursor-pointer rounded border border-[var(--semantic-error-muted)] px-2 py-[3px] font-mono text-[10px] text-[var(--semantic-error)] hover:border-[var(--semantic-error)]"
              title="Stop the leader and every report under it"
            >
              stop all
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className={`${live ? '' : 'ml-auto '}cursor-pointer rounded border border-[var(--border-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)]`}
          >
            close
          </button>
        </div>

        {/* Tree */}
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
          {rows.length === 0 ? (
            <p className="font-mono text-[11px] text-[var(--content-tertiary)]">
              {loading ? 'Loading…' : 'No runs yet.'}
            </p>
          ) : (
            rows.map((run) => (
              <div
                key={run.id}
                style={{ marginLeft: `${run.depth * 20}px` }}
                className={`flex flex-col gap-1 rounded border bg-[var(--surface-secondary)] px-2 py-1.5 ${
                  run.pendingStep
                    ? 'border-[var(--accent-secondary)]'
                    : 'border-[var(--border-primary)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  {run.depth > 0 && (
                    <span className="font-mono text-[10px] text-[var(--content-tertiary)]">↳</span>
                  )}
                  <button
                    type="button"
                    onClick={() => run.agentKey && onOpenTerminal(run.agentKey)}
                    disabled={!run.agentKey}
                    className="cursor-pointer font-mono text-[11px] text-[var(--content-primary)] hover:text-[var(--accent-primary)] disabled:cursor-default"
                    title="Open this agent's terminal"
                  >
                    {nameFor(run.agentKey)}
                  </button>
                  <StatusPill status={run.status as RunStatus} compact />
                  <span className="ml-auto font-mono text-[10px] text-[var(--content-tertiary)]">
                    ${run.cost.toFixed(4)}
                  </span>
                </div>
                {/* The step THIS run is waiting on. Shown per-node because in a
                    tree deeper than one level several runs are live at once and
                    only one of them is asking — attributing every pause to the
                    root is how a middle manager's request looked like the CMO's. */}
                {run.pendingStep && (
                  <div className="flex items-center gap-2 pl-4">
                    <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--accent-secondary)]">
                      ⏸ {run.pendingStep}
                    </p>
                    <button
                      type="button"
                      disabled={deciding !== null}
                      onClick={() => void answer(run, 'proceed')}
                      className="shrink-0 cursor-pointer rounded border border-[var(--accent-primary)] px-2 py-[2px] font-mono text-[9px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 disabled:opacity-40"
                    >
                      {deciding === run.id ? '…' : 'proceed'}
                    </button>
                    <button
                      type="button"
                      disabled={deciding !== null}
                      onClick={() => void answer(run, 'stop')}
                      className="shrink-0 cursor-pointer rounded border border-[var(--semantic-error-muted)] px-2 py-[2px] font-mono text-[9px] text-[var(--semantic-error)] hover:border-[var(--semantic-error)] disabled:opacity-40"
                    >
                      stop
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
