import { isElectron } from './config';

/**
 * Window controls for the title bar the app draws itself.
 *
 * WHY THIS IS A SIBLING OF client.ts RATHER THAN A CALL THROUGH IT. Every other
 * API module speaks HTTP: `request()` forwards a method and a path to Express
 * and resolves with a body. Window chrome is neither — it is a command to the
 * main process with no response, plus a state it pushes back unprompted. Routing
 * it through `request` would mean inventing a fake endpoint for a thing the
 * backend has no opinion about.
 *
 * It is NOT, however, a new pattern: `onServiceStatus` in electron/preload.ts
 * already establishes main -> renderer push with a subscribe/unsubscribe pair.
 * This module extends that precedent to a second channel rather than inventing
 * a third shape.
 *
 * THE BROWSER CASE IS REAL. `npm run dev` serves the same React app at
 * localhost:3000 with no Electron at all. Every function here degrades to a
 * no-op and `getState` reports `controls: 'none'`, so the title bar renders
 * nothing rather than drawing three buttons that would do nothing when clicked.
 */

/**
 * Who draws the window buttons, and how much room they need.
 *
 * This is the whole reason the frontend never checks `process.platform`: the
 * main process decides the chrome and describes it here, so one component lays
 * itself out for Windows, macOS and a plain browser tab without branching on
 * the platform itself.
 *
 *   custom  we draw minimize/maximize/close   (Windows, Linux — frame: false)
 *   native  the OS draws them                 (macOS — titleBarStyle hiddenInset)
 *   none    there is no window to control     (browser)
 *
 * Mirrors WindowState in electron/main.ts and electron/preload.ts.
 */
export type WindowChrome = {
  controls: 'custom' | 'native' | 'none';
  /** Space to leave clear for OS-drawn buttons, in CSS pixels. macOS reserves
   *  ~78px at the left for its traffic lights; Windows reserves nothing,
   *  because our own buttons are laid out in normal flow. */
  inset: { left: number; right: number };
  isMaximized: boolean;
  isFullScreen: boolean;
};

/** What a browser tab gets: no chrome, no controls, nothing to inset. */
const NO_CHROME: WindowChrome = {
  controls: 'none',
  inset: { left: 0, right: 0 },
  isMaximized: false,
  isFullScreen: false,
};

/*
 * The `window.electronAPI.window` TYPE lives in api/client.ts, not here.
 *
 * TypeScript merges `interface Window` across modules but rejects two
 * declarations of the same PROPERTY, so `electronAPI` can only be described
 * once — and client.ts already describes it for `request`. This module owns the
 * behaviour; that one owns the shape.
 */

/** The bridge, or undefined when we are in a browser — or in an Electron build
 *  whose preload predates this module, which is why the optional chain is not
 *  redundant with `isElectron()`. */
const bridge = () => (isElectron() ? window.electronAPI?.window : undefined);

export function minimize(): void {
  bridge()?.minimize();
}

export function toggleMaximize(): void {
  bridge()?.toggleMaximize();
}

export function close(): void {
  bridge()?.close();
}

/** The chrome as it stands right now. Called once on mount, before any maximize
 *  event has had cause to fire. */
export async function getState(): Promise<WindowChrome> {
  const api = bridge();
  if (!api) return NO_CHROME;
  try {
    return await api.getState();
  } catch {
    // An IPC failure here must not take the whole window down with it: a title
    // bar that renders without buttons still lets the user work.
    return NO_CHROME;
  }
}

/**
 * Subscribe to chrome changes; returns an unsubscribe.
 *
 * Subscribing matters more than it looks: Win+arrow, drag-to-edge snapping and
 * double-clicking the bar all maximize the window WITHOUT passing through our
 * buttons. Polling would show a stale restore/maximize icon for up to an
 * interval after any of them.
 */
export function subscribe(callback: (state: WindowChrome) => void): () => void {
  const api = bridge();
  if (!api) return () => {};
  return api.onState(callback);
}
