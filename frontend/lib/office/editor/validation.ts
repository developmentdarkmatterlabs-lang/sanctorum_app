import { GH, GW } from '../constants';
import { PAD } from '../rooms';
import type { Room } from '../types';

/**
 * Client-side mirror of the server's reachability check, for instant hover
 * feedback. The server is authoritative — this only decides whether to paint
 * the hover cell red before the round-trip. Kept identical in logic to
 * backend/utils/reachability.ts.
 */

export type Stranded = { stranded: { x: number; y: number }[]; ok: boolean };

/** Base grid + blocking props stamped as walls. */
function effectiveGrid(room: Room, extra?: { x: number; y: number }): number[][] {
  const grid = room.M.map((row) => row.slice());
  for (const p of room.props) {
    if (p.blocking && grid[p.y]?.[p.x] !== undefined) grid[p.y][p.x] = 1;
  }
  if (extra && grid[extra.y]?.[extra.x] !== undefined) grid[extra.y][extra.x] = 1;
  return grid;
}

function reachable(grid: number[][]): Set<number> {
  const seen = new Set<number>();
  const [px, py] = PAD;
  if (grid[py]?.[px] !== 0) return seen;
  seen.add(py * GW + px);
  const q: [number, number][] = [[px, py]];
  let head = 0;
  while (head < q.length) {
    const [x, y] = q[head++];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (
        nx >= 0 &&
        ny >= 0 &&
        nx < GW &&
        ny < GH &&
        grid[ny][nx] === 0 &&
        !seen.has(ny * GW + nx)
      ) {
        seen.add(ny * GW + nx);
        q.push([nx, ny]);
      }
    }
  }
  return seen;
}

/**
 * Would a blocking prop at `cell` strand anything on this floor? Returns the
 * stranded tiles (empty when safe). Also treats stranded seats as failures.
 */
export function checkStranding(room: Room, cell: { x: number; y: number }): Stranded {
  const grid = effectiveGrid(room, cell);
  const seen = reachable(grid);

  const stranded: { x: number; y: number }[] = [];
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      if (grid[y][x] === 0 && !seen.has(y * GW + x)) stranded.push({ x, y });
    }
  }

  const seatStranded = room.seats.some(
    (s) => grid[s.y]?.[s.x] !== 0 || !seen.has(s.y * GW + s.x)
  );

  return { stranded, ok: stranded.length === 0 && !seatStranded };
}
