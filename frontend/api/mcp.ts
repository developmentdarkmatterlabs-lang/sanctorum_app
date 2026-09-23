import { API_BASE_URL } from './config';
import { get } from './client';
import type { McpServer } from '@/lib/office/types';

/** Surfaces the server's `error` message (name clash, clearance guardrail) so the
 *  UI can show the real reason. */
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

// ---- Library --------------------------------------------------------------

export const fetchMcpServers = () => get<McpServer[]>('/api/mcp');

/** What the client may WRITE. `authToken` is raw here ('' clears it); the response
 *  masks it. */
export type McpServerInput = {
  name: string;
  description?: string;
  transport?: 'http' | 'stdio';
  url?: string;
  authToken?: string;
  headers?: string;
  command?: string;
  args?: string;
  minClearance?: number;
  enabled?: boolean;
};

export const createMcpServer = (input: McpServerInput) =>
  sendJson<McpServer>('/api/mcp', 'POST', input);

export const updateMcpServer = (id: string, input: Partial<McpServerInput>) =>
  sendJson<McpServer>(`/api/mcp/${encodeURIComponent(id)}`, 'PATCH', input);

export const deleteMcpServer = (id: string) =>
  sendJson<{ deleted: boolean }>(`/api/mcp/${encodeURIComponent(id)}`, 'DELETE');

// ---- Assignment (server <-> position) -------------------------------------

export const fetchPositionMcps = (positionId: string) =>
  get<McpServer[]>(`/api/mcp/position/${encodeURIComponent(positionId)}`);

export const assignMcp = (positionId: string, mcpServerId: string) =>
  sendJson<{ ok: true }>(`/api/mcp/position/${encodeURIComponent(positionId)}`, 'POST', {
    mcpServerId,
  });

export const unassignMcp = (positionId: string, mcpServerId: string) =>
  sendJson<{ ok: true }>(
    `/api/mcp/position/${encodeURIComponent(positionId)}/${encodeURIComponent(mcpServerId)}`,
    'DELETE'
  );
