import type { MouseEvent, RefObject } from 'react';
import GridOverlay from './GridOverlay';

type OfficeCanvasProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** The scrolling box, so wheel zoom can anchor to the cursor. */
  scrollRef?: RefObject<HTMLDivElement | null>;
  width: number;
  height: number;
  zoom: number;
  editing: boolean;
  onClick: (event: MouseEvent<HTMLCanvasElement>) => void;
  onHover: (event: MouseEvent<HTMLCanvasElement>) => void;
  onLeave: () => void;
};

export default function OfficeCanvas({
  canvasRef,
  scrollRef,
  width,
  height,
  zoom,
  editing,
  onClick,
  onHover,
  onLeave,
}: OfficeCanvasProps) {
  return (
    // The scanline overlay lives on the outer box so it stays put while the
    // inner box scrolls.
    <div className="office-wrap relative min-w-0 flex-1">
      <div ref={scrollRef} className="office-scroll h-full w-full overflow-auto p-[18px]">
        {/* Positioned wrapper so the grid overlay can sit exactly over the
            canvas. `margin:auto` keeps the top/left overflow reachable. */}
        <div className="relative m-auto block" style={{ width, height }}>
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            onClick={onClick}
            onMouseMove={onHover}
            onMouseLeave={onLeave}
            aria-label="Office floor. Select an agent, then click a tile to send it there. Scroll to zoom."
            style={{ width, height }}
            className={`block rounded-md border border-[var(--border-primary)] bg-[var(--surface-tertiary)] shadow-[0_18px_60px_rgba(0,0,0,.5)] [image-rendering:pixelated] ${
              editing ? 'cursor-cell' : 'cursor-crosshair'
            }`}
          />
          <GridOverlay width={width} height={height} zoom={zoom} />
        </div>
      </div>
    </div>
  );
}
