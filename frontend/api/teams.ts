import { API_BASE_URL } from './config';
import { get } from './client';
import type { Team } from '@/lib/office/types';

/**
 * Like the generic client helpers, but surfaces the server's `error` message on
 * failure instead of a bare "Request failed". Team/position edits refuse for
 * real reasons ("that floor already hosts a team", "that position is already
 * held by another agent"), and the UI shows that text.
 */
async function sendJson<T>(
  endpoint: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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

/** Loads all teams with their positions and holders. */
export const fetchTeams = () => get<Team[]>('/api/teams');

// ---- teams ----------------------------------------------------------------

export const createTeam = (
  name: string,
  mission: string,
  floorId: string | null,
  parentTeamId: string | null = null
) => sendJson<Team>('/api/teams', 'POST', { name, mission, floorId, parentTeamId });

/** Patch a subset of a team. `floorId: null` clears the home floor;
 *  `parentTeamId: null` makes it a top-level team again. */
export const updateTeam = (
  teamId: string,
  patch: {
    name?: string;
    mission?: string;
    floorId?: string | null;
    parentTeamId?: string | null;
  }
) => sendJson<Team>(`/api/teams/${teamId}`, 'PATCH', patch);

export const deleteTeam = (teamId: string) =>
  sendJson<{ deleted: boolean }>(`/api/teams/${teamId}`, 'DELETE');

// ---- positions ------------------------------------------------------------

export const createPosition = (
  teamId: string,
  input: {
    roleId?: string | null;
    titleOverride?: string | null;
    clearanceOverride?: number | null;
    isLeader?: boolean;
  }
) => sendJson<Team>(`/api/teams/${teamId}/positions`, 'POST', input);

export const updatePosition = (
  positionId: string,
  patch: {
    roleId?: string | null;
    /** null CLEARS the override, so the seat inherits from its role again. */
    titleOverride?: string | null;
    clearanceOverride?: number | null;
    isLeader?: boolean;
  }
) => sendJson<Team>(`/api/teams/positions/${positionId}`, 'PATCH', patch);

export const deletePosition = (positionId: string) =>
  sendJson<{ deleted: boolean; teamId: string }>(
    `/api/teams/positions/${positionId}`,
    'DELETE'
  );

// ---- assignment -----------------------------------------------------------

/** Assign an agent to a position (moves them off any prior seat). Throws with
 *  the reason if the position is already held. */
export const assignAgent = (positionId: string, agentKey: string) =>
  sendJson<{ assigned: boolean }>(`/api/teams/positions/${positionId}/agent`, 'PUT', {
    agentKey,
  });

/** Remove an agent from its position (back to the bench). */
export const unassignAgent = (agentKey: string) =>
  sendJson<{ unassigned: boolean }>(`/api/teams/agents/${agentKey}/position`, 'DELETE');
