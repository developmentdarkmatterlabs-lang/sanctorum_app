import {
  addSeat,
  deleteSeat,
  eraseTile,
  moveSeat,
  paintTile,
  placeProp,
  removeProp,
  renameSeat,
  setBlocked,
} from '@/api/rooms';
import { useOfficeStore } from '@/store/officeStore';
import type { Prop, Room, Seat, Tile } from '@/lib/office/types';

/**
 * Edits to the floors themselves — tiles and props for now, seats/floors later.
 * Follows Component -> Hook -> Service -> API, then patches the room in the
 * store so the render loop shows the change immediately.
 */
export class RoomService {
  /** Replaces a room in the store with a new tile list. */
  private patchRoomTiles(roomId: string, tiles: Tile[]): void {
    const { rooms, setRooms } = useOfficeStore.getState();
    setRooms(rooms.map((r) => (r.id === roomId ? { ...r, tiles } : r)));
  }

  /** Replaces a room in the store with a new prop list. */
  private patchRoomProps(roomId: string, props: Prop[]): void {
    const { rooms, setRooms } = useOfficeStore.getState();
    setRooms(rooms.map((r) => (r.id === roomId ? { ...r, props } : r)));
  }

  /** Replaces a room in the store with a new seat list. */
  private patchRoomSeats(roomId: string, seats: Seat[]): void {
    const { rooms, setRooms } = useOfficeStore.getState();
    setRooms(rooms.map((r) => (r.id === roomId ? { ...r, seats } : r)));
  }

  /** Replaces a room's collision grid in the store. */
  private patchRoomGrid(roomId: string, M: number[][]): void {
    const { rooms, setRooms } = useOfficeStore.getState();
    setRooms(rooms.map((r) => (r.id === roomId ? { ...r, M } : r)));
  }

  /**
   * Blocks or unblocks a grid cell (the collision-paint brush). Optimistic: the
   * red tint flips instantly, rolling back if the server refuses (e.g. blocking
   * would strand a desk). A no-op (cell already in that state) is skipped.
   */
  async setBlocked(
    room: Room,
    cell: { x: number; y: number },
    blocked: boolean
  ): Promise<void> {
    const before = room.M;
    const current = before[cell.y]?.[cell.x] === 1;
    if (current === blocked) return;

    const next = before.map((row) => row.slice());
    next[cell.y][cell.x] = blocked ? 1 : 0;
    this.patchRoomGrid(room.id, next);

    try {
      await setBlocked(room.id, cell.x, cell.y, blocked);
    } catch (error) {
      this.patchRoomGrid(room.id, before);
      throw error;
    }
  }

  /** Adds a desk. Server-validated: an unwalkable or unreachable tile throws. */
  async addSeat(room: Room, cell: { x: number; y: number }): Promise<void> {
    const seat = await addSeat(room.id, cell.x, cell.y);
    this.patchRoomSeats(room.id, [...room.seats, seat]);
  }

  /** Moves a desk to a new tile. */
  async moveSeat(room: Room, seatId: string, cell: { x: number; y: number }): Promise<void> {
    const before = room.seats;
    const moved = await moveSeat(seatId, cell.x, cell.y);
    this.patchRoomSeats(
      room.id,
      before.map((s) => (s.id === seatId ? moved : s))
    );
  }

  /** Deletes a desk. Server refuses if an agent occupies it. */
  async deleteSeat(room: Room, seatId: string): Promise<void> {
    const before = room.seats;
    this.patchRoomSeats(room.id, before.filter((s) => s.id !== seatId));
    try {
      await deleteSeat(seatId);
    } catch (error) {
      this.patchRoomSeats(room.id, before);
      throw error;
    }
  }

  /** Renames a desk (its human label). */
  async renameSeat(room: Room, seatId: string, name: string): Promise<void> {
    const before = room.seats;
    const renamed = await renameSeat(seatId, name);
    this.patchRoomSeats(
      room.id,
      before.map((s) => (s.id === seatId ? renamed : s))
    );
  }

  /**
   * Places a blocking prop. Not optimistic: the server validates reachability
   * first, so a stranding placement is rejected before it ever appears. On a
   * 409 the thrown error carries the stranded cells for the UI.
   */
  async placeProp(
    room: Room,
    cell: { x: number; y: number },
    kind: string,
    rotation: number
  ): Promise<void> {
    const saved = await placeProp(room.id, { kind, rotation, blocking: true, ...cell });
    this.patchRoomProps(room.id, [
      ...room.props.filter((p) => !(p.x === cell.x && p.y === cell.y)),
      saved,
    ]);
  }

  /** Removes the prop at a cell. Only editor (blocking) props are removed here;
   *  removing never strands anything. */
  async removeProp(room: Room, cell: { x: number; y: number }): Promise<void> {
    const target = room.props.find((p) => p.x === cell.x && p.y === cell.y);
    if (!target) return;
    const before = room.props;
    this.patchRoomProps(
      room.id,
      before.filter((p) => !(p.x === cell.x && p.y === cell.y))
    );
    try {
      await removeProp(room.id, cell.x, cell.y);
    } catch (error) {
      this.patchRoomProps(room.id, before);
      throw error;
    }
  }

  /** Paints a tile, optimistically updating the store, rolling back on failure. */
  async paint(
    room: Room,
    cell: { x: number; y: number },
    kind: string,
    rotation: number
  ): Promise<void> {
    const before = room.tiles;
    // Optimistic: replace-or-add the cell locally, then confirm with the server.
    const provisional: Tile = { id: `tmp-${cell.x}-${cell.y}`, kind, rotation, ...cell };
    this.patchRoomTiles(room.id, [
      ...before.filter((t) => !(t.x === cell.x && t.y === cell.y)),
      provisional,
    ]);

    try {
      const saved = await paintTile(room.id, { kind, rotation, ...cell });
      this.patchRoomTiles(room.id, [
        ...before.filter((t) => !(t.x === cell.x && t.y === cell.y)),
        saved,
      ]);
    } catch (error) {
      this.patchRoomTiles(room.id, before);
      throw error;
    }
  }

  /** Erases the tile at a cell, optimistically. */
  async erase(room: Room, cell: { x: number; y: number }): Promise<void> {
    const before = room.tiles;
    if (!before.some((t) => t.x === cell.x && t.y === cell.y)) return;

    this.patchRoomTiles(
      room.id,
      before.filter((t) => !(t.x === cell.x && t.y === cell.y))
    );

    try {
      await eraseTile(room.id, cell.x, cell.y);
    } catch (error) {
      this.patchRoomTiles(room.id, before);
      throw error;
    }
  }
}

export const roomService = new RoomService();
