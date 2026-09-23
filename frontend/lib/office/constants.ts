import { DIRECTIONS, type Direction, type DirectionName } from './types';

/** Tile size in world pixels. */
export const TILE = 32;
/** Grid width in tiles. */
export const GW = 20;
/** Grid height in tiles. */
export const GH = 20;
/** Spritesheet cell size. */
export const SPR = 48;

/**
 * Logical facings. These are NOT spritesheet rows — each agent maps them to
 * its own rows via `rowOrder`, because sheets disagree about row order.
 */
export const DIR: Record<DirectionName, Direction> = {
  down: 0,
  right: 1,
  up: 2,
  left: 3,
};

/** The order the shipped sheets use, and the fallback for anything unlabelled. */
export const DEFAULT_ROW_ORDER: DirectionName[] = ['down', 'right', 'up', 'left'];

/**
 * Builds a direction -> row lookup from a sheet's row order.
 * `rowOrder[2] === 'up'` means row 2 holds the up-facing frames, so the
 * returned table maps DIR.up -> 2.
 */
export function toRowLookup(rowOrder: DirectionName[]): Direction[] {
  const lookup = [...DEFAULT_ROW_ORDER].map(
    (_, i) => i
  ) as Direction[];
  rowOrder.forEach((name, row) => {
    const dir = DIRECTIONS.indexOf(name);
    if (dir !== -1) lookup[dir] = row as Direction;
  });
  return lookup;
}

/** The two presets the 1x / 2x chips snap to. */
export const ZOOM_LEVELS = [1, 2] as const;

/**
 * Zoom is continuous between these bounds — the wheel steps through it in
 * fine increments, while the chips jump straight to a preset.
 */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;

export type Zoom = number;

/** Snap to the step grid and clamp, so wheel deltas cannot drift off-grid. */
export const quantizeZoom = (value: number): Zoom => {
  const stepped = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped));
  // Kill floating-point fuzz: 1.7999999 renders a blurry canvas.
  return Math.round(clamped * 100) / 100;
};

/** Walk animation: seconds per frame, and frame count. */
export const ANIM_FRAME_TIME = 0.13;
export const ANIM_FRAMES = 4;

/** Base walk speed in world px/sec; each agent gets a small random offset. */
export const SPEED_BASE = 52;
export const SPEED_JITTER = 10;

/** Seconds an agent ignores the auto-scheduler after a manual command. */
export const MANUAL_HOLD = 25;

/** Seconds of portal cooldown after teleporting, so agents don't ping-pong. */
export const PORTAL_COOLDOWN = 1.5;

/** Auto-behavior think timer bounds (seconds). */
export const THINK_MIN = 5;
export const THINK_SPREAD = 9;
export const THINK_INITIAL_MIN = 3;
export const THINK_INITIAL_SPREAD = 6;

/** Max simulation step, to avoid tunneling after a background tab resumes. */
export const MAX_DT = 0.05;

/** Activity log ring-buffer size. */
export const LOG_LIMIT = 60;

/** Agent draw offsets, in world px. */
export const AGENT_DRAW = {
  spriteYOffset: 4,
  shadowRx: 9,
  shadowRy: 3.5,
  shadowYOffset: 1,
  selectionX: -12,
  selectionY: -40,
  selectionW: 24,
  selectionH: 42,
  bubbleX: 8,
  bubbleY: -52,
  bubbleW: 16,
  bubbleH: 12,
  bubbleRadius: 3,
  bubbleFont: 9,
} as const;

/** Prop draw boxes, in world px. */
export const PROP_DRAW = {
  tree: { dx: -8, dy: -22, w: 48, h: 54, sortOffset: 0 },
  bush: { dx: 1, dy: 2, w: 30, h: 30, sortOffset: -6 },
} as const;

export const PORTAL_DRAW = {
  // Offsets are relative to the pad tile's top-left corner (TILE=32).
  // The doorway art in both rooms spans two tiles (x = pad..pad+1), so the
  // arch is nudged half a tile right to centre on that seam, and dropped so it
  // stands at the foot of the room rather than floating above the pad.
  small: { dx: 17, dy: 1, w: 30, h: 30 },
  big: { dx: 6, dy: -22, w: 52, h: 60, sortOffset: -1 },
} as const;

/** Hit-test tolerance when clicking an agent on canvas, in world px. */
export const HIT_TEST = { x: 14, y: 22, yOffset: 20 } as const;

/**
 * Face thumbnail crop, taken from the first frame of the down-facing row.
 * `sy` is an offset *within* that row — the row itself depends on the sheet,
 * so callers add `rowLookup[DIR.down] * SPR`.
 */
export const FACE_CROP = { sx: 14, sy: 6, sw: 20, sh: 20, size: 16 } as const;
