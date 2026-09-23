import { useSyncExternalStore } from 'react';
import {
  getServerSpriteSnapshot,
  getSpriteImages,
  getSpriteSnapshot,
  subscribeToSprites,
} from '@/lib/office/spriteStore';
import type { OfficeImages } from '@/lib/office/sprites';

/**
 * Subscribes to the shared office image bank. Loading begins on first use.
 * `version` changes as each image decodes, so canvases can repaint.
 */
export function useSprites(): { images: OfficeImages; version: number } {
  const version = useSyncExternalStore(
    subscribeToSprites,
    getSpriteSnapshot,
    getServerSpriteSnapshot
  );

  return { images: getSpriteImages(), version };
}
