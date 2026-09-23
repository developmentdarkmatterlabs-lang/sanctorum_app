import { useEffect, useRef } from 'react';
import { GH, GW, TILE } from '@/lib/office/constants';
import { PAD } from '@/lib/office/rooms';
import { useEditorStore } from '@/store/editorStore';

type GridOverlayProps = {
  width: number;
  height: number;
  zoom: number;
};

/**
 * A canvas laid over the office that draws the tile grid and highlights the
 * cell under the cursor. Only shown in edit mode. Purely visual — pointer
 * events pass through to the office canvas beneath.
 */
export default function GridOverlay({ width, height, zoom }: GridOverlayProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const active = useEditorStore((s) => s.active);
  const hover = useEditorStore((s) => s.hover);
  const tool = useEditorStore((s) => s.tool);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    if (!active) return;

    const cell = TILE * zoom;

    // Grid lines.
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= GW; x++) {
      ctx.moveTo(x * cell + 0.5, 0);
      ctx.lineTo(x * cell + 0.5, GH * cell);
    }
    for (let y = 0; y <= GH; y++) {
      ctx.moveTo(0, y * cell + 0.5);
      ctx.lineTo(GW * cell, y * cell + 0.5);
    }
    ctx.stroke();

    // The portal pad, which cannot be edited, marked so it is not mistaken for
    // an empty cell.
    ctx.fillStyle = 'rgba(240,168,50,0.18)';
    ctx.fillRect(PAD[0] * cell, PAD[1] * cell, cell, cell);

    // Hover highlight — red for erase, accent for paint.
    if (hover) {
      ctx.fillStyle =
        tool === 'erase' ? 'rgba(224,85,85,0.35)' : 'rgba(87,199,255,0.35)';
      ctx.fillRect(hover.x * cell, hover.y * cell, cell, cell);
      ctx.strokeStyle = tool === 'erase' ? '#e05555' : '#57c7ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(hover.x * cell + 1, hover.y * cell + 1, cell - 2, cell - 2);
    }
  }, [active, hover, tool, width, height, zoom]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0"
      style={{ width, height }}
    />
  );
}
