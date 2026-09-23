import { API_BASE_URL } from './config';
import { get, del, patch } from './client';
import type {
  AgentEdit,
  DirectionName,
  RosterEntry,
  Taxonomy,
} from '@/lib/office/types';

export type CreateAgentInput = {
  name: string;
  room: number;
  seat: number;
  title: string;
  tagline: string;
  role: string;
  clearance: number;
  dataType: number;
  tenure: string;
  focus: string;
  /** Which direction each spritesheet row faces, top row first. */
  rowOrder: DirectionName[];
  responsibilities: string[];
  sprite: File;
  portrait: File;
};

export const fetchAgents = () => get<RosterEntry[]>('/api/agents');

export const fetchTaxonomy = () => get<Taxonomy>('/api/agents/taxonomy');

export const fetchTakenSeats = (room: number) =>
  get<{ room: number; taken: number[] }>(`/api/agents/seats/${room}`);

/**
 * Multipart upload, so this bypasses the JSON `request()` helper: the browser
 * must set its own multipart boundary on Content-Type.
 */
export async function createAgent(input: CreateAgentInput): Promise<RosterEntry> {
  const form = new FormData();
  form.append('name', input.name);
  form.append('room', String(input.room));
  form.append('seat', String(input.seat));
  form.append('title', input.title);
  form.append('tagline', input.tagline);
  form.append('role', input.role);
  form.append('clearance', String(input.clearance));
  form.append('dataType', String(input.dataType));
  form.append('tenure', input.tenure);
  form.append('focus', input.focus);
  form.append('rowOrder', JSON.stringify(input.rowOrder));
  form.append('responsibilities', JSON.stringify(input.responsibilities));
  form.append('sprite', input.sprite);
  form.append('portrait', input.portrait);

  const response = await fetch(`${API_BASE_URL}/api/agents`, {
    method: 'POST',
    body: form,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error ?? `Failed to create agent (${response.status})`);
  }
  return body as RosterEntry;
}

/** Edit any subset of a dossier — used by the panel's save button. */
export const updateAgent = (key: string, edit: AgentEdit) =>
  patch<RosterEntry>(`/api/agents/${encodeURIComponent(key)}`, edit);

export const deleteAgent = (key: string) =>
  del<{ key: string; deleted: boolean }>(`/api/agents/${encodeURIComponent(key)}`);
