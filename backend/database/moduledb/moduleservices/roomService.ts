import { prisma } from '../../db';
import {
  PAD,
  GRID as REACH_GRID,
  effectiveGrid,
  reachableFromPad,
  validateReachability,
  type ValidationResult,
} from '../../../utils/reachability';

export type Prop = {
  id: string;
  kind: string;
  x: number;
  y: number;
  rotation: number;
  blocking: boolean;
};

export type Tile = {
  id: string;
  kind: string;
  x: number;
  y: number;
  rotation: number;
};

export type Seat = {
  id: string;
  /** The desk's stored seat index on its floor. Not the array position — a
   *  floor can have gaps (e.g. only seat 4 exists), so callers that reference a
   *  desk by index must use this, not the array offset. */
  seat: number;
  /** Optional human label for the desk; '' = no label (show "seat <index>"). */
  name: string;
  x: number;
  y: number;
  /** Whether an agent currently occupies this desk. */
  occupied: boolean;
};

/** A floor, with its grid, props, tiles and seats. */
export type RoomDTO = {
  id: string;
  order: number;
  name: string;
  bg: string;
  grid: number[][];
  props: Prop[];
  tiles: Tile[];
  seats: Seat[];
};

const parseGrid = (raw: string): number[][] => {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((r) => Array.isArray(r))) {
      return parsed as number[][];
    }
  } catch {
    /* fall through */
  }
  return [];
};

type RoomRow = {
  id: string;
  order: number;
  name: string;
  bg: string;
  grid: string;
  tiles: { id: string; kind: string; x: number; y: number; rotation: number }[];
  props: {
    id: string;
    kind: string;
    x: number;
    y: number;
    rotation: number;
    blocking: boolean;
  }[];
};

type SeatRow = { id: string; room: number; seat: number; name: string; tx: number; ty: number; agent: { id: string } | null };

const toDTO = (row: RoomRow, seats: SeatRow[]): RoomDTO => ({
  id: row.id,
  order: row.order,
  name: row.name,
  bg: row.bg,
  grid: parseGrid(row.grid),
  props: row.props.map((p) => ({
    id: p.id,
    kind: p.kind,
    x: p.x,
    y: p.y,
    rotation: p.rotation,
    blocking: p.blocking,
  })),
  tiles: row.tiles.map((t) => ({
    id: t.id,
    kind: t.kind,
    x: t.x,
    y: t.y,
    rotation: t.rotation,
  })),
  seats: seats
    .filter((s) => s.room === row.order)
    .map((s) => ({ id: s.id, seat: s.seat, name: s.name, x: s.tx, y: s.ty, occupied: s.agent !== null })),
});

const withRelations = { include: { tiles: true, props: true } } as const;

/** All floors, in building order, with their tiles, props and seats. Seats key
 *  to a floor by its order index (not a FK), so they are fetched alongside. */
export async function getAllRooms(): Promise<RoomDTO[]> {
  const [rows, seats] = await Promise.all([
    prisma.room.findMany({ orderBy: { order: 'asc' }, ...withRelations }),
    prisma.seat.findMany({ include: { agent: { select: { id: true } } } }),
  ]);
  return rows.map((r) => toDTO(r, seats));
}

const GRID = 20;
export const isValidCoord = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < GRID;

export const isValidRotation = (n: unknown): n is number =>
  n === 0 || n === 90 || n === 180 || n === 270;

// ---- tiles (cosmetic, no reachability check) ------------------------------

export type TileInput = { kind: string; x: number; y: number; rotation: number };

export async function paintTile(roomId: string, input: TileInput): Promise<Tile> {
  const row = await prisma.tile.upsert({
    where: { roomId_x_y: { roomId, x: input.x, y: input.y } },
    update: { kind: input.kind, rotation: input.rotation },
    create: { roomId, kind: input.kind, x: input.x, y: input.y, rotation: input.rotation },
  });
  return { id: row.id, kind: row.kind, x: row.x, y: row.y, rotation: row.rotation };
}

export async function eraseTile(roomId: string, x: number, y: number): Promise<void> {
  await prisma.tile.deleteMany({ where: { roomId, x, y } });
}

// ---- reachability helpers -------------------------------------------------

async function roomGrid(roomId: string): Promise<number[][] | null> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { grid: true, order: true } });
  return room ? parseGrid(room.grid) : null;
}

async function roomOrder(roomId: string): Promise<number | null> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { order: true } });
  return room?.order ?? null;
}

/** Blocking props for a room, optionally excluding one cell (the one being edited). */
async function blockingProps(
  roomId: string,
  exclude?: { x: number; y: number }
): Promise<{ x: number; y: number }[]> {
  const props = await prisma.prop.findMany({
    where: { roomId, blocking: true },
    select: { x: true, y: true },
  });
  return props.filter((p) => !(exclude && p.x === exclude.x && p.y === exclude.y));
}

/** Desk tiles for a floor, which must stay reachable. Seats live in the Seat
 *  table keyed by the room's order index. */
async function roomSeats(order: number): Promise<{ x: number; y: number }[]> {
  const seats = await prisma.seat.findMany({ where: { room: order }, select: { tx: true, ty: true } });
  return seats.map((s) => ({ x: s.tx, y: s.ty }));
}

/**
 * Would placing a blocking prop at (x, y) strand anything? Runs the same BFS the
 * office uses. `blocking=false` props never need this check.
 */
export async function validatePropPlacement(
  roomId: string,
  x: number,
  y: number,
  blocking: boolean
): Promise<ValidationResult> {
  const grid = await roomGrid(roomId);
  const order = await roomOrder(roomId);
  if (!grid || order === null) {
    return { ok: false, stranded: [], strandedSeats: [] };
  }

  // The existing blockers, minus whatever is at this cell (we are replacing it),
  // plus the new one if it blocks.
  const others = await blockingProps(roomId, { x, y });
  const blockers = blocking ? [...others, { x, y }] : others;
  const seats = await roomSeats(order);
  return validateReachability(grid, blockers, seats);
}

// ---- collision paint (the grid itself) ------------------------------------

export type BlockResult =
  | { ok: true }
  | { ok: false; notFound: true }
  | { ok: false; error: string; strandedSeats?: { x: number; y: number }[] };

/**
 * Flips a single grid cell between walkable (0) and blocked (1) — the "block"
 * brush. This edits the floor's real collision map, so a blocked cell is solid
 * to agents but shows no art. Unblocking never strands anything. Blocking is
 * warn-but-allow: free tiles may be cut off freely (that is normal while
 * shaping an irregular wall), but a stroke that would strand a SEAT/occupied
 * desk, or block the portal pad, is refused.
 */
export async function setBlocked(
  roomId: string,
  x: number,
  y: number,
  blocked: boolean
): Promise<BlockResult> {
  if (!isValidCoord(x) || !isValidCoord(y)) return { ok: false, error: 'off the grid' };

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { grid: true, order: true },
  });
  if (!room) return { ok: false, notFound: true };

  const grid = parseGrid(room.grid);

  if (blocked) {
    if (x === PAD[0] && y === PAD[1]) {
      return { ok: false, error: 'the portal tile must stay walkable' };
    }
    // Check seat stranding on the grid WITH this cell blocked. Free-tile
    // strandings are allowed; only stranded seats/desks refuse the stroke.
    const next = grid.map((row) => row.slice());
    next[y][x] = 1;
    const seats = await roomSeats(room.order);
    const blockers = await blockingProps(roomId);
    const check = validateReachability(next, blockers, seats);
    if (check.strandedSeats.length > 0) {
      return {
        ok: false,
        error: 'that would cut a desk off from the portal',
        strandedSeats: check.strandedSeats,
      };
    }
  }

  // No-op writes are cheap; keep it simple and always persist.
  grid[y][x] = blocked ? 1 : 0;
  await prisma.room.update({ where: { id: roomId }, data: { grid: JSON.stringify(grid) } });
  return { ok: true };
}

// ---- props ----------------------------------------------------------------

export type PropInput = {
  kind: string;
  x: number;
  y: number;
  rotation: number;
  blocking: boolean;
};

/** Places a prop, one per cell (upsert). Callers must validate first. */
export async function placeProp(roomId: string, input: PropInput): Promise<Prop> {
  const row = await prisma.prop.upsert({
    where: { roomId_x_y: { roomId, x: input.x, y: input.y } },
    update: { kind: input.kind, rotation: input.rotation, blocking: input.blocking },
    create: {
      roomId,
      kind: input.kind,
      x: input.x,
      y: input.y,
      rotation: input.rotation,
      blocking: input.blocking,
    },
  });
  return {
    id: row.id,
    kind: row.kind,
    x: row.x,
    y: row.y,
    rotation: row.rotation,
    blocking: row.blocking,
  };
}

/** Removes the prop at a cell. Never strands anything (removing a wall only
 *  opens the map up), so no validation needed. */
export async function removeProp(roomId: string, x: number, y: number): Promise<void> {
  await prisma.prop.deleteMany({ where: { roomId, x, y } });
}

export async function roomExists(roomId: string): Promise<boolean> {
  return (await prisma.room.count({ where: { id: roomId } })) > 0;
}

// ---- seats ----------------------------------------------------------------

export type SeatCheck = { ok: boolean; reason?: string };

/** Whether a tile can hold a desk: on the grid, walkable, reachable from the
 *  portal (with blocking props applied), not the pad, not already a seat. */
async function checkSeatCell(
  roomId: string,
  order: number,
  x: number,
  y: number,
  excludeSeatId?: string
): Promise<SeatCheck> {
  if (!isValidCoord(x) || !isValidCoord(y)) return { ok: false, reason: 'off the grid' };
  if (x === PAD[0] && y === PAD[1]) return { ok: false, reason: 'the portal tile cannot be a seat' };

  const grid = await roomGrid(roomId);
  if (!grid) return { ok: false, reason: 'room not found' };
  if (grid[y]?.[x] !== 0) return { ok: false, reason: 'that tile is not walkable' };

  const blockers = await blockingProps(roomId);
  if (blockers.some((b) => b.x === x && b.y === y)) {
    return { ok: false, reason: 'a prop blocks that tile' };
  }

  const reachable = reachableFromPad(effectiveGrid(grid, blockers));
  if (!reachable.has(y * REACH_GRID + x)) {
    return { ok: false, reason: 'that tile is cut off from the portal' };
  }

  const existing = await prisma.seat.findFirst({ where: { room: order, tx: x, ty: y } });
  if (existing && existing.id !== excludeSeatId) {
    return { ok: false, reason: 'a desk is already there' };
  }

  return { ok: true };
}

export type SeatDTO = { id: string; seat: number; name: string; x: number; y: number; occupied: boolean };

/** Adds a seat at (x, y) on the floor with the given order, after validating
 *  the cell. The seat index is the next free integer for that floor. */
export async function addSeat(
  roomId: string,
  order: number,
  x: number,
  y: number
): Promise<{ seat?: SeatDTO; error?: string }> {
  const check = await checkSeatCell(roomId, order, x, y);
  if (!check.ok) return { error: check.reason };

  const used = await prisma.seat.findMany({ where: { room: order }, select: { seat: true } });
  const taken = new Set(used.map((s) => s.seat));
  let index = 0;
  while (taken.has(index)) index++;

  const row = await prisma.seat.create({
    data: { room: order, seat: index, tx: x, ty: y },
  });
  return { seat: { id: row.id, seat: row.seat, name: row.name, x: row.tx, y: row.ty, occupied: false } };
}

/** Moves a seat to a new tile, validating the destination. */
export async function moveSeat(
  seatId: string,
  x: number,
  y: number
): Promise<{ seat?: SeatDTO; error?: string; notFound?: boolean }> {
  const seat = await prisma.seat.findUnique({
    where: { id: seatId },
    include: { agent: { select: { id: true } } },
  });
  if (!seat) return { notFound: true };

  const room = await prisma.room.findFirst({ where: { order: seat.room }, select: { id: true } });
  if (!room) return { notFound: true };

  const check = await checkSeatCell(room.id, seat.room, x, y, seatId);
  if (!check.ok) return { error: check.reason };

  const row = await prisma.seat.update({ where: { id: seatId }, data: { tx: x, ty: y } });
  return { seat: { id: row.id, seat: row.seat, name: row.name, x: row.tx, y: row.ty, occupied: seat.agent !== null } };
}

/** Deletes a seat. Refuses if an agent occupies it — move the agent first. */
export async function deleteSeat(
  seatId: string
): Promise<{ ok: boolean; error?: string; notFound?: boolean }> {
  const seat = await prisma.seat.findUnique({
    where: { id: seatId },
    include: { agent: { select: { id: true } } },
  });
  if (!seat) return { ok: false, notFound: true };
  if (seat.agent) return { ok: false, error: 'an agent sits here — move them first' };

  await prisma.seat.delete({ where: { id: seatId } });
  return { ok: true };
}

/** Renames a desk (its human label). Empty clears it. */
export async function renameSeat(
  seatId: string,
  name: string
): Promise<{ seat?: SeatDTO; notFound?: boolean }> {
  const existing = await prisma.seat.findUnique({
    where: { id: seatId },
    include: { agent: { select: { id: true } } },
  });
  if (!existing) return { notFound: true };
  const row = await prisma.seat.update({
    where: { id: seatId },
    data: { name: name.trim() },
    include: { agent: { select: { id: true } } },
  });
  return {
    seat: { id: row.id, seat: row.seat, name: row.name, x: row.tx, y: row.ty, occupied: row.agent !== null },
  };
}

// ---- floors ---------------------------------------------------------------

/** A fresh floor's grid: fully walkable interior, walls at the border, with a
 *  gap at the portal so the pad is reachable from inside. */
function blankGrid(): number[][] {
  const g: number[][] = [];
  for (let y = 0; y < REACH_GRID; y++) {
    const row: number[] = [];
    for (let x = 0; x < REACH_GRID; x++) {
      const border = x < 2 || y < 2 || x >= REACH_GRID - 2 || y >= REACH_GRID - 2;
      row.push(border ? 1 : 0);
    }
    g.push(row);
  }
  // Open the portal cell and its approach so the pad is reachable.
  g[PAD[1]][PAD[0]] = 0;
  g[PAD[1] - 1][PAD[0]] = 0;
  return g;
}

/** Adds a floor at the bottom of the building with a blank walkable grid. */
export async function createRoom(
  name: string,
  bg: string
): Promise<RoomDTO> {
  const max = await prisma.room.aggregate({ _max: { order: true } });
  const order = (max._max.order ?? -1) + 1;
  const room = await prisma.room.create({
    data: { order, name, bg, grid: JSON.stringify(blankGrid()) },
    ...withRelations,
  });
  return toDTO(room, []);
}

export async function renameRoom(
  roomId: string,
  name: string
): Promise<RoomDTO | null> {
  const exists = await prisma.room.findUnique({ where: { id: roomId }, select: { order: true } });
  if (!exists) return null;
  const room = await prisma.room.update({
    where: { id: roomId },
    data: { name },
    ...withRelations,
  });
  const seats = await prisma.seat.findMany({ include: { agent: { select: { id: true } } } });
  return toDTO(room, seats);
}

/** Agents in a room (by its order), so a floor with occupants can be refused. */
async function agentsInRoom(order: number): Promise<number> {
  return prisma.agent.count({ where: { room: order } });
}

/**
 * Deletes a floor. Refused if any agent lives there. Renumbers the floors and
 * their seats and agents below it so `order` stays contiguous — the portal
 * cycles by index, so gaps would break the lift.
 */
export async function deleteRoom(
  roomId: string
): Promise<{ ok: boolean; error?: string; notFound?: boolean }> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { order: true } });
  if (!room) return { ok: false, notFound: true };

  const occupants = await agentsInRoom(room.order);
  if (occupants > 0) {
    return { ok: false, error: `move the ${occupants} agent(s) off this floor first` };
  }
  if ((await prisma.room.count()) <= 1) {
    return { ok: false, error: 'the building must have at least one floor' };
  }

  const removed = room.order;
  await prisma.$transaction(async (tx) => {
    // Cascades tiles and props via the FK.
    await tx.room.delete({ where: { id: roomId } });
    // Shift every floor below up by one, and its seats/agents with it.
    await tx.room.updateMany({ where: { order: { gt: removed } }, data: { order: { decrement: 1 } } });
    await tx.seat.updateMany({ where: { room: { gt: removed } }, data: { room: { decrement: 1 } } });
    await tx.agent.updateMany({ where: { room: { gt: removed } }, data: { room: { decrement: 1 } } });
  });
  return { ok: true };
}

/**
 * Moves a floor to a new position, renumbering everything so `order` stays a
 * contiguous 0..n-1 sequence. Seats and agents follow their floor.
 */
export async function reorderRoom(
  roomId: string,
  toOrder: number
): Promise<{ ok: boolean; error?: string; notFound?: boolean }> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { order: true } });
  if (!room) return { ok: false, notFound: true };

  const count = await prisma.room.count();
  const from = room.order;
  const to = Math.max(0, Math.min(count - 1, toOrder));
  if (from === to) return { ok: true };

  // Compute the final order for every floor, then write them. We can't slide
  // the gap with in-place increments: `order` is unique, and updateMany applies
  // row-by-row in an undefined order, so a transient collision (e.g. 2→3 while
  // 3 still exists) aborts the transaction. Instead we park all floors in a
  // negative band first, then set each to its final order — no value is ever
  // shared, even mid-transaction.
  const all = await prisma.room.findMany({ select: { id: true, order: true } });
  const finalOrder = (o: number): number => {
    if (o === from) return to;
    if (from < to) return o > from && o <= to ? o - 1 : o; // moved up: gap slides down
    return o >= to && o < from ? o + 1 : o; // moved down: gap slides up
  };

  await prisma.$transaction(async (tx) => {
    // 1. Park every floor (and its seats/agents) in a distinct negative slot so
    //    no unique(order) value is occupied while we reassign.
    for (const r of all) {
      const park = -1 - r.order;
      await tx.room.update({ where: { id: r.id }, data: { order: park } });
      await tx.seat.updateMany({ where: { room: r.order }, data: { room: park } });
      await tx.agent.updateMany({ where: { room: r.order }, data: { room: park } });
    }
    // 2. Drop each floor into its final slot, seats and agents in lockstep.
    for (const r of all) {
      const park = -1 - r.order;
      const dest = finalOrder(r.order);
      await tx.room.update({ where: { id: r.id }, data: { order: dest } });
      await tx.seat.updateMany({ where: { room: park }, data: { room: dest } });
      await tx.agent.updateMany({ where: { room: park }, data: { room: dest } });
    }
  });
  return { ok: true };
}
