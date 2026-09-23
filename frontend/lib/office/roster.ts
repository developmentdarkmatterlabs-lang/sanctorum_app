import type { AssetKey } from './types';

// Static shared art. Floor backgrounds are room data loaded from GET /api/rooms
// and drawn by URL; props come from the generated PROP_KINDS. Only the portal,
// the same on every floor, stays mapped here.
export const ASSET_PATHS: Record<AssetKey, string> = {
  portalBig: '/assets/floor/objects/portal_big.png',
  portalSmall: '/assets/floor/objects/portal_small.png',
};
