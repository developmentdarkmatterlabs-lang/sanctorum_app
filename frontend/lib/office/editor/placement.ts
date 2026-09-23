import { TILE } from '../constants';
import type { Rotation } from './tools';

/**
 * Draws a tile image into grid cell (x, y), rotated in quarter-turns about the
 * cell centre. `px` scales world units to screen for the current zoom.
 */
export function drawTile(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  x: number,
  y: number,
  rotation: Rotation,
  zoom: number
): void {
  const px = (n: number) => n * zoom;
  const size = px(TILE);
  const cx = px(x * TILE) + size / 2;
  const cy = px(y * TILE) + size / 2;

  ctx.save();
  ctx.translate(cx, cy);
  if (rotation) ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}
