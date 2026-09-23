import { useEffect, useRef } from 'react';
import { DEFAULT_ROW_ORDER, DIR, FACE_CROP, SPR, toRowLookup } from '@/lib/office/constants';
import { ready } from '@/lib/office/sprites';
import type { DirectionName } from '@/lib/office/types';

type AgentFaceProps = {
  sprite: HTMLImageElement | undefined;
  /** Bumps as sprites decode; redraws once this agent's image is ready. */
  spriteVersion: number;
  /** This sheet's row order — the down-facing row is not always row 0. */
  rowOrder?: DirectionName[];
};

/** 16x16 head crop from the agent's spritesheet. */
export default function AgentFace({ sprite, spriteVersion, rowOrder }: AgentFaceProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !ready(sprite)) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const downRow = toRowLookup(rowOrder ?? DEFAULT_ROW_ORDER)[DIR.down];

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, FACE_CROP.size, FACE_CROP.size);
    ctx.drawImage(
      sprite,
      FACE_CROP.sx,
      downRow * SPR + FACE_CROP.sy,
      FACE_CROP.sw,
      FACE_CROP.sh,
      0,
      0,
      FACE_CROP.size,
      FACE_CROP.size
    );
  }, [sprite, spriteVersion, rowOrder]);

  return (
    <canvas
      ref={ref}
      width={FACE_CROP.size}
      height={FACE_CROP.size}
      aria-hidden="true"
      className="h-7 w-7 flex-none rounded bg-[var(--border-secondary)] [image-rendering:pixelated]"
    />
  );
}
