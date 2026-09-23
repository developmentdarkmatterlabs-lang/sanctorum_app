import { API_BASE_URL, isElectron } from './config';

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
};

const DEFAULT_TIMEOUT = 30_000;
const MAX_RETRIES = 3;

/** What the Electron main process returns for every IPC request. Mirrors the
 *  shape built in electron/main.ts — including `ok`, which this module MUST
 *  check: see the comment in `request` below. */
type IpcResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  data?: unknown;
};

/**
 * THE ONE `electronAPI` DECLARATION.
 *
 * TypeScript merges `interface Window` across modules, but NOT two declarations
 * of the same property — a second `electronAPI?: {...}` elsewhere is an error,
 * not a union. So every slice of the preload bridge is declared here, even when
 * the code that uses it lives in another module (window.ts owns the window
 * controls; this file only types them).
 *
 * Every level is optional because in a browser there is no bridge at all, and
 * in an Electron build whose preload predates a slice, that slice is missing.
 */
declare global {
  interface Window {
    electronAPI?: {
      request: (
        endpoint: string,
        options?: {
          method?: string;
          body?: unknown;
          headers?: Record<string, string>;
        }
      ) => Promise<IpcResponse | unknown>;

      /** The agent's browser pane — placement only; the agent drives the page. */
      browser?: {
        setRect: (rect: { x: number; y: number; width: number; height: number }) => void;
        show: (runId: string) => Promise<boolean>;
        hide: (runId: string) => Promise<boolean>;
        liveUrl: (runId: string) => Promise<string>;
        clearSession: (agentKey: string) => Promise<void>;
      };

      /** Window controls for the app-drawn title bar. Implemented in
       *  electron/preload.ts, consumed through frontend/api/window.ts. */
      window?: {
        minimize: () => void;
        toggleMaximize: () => void;
        close: () => void;
        getState: () => Promise<NativeWindowState>;
        onState: (callback: (state: NativeWindowState) => void) => () => void;
      };
    };
  }
}

/** The chrome descriptor the main process reports. `controls` is narrower than
 *  WindowChrome's in api/window.ts: the main process never says 'none', because
 *  a process that can answer at all necessarily has a window. */
type NativeWindowState = {
  controls: 'custom' | 'native';
  inset: { left: number; right: number };
  isMaximized: boolean;
  isFullScreen: boolean;
};

/**
 * Single entry point for backend calls.
 * In Electron the request goes over IPC; in the browser it uses fetch().
 */
export async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, timeout = DEFAULT_TIMEOUT } = options;

  if (isElectron()) {
    // status 0 means the backend process is not accepting connections yet — retry.
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = (await window.electronAPI!.request(endpoint, {
          method,
          body,
          headers,
        })) as IpcResponse;

        if (result && typeof result === 'object' && result.status === 0) {
          lastError = new Error(`Request failed with status 0: ${endpoint}`);
          continue;
        }

        // A NON-OK RESPONSE MUST THROW, exactly as the browser path below does.
        //
        // This check was missing, and its absence was invisible: the IPC bridge
        // resolves with the error BODY in `data`, so a 400 came back looking like
        // a successful result. The dossier would report "saved" while the backend
        // had rejected the patch and written nothing — a failure you could only
        // find by reading the database. Anything that reports success it did not
        // have is worse than a crash.
        if (result && typeof result === 'object' && result.ok === false) {
          const message =
            (result.data as { error?: string } | undefined)?.error ??
            `${result.statusText || 'Request failed'} (${result.status})`;
          throw new Error(`${message}: ${endpoint}`);
        }

        return (result && typeof result === 'object' && 'data' in result
          ? result.data
          : result) as T;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Request failed (${response.status}): ${endpoint}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const get = <T>(endpoint: string, options: RequestOptions = {}) =>
  request<T>(endpoint, { ...options, method: 'GET' });

export const post = <T>(endpoint: string, body?: unknown, options: RequestOptions = {}) =>
  request<T>(endpoint, { ...options, method: 'POST', body });

export const put = <T>(endpoint: string, body?: unknown, options: RequestOptions = {}) =>
  request<T>(endpoint, { ...options, method: 'PUT', body });

export const patch = <T>(endpoint: string, body?: unknown, options: RequestOptions = {}) =>
  request<T>(endpoint, { ...options, method: 'PATCH', body });

export const del = <T>(endpoint: string, options: RequestOptions = {}) =>
  request<T>(endpoint, { ...options, method: 'DELETE' });
