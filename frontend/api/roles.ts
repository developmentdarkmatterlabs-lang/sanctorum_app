import { API_BASE_URL } from './config';
import { get } from './client';
import type { Role } from '@/lib/office/types';

/** Surfaces the server's `error` message so the UI can show the real reason —
 *  a duplicate title, or the 409 "N seats hold this role; reassign them first". */
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

/** The catalog, each role carrying its current headcount (`seatCount`). */
export const fetchRoles = () => get<Role[]>('/api/roles');

export type RoleInput = {
  title?: string;
  level?: number;
  discipline?: string;
  description?: string;
  defaultClearance?: number;
};

export const createRole = (input: RoleInput) => sendJson<Role>('/api/roles', 'POST', input);

/** Editing title/defaultClearance propagates LIVE to every seat that inherits it. */
export const updateRole = (id: string, input: RoleInput) =>
  sendJson<Role>(`/api/roles/${encodeURIComponent(id)}`, 'PATCH', input);

/** Refused (409) while any seat holds the role — the thrown message says how many. */
export const deleteRole = (id: string) =>
  sendJson<{ deleted: boolean }>(`/api/roles/${encodeURIComponent(id)}`, 'DELETE');
