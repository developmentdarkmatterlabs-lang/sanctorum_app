import { useEffect, useState } from 'react';
import type { RosterEntry } from '@/lib/office/types';
import type { Thread } from '@/store/inboxStore';

type FleetViewProps = {
  open: boolean;
  roster: RosterEntry[];
  /** All threads, for per-agent run state (paused / working / idle) + last line. */
  threads: Thread[];
  onClose: () => void;
  /** Open the full interactive terminal for an agent. */
  onOpenTerminal: (agentKey: string) => void;
  /** Poll the thread list so tile status stays live while the grid is open. */
  refresh: () => Promise<unknown>;
  /** Answer a supervised pause from the tile. */
  onDecide: (
    threadId: string,
    runId: string,
    decision: 'proceed' | 'stop' | 'edit',
    edited?: string
  ) => Promise<unknown>;
  /** Hard-stop the in-flight run from the tile. */
  onCancel: (threadId: string, runId: string) => Promise<unknown>;
  /** Interrupt-and-redirect from the tile. */
  onRedirect: (threadId: string, body: string, runId?: string) => Promise<unknown>;
  /** Phase 4 — open the delegation tree for a thread that has one (a leader that
   *  has fanned work out to its reports). */
  onOpenTree: (rootRunId: string) => void;
};

type FleetStatus = 'paused' | 'working' | 'idle';

function statusFor(thread: Thread | undefined): FleetStatus {
  if (!thread) return 'idle';
  if (thread.pendingRunId) return 'paused';
  if (thread.activeRunId) return 'working';
  return 'idle';
}

const STATUS_STYLE: Record<FleetStatus, string> = {
  paused: 'border-[var(--accent-secondary)] text-[var(--accent-secondary)]',
  working: 'border-[var(--accent-primary)] text-[var(--accent-primary)]',
  idle: 'border-[var(--border-primary)] text-[var(--content-tertiary)]',
};

const btn =
  'cursor-pointer rounded border px-2 py-1 font-mono text-[9px] transition-colors disabled:cursor-not-allowed disabled:opacity-40';

/** One agent tile: status, last line / paused step, and the inline controls for
 *  its current state (approve when paused; stop/redirect when working). */
function Tile({
  agent,
  thread,
  onOpenTerminal,
  onDecide,
  onCancel,
  onRedirect,
  onOpenTree,
}: {
  agent: RosterEntry;
  thread: Thread | undefined;
  onOpenTerminal: (agentKey: string) => void;
  onDecide: FleetViewProps['onDecide'];
  onCancel: FleetViewProps['onCancel'];
  onRedirect: FleetViewProps['onRedirect'];
  onOpenTree: FleetViewProps['onOpenTree'];
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // The step we have already answered. A decision POST returns as soon as it is
  // ACCEPTED, but the run then works for seconds with `pendingRunId` still set —
  // so without this the tile's approve buttons come straight back and invite a
  // second click on an already-approved step (which spawned duplicate runs).
  const [decided, setDecided] = useState<string | null>(null);
  const pendingKey = thread?.pendingRunId ? `${thread.pendingRunId}:${thread.pendingStep ?? ''}` : null;
  const alreadyDecided = pendingKey !== null && pendingKey === decided;

  const rawStatus = statusFor(thread);
  // Treat an answered pause as "working" until the next pause actually arrives.
  const status: FleetStatus = rawStatus === 'paused' && alreadyDecided ? 'working' : rawStatus;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    if (pendingKey) setDecided(pendingKey);
    try {
      await fn();
      setDraft('');
      setEditing(false);
    } catch (err) {
      setDecided(null); // never landed — let them retry
      throw err;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 rounded border border-[var(--border-primary)] bg-[var(--surface-primary,#0b0b12)] p-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenTerminal(agent.key)}
          className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-[var(--content-primary)] hover:text-[var(--accent-primary)]"
          title="Open terminal"
        >
          {agent.name}
        </button>
        {thread?.rootRunId && (
          <button
            type="button"
            onClick={() => onOpenTree(thread.rootRunId!)}
            className="shrink-0 cursor-pointer rounded border border-[var(--border-primary)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--content-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
            title="Open the delegation tree for this task"
          >
            tree
          </button>
        )}
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${STATUS_STYLE[status]}`}
        >
          {status === 'working' ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-primary)]" />
              working
            </span>
          ) : status === 'paused' ? (
            '⏸ awaiting you'
          ) : (
            'idle'
          )}
        </span>
      </div>

      <span className="truncate font-mono text-[10px] text-[var(--content-tertiary)]">
        {agent.title}
      </span>

      <pre className="m-0 line-clamp-3 min-h-[30px] flex-1 whitespace-pre-wrap break-words font-mono text-[10px] leading-snug text-[var(--content-secondary)]">
        {status === 'paused' && thread?.pendingStep
          ? thread.pendingStep
          : (thread?.lastMessage ?? '—')}
      </pre>

      {/* Inline controls, per state. */}
      {status === 'paused' && thread?.pendingRunId && !editing && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => onDecide(thread.id, thread.pendingRunId!, 'proceed'))}
            className={`${btn} border-[var(--accent-primary)] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15`}
          >
            proceed
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(true)}
            className={`${btn} border-[var(--border-primary)] text-[var(--content-secondary)] hover:text-[var(--content-primary)]`}
          >
            edit
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => onDecide(thread.id, thread.pendingRunId!, 'stop'))}
            className={`${btn} ml-auto border-[var(--semantic-error)] text-[var(--semantic-error)] hover:bg-[var(--semantic-error)]/15`}
          >
            stop
          </button>
        </div>
      )}

      {status === 'paused' && thread?.pendingRunId && editing && (
        <div className="flex items-center gap-1.5">
          <input
            className="min-w-0 flex-1 rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1 font-mono text-[11px] text-[var(--content-primary)]"
            placeholder="Revise the step…"
            value={draft}
            disabled={busy}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim())
                void run(() => onDecide(thread.id, thread.pendingRunId!, 'edit', draft.trim()));
            }}
          />
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() =>
              void run(() => onDecide(thread.id, thread.pendingRunId!, 'edit', draft.trim()))
            }
            className={`${btn} border-[var(--accent-secondary)] text-[var(--accent-secondary)] hover:bg-[var(--accent-secondary)]/15`}
          >
            resume
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(false)}
            className={`${btn} border-[var(--border-primary)] text-[var(--content-tertiary)]`}
          >
            ✕
          </button>
        </div>
      )}

      {status === 'working' && thread?.activeRunId && (
        <div className="flex items-center gap-1.5">
          <input
            className="min-w-0 flex-1 rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1 font-mono text-[11px] text-[var(--content-primary)]"
            placeholder="Redirect…"
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim())
                void run(() => onRedirect(thread.id, draft.trim(), thread.activeRunId ?? undefined));
            }}
          />
          {draft.trim() ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() => onRedirect(thread.id, draft.trim(), thread.activeRunId ?? undefined))
              }
              className={`${btn} border-[var(--accent-primary)] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15`}
            >
              redirect
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => onCancel(thread.id, thread.activeRunId!))}
              className={`${btn} border-[var(--semantic-error)] text-[var(--semantic-error)] hover:bg-[var(--semantic-error)]/15`}
            >
              stop
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => onOpenTerminal(agent.key)}
        className="mt-auto self-start font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--accent-primary)] hover:underline"
      >
        open terminal →
      </button>
    </div>
  );
}

/**
 * Fleet view — mission control, fullscreen. Every agent as a tile with its run
 * status and last line, plus INLINE controls: approve (proceed/edit/stop) when
 * paused, and stop/redirect when working — no need to open the terminal for the
 * common actions. Composes the operator-tooling handlers; holds no backend of its
 * own. Status stays live via a poll while open.
 */
export default function FleetView({
  open,
  roster,
  threads,
  onClose,
  onOpenTerminal,
  refresh,
  onDecide,
  onCancel,
  onRedirect,
  onOpenTree,
}: FleetViewProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const id = setInterval(() => void refresh(), 2500);
    return () => clearInterval(id);
  }, [open, refresh]);

  if (!open) return null;

  const threadByAgent = new Map<string, Thread>();
  for (const t of threads) if (t.agentKey) threadByAgent.set(t.agentKey, t);

  const active = roster.filter((a) => statusFor(threadByAgent.get(a.key)) !== 'idle').length;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[var(--surface-secondary)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-primary)] px-4 py-3">
        <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
          Fleet
        </span>
        <span className="font-mono text-[10px] text-[var(--content-tertiary)]">
          {active} of {roster.length} active
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto cursor-pointer rounded border border-[var(--border-primary)] px-3 py-1 font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
        >
          close
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {roster.length === 0 ? (
          <p className="m-auto py-8 text-center font-mono text-[11px] text-[var(--content-tertiary)]">
            No agents yet.
          </p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {roster.map((a) => (
              <li key={a.key} className="min-h-[150px]">
                <Tile
                  agent={a}
                  thread={threadByAgent.get(a.key)}
                  onOpenTerminal={onOpenTerminal}
                  onDecide={onDecide}
                  onCancel={onCancel}
                  onRedirect={onRedirect}
                  onOpenTree={onOpenTree}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
