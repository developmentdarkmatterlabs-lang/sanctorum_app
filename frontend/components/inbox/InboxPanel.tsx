import { useEffect } from 'react';
import type { RosterEntry, Team } from '@/lib/office/types';
import type { Message, Thread } from '@/store/inboxStore';
import ChatThread from './ChatThread';

type InboxPanelProps = {
  open: boolean;
  threads: Thread[];
  openThreadId: string | null;
  messages: Message[];
  roster: RosterEntry[];
  teams: Team[];
  onClose: () => void;
  onOpenThread: (threadId: string) => Promise<unknown>;
  onCloseThread: () => void;
  onSend: (threadId: string, body: string, successCriteria?: string) => Promise<unknown>;
  onDeleteThread: (threadId: string) => Promise<unknown>;
  onDecide: (
    threadId: string,
    runId: string,
    decision: 'proceed' | 'stop' | 'edit',
    edited?: string
  ) => Promise<unknown>;
  onCancel: (threadId: string, runId: string) => Promise<unknown>;
};

/** Human title for a thread: the agent's name (DM) or the team's name. */
function threadTitle(t: Thread, roster: RosterEntry[], teams: Team[]): string {
  if (t.agentKey) return roster.find((a) => a.key === t.agentKey)?.name ?? t.agentKey;
  if (t.teamId) {
    const team = teams.find((x) => x.id === t.teamId);
    return team ? `${team.name}${t.subject ? ` · ${t.subject}` : ''}` : 'Team';
  }
  return t.subject || 'Thread';
}

/** The inbox: a list of threads with unread badges, opening a ChatThread. */
export default function InboxPanel({
  open,
  threads,
  openThreadId,
  messages,
  roster,
  teams,
  onClose,
  onOpenThread,
  onCloseThread,
  onSend,
  onDeleteThread,
  onDecide,
  onCancel,
}: InboxPanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (openThreadId) onCloseThread();
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, openThreadId, onClose, onCloseThread]);

  if (!open) return null;

  const openThread = threads.find((t) => t.id === openThreadId) ?? null;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[560px] max-h-full w-[440px] max-w-full flex-col overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--surface-secondary)] shadow-2xl">
        {openThread ? (
          <ChatThread
            title={threadTitle(openThread, roster, teams)}
            messages={messages}
            onSend={(body, successCriteria) => onSend(openThread.id, body, successCriteria)}
            onClose={onCloseThread}
            pending={
              openThread.pendingRunId
                ? { runId: openThread.pendingRunId, step: openThread.pendingStep }
                : null
            }
            onDecide={(runId, decision, edited) =>
              onDecide(openThread.id, runId, decision, edited)
            }
            activeRunId={openThread.activeRunId}
            onCancel={(runId) => onCancel(openThread.id, runId)}
          />
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
                Inbox
              </span>
              <button
                type="button"
                onClick={onClose}
                className="ml-auto cursor-pointer rounded border border-[var(--border-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
              >
                close
              </button>
            </div>

            <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {threads.length === 0 ? (
                <li className="m-auto px-4 py-8 text-center font-mono text-[11px] leading-relaxed text-[var(--content-tertiary)]">
                  No conversations yet. Click an agent&apos;s <em className="not-italic text-[var(--content-secondary)]">message</em> to
                  start one.
                </li>
              ) : (
                threads.map((t) => (
                  <li key={t.id} className="border-b border-[var(--border-primary)]">
                    <div className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--surface-tertiary)]">
                      <button
                        type="button"
                        onClick={() => void onOpenThread(t.id)}
                        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                      >
                        <span className="flex w-full items-center gap-2">
                          <span className="truncate font-mono text-[12px] text-[var(--content-primary)]">
                            {threadTitle(t, roster, teams)}
                          </span>
                          {t.unread > 0 && (
                            <span className="ml-auto shrink-0 rounded-full bg-[var(--accent-primary)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--surface-primary,#000)]">
                              {t.unread}
                            </span>
                          )}
                        </span>
                        {t.lastMessage && (
                          <span className="w-full truncate font-mono text-[10px] text-[var(--content-tertiary)]">
                            {t.lastMessage}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteThread(t.id)}
                        aria-label="Delete thread"
                        className="shrink-0 cursor-pointer rounded border border-[var(--border-primary)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--content-tertiary)] hover:border-[var(--semantic-error)] hover:text-[var(--semantic-error)]"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
