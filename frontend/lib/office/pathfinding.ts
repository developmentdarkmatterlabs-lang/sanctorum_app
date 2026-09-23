import { GW } from './constants';
import { walkable } from './grid';
import type { Point } from './types';

const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Breadth-first search across a room grid. Returns the tile path excluding the
 * start tile, or null when the goal is unreachable.
 */
export function bfs(
  grid: number[][],
  sx: number,
  sy: number,
  gx: number,
  gy: number
): Point[] | null {
  if (!walkable(grid, gx, gy)) return null;

  const key = (x: number, y: number) => y * GW + x;
  const prev = new Map<number, [number, number] | null>();
  const queue: [number, number][] = [[sx, sy]];
  let head = 0;

  prev.set(key(sx, sy), null);

  while (head < queue.length) {
    const [x, y] = queue[head++];

    if (x === gx && y === gy) {
      const path: Point[] = [];
      let k = key(x, y);
      let cx = x;
      let cy = y;
      let step = prev.get(k);
      while (step) {
        path.unshift({ x: cx, y: cy });
        [cx, cy] = step;
        k = key(cx, cy);
        step = prev.get(k);
      }
      return path;
    }

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (walkable(grid, nx, ny) && !prev.has(key(nx, ny))) {
        prev.set(key(nx, ny), [x, y]);
        queue.push([nx, ny]);
      }
    }
  }

  return null;
}
