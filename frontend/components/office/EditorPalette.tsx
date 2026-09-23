import { useEffect, useRef, useState } from 'react';
import {
  PROP_GROUPS,
  propsInGroup,
  TILE_GROUPS,
  tilesInGroup,
} from '@/lib/office/editor/tools';
import { getSpriteImages } from '@/lib/office/spriteStore';
import { ready } from '@/lib/office/sprites';
import { roomService } from '@/services/roomService';
import { useEditorStore } from '@/store/editorStore';
import { useOfficeStore } from '@/store/officeStore';

/** A single tile swatch, drawn from the loaded art. */
function Swatch({ path }: { path: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const version = useEditorStore((s) => s.rotation); // cheap redraw trigger is fine

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const img = getSpriteImages().backgrounds[path];
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 28, 28);
    if (ready(img)) ctx.drawImage(img, 0, 0, 28, 28);
  }, [path, version]);

  return (
    <canvas
      ref={ref}
      width={28}
      height={28}
      aria-hidden="true"
      className="h-7 w-7 rounded-sm bg-[var(--surface-tertiary)] [image-rendering:pixelated]"
    />
  );
}

const rowButton = (selected: boolean) =>
  `flex items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)] ${
    selected
      ? 'border-[var(--accent-primary)]'
      : 'border-[var(--border-primary)] hover:border-[var(--content-tertiary)]'
  }`;

const gridButton = (selected: boolean) =>
  `relative rounded border p-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)] ${
    selected
      ? 'border-[var(--accent-primary)]'
      : 'border-[var(--border-primary)] hover:border-[var(--content-tertiary)]'
  }`;

type Item = { key: string; label: string; path: string; variant: number | null };

/** One palette group: numbered variations pack into a compact swatch grid; a
 *  group of named single items reads as full-width labelled rows. Shared by the
 *  tile and prop sections. */
function PaletteGroup({
  group,
  items,
  isSelected,
  onSelect,
}: {
  group: string;
  items: readonly Item[];
  isSelected: (key: string) => boolean;
  onSelect: (key: string) => void;
}) {
  if (items.length === 0) return null;
  const numbered = items.every((i) => i.variant !== null) && items.length > 1;

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--content-tertiary)]">
        {group}
      </h3>
      {numbered ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((i) => (
            <button
              key={i.key}
              type="button"
              onClick={() => onSelect(i.key)}
              aria-pressed={isSelected(i.key)}
              aria-label={`${group} ${i.label}`}
              title={`${group} ${i.label}`}
              className={gridButton(isSelected(i.key))}
            >
              <Swatch path={i.path} />
            </button>
          ))}
        </div>
      ) : (
        items.map((i) => (
          <button
            key={i.key}
            type="button"
            onClick={() => onSelect(i.key)}
            aria-pressed={isSelected(i.key)}
            className={rowButton(isSelected(i.key))}
          >
            <Swatch path={i.path} />
            <span className="font-mono text-[11px] text-[var(--content-primary)]">
              {i.label}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

/** Lists the current floor's desks with editable names + occupant, for the seat
 *  tool. Name edits commit on blur/Enter, keyed by seat id (no per-seat effects). */
function SeatList() {
  const rooms = useOfficeStore((s) => s.rooms);
  const viewRoom = useOfficeStore((s) => s.viewRoom);
  const rosterByKey = useOfficeStore((s) => s.rosterByKey);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const room = rooms[viewRoom];
  if (!room) return null;
  const seats = [...room.seats].sort((a, b) => a.seat - b.seat);

  // Occupant name for a seat, from the roster (matches by room + seat index).
  const occupantName = (seatIndex: number): string | null => {
    const entry = Object.values(rosterByKey).find(
      (e) => e.room === viewRoom && e.seat === seatIndex
    );
    return entry?.name ?? null;
  };

  const commit = (seatId: string, current: string) => {
    const next = drafts[seatId];
    setDrafts((d) => {
      const { [seatId]: _drop, ...rest } = d;
      return rest;
    });
    if (next === undefined || next.trim() === current) return;
    setError(null);
    void roomService.renameSeat(room, seatId, next.trim()).catch((e) =>
      setError(e instanceof Error ? e.message : 'Could not rename.')
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      {error && (
        <p role="alert" className="font-mono text-[9.5px] text-[var(--semantic-error)]">
          {error}
        </p>
      )}
      {seats.length === 0 ? (
        <p className="font-mono text-[9.5px] text-[var(--content-tertiary)]">
          No desks on this floor yet.
        </p>
      ) : (
        seats.map((s) => {
          const who = s.occupied ? occupantName(s.seat) : null;
          return (
            <div
              key={s.id}
              className="flex items-center gap-1.5 rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-1.5 py-1"
            >
              <span className="w-4 shrink-0 text-right font-mono text-[9px] tabular-nums text-[var(--content-tertiary)]">
                {s.seat}
              </span>
              <input
                aria-label={`Seat ${s.seat} name`}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[11px] text-[var(--content-primary)] hover:border-[var(--border-primary)] focus-visible:border-[var(--accent-primary)] focus-visible:outline-none"
                placeholder={`seat ${s.seat}`}
                value={drafts[s.id] ?? s.name}
                onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                onBlur={() => commit(s.id, s.name)}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <span
                className={`shrink-0 font-mono text-[9px] ${
                  who ? 'text-[var(--content-secondary)]' : 'text-[var(--content-tertiary)]'
                }`}
              >
                {who ?? 'empty'}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

/** The tile + prop palette, shown alongside the office in edit mode. */
export default function EditorPalette() {
  const active = useEditorStore((s) => s.active);
  const tool = useEditorStore((s) => s.tool);
  const tileKind = useEditorStore((s) => s.tileKind);
  const propKind = useEditorStore((s) => s.propKind);
  const setTileKind = useEditorStore((s) => s.setTileKind);
  const setPropKind = useEditorStore((s) => s.setPropKind);
  const setTool = useEditorStore((s) => s.setTool);

  if (!active) return null;

  return (
    <div className="flex flex-col gap-3 overflow-y-auto border-b border-[var(--border-primary)] p-3">
      <div className="flex flex-col gap-2.5">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
          Tiles
        </h2>
        {TILE_GROUPS.map((group) => (
          <PaletteGroup
            key={group}
            group={group}
            items={tilesInGroup(group)}
            isSelected={(key) => tool === 'tile' && tileKind === key}
            onSelect={(key) => {
              setTileKind(key);
              setTool('tile');
            }}
          />
        ))}
        <p className="font-mono text-[9.5px] leading-relaxed text-[var(--content-tertiary)]">
          Cosmetic — do not block movement.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
          Props
        </h2>
        {PROP_GROUPS.map((group) => (
          <PaletteGroup
            key={group}
            group={group}
            items={propsInGroup(group)}
            isSelected={(key) => tool === 'prop' && propKind === key}
            onSelect={(key) => {
              setPropKind(key);
              setTool('prop');
            }}
          />
        ))}
        <p className="font-mono text-[9.5px] leading-relaxed text-[var(--content-tertiary)]">
          Props block movement. A placement that would cut off the floor is
          shown in red and refused.
        </p>
      </div>

      {tool === 'seat' && (
        <div className="flex flex-col gap-1.5">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
            Seats
          </h2>
          <p className="font-mono text-[9.5px] leading-relaxed text-[var(--content-tertiary)]">
            Click a floor tile to add a desk; click an empty desk (amber ring) to
            remove it. Occupied desks (grey) cannot be removed until the agent
            moves. Name a desk below; blank falls back to its number.
          </p>
          <SeatList />
        </div>
      )}

      {tool === 'block' && (
        <div className="flex flex-col gap-1.5">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
            Block
          </h2>
          <p className="font-mono text-[9.5px] leading-relaxed text-[var(--content-tertiary)]">
            Paint invisible collision over the background. Click a tile to block
            it (red), click again to clear. Blocked cells are solid to agents but
            show no art, so you can trace shapes in the floor image. Red marks
            every blocked cell; it vanishes when you leave the editor. Blocking
            that would strand a desk is refused.
          </p>
        </div>
      )}
    </div>
  );
}
