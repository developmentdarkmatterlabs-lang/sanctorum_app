import { useCallback } from 'react';
import type { MouseEvent } from 'react';
import { TILE, GH, GW } from '@/lib/office/constants';
import { PAD } from '@/lib/office/rooms';
import { checkStranding } from '@/lib/office/editor/validation';
import { roomService } from '@/services/roomService';
import { useEditorStore } from '@/store/editorStore';
import { useOfficeStore } from '@/store/officeStore';

/** Cell under a pointer event, or null if outside the grid. */
const cellAt = (
  event: MouseEvent<HTMLCanvasElement>,
  zoom: number
): { x: number; y: number } | null => {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / (TILE * zoom));
  const y = Math.floor((event.clientY - rect.top) / (TILE * zoom));
  if (x < 0 || y < 0 || x >= GW || y >= GH) return null;
  return { x, y };
};

const isPad = (x: number, y: number) => x === PAD[0] && y === PAD[1];

/**
 * Pointer -> tile/prop edit. Returns handlers for the office canvas; when edit
 * mode is off it reports the click as unhandled so the caller falls back to
 * play behaviour (select an agent / move).
 */
export function useEditor() {
  const currentRoom = () => {
    const { rooms, viewRoom } = useOfficeStore.getState();
    return rooms[viewRoom];
  };

  // Surfaces a refused edit in the Activity feed so the reason is visible, not
  // just a console 409. The server sends a plain-language message (e.g. "that
  // tile is not walkable", "cut off from the portal").
  const report = (action: string, error: unknown) => {
    const reason = error instanceof Error ? error.message : 'that edit was refused';
    useOfficeStore.getState().appendLog('editor', `couldn't ${action}: ${reason}`);
    console.error(error);
  };

  const applyAt = useCallback((cell: { x: number; y: number }) => {
    const { tool, tileKind, propKind, rotation } = useEditorStore.getState();
    const room = currentRoom();
    if (!room || isPad(cell.x, cell.y)) return;

    const seatHere = room.seats.find((s) => s.x === cell.x && s.y === cell.y);

    if (tool === 'erase') {
      // Erase clears a tile, a prop, or an (empty) seat at that cell.
      void roomService.erase(room, cell).catch((e) => console.error(e));
      void roomService.removeProp(room, cell).catch((e) => console.error(e));
      if (seatHere && !seatHere.occupied) {
        void roomService.deleteSeat(room, seatHere.id).catch((e) => report('remove that desk', e));
      }
    } else if (tool === 'tile') {
      void roomService.paint(room, cell, tileKind, rotation).catch((e) => console.error(e));
    } else if (tool === 'prop') {
      // A blocking prop that would strand the floor is rejected by the server.
      void roomService
        .placeProp(room, cell, propKind, rotation)
        .catch((e) => report('place that prop', e));
    } else if (tool === 'seat') {
      // Toggle: an empty seat here is removed, otherwise one is added. An
      // occupied seat is left alone (delete would be refused anyway).
      if (seatHere) {
        if (!seatHere.occupied) {
          void roomService.deleteSeat(room, seatHere.id).catch((e) => report('remove that desk', e));
        }
      } else {
        void roomService.addSeat(room, cell).catch((e) => report('add a desk there', e));
      }
    } else if (tool === 'block') {
      // Toggle collision on the grid: a walkable cell becomes blocked, a blocked
      // one becomes walkable. The pad is never toggled (guarded above).
      const blocked = room.M[cell.y]?.[cell.x] === 1;
      void roomService
        .setBlocked(room, cell, !blocked)
        .catch((e) => report(blocked ? 'clear that block' : 'block that tile', e));
    }
  }, []);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLCanvasElement>, zoom: number): boolean => {
      if (!useEditorStore.getState().active) return false;
      const cell = cellAt(event, zoom);
      if (cell) applyAt(cell);
      return true;
    },
    [applyAt]
  );

  const handleHover = useCallback(
    (event: MouseEvent<HTMLCanvasElement>, zoom: number): void => {
      const { active, tool, setHover, setStranded } = useEditorStore.getState();
      if (!active) return;

      const cell = cellAt(event, zoom);
      setHover(cell);

      // Only the prop tool can strand; preview reachability under the cursor.
      if (cell && tool === 'prop' && !isPad(cell.x, cell.y)) {
        const room = currentRoom();
        if (room) {
          const { ok, stranded } = checkStranding(room, cell);
          setStranded(ok ? [] : stranded);
          return;
        }
      }
      setStranded([]);
    },
    []
  );

  const handleLeave = useCallback(() => {
    useEditorStore.getState().setHover(null);
    useEditorStore.getState().setStranded([]);
  }, []);

  return { handleClick, handleHover, handleLeave };
}
