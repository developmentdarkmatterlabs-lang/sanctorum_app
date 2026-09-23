import { useEffect, useRef, useState } from 'react';
import type { Message } from '@/store/inboxStore';

import { BrowserPane } from '@/components/browser';

type AgentTerminalProps = {
  /** The agent whose activity is shown; null = closed. */
  agent: { key: string; name: string } | null;
  /** Messages of that agent's thread (the live event stream). */
  messages: Message[];
  onClose: () => void;
  /** The thread's run state, so the terminal can drive it interactively. */
  pending?: { runId: string; step: string | null } | null;
  activeRunId?: string | null;
  /** Answer a supervised pause. */
  onDecide?: (
    runId: string,
    decision: 'proceed' | 'stop' | 'edit',
    edited?: string
  ) => Promise<unknown>;
  /** Hard-stop the in-flight run. */
  onCancel?: (runId: string) => Promise<unknown>;
  /** Interrupt-and-redirect (stop the run, send a new task) — or, when idle, just
   *  send a task. `runId` is the run to stop, if one is in flight. */
  onRedirect?: (body: string, runId?: string) => Promise<unknown>;
};

/** Colour a line by what it represents. */
function lineClass(m: Message): string {
  if (m.sender === 'user') return 'text-[var(--accent-primary)]';
  if (m.sender === 'system') {
    if (m.body.startsWith('🎯') || m.body.startsWith('⚖')) {
      return 'text-[var(--accent-secondary)]';
    }
    return m.body.startsWith('$ ')
      ? 'text-[var(--accent-secondary)]'
      : 'text-[var(--content-tertiary)]';
  }
  return 'text-[var(--content-primary)]';
}

/**
 * An INTERACTIVE terminal for one agent — its live RuntimeEvent stream as a
 * scrolling console, plus controls to drive the run like Claude Code's CLI:
 *   - paused (awaiting approval): proceed / edit / stop;
 *   - running (not paused): a live stop, and a composer that INTERRUPTS and
 *     redirects (stop the run, send a new instruction);
 *   - idle: a composer that sends a fresh task.
 * Auto-scrolls as new events arrive.
 */
export default function AgentTerminal({
  agent,
  messages,
  onClose,
  pending,
  activeRunId,
  onDecide,
  onCancel,
  onRedirect,
}: AgentTerminalProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editRequested, setEditing] = useState(false);

  // The run id + step we have already answered. The decision POST returns 202 as
  // soon as the service ACCEPTS it, but the run then works for seconds — during
  // which `pending` still holds the step we just approved. Without this, the bar
  // re-enables and actively invites a second click on an already-approved step,
  // which is how one approval round spawned three duplicate child runs.
  const [decided, setDecided] = useState<string | null>(null);
  const pendingKey = pending ? `${pending.runId}:${pending.step}` : null;
  const alreadyDecided = pendingKey !== null && pendingKey === decided;

  const paused = Boolean(pending && onDecide) && !alreadyDecided;
  const running = Boolean(activeRunId && !paused);
  // True from the click until a genuinely NEW pause (or the run ending) arrives.
  const awaitingStep = alreadyDecided;

  useEffect(() => {
    if (!agent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agent, onClose]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  // The inline editor only exists while paused, so DERIVE that rather than
  // syncing it in an effect (which cascades renders and trips
  // react-hooks/set-state-in-effect). Leaving the paused state closes it for
  // free, and `setEditing` still works within a pause.
  const editing = editRequested && paused;

  // A snapshot in the log means the agent used the BROWSER, not `search`. The
  // pane itself asks the main process what actually loaded.
  const browsing =
    Boolean(activeRunId) && messages.some((m) => /\[(link|button|input)\s+\d+\]/.test(m.body));

  if (!agent) return null;

  const decide = async (decision: 'proceed' | 'stop' | 'edit', edited?: string) => {
    if (!pending || !onDecide || busy || alreadyDecided) return;
    setBusy(true);
    setError(null);
    // Mark this exact step answered BEFORE awaiting, so the bar hides on the
    // click rather than when the request returns.
    setDecided(`${pending.runId}:${pending.step}`);
    try {
      await onDecide(pending.runId, decision, edited);
      if (decision === 'edit') setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit.');
      setDecided(null); // the decision never landed — let them try again
    } finally {
      setBusy(false);
    }
  };

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

  // Send (idle) or interrupt-and-redirect (running). When paused, editing routes
  // through decide('edit') instead.
  const submit = async () => {
    const body = draft.trim();
    if (!body || busy || !onRedirect) return;
    setBusy(true);
    setError(null);
    try {
      await onRedirect(body, running ? (activeRunId ?? undefined) : undefined);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send.');
    } finally {
      setBusy(false);
    }
  };

  const placeholder = paused
    ? editing
      ? 'Revise the step, then resume…'
      : ''
    : running
      ? 'Interrupt and redirect — type a new instruction…'
      : 'Message this agent a task…';

  const showComposer = onRedirect && (!paused || editing);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div
        className={`flex h-[560px] max-h-full max-w-full flex-col overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--surface-primary,#0b0b12)] shadow-2xl ${
          browsing ? 'h-[80vh] w-[1100px]' : 'w-[620px]'
        }`}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-primary)] bg-[var(--surface-secondary)] px-3 py-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
            {agent.name} — terminal
          </span>
          {running && onCancel && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-[var(--accent-secondary)]">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-secondary)]" />
              working
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto cursor-pointer rounded border border-[var(--border-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
          >
            close
          </button>
        </div>

        <div className={`flex min-h-0 flex-1 ${browsing ? 'flex-row' : 'flex-col'}`}>
        <div
          className={`flex min-h-0 flex-col gap-0.5 overflow-y-auto p-3 font-mono text-[11.5px] leading-[1.5] ${
            browsing ? 'w-[380px] shrink-0 border-r border-[var(--border-primary)]' : 'flex-1'
          }`}
        >
          {messages.length === 0 ? (
            <p className="text-[var(--content-tertiary)]">
              No activity yet. Send a task below and watch it work here.
            </p>
          ) : (
            messages.map((m) => (
              <pre
                key={m.id}
                className={`m-0 whitespace-pre-wrap break-words ${lineClass(m)}`}
              >
                {m.sender === 'user' ? `▸ ${m.body}` : m.body}
              </pre>
            ))
          )}
          <div ref={endRef} />
        </div>

        {browsing && (
          <BrowserPane runId={activeRunId ?? null} agentKey={agent.key} />
        )}
        </div>

        {error && (
          <p
            role="alert"
            className="shrink-0 px-3 pb-1 font-mono text-[10px] text-[var(--semantic-error)]"
          >
            {error}
          </p>
        )}

        {/* After a decision, until the next pause: say the step was approved and
            is running. Without this the bar simply vanishes and the terminal
            looks idle while the agent is in fact working. */}
        {awaitingStep && (
          <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-primary)] p-2.5">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-primary)]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
              step approved — working…
            </span>
          </div>
        )}

        {/* Approval bar when paused (and not mid-edit). */}
        {paused && !editing && (
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
                className="cursor-pointer rounded border border-[var(--accent-primary)] px-3 py-1.5 font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 disabled:opacity-40"
              >
                {busy ? '…' : 'proceed'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={busy}
                className="cursor-pointer rounded border border-[var(--border-primary)] px-3 py-1.5 font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)] disabled:opacity-40"
              >
                edit
              </button>
              <button
                type="button"
                onClick={() => void decide('stop')}
                disabled={busy}
                className="ml-auto cursor-pointer rounded border border-[var(--semantic-error)] px-3 py-1.5 font-mono text-[10px] text-[var(--semantic-error)] hover:bg-[var(--semantic-error)]/15 disabled:opacity-40"
              >
                stop
              </button>
            </div>
          </div>
        )}

        {/* Composer: send (idle), interrupt+redirect (running), or resume-edit (paused). */}
        {showComposer && (
          <div className="flex shrink-0 items-end gap-2 border-t border-[var(--border-primary)] p-2.5">
            <textarea
              className="min-h-[38px] max-h-[120px] flex-1 resize-y rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 font-mono text-[12px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
              placeholder={placeholder}
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (editing) void decide('edit', draft.trim());
                  else void submit();
                }
              }}
            />
            {running && onCancel && !editing && (
              <button
                type="button"
                onClick={() => void cancel()}
                disabled={busy}
                title="Stop without redirecting"
                className="shrink-0 cursor-pointer rounded border border-[var(--semantic-error)] px-2 py-2 font-mono text-[10px] text-[var(--semantic-error)] hover:bg-[var(--semantic-error)]/15 disabled:opacity-40"
              >
                stop
              </button>
            )}
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={() => void decide('edit', draft.trim())}
                  disabled={busy || !draft.trim()}
                  className="shrink-0 cursor-pointer rounded border border-[var(--accent-secondary)] px-3 py-2 font-mono text-[10px] text-[var(--accent-secondary)] hover:bg-[var(--accent-secondary)]/15 disabled:opacity-40"
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
                onClick={() => void submit()}
                disabled={busy || !draft.trim()}
                className="shrink-0 cursor-pointer rounded border border-[var(--accent-primary)] px-3 py-2 font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? '…' : running ? 'redirect' : 'send'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
