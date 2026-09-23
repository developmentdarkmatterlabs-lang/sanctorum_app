import { create } from 'zustand';

export type Sender = 'user' | 'agent' | 'system';

export type Message = {
  id: string;
  threadId: string;
  sender: Sender;
  agentKey: string | null;
  body: string;
  resultRef: string | null;
  readAt: string | null;
  createdAt: string;
};

export type Thread = {
  id: string;
  agentKey: string | null;
  teamId: string | null;
  subject: string;
  createdAt: string;
  updatedAt: string;
  unread: number;
  lastMessage: string | null;
  lastAt: string | null;
  /** Set while a supervised run is paused, waiting on this thread's decision. */
  pendingRunId: string | null;
  /** A `$ ...`-style description of the step awaiting approval. */
  pendingStep: string | null;
  /** The run currently in flight on this thread (for a hard stop), or null when
   *  idle. Set even when the run isn't paused. */
  activeRunId: string | null;
  /** Phase 4 — the root of the delegation tree running on this thread, or null.
   *  Present when a leader has fanned work out to its reports. */
  rootRunId: string | null;
};

type InboxState = {
  /** All threads, newest activity first. */
  threads: Thread[];
  /** Total unread across threads (top-level badge). */
  unread: number;
  /** The thread currently open in the chat pane, or null. */
  openThreadId: string | null;
  /** Messages of the open thread. */
  messages: Message[];

  setThreads: (threads: Thread[]) => void;
  /** Optimistically clear a thread's pause after the user answers it. The
   *  decision POST returns as soon as it is ACCEPTED, and the refresh that
   *  follows still reads the OLD pendingRunId (the service hasn't emitted its
   *  next event yet) — so without this the approval bar flickers back for a step
   *  already answered, and invites a duplicate click. */
  clearPending: (threadId: string) => void;
  setUnread: (unread: number) => void;
  setOpenThread: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
};

export const useInboxStore = create<InboxState>((set) => ({
  threads: [],
  unread: 0,
  openThreadId: null,
  messages: [],

  setThreads: (threads) => set({ threads }),
  clearPending: (threadId) =>
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, pendingRunId: null, pendingStep: null } : t
      ),
    })),
  setUnread: (unread) => set({ unread }),
  setOpenThread: (openThreadId) => set({ openThreadId }),
  setMessages: (messages) => set({ messages }),
}));
