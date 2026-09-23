import type { Room } from './types';

// Floors (including their seats) now live in the database (GET /api/rooms).
// What remains here is the small set of things that are NOT per-room data:
//   - PAD: the portal tile, identical on every floor so the lift lines up.
//   - helpers that used to read a global ROOMS constant, now pure functions of
//     a passed-in room array.

/** The portal pad tile — bottom-centre on every floor. */
export const PAD: [number, number] = [9, 18];

/** Short label used on agent cards. */
export const roomLabel = (rooms: Room[], room: number): string => {
  const name = rooms[room]?.name ?? '?';
  return name === 'Gaming Room' ? 'GAME' : name.toUpperCase().slice(0, 7);
};

/** The floor below, wrapping at the bottom — the portal is a lift. */
export const otherRoom = (rooms: Room[], room: number): number =>
  rooms.length ? (room + 1) % rooms.length : room;

const NUMBER_WORDS = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six',
  'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
];

/** Spelled-out floor count for prose; falls back to digits past the word list. */
export const floorCountWord = (count: number): string =>
  NUMBER_WORDS[count] ?? String(count);
