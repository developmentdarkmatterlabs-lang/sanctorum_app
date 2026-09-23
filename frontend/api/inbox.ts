import { API_BASE_URL } from './config';
import { get } from './client';
import type { Message, Thread } from '@/store/inboxStore';

async function sendJson<T>(
  endpoint: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const fetchThreads = () => get<Thread[]>('/api/inbox/threads');

export const fetchUnread = () => get<{ unread: number }>('/api/inbox/unread');

export const fetchMessages = (threadId: string) =>
  get<Message[]>(`/api/inbox/threads/${threadId}/messages`);

/** Open (or reuse) the DM thread for an agent. */
export const openAgentThread = (agentKey: string) =>
  sendJson<Thread>(`/api/inbox/threads/agent/${encodeURIComponent(agentKey)}`, 'POST');

/** Create a team broadcast thread. */
export const openTeamThread = (teamId: string, subject: string) =>
  sendJson<Thread>(`/api/inbox/threads/team/${teamId}`, 'POST', { subject });

/** Send a message; the returned list includes the (stubbed) reply. An optional
 *  success criterion steers the worker-evaluator loop (else it's derived). */
export const postMessage = (threadId: string, body: string, successCriteria?: string) =>
  sendJson<Message[]>(`/api/inbox/threads/${threadId}/messages`, 'POST', {
    body,
    ...(successCriteria?.trim() ? { successCriteria: successCriteria.trim() } : {}),
  });

/** The user's answer at a supervised pause. */
export type ApprovalKind = 'proceed' | 'stop' | 'edit';

/** Answer a supervised run's pause. `edited` is only used for the 'edit' kind. */
export const postDecision = (
  runId: string,
  threadId: string,
  decision: ApprovalKind,
  edited?: string
) =>
  sendJson<{ ok: true }>(
    `/api/runtime/runs/${encodeURIComponent(runId)}/decision`,
    'POST',
    { threadId, decision, ...(decision === 'edit' ? { edited: edited ?? '' } : {}) }
  );

/** Hard stop a run — works whether it's paused or mid-flight. */
export const postCancel = (runId: string, threadId: string) =>
  sendJson<{ ok: true }>(
    `/api/runtime/runs/${encodeURIComponent(runId)}/cancel`,
    'POST',
    { threadId }
  );

/** Interrupt-and-redirect: stop the current run (if any) and send a new task.
 *  Returns the updated thread messages. `runId` omitted if nothing is running. */
export const postRedirect = (threadId: string, body: string, runId?: string) =>
  sendJson<Message[]>(
    `/api/runtime/threads/${encodeURIComponent(threadId)}/redirect`,
    'POST',
    { body, ...(runId ? { runId } : {}) }
  );

export const markThreadRead = (threadId: string) =>
  sendJson<{ read: boolean }>(`/api/inbox/threads/${threadId}/read`, 'PATCH');

export const deleteThread = (threadId: string) =>
  sendJson<{ deleted: boolean }>(`/api/inbox/threads/${threadId}`, 'DELETE');
