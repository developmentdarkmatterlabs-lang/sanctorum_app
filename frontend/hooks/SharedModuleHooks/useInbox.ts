import { useCallback, useEffect } from 'react';
import { inboxService } from '@/services/inboxService';
import { useInboxStore } from '@/store/inboxStore';

/** How often to re-read threads while any agent is mid-run. */
const LIVE_POLL_MS = 2000;
/** How often when nothing is running — just enough to notice a reply landing. */
const IDLE_POLL_MS = 8000;

/**
 * Hook seam for the inbox (Component -> Hook -> Service -> API). Exposes the
 * threads/messages/unread state from the store plus the actions.
 *
 * WHY THIS POLLS. A run finishes ASYNCHRONOUSLY: the AI service POSTs events to
 * the backend, which writes the reply, and nothing pushes that to the browser —
 * there is no socket or SSE. `inboxService.send` starts a 30-second one-shot
 * poll, but a run that takes longer outlives it, and after that nothing refetches
 * until something else happens to call refresh(). That is why a reply only
 * appeared after leaving the inbox and coming back: reopening the thread called
 * refresh() by hand.
 *
 * The same stale `threads` array drives the OFFICE: useOffice derives which
 * agents are "running" from `activeRunId`, so a thread list that never refreshes
 * also means sprites that never change status.
 *
 * Polling faster while a run is live keeps the reply and the sprite responsive;
 * dropping to a slow tick when nothing is running keeps it cheap.
 */
export function useInbox() {
  const threads = useInboxStore((s) => s.threads);
  const unread = useInboxStore((s) => s.unread);
  const openThreadId = useInboxStore((s) => s.openThreadId);
  const messages = useInboxStore((s) => s.messages);

  const live = threads.some((t) => t.activeRunId || t.pendingRunId);

  useEffect(() => {
    void inboxService.refresh();
  }, []);

  useEffect(() => {
    const id = setInterval(
      () => void inboxService.refresh(),
      live ? LIVE_POLL_MS : IDLE_POLL_MS
    );
    return () => clearInterval(id);
  }, [live]);

  // The open thread's MESSAGES are a separate fetch from the thread list, so a
  // reply landing mid-run needs its own refresh — otherwise the badge updates
  // while the conversation on screen stays one message behind.
  useEffect(() => {
    if (!openThreadId || !live) return;
    const id = setInterval(() => void inboxService.refreshOpenThread(), LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [openThreadId, live]);

  return {
    threads,
    unread,
    openThreadId,
    messages,
    refresh: useCallback(() => inboxService.refresh(), []),
    openAgent: useCallback((agentKey: string) => inboxService.openAgent(agentKey), []),
    openThread: useCallback((threadId: string) => inboxService.openThread(threadId), []),
    closeThread: useCallback(() => inboxService.closeThread(), []),
    send: useCallback(
      (threadId: string, body: string, successCriteria?: string) =>
        inboxService.send(threadId, body, successCriteria),
      []
    ),
    decide: useCallback(
      (
        threadId: string,
        runId: string,
        decision: 'proceed' | 'stop' | 'edit',
        edited?: string
      ) => inboxService.decide(threadId, runId, decision, edited),
      []
    ),
    cancel: useCallback(
      (threadId: string, runId: string) => inboxService.cancel(threadId, runId),
      []
    ),
    redirect: useCallback(
      (threadId: string, body: string, runId?: string) =>
        inboxService.redirect(threadId, body, runId),
      []
    ),
    openTeam: useCallback(
      (teamId: string, subject: string) => inboxService.openTeam(teamId, subject),
      []
    ),
    remove: useCallback((threadId: string) => inboxService.remove(threadId), []),
  };
}
