import type { OfficePalette } from './types';

const FALLBACK: OfficePalette = {
  selection: '#f0a832',
  bubbleFg: '#d7dde6',
  bubbleBg: '#22262e',
  bubbleWaitingFg: '#141414',
  bubbleWaitingBg: '#f0a832',
  emptyBg: '#0b0d10',
  shadow: 'rgba(0,0,0,.28)',
};

const read = (styles: CSSStyleDeclaration, name: string, fallback: string): string => {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
};

/**
 * Canvas can't resolve CSS custom properties, so the theme tokens are read off
 * the document once per theme change and handed to the renderer.
 */
export function readPalette(): OfficePalette {
  if (typeof window === 'undefined') return FALLBACK;

  const styles = getComputedStyle(document.documentElement);
  return {
    selection: read(styles, '--accent-primary', FALLBACK.selection),
    bubbleFg: read(styles, '--content-primary', FALLBACK.bubbleFg),
    bubbleBg: read(styles, '--surface-tertiary', FALLBACK.bubbleBg),
    bubbleWaitingFg: read(styles, '--surface-primary', FALLBACK.bubbleWaitingFg),
    bubbleWaitingBg: read(styles, '--accent-primary', FALLBACK.bubbleWaitingBg),
    emptyBg: read(styles, '--surface-primary', FALLBACK.emptyBg),
    shadow: FALLBACK.shadow,
  };
}
