import {
  deleteThread,
  fetchMessages,
  fetchThreads,
  fetchUnread,
  markThreadRead,
  openAgentThread,
  openTeamThread,
  postCancel,
  postDecision,
  postMessage,
  postRedirect,
  type ApprovalKind,
} from '@/api/inbox';
import { useInboxStore } from '@/store/inboxStore';

/**
 * Inbox actions — threads, messages, unread. Follows
 * Component -> Hook -> Service -> API, patching the inbox store so the panel and
 * chat re-render. Sending a message returns the (stubbed) reply, which the
 * runtime will later stream instead.
 */
export class InboxService {
  /** Refresh the thread list + unread total. */
  async refresh(): Promise<void> {
    const [threads, { unread }] = await Promise.all([fetchThreads(), fetchUnread()]);
    const { setThreads, setUnread } = useInboxStore.getState();
    setThreads(threads);
    setUnread(unread);
  }

  /**
   * Re-reads the OPEN thread's messages, so a reply that lands while you are
   * looking at the conversation appears without reopening it.
   *
   * Separate from `refresh()` because the thread list and a thread's messages are
   * different endpoints: refreshing the list updates the badge and the sprite
   * state, but not the conversation on screen.
   *
   * Silent on failure — this runs on a timer, and a transient error should not
   * throw an unhandled rejection into the UI every couple of seconds.
   */
  async refreshOpenThread(): Promise<void> {
    const { openThreadId, messages, setMessages } = useInboxStore.getState();
    if (!openThreadId) return;

    const next = await fetchMessages(openThreadId).catch(() => null);
    if (!next) return;

    // Only touch the store when something actually arrived; a no-op setState
    // each tick would re-render the thread view for nothing.
    if (next.length === messages.length) return;
    // The thread may have been closed or switched while the fetch was in flight.
    if (useInboxStore.getState().openThreadId !== openThreadId) return;

    setMessages(next);
    await markThreadRead(openThreadId).catch(() => {});
  }

  /** Open an agent DM: create/reuse the thread, load its messages, mark read. */
  async openAgent(agentKey: string): Promise<void> {
    const thread = await openAgentThread(agentKey);
    await this.openThread(thread.id);
    await this.refresh();
  }

  /** Open an existing thread by id: load messages, mark read, refresh badges. */
  async openThread(threadId: string): Promise<void> {
    const { setOpenThread, setMessages } = useInboxStore.getState();
    setOpenThread(threadId);
    setMessages(await fetchMessages(threadId));
    await markThreadRead(threadId);
    await this.refresh();
  }

  /** Close the chat pane. */
  closeThread(): void {
    const { setOpenThread, setMessages } = useInboxStore.getState();
    setOpenThread(null);
    setMessages([]);
  }

  /**
   * Send a message to the open thread. With the in-process stub the reply is in
   * the returned list already. With the real out-of-process runtime, the agent's
   * events stream in over the next seconds via the backend webhook — so poll the
   * thread briefly and stop once it goes quiet (a `done`/`error`-style tail, or
   * no new messages for a couple of ticks).
   */
  async send(threadId: string, body: string, successCriteria?: string): Promise<void> {
    const messages = await postMessage(threadId, body, successCriteria);
    useInboxStore.getState().setMessages(messages);
    await markThreadRead(threadId);
    await this.refresh();
    await this.pollForReply(threadId, messages.length);
  }

  /** Poll a thread until new messages stop arriving (or a short timeout). Only
   *  refreshes the store while this thread is still the open one. */
  private async pollForReply(threadId: string, seenCount: number): Promise<void> {
    let count = seenCount;
    let quietTicks = 0;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (useInboxStore.getState().openThreadId !== threadId) return;
      const msgs = await fetchMessages(threadId).catch(() => null);
      if (!msgs) continue;
      if (msgs.length > count) {
        count = msgs.length;
        quietTicks = 0;
        useInboxStore.getState().setMessages(msgs);
        await markThreadRead(threadId);
        await this.refresh();
      } else {
        quietTicks++;
        // Two quiet seconds after at least one reply arrived → the run is done.
        if (quietTicks >= 2 && count > seenCount) return;
      }
    }
  }

  /**
   * Answer a supervised pause on the given thread: proceed / stop / edit. Posts
   * the decision (recorded as a system message), then polls for the follow-up
   * events the resumed run streams in — same tail-off logic as `send`.
   */
  async decide(
    threadId: string,
    runId: string,
    decision: ApprovalKind,
    edited?: string
  ): Promise<void> {
    const seen = useInboxStore.getState().messages.length;
    await postDecision(runId, threadId, decision, edited);
    // The decision itself adds a system message; reload so it shows immediately.
    const msgs = await fetchMessages(threadId).catch(() => null);
    if (msgs && useInboxStore.getState().openThreadId === threadId) {
      useInboxStore.getState().setMessages(msgs);
    }
    await this.refresh();
    // The pause is answered, but `refresh` just re-read the thread and the
    // service processes decisions ASYNCHRONOUSLY — so that row still carries the
    // OLD pendingRunId. Clear it locally AFTER the refresh (setThreads replaces
    // the list wholesale, so clearing before would be overwritten). Showing
    // "approve step" for an answered step is what invites a duplicate click, and
    // duplicates spawn duplicate child runs. The next real pause arrives as a
    // normal event and re-opens the bar legitimately.
    useInboxStore.getState().clearPending(threadId);
    // 'stop' ends the run; proceed/edit resume it and stream more events.
    if (decision !== 'stop') await this.pollForReply(threadId, seen);
  }

  /**
   * Hard stop the run in flight on a thread — works whether it's paused or mid
   * auto-approved loop. Posts the cancel, then polls briefly for the terminal
   * events (the run streams "run stopped by user." + done).
   */
  async cancel(threadId: string, runId: string): Promise<void> {
    const seen = useInboxStore.getState().messages.length;
    await postCancel(runId, threadId);
    const msgs = await fetchMessages(threadId).catch(() => null);
    if (msgs && useInboxStore.getState().openThreadId === threadId) {
      useInboxStore.getState().setMessages(msgs);
    }
    await this.refresh();
    await this.pollForReply(threadId, seen);
  }

  /**
   * Interrupt-and-redirect: stop the run in flight on a thread (if any) and send a
   * new instruction, which starts a fresh run. Reloads the thread and polls for
   * the new run's events, same as `send`.
   */
  async redirect(threadId: string, body: string, runId?: string): Promise<void> {
    const messages = await postRedirect(threadId, body, runId);
    if (useInboxStore.getState().openThreadId === threadId) {
      useInboxStore.getState().setMessages(messages);
    }
    await markThreadRead(threadId);
    await this.refresh();
    await this.pollForReply(threadId, messages.length);
  }

  /** Start a team broadcast thread and open it. */
  async openTeam(teamId: string, subject: string): Promise<void> {
    const thread = await openTeamThread(teamId, subject);
    await this.openThread(thread.id);
    await this.refresh();
  }

  async remove(threadId: string): Promise<void> {
    await deleteThread(threadId);
    if (useInboxStore.getState().openThreadId === threadId) this.closeThread();
    await this.refresh();
  }
}

export const inboxService = new InboxService();
