/** Logical facings an agent can have. */
export const DIRECTIONS = ['down', 'right', 'up', 'left'] as const;
export type DirectionName = (typeof DIRECTIONS)[number];

/** The order most sheets use, and the one every shipped agent uses. */
export const DEFAULT_ROW_ORDER: DirectionName[] = ['down', 'right', 'up', 'left'];

const isDirection = (v: unknown): v is DirectionName =>
  typeof v === 'string' && (DIRECTIONS as readonly string[]).includes(v);

/**
 * A row order is valid only if it assigns all four directions exactly once —
 * a sheet with two "up" rows and no "down" is always a mistake.
 */
export function parseRowOrder(value: unknown): DirectionName[] | null {
  const raw = typeof value === 'string' ? safeJson(value) : value;
  if (!Array.isArray(raw) || raw.length !== DIRECTIONS.length) return null;
  if (!raw.every(isDirection)) return null;
  if (new Set(raw).size !== DIRECTIONS.length) return null;
  return raw as DirectionName[];
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
