import { useEffect, useRef, useState } from 'react';
import { ANIM_FRAMES, ANIM_FRAME_TIME } from '@/lib/office/constants';
import { drawCell, missingDirections } from '@/lib/office/sheet';
import { DIRECTIONS, type DirectionName } from '@/lib/office/types';

type SheetRowPickerProps = {
  sheet: HTMLImageElement | null;
  value: (DirectionName | null)[];
  onChange: (rows: (DirectionName | null)[]) => void;
};

const CELL = 40;

/** One spritesheet row: its four frames, animated, plus a direction picker. */
function Row({
  sheet,
  row,
  value,
  taken,
  onPick,
}: {
  sheet: HTMLImageElement;
  row: number;
  value: DirectionName | null;
  taken: Set<DirectionName>;
  onPick: (d: DirectionName | null) => void;
}) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setFrame((f) => (f + 1) % ANIM_FRAMES),
      ANIM_FRAME_TIME * 1000 * 2
    );
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    refs.current.forEach((canvas, i) => {
      const ctx = canvas?.getContext('2d');
      if (ctx) drawCell(ctx, sheet, row, i, 0, 0, CELL);
    });
  }, [sheet, row]);

  return (
    <div className="flex items-center gap-2">
      <span className="w-9 shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--content-tertiary)]">
        row {row + 1}
      </span>

      <div className="flex gap-0.5">
        {Array.from({ length: ANIM_FRAMES }, (_, i) => (
          <canvas
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            width={CELL}
            height={CELL}
            aria-hidden="true"
            className={`rounded-sm bg-[var(--surface-tertiary)] [image-rendering:pixelated] ${
              i === frame ? 'ring-1 ring-[var(--accent-primary)]' : ''
            }`}
          />
        ))}
      </div>

      <select
        aria-label={`Direction for spritesheet row ${row + 1}`}
        value={value ?? ''}
        onChange={(e) => onPick((e.target.value || null) as DirectionName | null)}
        className={`ml-auto w-[86px] cursor-pointer rounded border bg-[var(--surface-tertiary)] px-1.5 py-1 font-mono text-[11px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)] ${
          value
            ? 'border-[var(--border-primary)] text-[var(--content-primary)]'
            : 'border-[var(--semantic-warning)] text-[var(--content-secondary)]'
        }`}
      >
        <option value="">— pick —</option>
        {DIRECTIONS.map((d) => (
          // A direction used by another row is disabled: each must appear once.
          <option key={d} value={d} disabled={d !== value && taken.has(d)}>
            {d}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Shows each spritesheet row's frames so the user can see which way the
 * character faces, and label it. Sheets disagree about row order, and a wrong
 * guess renders an agent that moonwalks rather than throwing.
 */
export default function SheetRowPicker({
  sheet,
  value,
  onChange,
}: SheetRowPickerProps) {
  if (!sheet) {
    return (
      <p className="rounded border border-dashed border-[var(--border-primary)] px-2 py-3 text-center font-mono text-[10px] text-[var(--content-tertiary)]">
        Pick a sprite sheet to label its rows.
      </p>
    );
  }

  const taken = new Set(value.filter((v): v is DirectionName => v !== null));
  const missing = missingDirections(value);

  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: DIRECTIONS.length }, (_, row) => (
        <Row
          key={row}
          sheet={sheet}
          row={row}
          value={value[row] ?? null}
          taken={taken}
          onPick={(d) => {
            const next = [...value];
            // Directions are unique: clear whoever held it before.
            if (d) next.forEach((v, i) => (next[i] = v === d ? null : v));
            next[row] = d;
            onChange(next);
          }}
        />
      ))}

      {missing.length > 0 && (
        <p className="font-mono text-[10px] text-[var(--semantic-warning)]">
          Still to label: {missing.join(', ')}
        </p>
      )}
    </div>
  );
}
