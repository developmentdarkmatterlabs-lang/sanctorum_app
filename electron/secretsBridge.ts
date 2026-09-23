import * as http from 'http';
import type { BrowserWindow } from 'electron';
import { decrypt, encrypt, available } from './secrets';
import * as browser from './browser';

/* ---------------------------------------------------------------------------
 * A loopback endpoint the BACKEND can call into the main process with.
 *
 * The backend is a plain Node child, so it has neither safeStorage nor a
 * WebContentsView — but it is the process that reads a provider key when
 * building a run, and the one Python calls for a browser action (exactly as
 * delegate.py already calls it). So it asks this process over 127.0.0.1.
 *
 * NOT reachable from anywhere else: bound to loopback, and every request must
 * carry the token generated at launch, handed over in the backend's environment
 * and never written to disk.
 * ------------------------------------------------------------------------- */

let server: http.Server | null = null;
let token = '';
let port = 0;
let windowRef: BrowserWindow | null = null;

/** The env the backend needs. Empty when unavailable, which it reads as "no
 *  crypto, no browser — treat stored values as plaintext". */
export function secretsEnv(): Record<string, string> {
  return port && token
    ? { SANCTORUM_SECRETS_URL: `http://127.0.0.1:${port}`, SANCTORUM_SECRETS_TOKEN: token }
    : {};
}

/** The main window, so a browser action can attach its view. */
export function setBridgeWindow(win: BrowserWindow | null): void {
  windowRef = win;
}

type Body = {
  op?: string;
  value?: string;
  runId?: string;
  agentKey?: string;
  url?: string;
  action?: 'click' | 'type' | 'scroll' | 'back' | 'read';
  index?: number;
  text?: string;
  amount?: number;
};

async function handle(body: Body): Promise<unknown> {
  switch (body.op) {
    // `available()` is checked per call, not at startup: the bridge now also
    // serves the browser, which needs no keyring.
    case 'encrypt':
      return { value: available() ? encrypt(String(body.value ?? '')) : String(body.value ?? '') };
    case 'decrypt':
      return { value: available() ? decrypt(String(body.value ?? '')) : String(body.value ?? '') };
    case 'crypto':
      return { available: available() };

    case 'browse': {
      const result = await browser.browse(
        String(body.runId ?? ''),
        String(body.agentKey ?? ''),
        String(body.url ?? '')
      );
      // Reveal the pane as soon as a run opens a page, so the user sees what
      // the agent is doing without having to go looking for it.
      if (result.ok && windowRef) browser.attach(windowRef, String(body.runId ?? ''));
      return toReply(result);
    }

    case 'act':
      return toReply(
        await browser.act(String(body.runId ?? ''), body.action ?? 'read', {
          index: body.index,
          value: body.text,
          amount: body.amount,
        })
      );

    case 'close':
      browser.close(windowRef, String(body.runId ?? ''));
      return { ok: true };

    default:
      return { error: 'unknown op' };
  }
}

/** One shape for every browser action: the rendered snapshot, or the reason. */
function toReply(result: browser.ActionResult) {
  return result.ok && result.snapshot
    ? { ok: true, text: browser.renderSnapshot(result.snapshot), url: result.snapshot.url }
    : { ok: false, error: result.error ?? 'the action failed' };
}

export function startSecretsBridge(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      resolve();
      return;
    }
    token = Math.random().toString(36).slice(2) + Date.now().toString(36);

    server = http.createServer((req, res) => {
      if (req.headers['x-secrets-token'] !== token) {
        res.writeHead(403).end();
        return;
      }
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        void (async () => {
          try {
            const out = await handle(JSON.parse(raw || '{}') as Body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(out));
          } catch (err) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
          }
        })();
      });
    });

    // Port 0 = the OS picks, so nothing can squat a known one.
    server.listen(0, '127.0.0.1', () => {
      const addr = server?.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
  });
}

export function stopSecretsBridge(): void {
  server?.close();
  server = null;
  port = 0;
  token = '';
}

/** True when safeStorage works; the browser needs no keyring. */
export const cryptoAvailable = available;
