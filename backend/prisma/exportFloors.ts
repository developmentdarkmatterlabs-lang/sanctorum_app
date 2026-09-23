/**
 * Exports the LIVE floor layout back into the seed files.
 *
 * WHY THIS EXISTS. Floors are edited in the app (the tile / block / seat tools),
 * which writes to `Room.grid` and the `Seat` table. That makes a layout real in
 * YOUR database and nowhere else: a reset, a fresh clone, or anyone else's
 * install falls back to whatever `seed.ts` says. This script closes that loop —
 * it reads the current rooms and seats and rewrites `rooms.ts` and `seats.ts`,
 * so the layout you built by hand becomes the layout the product ships with.
 *
 * Edit in the UI -> run this -> commit. The seed then matches reality by
 * construction instead of by someone hand-editing 20x20 grid JSON.
 *
 * SEAT IDS ARE RENUMBERED. The editor creates seats with cuids, which are
 * meaningless in a fresh install and would churn the diff on every export. This
 * writes deterministic `seat_<room>_<index>` ids instead, matching the original
 * convention and keeping the seed idempotent. Indices are renumbered 0..n-1 in
 * reading order (top-to-bottom, left-to-right) because the editor assigns the
 * lowest FREE index as you work, which leaves them in no order at all.
 *
 * SCOPE. Pass room orders to export only those floors; omit for all of them.
 *   npx tsx prisma/exportFloors.ts 0        # just HQ
 *   npx tsx prisma/exportFloors.ts          # every floor
 * A partial export rewrites only the named floors and leaves the rest of the
 * seed files exactly as they were.
 *
 * WHAT IT DOES NOT TOUCH. Agent placement in `seed.ts` — who sits where is a
 * separate decision from what the floor looks like, and this script would
 * otherwise silently bake the current roster into the shipped layout.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '../database/db';

const ROOMS_FILE = path.join(__dirname, 'rooms.ts');
const SEATS_FILE = path.join(__dirname, 'seats.ts');

type SeatRow = { room: number; seat: number; tx: number; ty: number };

const ROOMS_HEADER = `// The floors the product ships with. GENERATED — do not hand-edit.
// Regenerate from the live database after editing floors in the app:
//   npx tsx prisma/exportFloors.ts [roomOrder ...]
// grid and props are JSON strings, matching the schema columns.
export type RoomSeed = { order: number; name: string; bg: string; grid: string; props: string };

export const ROOM_SEEDS: RoomSeed[] = [
`;

const SEATS_HEADER = `// The desks the product ships with. GENERATED — do not hand-edit.
// Regenerate from the live database after editing floors in the app:
//   npx tsx prisma/exportFloors.ts [roomOrder ...]
// Ids are deterministic (seat_<room>_<index>) so the seed stays idempotent.
export const SEATS = [
`;

/** A TS string literal, single-quoted, with the few chars that matter escaped. */
const lit = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * Parses the existing generated files so a PARTIAL export can keep the floors it
 * was not asked to touch. Reading back what we wrote is safer than regenerating
 * everything, which would silently export floors the user has not reviewed yet.
 */
async function readExisting(): Promise<{
  rooms: Map<number, string>;
  seats: Map<number, SeatRow[]>;
}> {
  const rooms = new Map<number, string>();
  const seats = new Map<number, SeatRow[]>();

  const roomsSrc = await fs.readFile(ROOMS_FILE, 'utf8').catch(() => '');
  for (const line of roomsSrc.split('\n')) {
    const m = line.match(/^\s*\{\s*order:\s*(\d+)\s*,/);
    if (m) rooms.set(Number(m[1]), line.replace(/\s+$/, ''));
  }

  const seatsSrc = await fs.readFile(SEATS_FILE, 'utf8').catch(() => '');
  for (const line of seatsSrc.split('\n')) {
    const m = line.match(
      /room:\s*(\d+)\s*,\s*seat:\s*(\d+)\s*,\s*tx:\s*(\d+)\s*,\s*ty:\s*(\d+)/
    );
    if (!m) continue;
    const row: SeatRow = {
      room: Number(m[1]),
      seat: Number(m[2]),
      tx: Number(m[3]),
      ty: Number(m[4]),
    };
    seats.set(row.room, [...(seats.get(row.room) ?? []), row]);
  }

  return { rooms, seats };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).map(Number);
  if (args.some((n) => !Number.isInteger(n) || n < 0)) {
    console.error('Usage: npx tsx prisma/exportFloors.ts [roomOrder ...]');
    process.exitCode = 1;
    return;
  }

  const live = await prisma.room.findMany({ orderBy: { order: 'asc' } });
  if (live.length === 0) {
    console.error('No rooms in the database — nothing to export.');
    process.exitCode = 1;
    return;
  }

  const target = args.length ? new Set(args) : new Set(live.map((r) => r.order));
  const missing = [...target].filter((o) => !live.some((r) => r.order === o));
  if (missing.length) {
    console.error(`No such floor(s): ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const existing = await readExisting();
  const roomLines = new Map(existing.rooms);
  const seatRows = new Map(existing.seats);

  for (const room of live) {
    if (!target.has(room.order)) continue;

    // Props are a relation; re-serialise them into the seed's JSON column so a
    // floor's decoration survives the round trip too.
    const props = await prisma.prop.findMany({
      where: { roomId: room.id },
      orderBy: [{ y: 'asc' }, { x: 'asc' }],
      select: { kind: true, x: true, y: true },
    });
    const propsJson = JSON.stringify(props.map((p) => ({ kind: p.kind, x: p.x, y: p.y })));

    roomLines.set(
      room.order,
      `  { order: ${room.order}, name: ${lit(room.name)}, bg: ${lit(room.bg)}, ` +
        `grid: ${lit(room.grid)}, props: ${lit(propsJson)} },`
    );

    // Reading order, so the shipped indices follow the floor rather than the
    // order the user happened to click.
    const live_seats = await prisma.seat.findMany({
      where: { room: room.order },
      orderBy: [{ ty: 'asc' }, { tx: 'asc' }],
      select: { tx: true, ty: true },
    });
    seatRows.set(
      room.order,
      live_seats.map((s, i) => ({ room: room.order, seat: i, tx: s.tx, ty: s.ty }))
    );

    console.log(
      `floor ${room.order} "${room.name}": ${live_seats.length} seats, ${props.length} props`
    );
  }

  const orders = [...new Set([...roomLines.keys(), ...seatRows.keys()])].sort((a, b) => a - b);

  await fs.writeFile(
    ROOMS_FILE,
    ROOMS_HEADER + orders.map((o) => roomLines.get(o)).filter(Boolean).join('\n') + '\n];\n',
    'utf8'
  );

  const seatLines: string[] = [];
  for (const o of orders) {
    for (const s of seatRows.get(o) ?? []) {
      seatLines.push(
        `  { id: 'seat_${s.room}_${s.seat}', room: ${s.room}, seat: ${s.seat}, tx: ${s.tx}, ty: ${s.ty} },`
      );
    }
  }
  await fs.writeFile(SEATS_FILE, SEATS_HEADER + seatLines.join('\n') + '\n];\n', 'utf8');

  const exported = [...target].sort((a, b) => a - b).join(', ');
  console.log(
    `\nWrote ${orders.length} floors and ${seatLines.length} seats ` +
      `(exported floor${target.size === 1 ? '' : 's'} ${exported}; the rest kept as they were).`
  );
}

main()
  .catch((e) => {
    console.error('Floor export failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
