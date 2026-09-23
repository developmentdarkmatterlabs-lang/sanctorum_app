/**
 * The renderer's only door to the main process.
 *
 * `contextIsolation` is on and `nodeIntegration` off, so the React app has no
 * Node, no filesystem and no Electron API. It gets exactly what is exposed here
 * and nothing else — which is the same argument the rest of Sanctorum makes
 * about capability: you get what your position grants, not what you can reach.
 *
 * The shape below is what `frontend/api/config.ts` already probes for
 * (`window.electronAPI !== undefined`) and what `frontend/api/client.ts` already
 * calls, so nothing in the frontend changes.
 */

import { contextBridge, ipcRenderer } from 'electron';

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
}

interface IPCResponse {
  ok: boolean;
  status: number;
  statusText: string;
  data: unknown;
}

type ServiceStatusCallback = (data: { service: string; status: string }) => void;

/**
 * The window chrome the main process handed this renderer.
 *
 * The frontend NEVER inspects process.platform - it has no Node to inspect it
 * with, and more to the point the decision belongs to whoever created the
 * window. `controls` says who draws minimize/maximize/close and `inset` says how
 * much room the OS's own buttons need, so one React component lays itself out
 * correctly on both platforms without knowing which one it is on.
 *
 * Mirrors WindowState in main.ts and WindowChrome in frontend/api/window.ts.
 */
interface WindowState {
  controls: 'custom' | 'native';
  inset: { left: number; right: number };
  isMaximized: boolean;
  isFullScreen: boolean;
}

type WindowStateCallback = (state: WindowState) => void;

contextBridge.exposeInMainWorld('electronAPI', {
  /** Express backend — every REST call the app makes today. */
  request: (endpoint: string, options?: RequestOptions): Promise<IPCResponse> =>
    ipcRenderer.invoke('api-request', endpoint, options),

  /**
   * Python AI service, direct. Unused today: the frontend talks to the backend,
   * which owns the conversation with the AI service. Exposed so a future direct
   * call does not need a preload change (and a preload change needs a restart).
   */
  aiRequest: (endpoint: string, options?: RequestOptions): Promise<IPCResponse> =>
    ipcRenderer.invoke('ai-request', endpoint, options),

  /** Fires when a child service becomes ready, or fails to. */
  onServiceStatus: (callback: ServiceStatusCallback): void => {
    ipcRenderer.on('service-status', (_event, data) =>
      callback(data as { service: string; status: string })
    );
  },

  removeServiceStatusListener: (): void => {
    ipcRenderer.removeAllListeners('service-status');
  },

  /**
   * Window controls, for the title bar the app draws itself.
   *
   * `send`, not `invoke`: these are commands with no useful return, and making
   * them promises would invite callers to await a minimize. `getState` is the
   * exception - the renderer needs the chrome descriptor on mount, before any
   * maximize event has had cause to fire.
   */
  /** The agent's browser pane: the renderer only PLACES and reveals it. Actions
   *  come from the backend, because Python drives the page. */
  browser: {
    setRect: (rect: { x: number; y: number; width: number; height: number }): void =>
      ipcRenderer.send('browser:rect', rect),
    show: (runId: string): Promise<boolean> => ipcRenderer.invoke('browser:show', runId),
    hide: (runId: string): Promise<boolean> => ipcRenderer.invoke('browser:hide', runId),
    liveUrl: (runId: string): Promise<string> => ipcRenderer.invoke('browser:url', runId),
    clearSession: (agentKey: string): Promise<void> =>
      ipcRenderer.invoke('browser:clear-session', agentKey),
  },

  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    toggleMaximize: (): void => ipcRenderer.send('window:toggle-maximize'),
    close: (): void => ipcRenderer.send('window:close'),
    getState: (): Promise<WindowState> => ipcRenderer.invoke('window:get-state'),

    /**
     * Subscribe to chrome changes, returning an unsubscribe.
     *
     * Returning the disposer (rather than pairing with a removeAll like
     * service-status does) matters here because React effects mount and unmount
     * repeatedly in a way the one-shot service banner never does - and
     * removeAllListeners would let one unmounting component deafen every other
     * subscriber.
     */
    onState: (callback: WindowStateCallback): (() => void) => {
      const listener = (_event: unknown, state: WindowState) => callback(state);
      ipcRenderer.on('window:state', listener);
      return () => ipcRenderer.removeListener('window:state', listener);
    },
  },
});
