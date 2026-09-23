/**
 * Sanctorum — Electron main process.
 *
 * Owns the three-process stack as a desktop app: it spawns the Express backend
 * (3001) and the Python AI service (8000) as children, serves the Next.js static
 * export over an `app://` protocol, and bridges the renderer to both services
 * over IPC.
 *
 * WHO SPAWNS WHAT. In Electron mode the MAIN PROCESS owns the backend and AI
 * service — not `concurrently`. Running `npm run dev` (browser mode) and Electron
 * at the same time would put two backends on port 3001, and `killPortProcess`
 * below would shoot the wrong one. Use `npm run dev:electron`, which starts only
 * Next.js and lets Electron own the rest.
 */

import { app, BrowserWindow, ipcMain, protocol, net, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess, execSync } from 'child_process';
import http from 'http';
import { pathToFileURL } from 'url';
import { prepareDatabase, packagedDatabaseUrl } from './database';
import {
  secretsEnv,
  setBridgeWindow,
  startSecretsBridge,
  stopSecretsBridge,
} from './secretsBridge';
import * as browser from './browser';

// Must be registered before app.ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const EXPRESS_PORT = 3001;
const PYTHON_PORT = 8000;

/**
 * Health paths differ per service, and getting this wrong is silent: a 404 reads
 * exactly like "not up yet", so the service would poll until it times out and
 * report an error while running perfectly.
 *   backend   → /api/health   (routes/healthRoutes.ts)
 *   aiservice → /health       (api/main.py)
 */
const EXPRESS_HEALTH = '/api/health';
const PYTHON_HEALTH = '/health';

const ROOT = path.join(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const AISERVICE_DIR = path.join(ROOT, 'aiservice');
const FRONTEND_OUT = path.join(ROOT, 'frontend', 'out');

let mainWindow: BrowserWindow | null = null;
let expressProcess: ChildProcess | null = null;
let pythonProcess: ChildProcess | null = null;

// ---- window ---------------------------------------------------------------

/* ---- window chrome -------------------------------------------------------
 *
 * The OS title bar is replaced by a React component (components/layout/TitleBar)
 * so the strip can carry live supervision state - a pending-approval badge and
 * the tree's cost - instead of a title the user already knows.
 *
 * HYBRID, NOT UNIFORM. The two platforms get different treatment because they
 * have different conventions, and only one of them can be safely broken:
 *
 *   Windows/Linux  frame: false                 we draw the buttons (Lucide)
 *   macOS          titleBarStyle: hiddenInset   the OS keeps the traffic lights
 *
 * Hand-drawing traffic lights would break Option-hover, Mission Control and
 * green-means-fullscreen - behaviours Mac users notice immediately and that no
 * amount of CSS restores. `hiddenInset` keeps them native and floating over our
 * content, which is what Slack, Notion, Linear and Arc all do. Windows has no
 * equivalent convention to violate, so drawing our own there is expected.
 *
 * RESIZING SURVIVES. `frame: false` removes the visible chrome, not the
 * hit-testing: Electron keeps an ~8px invisible grip on every edge and corner
 * as long as `resizable` stays true. Edge-drag resize, Win+arrow snapping,
 * drag-to-edge snapping and double-click-to-maximize all still work. The one
 * genuine loss is the Windows 11 hover-over-maximize snap-layouts flyout, which
 * needs WM_NCHITTEST and therefore a native module.
 *
 * The renderer is told which of these it got via `window:state` rather than
 * inspecting process.platform itself - capability comes from the main process,
 * the same way it does everywhere else in this app.
 */
const IS_MAC = process.platform === 'darwin';

/** What the renderer needs to lay the bar out. Mirrored by WindowChrome in
 *  frontend/api/window.ts - change one and change the other. */
type WindowState = {
  /** 'custom' = we draw minimize/maximize/close; 'native' = the OS does. */
  controls: 'custom' | 'native';
  /** Reserved space for OS-drawn buttons, in CSS pixels. macOS puts its traffic
   *  lights at the left; on Windows we draw our own, so nothing is reserved. */
  inset: { left: number; right: number };
  isMaximized: boolean;
  isFullScreen: boolean;
};

function windowState(win: BrowserWindow): WindowState {
  return {
    controls: IS_MAC ? 'native' : 'custom',
    // 78px clears the three traffic lights at their default hiddenInset
    // position. In fullscreen macOS hides them entirely, so the inset would be
    // dead space.
    inset: { left: IS_MAC && !win.isFullScreen() ? 78 : 0, right: 0 },
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen(),
  };
}

/** Push the current chrome state to the renderer. Same main -> renderer shape
 *  as `service-status`, so preload exposes it the same way. */
function pushWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  win.webContents.send('window:state', windowState(win));
}

function createWindow(): void {
  if (app.isPackaged) Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(ROOT, 'electron', 'assets', 'icon.ico'),
    backgroundColor: '#0b0e14',
    // See the block above. On macOS the traffic lights stay; everywhere else
    // the frame goes entirely and TitleBar.tsx draws the whole strip.
    ...(IS_MAC
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 10 } }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Sanctorum',
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // The renderer's copy of the chrome state has to follow the WINDOW, not just
  // our own buttons: Win+arrow, drag-to-edge and double-click all maximize
  // without going through IPC, and a stale icon after any of those is the bug
  // people notice first.
  // Listed one by one rather than looped: Electron types `on` as a union of
  // per-event overloads, so a variable event name matches none of them.
  const onChrome = () => mainWindow && pushWindowState(mainWindow);
  mainWindow.on('maximize', onChrome);
  mainWindow.on('unmaximize', onChrome);
  mainWindow.on('enter-full-screen', onChrome);
  mainWindow.on('leave-full-screen', onChrome);
  // Covers a reload, where the page remounts against an already-maximized
  // window. The renderer also asks once on mount via `window:get-state`.
  mainWindow.webContents.on('did-finish-load', () => mainWindow && pushWindowState(mainWindow));

  // A static export at frontend/out means this is a production build; without
  // one, load the Next dev server so hot reload still works.
  const isDev = !fs.existsSync(path.join(FRONTEND_OUT, 'index.html'));
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadURL('app://./index.html');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---- IPC bridges ----------------------------------------------------------

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
};

/**
 * One forwarder for both services — they differ only in port and default
 * timeout. The shape it returns ({ok, status, statusText, data}) is what
 * frontend/api/client.ts already expects, including `status: 0` meaning "could
 * not connect", which the client retries on while a service is still booting.
 */
async function forward(port: number, endpoint: string, options: RequestOptions, defaultTimeout: number) {
  const { method = 'GET', body, headers = {}, timeout = defaultTimeout } = options;

  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body !== undefined && method !== 'GET') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  init.signal = controller.signal;

  try {
    const res = await fetch(`http://localhost:${port}${endpoint}`, init);
    clearTimeout(timer);

    const contentType = res.headers.get('content-type');
    let data: unknown;
    if (res.status === 204) {
      data = null;
    } else if (contentType?.includes('application/json')) {
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text };
      }
    } else {
      data = await res.text();
    }

    return { ok: res.ok, status: res.status, statusText: res.statusText, data };
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : 'request failed';
    return { ok: false, status: 0, statusText: 'IPC_ERROR', data: { error: message } };
  }
}

function setupIPC(): void {
  ipcMain.handle('api-request', (_e, endpoint: string, options: RequestOptions = {}) =>
    forward(EXPRESS_PORT, endpoint, options, 30_000)
  );
  // Longer default: an AI call can legitimately run for minutes.
  ipcMain.handle('ai-request', (_e, endpoint: string, options: RequestOptions = {}) =>
    forward(PYTHON_PORT, endpoint, { method: 'POST', ...options }, 120_000)
  );

  // ---- window controls ----------------------------------------------------
  // Commands are `on`, not `handle`: minimizing is fire-and-forget and nothing
  // useful comes back. The one request that DOES return a value is get-state,
  // which the renderer calls once on mount before any event has fired.
  //
  // Every handler resolves the window from the event's sender rather than the
  // module-level `mainWindow`, so a second window (there is none today) would
  // control itself rather than the first one.
  const senderWindow = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    BrowserWindow.fromWebContents(e.sender);

  ipcMain.on('window:minimize', (e) => senderWindow(e)?.minimize());

  ipcMain.on('window:toggle-maximize', (e) => {
    const win = senderWindow(e);
    if (!win) return;
    // Toggle, not maximize: the same button serves both directions, and the
    // renderer's icon is driven by the state event this triggers.
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });

  ipcMain.on('window:close', (e) => senderWindow(e)?.close());

  // ---- agent browser ------------------------------------------------------
  // The renderer only places and reveals the pane; the actions come from the
  // backend, because Python calls Node exactly as delegate.py does.
  ipcMain.on('browser:rect', (_e, rect: browser.BrowserRect) => browser.setRect(rect));

  ipcMain.handle('browser:show', (_e, runId: string) =>
    mainWindow ? browser.attach(mainWindow, runId) : false
  );

  ipcMain.handle('browser:hide', (_e, runId: string) => {
    if (mainWindow) browser.detach(mainWindow, runId);
    return true;
  });

  ipcMain.handle('browser:clear-session', (_e, agentKey: string) =>
    browser.clearSession(agentKey)
  );

  // The live page's URL, or '' when the run has not opened one.
  ipcMain.handle('browser:url', (_e, runId: string) => browser.liveUrl(runId));

  ipcMain.handle('window:get-state', (e) => {
    const win = senderWindow(e);
    // A renderer with no window is not a real case, but the fallback keeps the
    // frontend's contract non-nullable rather than making every caller guard.
    return win
      ? windowState(win)
      : {
          controls: IS_MAC ? 'native' : 'custom',
          inset: { left: 0, right: 0 },
          isMaximized: false,
          isFullScreen: false,
        };
  });
}

// ---- port cleanup ---------------------------------------------------------

/** Never SIGKILL ourselves. The port filters should exclude us; this is free. */
function isKillable(pid: string, port: number): boolean {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  if (n === process.pid || n === process.ppid) {
    console.log(`[cleanup] skipping pid ${pid} on ${port} — that is us`);
    return false;
  }
  return true;
}

/** Kills whatever is squatting on a port — an orphan from a crashed run. */
function killPortProcess(port: number): void {
  try {
    if (process.platform === 'win32') {
      const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const pids = new Set<string>();
      for (const line of result.trim().split('\n')) {
        const pid = line.trim().split(/\s+/).pop();
        if (pid && pid !== '0') pids.add(pid);
      }
      for (const pid of pids) {
        if (!isKillable(pid, port)) continue;
        console.log(`[cleanup] killing orphan on ${port} (pid ${pid})`);
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        } catch {
          /* already gone */
        }
      }
    } else {
      // -sTCP:LISTEN matches the Windows branch's LISTENING filter. Bare
      // `lsof -ti` also returns ESTABLISHED sockets, so our own connection to
      // the backend made us a candidate and the app SIGKILLed itself on launch.
      // Cost EPIC an evening; same code, same bug.
      const result = execSync(`lsof -ti:${port} -sTCP:LISTEN`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      for (const pid of result.trim().split('\n').filter(Boolean)) {
        if (!isKillable(pid, port)) continue;
        console.log(`[cleanup] killing orphan on ${port} (pid ${pid})`);
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        } catch {
          /* already gone */
        }
      }
    }
  } catch {
    // Nothing listening — the normal case.
  }
}

// ---- child services -------------------------------------------------------

/** A log line must never take the app down. Launched from Explorer there is no
 *  console at all, and writing to a closed stdout throws EPIPE — uncaught, that
 *  killed the main process. */
function say(stream: 'log' | 'error', text: string): void {
  try {
    console[stream](text);
  } catch {
    /* no console attached */
  }
}

function pipeLogs(proc: ChildProcess, name: string): void {
  proc.stdout?.on('data', (d: Buffer) => say('log', `[${name}] ${d.toString().trimEnd()}`));
  proc.stderr?.on('data', (d: Buffer) => say('error', `[${name}] ${d.toString().trimEnd()}`));
  proc.on('close', (code) => say('log', `[${name}] exited (${code})`));
  proc.on('error', (err) => say('error', `[${name}] failed to start: ${err.message}`));
  // The pipes themselves emit EPIPE when the far end goes; swallow it here too.
  proc.stdout?.on('error', () => undefined);
  proc.stderr?.on('error', () => undefined);
}

function spawnExpressService(): void {
  killPortProcess(EXPRESS_PORT);
  const isDev = !app.isPackaged;

  // PACKAGED LAYOUT. The compiled backend is mirrored into app.asar.unpacked,
  // but its dependencies are copied to resources/backend/node_modules by
  // `extraResources` — electron-builder prunes node_modules out of `files`
  // entirely. So the script and the modules it requires live in DIFFERENT places,
  // and the process must run from the one that has node_modules or every
  // `require('express')` fails.
  const scriptDir = isDev
    ? BACKEND_DIR
    : path.join(app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'), 'backend');
  const modulesDir = isDev ? BACKEND_DIR : path.join(process.resourcesPath, 'backend');

  const command = isDev
    ? path.join(
        BACKEND_DIR,
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'ts-node-dev.cmd' : 'ts-node-dev'
      )
    : process.execPath;
  const args = isDev
    ? ['--respawn', '--transpile-only', 'index.ts']
    : [path.join(scriptDir, 'dist', 'index.js')];

  expressProcess = spawn(command, args, {
    cwd: modulesDir,
    env: {
      ...process.env,
      PORT: String(EXPRESS_PORT),
      // Lets the backend use safeStorage, which only exists in this process.
      ...secretsEnv(),
      // Packaged: the bundle is read-only, so the database, uploads and agent
      // workspaces live in the user's data directory instead (backend/paths.ts).
      // DATABASE_URL must name the very file prepareDatabase() migrated —
      // schema.prisma reads it from env, so a mismatch here would silently open
      // a different (empty) database.
      ...(isDev
        ? {}
        : {
            // WITHOUT THIS, process.execPath launches a whole second Electron
            // APP rather than running the script as Node — and that app runs
            // this same startup, spawning another, forever. The symptom is
            // windows opening endlessly and logs nesting as
            // "[backend] [backend] [backend]". ELECTRON_RUN_AS_NODE is what
            // makes the Electron binary behave as a plain Node runtime, which is
            // why we can ship one runtime instead of two.
            ELECTRON_RUN_AS_NODE: '1',
            // Without this the backend falls back to its STUB runtime and every
            // agent returns canned text while the real AI service sits idle on
            // 8000 — a failure that looks like success. backend/.env supplies it
            // in development and is not bundled, so the packaged app must pass it.
            AISERVICE_URL: `http://localhost:${PYTHON_PORT}`,
            APP_USER_DATA: app.getPath('userData'),
            DATABASE_URL: packagedDatabaseUrl(),
            // Covers a require that resolves from the script's own folder rather
            // than the cwd.
            NODE_PATH: path.join(modulesDir, 'node_modules'),
          }),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: isDev && process.platform === 'win32',
  });
  pipeLogs(expressProcess, 'backend');
}

/**
 * Spawns the AI service. The two modes are genuinely different programs:
 *
 * DEV — `uv run python -m sanctorum_aiservice.api.main`, which resolves the
 *   project's virtualenv and puts aiservice/src on the path. This is what the
 *   repo's own npm scripts use, so dev and Electron stay on one code path.
 *   (The module is `sanctorum_aiservice.api.main`; the package is under src/.)
 *
 * PACKAGED — a PyInstaller bundle at resources/aiservice/, because a user's
 *   machine has neither the repo nor uv. Built by `aiservice/aiservice.spec`
 *   and copied in by electron-builder's extraResources.
 *
 * SANCTORUM_DATA_DIR points the service at the same per-user directory the
 * backend uses, so its checkpoint database is not written inside the read-only
 * app bundle (see aiservice/src/sanctorum_aiservice/paths.py).
 */
function spawnPythonService(): void {
  killPortProcess(PYTHON_PORT);

  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    SANCTORUM_DATA_DIR: app.getPath('userData'),
  };

  if (app.isPackaged) {
    const exeName = process.platform === 'win32' ? 'aiservice.exe' : 'aiservice';
    const bundled = path.join(process.resourcesPath, 'aiservice', exeName);

    // Say so loudly rather than dying silently: without this binary every run
    // fails at spawn, and "agent does nothing" is a much worse symptom than a
    // named missing file.
    if (!fs.existsSync(bundled)) {
      console.error(
        `[aiservice] bundle missing at ${bundled} — the AI service will not start. ` +
          `Build it with: cd aiservice && uv run pyinstaller aiservice.spec --noconfirm`
      );
      return;
    }

    pythonProcess = spawn(bundled, [], {
      cwd: path.dirname(bundled),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } else {
    pythonProcess = spawn('uv', ['run', 'python', '-m', 'sanctorum_aiservice.api.main'], {
      cwd: AISERVICE_DIR,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // `uv` is resolved from PATH, which on Windows needs a shell.
      shell: process.platform === 'win32',
    });
  }

  pipeLogs(pythonProcess, 'aiservice');
}

// ---- health ---------------------------------------------------------------

function waitForService(port: number, healthPath: string, name: string, maxRetries = 30): Promise<void> {
  return new Promise((resolve, reject) => {
    let retries = 0;
    let done = false;

    const retry = () => {
      if (done) return;
      if (++retries >= maxRetries) {
        done = true;
        reject(new Error(`${name} did not come up after ${maxRetries} attempts`));
      } else {
        setTimeout(check, 1000);
      }
    };

    const check = () => {
      if (done) return;
      const req = http.get(`http://localhost:${port}${healthPath}`, (res) => {
        if (done) return;
        if (res.statusCode === 200) {
          done = true;
          console.log(`[${name}] ready on ${port}`);
          resolve();
        } else {
          res.resume();
          retry();
        }
      });
      req.on('error', () => !done && retry());
      req.setTimeout(1000, () => {
        req.destroy();
        if (!done) retry();
      });
    };

    check();
  });
}

function notifyRenderer(channel: string, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

// ---- app:// protocol ------------------------------------------------------

/**
 * Serves the Next.js static export, and proxies API traffic to the child
 * services so the renderer sees one origin.
 *
 * The /aiservice/ proxy exists for streaming responses, which cannot go over
 * IPC (`ipcMain.handle` resolves once, with a whole value). Sanctorum does not
 * stream today — the AI service POSTs events to the backend and the UI polls —
 * so this path is currently unused. It is kept because it is the only way a
 * future SSE endpoint could reach the renderer.
 */
function setupAppProtocol(): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);

    if (filePath.startsWith('/aiservice/')) {
      const aiPath = filePath.replace('/aiservice', '');
      return net.fetch(`http://localhost:${PYTHON_PORT}${aiPath}${url.search}`, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        duplex: 'half',
      } as RequestInit);
    }

    if (filePath.startsWith('/api/')) {
      return net.fetch(`http://localhost:${EXPRESS_PORT}${filePath}${url.search}`, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        duplex: 'half',
      } as RequestInit);
    }

    if (filePath === '/' || filePath === '') filePath = '/index.html';

    return net.fetch(pathToFileURL(path.join(FRONTEND_OUT, filePath)).href);
  });
}

// ---- lifecycle ------------------------------------------------------------

app.name = 'Sanctorum';

// EPIPE on stdout/stderr is never fatal: it only means nothing is listening.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', () => undefined);
}

app.whenReady().then(async () => {
  // The database is prepared BEFORE the backend spawns: migrations and seeding
  // must finish while nothing holds the file open, and the backend would
  // otherwise start against a schema that does not exist yet. On failure this
  // shows the user a dialog and throws, and we quit rather than run against a
  // half-built database.
  try {
    await prepareDatabase();
  } catch {
    app.quit();
    return;
  }

  // Before the backend spawns: it reads the endpoint from its environment.
  await startSecretsBridge();

  setupAppProtocol();
  setupIPC();
  createWindow();
  // The bridge attaches browser views to this window when an agent opens a page.
  setBridgeWindow(mainWindow);

  spawnExpressService();
  spawnPythonService();

  // The UI is useless without the backend, so surface its state first.
  try {
    await waitForService(EXPRESS_PORT, EXPRESS_HEALTH, 'backend');
    notifyRenderer('service-status', { service: 'express', status: 'ready' });
  } catch (err) {
    console.error(err);
    notifyRenderer('service-status', { service: 'express', status: 'error' });
  }

  // The AI service is only needed to RUN an agent; everything else works
  // without it, so this never blocks the window.
  waitForService(PYTHON_PORT, PYTHON_HEALTH, 'aiservice')
    .then(() => notifyRenderer('service-status', { service: 'python', status: 'ready' }))
    .catch((err) => {
      console.error(err);
      notifyRenderer('service-status', { service: 'python', status: 'error' });
    });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ---- shutdown -------------------------------------------------------------

/**
 * On Windows a child spawned through a shell has its own process tree, so
 * killing the pid we hold would orphan the real server. `taskkill /T` takes the
 * tree; elsewhere SIGTERM then SIGKILL.
 */
function killAllChildProcesses(): void {
  const kill = (proc: ChildProcess | null, name: string) => {
    if (!proc || proc.killed || !proc.pid) return;
    console.log(`[${name}] shutting down (pid ${proc.pid})`);
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
      } catch {
        /* already gone */
      }
    } else {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (proc && !proc.killed) proc.kill('SIGKILL');
      }, 5000);
    }
  };

  kill(expressProcess, 'backend');
  kill(pythonProcess, 'aiservice');
  expressProcess = null;
  pythonProcess = null;
}

app.on('window-all-closed', () => {
  killAllChildProcesses();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  killAllChildProcesses();
  stopSecretsBridge();
  browser.closeAll(mainWindow);
});
