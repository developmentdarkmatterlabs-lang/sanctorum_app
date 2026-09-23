import { WebContentsView, BrowserWindow, session } from 'electron';
import * as dns from 'dns';
import * as net from 'net';
import { URL } from 'url';
import {
  SNAPSHOT_JS,
  clickJs,
  scrollJs,
  typeJs,
  type PageSnapshot,
} from './browserSnapshot';

/* ---------------------------------------------------------------------------
 * The agent's browser — Electron's own Chromium, not a bundled one.
 *
 * A WebContentsView, because Electron IS Chromium: adding Playwright would ship
 * a SECOND browser (~150 MB per platform) to drive the one already running.
 *
 * `<webview>` would be the other option; it is deprecated in Electron 33, so
 * WebContentsView is the supported surface. It is NATIVE, which is the one
 * awkward consequence: it floats above the page in window coordinates rather
 * than flowing in the React tree, so the renderer must tell us its rect.
 *
 * SESSIONS ARE PER AGENT. Each gets its own persistent partition, so one stays
 * logged in between runs and two never share cookies — the seat-derived idea
 * applied to browser state.
 * ------------------------------------------------------------------------- */

export type BrowserRect = { x: number; y: number; width: number; height: number };

type Session = {
  view: WebContentsView;
  agentKey: string;
  attached: boolean;
  /** The last page actually loaded — the renderer asks, never guesses. */
  url: string;
};

const sessions = new Map<string, Session>();

/** The renderer's pane, in window coordinates. */
let currentRect: BrowserRect = { x: 0, y: 0, width: 0, height: 0 };
let visibleKey: string | null = null;

// ---- SSRF guard -----------------------------------------------------------
// The same hole fetch_url has: a browser told to open http://localhost:3001
// reads this app's own backend. Checked on the RESOLVED address, because a
// hostname can point at loopback and a public URL can redirect to one.

function isPublic(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false; // cloud metadata
    if (a >= 224) return false;
    return true;
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6 === '::' ) return false;
  if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return false;
  // IPv4-mapped (::ffff:127.0.0.1) must be judged as the v4 address.
  const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
  return mapped ? isPublic(mapped[1]) : true;
}

export async function checkUrl(raw: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return `'${raw}' is not a valid URL.`;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `'${parsed.protocol}' is not a web address. Only http and https are allowed.`;
  }
  const host = parsed.hostname;
  if (!host) return 'no host in that URL.';

  let addrs: { address: string }[];
  try {
    addrs = await dns.promises.lookup(host, { all: true });
  } catch {
    return `'${host}' could not be resolved.`;
  }
  for (const { address } of addrs) {
    if (!isPublic(address)) {
      return `'${host}' resolves to ${address}, which is not a public address. Fetching private, loopback or link-local addresses is refused.`;
    }
  }
  return '';
}

// ---- lifecycle ------------------------------------------------------------

function ensure(runId: string, agentKey: string): Session {
  const existing = sessions.get(runId);
  if (existing) return existing;

  const view = new WebContentsView({
    webPreferences: {
      // A hostile page must not reach Node, this app, or another agent's cookies.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: `persist:agent-${agentKey || 'bench'}`,
      webSecurity: true,
    },
  });

  // Popups open in the same view rather than an unmanaged window the agent
  // cannot see or the user cannot close.
  view.webContents.setWindowOpenHandler(({ url }) => {
    void view.webContents.loadURL(url).catch(() => undefined);
    return { action: 'deny' };
  });

  // Every navigation is re-checked, including ones the PAGE starts.
  view.webContents.on('will-navigate', (event, url) => {
    void checkUrl(url).then((problem) => {
      if (problem) {
        event.preventDefault();
        view.webContents.stop();
      }
    });
  });

  const created: Session = { view, agentKey, attached: false, url: '' };
  sessions.set(runId, created);
  return created;
}

/** Show a run's browser in the window, hiding whichever was showing. */
export function attach(window: BrowserWindow, runId: string): boolean {
  const s = sessions.get(runId);
  if (!s) return false;
  if (visibleKey && visibleKey !== runId) detach(window, visibleKey);
  if (!s.attached) {
    window.contentView.addChildView(s.view);
    s.attached = true;
  }
  visibleKey = runId;
  // A zero rect means the renderer has not measured yet; it will call setRect
  // as soon as it mounts, and hiding until then beats a 0x0 view.
  if (currentRect.width > 0 && currentRect.height > 0) s.view.setBounds(currentRect);
  return true;
}

export function detach(window: BrowserWindow, runId: string): void {
  const s = sessions.get(runId);
  if (!s?.attached) return;
  window.contentView.removeChildView(s.view);
  s.attached = false;
  if (visibleKey === runId) visibleKey = null;
}

/** The renderer reports its pane's rect; a native view cannot infer it. */
export function setRect(rect: BrowserRect): void {
  currentRect = rect;
  if (visibleKey) sessions.get(visibleKey)?.view.setBounds(rect);
}

/** Which runs have a live page, and where they are. The renderer asks this
 *  instead of guessing from log text. */
export function liveUrl(runId: string): string {
  return sessions.get(runId)?.url ?? '';
}

/** Close a run's browser. Called when the run ends — a leaked view outlives it. */
export function close(window: BrowserWindow | null, runId: string): void {
  const s = sessions.get(runId);
  if (!s) return;
  if (window && s.attached) window.contentView.removeChildView(s.view);
  s.view.webContents.close();
  sessions.delete(runId);
  if (visibleKey === runId) visibleKey = null;
}

export function closeAll(window: BrowserWindow | null): void {
  for (const runId of [...sessions.keys()]) close(window, runId);
}

/** Wipe an agent's cookies and storage — the "log me out" escape hatch. */
export async function clearSession(agentKey: string): Promise<void> {
  await session.fromPartition(`persist:agent-${agentKey}`).clearStorageData();
}

// ---- actions --------------------------------------------------------------

export type ActionResult = { ok: boolean; snapshot?: PageSnapshot; error?: string };

async function snapshot(s: Session): Promise<PageSnapshot> {
  return (await s.view.webContents.executeJavaScript(SNAPSHOT_JS, true)) as PageSnapshot;
}

/** Wait for the page to settle, then snapshot. A fixed delay after load covers
 *  the client-side render that `did-finish-load` does not. */
async function settleAndSnapshot(s: Session): Promise<PageSnapshot> {
  await new Promise((r) => setTimeout(r, 600));
  return snapshot(s);
}

export async function browse(runId: string, agentKey: string, url: string): Promise<ActionResult> {
  const problem = await checkUrl(url);
  if (problem) return { ok: false, error: `refused: ${problem}` };

  const s = ensure(runId, agentKey);
  try {
    await s.view.webContents.loadURL(url);
  } catch (err) {
    return { ok: false, error: `could not load that page: ${(err as Error).message}` };
  }
  const snap = await settleAndSnapshot(s);
  s.url = snap.url || url;
  return { ok: true, snapshot: snap };
}

export async function act(
  runId: string,
  action: 'click' | 'type' | 'scroll' | 'back' | 'read',
  arg: { index?: number; value?: string; amount?: number }
): Promise<ActionResult> {
  const s = sessions.get(runId);
  if (!s) return { ok: false, error: 'no page is open — call browse first.' };

  try {
    if (action === 'click') {
      const problem = (await s.view.webContents.executeJavaScript(
        clickJs(arg.index ?? 0),
        true
      )) as string;
      if (problem) return { ok: false, error: problem };
      // A click usually navigates or re-renders; the snapshot after it is what
      // the agent reasons about next.
      const after = await settleAndSnapshot(s);
      s.url = after.url || s.url;
      return { ok: true, snapshot: after };
    }
    if (action === 'type') {
      const problem = (await s.view.webContents.executeJavaScript(
        typeJs(arg.index ?? 0, arg.value ?? ''),
        true
      )) as string;
      if (problem) return { ok: false, error: problem };
      return { ok: true, snapshot: await snapshot(s) };
    }
    if (action === 'scroll') {
      await s.view.webContents.executeJavaScript(scrollJs(arg.amount ?? 600), true);
      return { ok: true, snapshot: await snapshot(s) };
    }
    if (action === 'back') {
      if (!s.view.webContents.navigationHistory.canGoBack()) {
        return { ok: false, error: 'nothing to go back to.' };
      }
      s.view.webContents.navigationHistory.goBack();
      return { ok: true, snapshot: await settleAndSnapshot(s) };
    }
    return { ok: true, snapshot: await snapshot(s) };
  } catch (err) {
    return { ok: false, error: `the page did not respond: ${(err as Error).message}` };
  }
}

/** Render a snapshot as the numbered text the model reads. */
export function renderSnapshot(snap: PageSnapshot): string {
  const lines = snap.nodes.map(
    (n) => `[${n.role} ${n.index}] ${n.text}${n.value ? ` (value: ${n.value})` : ''}`
  );
  return (
    `${snap.title}\n${snap.url}\n\n` +
    (lines.length ? `Interactive elements:\n${lines.join('\n')}\n\n` : '') +
    `Page text:\n${snap.text}`
  );
}
