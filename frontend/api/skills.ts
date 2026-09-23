import { API_BASE_URL } from './config';
import { get } from './client';
import type { Skill } from '@/lib/office/types';

/** Surfaces the server's `error` message on failure (name clashes, clearance
 *  guardrail on assignment) so the UI can show the real reason. */
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

export const fetchSkills = () => get<Skill[]>('/api/skills');

export type SkillInput = {
  name: string;
  description?: string;
  body: string;
  minClearance?: number;
};

export const createSkill = (input: SkillInput) => sendJson<Skill>('/api/skills', 'POST', input);

export const updateSkill = (id: string, input: Partial<SkillInput>) =>
  sendJson<Skill>(`/api/skills/${encodeURIComponent(id)}`, 'PATCH', input);

export const deleteSkill = (id: string) =>
  sendJson<{ deleted: boolean }>(`/api/skills/${encodeURIComponent(id)}`, 'DELETE');

// ---- Assignment (skill <-> position) --------------------------------------

export const fetchPositionSkills = (positionId: string) =>
  get<Skill[]>(`/api/skills/position/${encodeURIComponent(positionId)}`);

export const assignSkill = (positionId: string, skillId: string) =>
  sendJson<{ ok: true }>(`/api/skills/position/${encodeURIComponent(positionId)}`, 'POST', {
    skillId,
  });

export const unassignSkill = (positionId: string, skillId: string) =>
  sendJson<{ ok: true }>(
    `/api/skills/position/${encodeURIComponent(positionId)}/${encodeURIComponent(skillId)}`,
    'DELETE'
  );
