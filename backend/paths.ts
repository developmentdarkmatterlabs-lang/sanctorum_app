import path from 'path';

// When TypeScript compiles backend/ -> backend/dist/, every __dirname
// reference shifts one level deeper. This module detects whether we're
// running from source (ts-node) or from the compiled dist/ folder and
// exports stable root paths that always point to the right place.

const isCompiledDist = __dirname.replace(/\\/g, '/').includes('/dist');

// Always resolves to the backend/ folder (never backend/dist/).
export const BACKEND_ROOT = isCompiledDist ? path.resolve(__dirname, '..') : __dirname;

// Always resolves to the top-level project folder (parent of backend/).
export const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..');

// Writable root for uploads, user data, etc.
//   Packaged Electron: app.getPath('userData') passed via APP_USER_DATA env
//   Dev mode: falls back to BACKEND_ROOT (the normal backend/ folder)
export const DATA_ROOT = process.env.APP_USER_DATA || BACKEND_ROOT;
