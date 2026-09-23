import { isElectron } from './config';

/**
 * The agent's browser pane — placement only.
 *
 * The renderer does NOT drive the page: the agent does, through the backend.
 * This positions a native WebContentsView, which floats above the DOM in window
 * coordinates and cannot infer where React put its placeholder.
 *
 * A sibling of window.ts for the same reason: nothing crosses to the backend,
 * so routing it through client.ts would mean inventing an endpoint.
 */

export type PaneRect = { x: number; y: number; width: number; height: number };

const bridge = () => (isElectron() ? window.electronAPI?.browser : undefined);

/** True only in the desktop app; a browser tab has no view to place. */
export const browserSupported = (): boolean => Boolean(bridge());

export function setRect(rect: PaneRect): void {
  bridge()?.setRect(rect);
}

export async function show(runId: string): Promise<boolean> {
  return (await bridge()?.show(runId)) ?? false;
}

export async function hide(runId: string): Promise<void> {
  await bridge()?.hide(runId);
}

/** The URL the run actually loaded, or '' if it never opened a page. */
export async function liveUrl(runId: string): Promise<string> {
  return (await bridge()?.liveUrl(runId)) ?? '';
}

/** Wipe an agent's cookies — the "log me out" escape hatch. */
export async function clearSession(agentKey: string): Promise<void> {
  await bridge()?.clearSession(agentKey);
}
