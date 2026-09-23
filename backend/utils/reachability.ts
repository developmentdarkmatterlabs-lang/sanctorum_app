// The reachability invariant, server-side. Everything the office does depends
// on it: every walkable tile must be reachable from the portal, and no seat
// may be stranded. Edits that break this are rejected.

export const GRID = 20;
/** The portal pad, identical on every floor. Kept in sync with frontend PAD. */
export const PAD: [number, number] = [9, 18];

export type Blocker = { x: number; y: number };

/**
 * Builds the effective walkability grid: the base grid, plus any blocking
 * props stamped as walls. Returns a fresh 2D array of 0 (walkable) / 1 (blocked).
 */
export function effectiveGrid(base: number[][], blockers: Blocker[]): number[][] {
  const grid = base.map((row) => row.slice());
  for (const b of blockers) {
    if (b.y >= 0 && b.y < GRID && b.x >= 0 && b.x < GRID) grid[b.y][b.x] = 1;
  }
  return grid;
}

/** Tiles reachable from the portal pad, as a Set of y*GRID+x keys. */
export function reachableFromPad(grid: number[][]): Set<number> {
  const seen = new Set<number>();
  const [px, py] = PAD;
  if (grid[py]?.[px] !== 0) return seen; // pad itself blocked — nothing reachable
  seen.add(py * GRID + px);
  const queue: [number, number][] = [[px, py]];
  let head = 0;
  while (head < queue.length) {
    const [x, y] = queue[head++];
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
        nx < GRID &&
        ny < GRID &&
        grid[ny][nx] === 0 &&
        !seen.has(ny * GRID + nx)
      ) {
        seen.add(ny * GRID + nx);
        queue.push([nx, ny]);
      }
    }
  }
  return seen;
}

export type ValidationResult = {
  ok: boolean;
  /** Walkable tiles cut off from the portal, if any. */
  stranded: { x: number; y: number }[];
  /** Seats that would end up unreachable, if any. */
  strandedSeats: { x: number; y: number }[];
};

/**
 * Checks whether a grid + blockers leaves everything reachable. `seats` are the
 * desk tiles that must stay reachable (a stranded desk is as bad as a stranded
 * agent). Returns the offending tiles so the UI can highlight them.
 */
export function validateReachability(
  base: number[][],
  blockers: Blocker[],
  seats: { x: number; y: number }[]
): ValidationResult {
  const grid = effectiveGrid(base, blockers);
  const reachable = reachableFromPad(grid);

  const stranded: { x: number; y: number }[] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (grid[y][x] === 0 && !reachable.has(y * GRID + x)) {
        stranded.push({ x, y });
      }
    }
  }

  const strandedSeats = seats.filter(
    (s) => grid[s.y]?.[s.x] !== 0 || !reachable.has(s.y * GRID + s.x)
  );

  return { ok: stranded.length === 0 && strandedSeats.length === 0, stranded, strandedSeats };
}
