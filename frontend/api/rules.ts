import { API_BASE_URL } from './config';
import { get } from './client';
import type { Rule, RuleScope } from '@/lib/office/types';

/** Surfaces the server's `error` message (e.g. "a team-scoped rule needs a team")
 *  so the UI can show the real reason. */
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

export const fetchRules = () => get<Rule[]>('/api/rules');

/** The rules a seat actually follows (global + team + position, inherited). */
export const fetchEffectiveRules = (teamId: string | null, positionId: string | null) => {
  const params = new URLSearchParams();
  if (teamId) params.set('teamId', teamId);
  if (positionId) params.set('positionId', positionId);
  const qs = params.toString();
  return get<Rule[]>(`/api/rules/effective${qs ? `?${qs}` : ''}`);
};

export type RuleInput = {
  title?: string;
  body?: string;
  scope?: RuleScope;
  ownerId?: string | null;
  order?: number;
  enabled?: boolean;
};

export const createRule = (input: RuleInput) => sendJson<Rule>('/api/rules', 'POST', input);

export const updateRule = (id: string, input: RuleInput) =>
  sendJson<Rule>(`/api/rules/${encodeURIComponent(id)}`, 'PATCH', input);

export const deleteRule = (id: string) =>
  sendJson<{ deleted: boolean }>(`/api/rules/${encodeURIComponent(id)}`, 'DELETE');

export const reorderRules = (items: { id: string; order: number }[]) =>
  sendJson<{ ok: true }>('/api/rules/reorder', 'PATCH', { items });
