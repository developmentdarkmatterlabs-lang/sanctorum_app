import { API_BASE_URL } from './config';
import { get } from './client';

export type MemoryScope = 'team' | 'position' | 'agent';
export type MemoryKind = 'task' | 'result' | 'insight' | 'note';

export type MemoryEntry = {
  id: string;
  scope: MemoryScope;
  ownerId: string;
  kind: MemoryKind;
  body: string;
  clearance: number;
  authorAgentKey: string | null;
  createdAt: string;
};

async function sendJson<T>(
  endpoint: string,
  method: 'POST' | 'DELETE',
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

/**
 * Reads memory for an owner. Pass `asAgentKey` to apply the clearance/membership
 * gate (what that agent may see); omit it for the unfiltered management view.
 */
export function fetchMemory(
  scope: MemoryScope,
  ownerId: string,
  asAgentKey?: string
): Promise<MemoryEntry[]> {
  const q = asAgentKey ? `?as=${encodeURIComponent(asAgentKey)}` : '';
  return get<MemoryEntry[]>(`/api/memory/${scope}/${encodeURIComponent(ownerId)}${q}`);
}

/** Adds a memory entry to an owner. Throws the server's reason on failure. */
export const writeMemory = (
  scope: MemoryScope,
  ownerId: string,
  input: { body: string; kind?: MemoryKind; clearance?: number; authorAgentKey?: string | null }
) =>
  sendJson<MemoryEntry>(
    `/api/memory/${scope}/${encodeURIComponent(ownerId)}`,
    'POST',
    input
  );

export const deleteMemory = (id: string) =>
  sendJson<{ deleted: boolean }>(`/api/memory/${id}`, 'DELETE');
