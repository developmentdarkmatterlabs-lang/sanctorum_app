import { GH, GW, TILE } from './constants';

/** True if (x, y) is inside the grid and walkable. Takes the grid directly, so
 *  it does not depend on any global room list. */
export const walkable = (grid: number[][], x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < GW && y < GH && grid[y]?.[x] === 0;

/** Centre-bottom world position of a tile — where an agent stands. */
export const tileToWorld = (x: number, y: number): { px: number; py: number } => ({
  px: (x + 0.5) * TILE,
  py: (y + 1) * TILE - 2,
});

export const worldToTile = (px: number, py: number): { x: number; y: number } => ({
  x: Math.floor(px / TILE),
  y: Math.floor(py / TILE),
});
