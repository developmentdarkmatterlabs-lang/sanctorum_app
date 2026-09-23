import {
  browserSupported,
  clearSession,
  hide,
  liveUrl,
  setRect,
  show,
  type PaneRect,
} from '@/api/browser';

/**
 * The agent's browser pane.
 *
 * Its whole job is the awkward part of a native view: it floats ABOVE the DOM,
 * so React's placeholder is just a hole and the main process has to be told
 * where that hole is, in window coordinates, every time it moves.
 *
 * Rounded and de-duplicated here rather than in the component, because a resize
 * or scroll fires many times a second and each one is an IPC message.
 */
export class BrowserService {
  private last = '';

  supported(): boolean {
    return browserSupported();
  }

  /** Report the pane's rect. Ignores a repeat of the same value. */
  place(rect: PaneRect): void {
    const next: PaneRect = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    };
    const key = `${next.x}:${next.y}:${next.width}:${next.height}`;
    if (key === this.last) return;
    this.last = key;
    setRect(next);
  }

  show(runId: string): Promise<boolean> {
    return show(runId);
  }

  hide(runId: string): Promise<void> {
    return hide(runId);
  }

  clearSession(agentKey: string): Promise<void> {
    return clearSession(agentKey);
  }

  /** What the run actually loaded. '' means no page — never a guess. */
  liveUrl(runId: string): Promise<string> {
    return liveUrl(runId);
  }
}

export const browserService = new BrowserService();
