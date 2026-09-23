import { useEffect } from 'react';
import { GH, GW, TILE } from '@/lib/office/constants';
import { useOfficeStore } from '@/store/officeStore';

/** Padding around the canvas inside its scroll box. */
const PAD = 40;

export const fits2x = (w: number, h: number): boolean =>
  GW * TILE * 2 <= w - PAD && GH * TILE * 2 <= h - PAD;

/**
 * Picks the starting zoom from the viewport so the map fits on first paint.
 * Runs once: after that the choice is the user's, and the canvas scrolls in
 * both axes when 2x is larger than the window.
 */
export function useAutoZoom(): void {
  useEffect(() => {
    if (!fits2x(window.innerWidth, window.innerHeight)) {
      useOfficeStore.getState().setZoom(1);
    }
  }, []);
}
