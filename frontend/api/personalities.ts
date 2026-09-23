import { del, get, patch, post } from './client';
import type { Personality } from '@/lib/office/types';

/**
 * Personalities — who an agent is and how it speaks.
 *
 * Routed through client.ts rather than a local `sendJson` helper (which several
 * older API modules still carry): client.ts now throws on a non-ok response with
 * the server's own message, which is the only thing those helpers added, and it
 * is the path that works over Electron IPC.
 */

export type PersonalityInput = {
  name?: string;
  summary?: string;
  body?: string;
  stance?: string;
  enabled?: boolean;
};

export const fetchPersonalities = () => get<Personality[]>('/api/personalities');

export const createPersonality = (input: PersonalityInput) =>
  post<Personality>('/api/personalities', input);

export const updatePersonality = (id: string, input: PersonalityInput) =>
  patch<Personality>(`/api/personalities/${encodeURIComponent(id)}`, input);

export const deletePersonality = (id: string) =>
  del<void>(`/api/personalities/${encodeURIComponent(id)}`);
