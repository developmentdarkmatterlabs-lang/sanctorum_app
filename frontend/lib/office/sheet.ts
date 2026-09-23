import { ANIM_FRAMES, SPR } from './constants';
import { DIRECTIONS, type DirectionName } from './types';

/** Sheets are ANIM_FRAMES columns x DIRECTIONS.length rows of SPR px cells. */
export const SHEET = {
  cell: SPR,
  columns: ANIM_FRAMES,
  rows: DIRECTIONS.length,
  width: SPR * ANIM_FRAMES,
  height: SPR * DIRECTIONS.length,
} as const;

/** Draws one cell of a spritesheet, scaled to fit the destination box. */
export function drawCell(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  row: number,
  frame: number,
  dx: number,
  dy: number,
  size: number
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(dx, dy, size, size);
  ctx.drawImage(sheet, frame * SPR, row * SPR, SPR, SPR, dx, dy, size, size);
}

/** True when every direction appears exactly once. */
export function isCompleteRowOrder(
  rows: (DirectionName | null)[]
): rows is DirectionName[] {
  const named = rows.filter((r): r is DirectionName => r !== null);
  return (
    named.length === DIRECTIONS.length &&
    new Set(named).size === DIRECTIONS.length
  );
}

/** Which directions are still unassigned, for prompting in the UI. */
export function missingDirections(
  rows: (DirectionName | null)[]
): DirectionName[] {
  const used = new Set(rows.filter(Boolean));
  return DIRECTIONS.filter((d) => !used.has(d));
}
