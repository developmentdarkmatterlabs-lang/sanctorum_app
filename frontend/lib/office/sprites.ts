import { ASSET_PATHS } from './roster';
import type { AssetKey, SpriteKey } from './types';

export type ImageBank<K extends string> = Partial<Record<K, HTMLImageElement>>;

export type OfficeImages = {
  sprites: ImageBank<SpriteKey>;
  assets: ImageBank<AssetKey>;
  /** Floor backgrounds, keyed by their URL (floors are runtime data). */
  backgrounds: Record<string, HTMLImageElement>;
};

/** An image is safe to draw only once decoded; drawing early throws or no-ops. */
export const ready = (img: HTMLImageElement | undefined): img is HTMLImageElement =>
  !!img && img.complete && img.naturalWidth > 0;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/**
 * Loads the static room art. Agent sprites are loaded separately, since they
 * are only known once the roster arrives from the API.
 */
export function loadRoomAssets(bank: OfficeImages, onProgress?: () => void): void {
  (Object.keys(ASSET_PATHS) as AssetKey[]).forEach((key) => {
    void loadImage(ASSET_PATHS[key])
      .then((img) => {
        bank.assets[key] = img;
        onProgress?.();
      })
      .catch((err) => console.error(err));
  });
}

/** Loads any floor backgrounds not already in the bank, keyed by URL. */
export function loadBackgrounds(
  bank: OfficeImages,
  urls: string[],
  onProgress?: () => void
): void {
  urls.forEach((url) => {
    if (bank.backgrounds[url]) return;
    void loadImage(url)
      .then((img) => {
        bank.backgrounds[url] = img;
        onProgress?.();
      })
      .catch((err) => console.error(err));
  });
}

/** Loads any sprite sheets in `entries` that are not already in the bank. */
export function loadAgentSprites(
  bank: OfficeImages,
  entries: { key: SpriteKey; spritePath: string }[],
  onProgress?: () => void
): void {
  entries.forEach(({ key, spritePath }) => {
    if (bank.sprites[key]) return;
    void loadImage(spritePath)
      .then((img) => {
        bank.sprites[key] = img;
        onProgress?.();
      })
      .catch((err) => console.error(err));
  });
}
