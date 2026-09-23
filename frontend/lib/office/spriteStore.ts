import {
  loadAgentSprites,
  loadBackgrounds,
  loadRoomAssets,
  type OfficeImages,
} from './sprites';
import { PROP_KINDS, TILE_KINDS } from './editor/tools';
import type { SpriteKey } from './types';

/**
 * Module-level image bank. Images are external state — the browser owns the
 * decoding — so React subscribes to this rather than holding it in useState.
 * Static art loads on first subscribe; agent sprites and floor backgrounds
 * load as rosters and rooms arrive.
 */
const images: OfficeImages = { sprites: {}, assets: {}, backgrounds: {} };

let snapshot = 0;
let started = false;
const listeners = new Set<() => void>();

const emit = () => {
  snapshot += 1;
  listeners.forEach((listener) => listener());
};

export const subscribeToSprites = (listener: () => void): (() => void) => {
  listeners.add(listener);

  if (!started) {
    started = true;
    loadRoomAssets(images, emit);
    // Tile and prop art are small fixed sets; load into the URL-keyed bank so
    // the renderer and palette can look them up by path.
    loadBackgrounds(
      images,
      [...TILE_KINDS.map((t) => t.path), ...PROP_KINDS.map((p) => p.path)],
      emit
    );
    emit();
  }

  return () => {
    listeners.delete(listener);
  };
};

/** Loads sprite sheets for agents the bank has not seen yet. */
export const ensureAgentSprites = (
  entries: { key: SpriteKey; spritePath: string }[]
): void => {
  loadAgentSprites(images, entries, emit);
};

/** Loads floor backgrounds the bank has not seen yet, by URL. */
export const ensureBackgrounds = (urls: string[]): void => {
  loadBackgrounds(images, urls, emit);
};

/** Version counter — changes whenever a new image finishes decoding. */
export const getSpriteSnapshot = (): number => snapshot;

export const getServerSpriteSnapshot = (): number => 0;

export const getSpriteImages = (): OfficeImages => images;
