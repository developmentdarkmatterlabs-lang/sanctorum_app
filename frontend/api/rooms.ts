import { API_BASE_URL } from './config';
import { get, post, put, patch, del } from './client';
import type { Prop, Room, Seat, Tile } from '@/lib/office/types';

/** Shape returned by GET /api/rooms. Everything — including seats — is now the
 *  API's, not a frontend constant. */
type RoomResponse = {
  id: string;
  order: number;
  name: string;
  bg: string;
  grid: number[][];
  props: Prop[];
  tiles: Tile[];
  seats: Seat[];
};

/** Loads the floors, fully from the API. */
export async function fetchRooms(): Promise<Room[]> {
  const rooms = await get<RoomResponse[]>('/api/rooms');
  return rooms
    .sort((a, b) => a.order - b.order)
    .map((r) => ({
      id: r.id,
      order: r.order,
      name: r.name,
      bg: r.bg,
      M: r.grid,
      props: r.props,
      tiles: r.tiles ?? [],
      seats: r.seats ?? [],
    }));
}

/** Paints (or replaces) a decorative tile, returning the saved tile. */
export const paintTile = (
  roomId: string,
  tile: { kind: string; x: number; y: number; rotation: number }
) => put<Tile>(`/api/rooms/${roomId}/tiles`, tile);

/** Erases the tile at a cell. */
export const eraseTile = (roomId: string, x: number, y: number) =>
  del<{ x: number; y: number; erased: boolean }>(`/api/rooms/${roomId}/tiles/${x}/${y}`);

export type ValidateResult = {
  ok: boolean;
  stranded: { x: number; y: number }[];
  strandedSeats: { x: number; y: number }[];
};

/** Dry-run: would a blocking prop at (x, y) strand anything? */
export const validatePlacement = (
  roomId: string,
  x: number,
  y: number,
  blocking = true
) => post<ValidateResult>(`/api/rooms/${roomId}/validate`, { x, y, blocking });

/**
 * Places (or replaces) a prop. Throws with `stranded` details on a 409 when a
 * blocking prop would cut off the floor.
 */
export const placeProp = (
  roomId: string,
  prop: { kind: string; x: number; y: number; rotation: number; blocking: boolean }
) => put<Prop>(`/api/rooms/${roomId}/props`, prop);

/** Removes the prop at a cell. */
export const removeProp = (roomId: string, x: number, y: number) =>
  del<{ x: number; y: number; removed: boolean }>(`/api/rooms/${roomId}/props/${x}/${y}`);

/**
 * Blocks or unblocks a grid cell (the collision-paint brush). Blocking is
 * refused (with a reason) if it strands a desk or the portal; unblocking never
 * is. Uses `sendJson` (defined below) to surface the server's message.
 */
export const setBlocked = (roomId: string, x: number, y: number, blocked: boolean) =>
  sendJson<{ x: number; y: number; blocked: boolean }>(
    `/api/rooms/${roomId}/block/${x}/${y}`,
    blocked ? 'PUT' : 'DELETE'
  );

/**
 * Like the generic client helpers, but surfaces the server's `error` message on
 * failure instead of a bare "Request failed (409)". Seat edits refuse for real
 * reasons ("that tile is not walkable", "cut off from the portal", …) and the
 * editor shows that text, so it must reach the caller.
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
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

/** Adds a desk at (x, y). Throws with the reason if the tile is refused. */
export const addSeat = (roomId: string, x: number, y: number) =>
  sendJson<Seat>(`/api/rooms/${roomId}/seats`, 'POST', { x, y });

/** Moves a desk to a new tile. Throws with the reason if refused. */
export const moveSeat = (seatId: string, x: number, y: number) =>
  sendJson<Seat>(`/api/rooms/seats/${seatId}`, 'PATCH', { x, y });

/** Deletes a desk. Throws with the reason (e.g. an agent occupies it). */
export const deleteSeat = (seatId: string) =>
  sendJson<{ deleted: boolean }>(`/api/rooms/seats/${seatId}`, 'DELETE');

/** Renames a desk (its human label). Empty clears it. */
export const renameSeat = (seatId: string, name: string) =>
  sendJson<Seat>(`/api/rooms/seats/${seatId}/name`, 'PATCH', { name });

// ---- floors ---------------------------------------------------------------

/** The full room, as returned by GET /api/rooms — reused for the create response. */
type RoomDTO = {
  id: string;
  order: number;
  name: string;
  bg: string;
  grid: number[][];
  props: Prop[];
  tiles: Tile[];
  seats: Seat[];
};

const toRoom = (r: RoomDTO): Room => ({
  id: r.id,
  order: r.order,
  name: r.name,
  bg: r.bg,
  M: r.grid,
  props: r.props,
  tiles: r.tiles ?? [],
  seats: r.seats ?? [],
});

/**
 * Creates a floor from a name + background image. Multipart, so it bypasses the
 * JSON `request()` helper (the browser sets its own boundary) and surfaces the
 * server's error text on failure.
 */
export async function createFloor(name: string, background: File): Promise<Room> {
  const form = new FormData();
  form.append('name', name);
  form.append('background', background);

  const response = await fetch(`${API_BASE_URL}/api/rooms`, { method: 'POST', body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error ?? `Failed to create floor (${response.status})`);
  }
  return toRoom(body as RoomDTO);
}

/** Renames a floor. */
export const renameFloor = (roomId: string, name: string) =>
  patch<RoomDTO>(`/api/rooms/${roomId}/name`, { name }).then(toRoom);

/** Moves a floor to a new position in the building. */
export const reorderFloor = (roomId: string, order: number) =>
  patch<{ reordered: boolean }>(`/api/rooms/${roomId}/order`, { order });

/**
 * Deletes a floor. Rejects with the server's message (e.g. "move the N agent(s)
 * off this floor first") on a 409, so the UI can show why it was refused.
 */
export async function deleteFloor(roomId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/rooms/${roomId}`, { method: 'DELETE' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error ?? `Failed to delete floor (${response.status})`);
  }
}
