import { useEffect, useRef, useState } from 'react';
import type { Message } from '@/store/inboxStore';

type ChatThreadProps = {
  title: string;
  messages: Message[];
  onSend: (body: string, successCriteria?: string) => Promise<unknown>;
  onClose: () => void;
  /** Set while a supervised run is paused on this thread, waiting to proceed. */
  pending?: { runId: string; step: string | null } | null;
  /** Answer the pause: proceed / stop / edit (edit carries a revised instruction). */
  onDecide?: (
    runId: string,
    decision: 'proceed' | 'stop' | 'edit',
    edited?: string
  ) => Promise<unknown>;
  /** The run in flight on this thread (set even when NOT paused), for a hard stop. */
  activeRunId?: string | null;
  /** Hard-stop the in-flight run. */
  onCancel?: (runId: string) => Promise<unknown>;
};

/** Aligns and colours a bubble by who sent it. The Phase 3 loop lines (criterion
 *  🎯 and evaluation ⚖) get a distinct, centred callout so the self-critique reads
 *  apart from the agent's own prose. */
const bubbleClass = (m: Message): string => {
  if (m.sender === 'user') {
    return 'self-end bg-[var(--accent-primary)]/15 border-[var(--accent-primary)] text-[var(--content-primary)]';
  }
  if (m.sender === 'system') {
    if (m.body.startsWith('🎯') || m.body.startsWith('⚖')) {
      return 'self-center bg-[var(--accent-secondary)]/10 border-[var(--accent-secondary)]/40 text-[var(--content-secondary)] text-[10.5px] whitespace-pre-wrap';
    }
    return 'self-center bg-transparent border-transparent text-[var(--content-tertiary)] text-[10px]';
  }
  return 'self-start bg-[var(--surface-tertiary)] border-[var(--border-primary)] text-[var(--content-primary)]';
};

/** Per-agent (or team) conversation: a scrolling message list and a composer. */
export default function ChatThread({
  title,
  messages,
  onSend,
  onClose,
  pending,
  onDecide,
  activeRunId,
  onCancel,
}: ChatThreadProps) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Phase 3 steering: an optional success criterion for the next task. When empty
  // (default) the agent derives one. `showCriteria` toggles the input.
  const [criteria, setCriteria] = useState('');
  const [showCriteria, setShowCriteria] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const paused = Boolean(pending && onDecide);
  // A run is in flight but NOT paused (e.g. an auto-approved read loop). Offer a
  // hard stop; when paused, the approval bar's own "stop" covers it instead.
  const running = Boolean(activeRunId && onCancel && !paused);

  const cancel = async () => {
    if (!activeRunId || !onCancel || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCancel(activeRunId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stop.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  // Leaving the paused state closes the inline editor.
  useEffect(() => {
    if (!paused) setEditing(false);
  }, [paused]);

  const decide = async (decision: 'proceed' | 'stop' | 'edit', edited?: string) => {
    if (!pending || !onDecide || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDecide(pending.runId, decision, edited);
      if (decision === 'edit') setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit.');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(body, criteria.trim() || undefined);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
          {title}
        </span>
        {running && (
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={busy}
            title="Stop the run in progress"
            className="ml-auto flex items-center gap-1 cursor-pointer rounded border border-[var(--semantic-error)] px-2 py-[3px] font-mono text-[10px] text-[var(--semantic-error)] hover:bg-[var(--semantic-error)]/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--semantic-error)]" />
            {busy ? '…' : 'stop'}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className={`${running ? '' : 'ml-auto'} cursor-pointer rounded border border-[var(--border-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)]`}
        >
          back
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <p className="m-auto font-mono text-[11px] text-[var(--content-tertiary)]">
            Send a task to get started.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] rounded border px-2.5 py-1.5 font-mono text-[12px] leading-snug ${bubbleClass(
                m
              )}`}
            >
              {m.body}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <p
          role="alert"
          className="shrink-0 px-3 pb-1 font-mono text-[10px] text-[var(--semantic-error)]"
        >
          {error}
        </p>
      )}

      {paused && !editing ? (
        // Supervised pause: the run is waiting before its next step.
        <div className="flex shrink-0 flex-col gap-2 border-t border-[var(--accent-secondary)] bg-[var(--accent-secondary)]/8 p-2.5">
          <div className="flex items-start gap-2">
            <span className="mt-[1px] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--accent-secondary)]">
              ⏸ approve step
            </span>
            {pending?.step && (
              <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--content-secondary)]">
                {pending.step}
              </code>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void decide('proceed')}
              disabled={busy}
              className="cursor-pointer rounded border border-[var(--accent-primary)] px-3 py-1.5 font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? '…' : 'proceed'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="cursor-pointer rounded border border-[var(--border-primary)] px-3 py-1.5 font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              edit
            </button>
            <button
              type="button"
              onClick={() => void decide('stop')}
              disabled={busy}
              className="ml-auto cursor-pointer rounded border border-[var(--semantic-error)] px-3 py-1.5 font-mono text-[10px] text-[var(--semantic-error)] hover:bg-[var(--semantic-error)]/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              stop
            </button>
          </div>
        </div>
      ) : (
        <div className="flex shrink-0 flex-col gap-2 border-t border-[var(--border-primary)] p-2.5">
          {!editing && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setShowCriteria((v) => !v)}
                className="self-start cursor-pointer font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--content-tertiary)] hover:text-[var(--accent-secondary)]"
              >
                🎯 success criteria {showCriteria ? '▴' : '▾'}
                {!showCriteria && criteria.trim() ? ' (set)' : ''}
              </button>
              {showCriteria && (
                <input
                  type="text"
                  value={criteria}
                  disabled={busy}
                  onChange={(e) => setCriteria(e.target.value)}
                  placeholder="Leave blank to auto-derive from the task…"
                  className="w-full rounded border border-[var(--accent-secondary)]/40 bg-[var(--surface-tertiary)] px-2 py-1 font-mono text-[11px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-secondary)]"
                />
              )}
            </div>
          )}
          <div className="flex items-end gap-2">
          <textarea
            className="min-h-[38px] max-h-[120px] flex-1 resize-y rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 font-mono text-[12px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
            placeholder={
              editing ? 'Revise the step, then send the new instruction…' : 'Tell them what to do…'
            }
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (editing) void decide('edit', draft.trim());
                else void send();
              }
            }}
          />
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => void decide('edit', draft.trim())}
                disabled={busy || !draft.trim()}
                className="shrink-0 cursor-pointer rounded border border-[var(--accent-secondary)] px-3 py-2 font-mono text-[10px] text-[var(--accent-secondary)] hover:bg-[var(--accent-secondary)]/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? '…' : 'resume'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={busy}
                className="shrink-0 cursor-pointer rounded border border-[var(--border-primary)] px-2 py-2 font-mono text-[10px] text-[var(--content-tertiary)] hover:text-[var(--content-primary)] disabled:opacity-40"
              >
                cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !draft.trim()}
              className="shrink-0 cursor-pointer rounded border border-[var(--accent-primary)] px-3 py-2 font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? '…' : 'send'}
            </button>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
