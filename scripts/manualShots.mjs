// Screenshots of the real app for the user manual (docs/manual/images), taken against a staged demo database.
// Run through scripts/build_manual.ps1 -Screenshots, or: node scripts/manualShots.mjs [--only=name,name]
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'manual', 'images');
const WORK = path.join(os.tmpdir(), 'sanctorum-manual-shots');
const DEBUG_PORT = 9233;
const VIEW = { width: 1280, height: 800 };
const SCALE = 1.5;
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- demo data

const T0 = Date.now() - 40 * 60_000;
const at = (min) => T0 + min * 60_000;

const CLR5 = 'read_file, list_dir, search, read_memory, fetch_url, write_file, edit_file, write_memory, generate_image, generate_speech, run_command';
const CLR7 = `${CLR5}, delegate, network, manage_secrets`;

/** Seats the cast and stages two runs: Atum waiting for approval, and Alden's delegation tree. */
function stage(db) {
  const seat = { wizard: 'pos_eng_lead', aeon: 'pos_eng_backend', atum: 'pos_eng_frontend', senoj: 'pos_eng_intern', uriel: 'pos_eng_tester', magician: 'pos_mkt_lead', eldrica: 'pos_mkt_content', seshats: 'pos_mkt_designer' };
  for (const [key, pos] of Object.entries(seat)) db.prepare('UPDATE "Agent" SET positionId = ? WHERE key = ?').run(pos, key);
  db.prepare('UPDATE "Agent" SET supervised = 0, trustedDelegator = 1, maxCost = 1.5 WHERE key = ?').run('wizard');
  db.prepare('UPDATE "Agent" SET supervised = 0 WHERE key = ?').run('aeon');

  db.prepare('INSERT INTO "Memory" (id, scope, ownerId, kind, body, clearance, authorAgentKey, createdAt, dataType) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('mem_demo_1', 'team', 'team_engineering', 'note', 'Run the full test suite before anything is merged.', 0, 'wizard', at(0), 2);

  const thread = db.prepare('INSERT INTO "Thread" (id, agentKey, subject, createdAt, updatedAt, pendingRunId, pendingStep, activeRunId, rootRunId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const run = db.prepare(`INSERT INTO "Run" (id, threadId, agentKey, parentRunId, rootRunId, depth, status, result, cost, maxDepth, maxRuns, maxCost, positionId, createdAt, updatedAt, pendingStep, promptTokens, completionTokens, cachedTokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 3, 12, 2, ?, ?, ?, ?, ?, ?, ?)`);
  const msg = db.prepare('INSERT INTO "Message" (id, threadId, sender, agentKey, body, createdAt) VALUES (?, ?, ?, ?, ?, ?)');
  let n = 0;
  const say = (threadId, sender, agentKey, body, min) => msg.run(`msg_demo_${++n}`, threadId, sender, agentKey, body, at(min + n / 100));

  // Atum, supervised: every tool waits for a decision; the build is waiting now.
  const atumStep = '$ run_command npm run build';
  thread.run('thr_demo_atum', 'atum', '', at(10), at(14), 'run_demo_atum', atumStep, 'run_demo_atum', null);
  run.run('run_demo_atum', 'thr_demo_atum', 'atum', null, 'run_demo_atum', 0, 'paused', '', 0.0158, 'pos_eng_frontend', at(10), at(14), atumStep, 11840, 806, 7790);
  const A = 'thr_demo_atum';
  say(A, 'user', null, 'Show the app version in the page footer.', 10);
  say(A, 'system', 'atum', `picked up the task. Clearance 5; tools: ${CLR5}.`, 10);
  say(A, 'system', 'atum', '🎯 success criteria: The footer on every page shows the current app version, read from package.json, and the build succeeds.', 10);
  say(A, 'system', 'atum', '⏸ awaiting your approval: $ read_file src/components/Footer.tsx', 11);
  say(A, 'user', null, '▹ you chose to proceed', 11);
  say(A, 'system', 'atum', "export function Footer() {\n  return <footer className=\"footer\">Made with care</footer>;\n}", 11);
  say(A, 'system', 'atum', '⏸ awaiting your approval: $ edit_file src/components/Footer.tsx', 12);
  say(A, 'user', null, '▹ you chose to proceed', 12);
  say(A, 'system', 'atum', 'edited src/components/Footer.tsx', 12);
  say(A, 'system', 'atum', `⏸ awaiting your approval: ${atumStep}`, 14);

  // Alden leads: two reports in parallel, one finished and one waiting.
  const R = 'run_demo_alden';
  const uStep = '$ run_command npm test -- health';
  thread.run('thr_demo_alden', 'wizard', '', at(20), at(31), null, null, R, R);
  run.run(R, 'thr_demo_alden', 'wizard', null, R, 0, 'running', '', 0.0186, 'pos_eng_lead', at(20), at(31), null, 9840, 712, 5620);
  run.run('run_demo_aeon', 'thr_demo_alden', 'aeon', R, R, 1, 'done', 'Added GET /health, returning { status: "ok", version }.', 0.0214, 'pos_eng_backend', at(21), at(26), null, 15210, 1104, 10230);
  run.run('run_demo_uriel', 'thr_demo_alden', 'uriel', R, R, 1, 'paused', '', 0.0127, 'pos_eng_tester', at(21), at(31), uStep, 8730, 655, 4410);
  const L = 'thr_demo_alden';
  const route = "Add a GET /health route that returns { status: 'ok', version }.";
  const test = 'Write tests/health.test.ts for the new route, then run it.';
  say(L, 'user', null, 'Ship a health check for the API: a GET /health route and a test for it. Split the work across the team.', 20);
  say(L, 'system', 'wizard', `picked up the task. Clearance 7; tools: ${CLR7}.`, 20);
  say(L, 'system', 'wizard', '🎯 success criteria: GET /health returns status ok with the app version, a test covers it, and the test suite passes.', 20);
  say(L, 'system', 'wizard', `$ delegate(positionId=pos_eng_backend, task=${route}); $ delegate(positionId=pos_eng_tester, task=${test})`, 21);
  say(L, 'system', 'wizard', `⇩ delegated to Aeon (Backend Engineer): ${route}`, 21);
  say(L, 'system', 'wizard', `⇩ delegated to Uriel (Test Runner): ${test}`, 21);
  say(L, 'system', 'wizard', 'waiting for the report(s) to come back…', 21);
  say(L, 'system', 'aeon', `picked up the task. Clearance 5; tools: ${CLR5}.`, 22);
  say(L, 'system', 'aeon', '$ write_file src/routes/health.ts', 23);
  say(L, 'system', 'aeon', 'wrote 212 chars to src/routes/health.ts', 23);
  say(L, 'system', 'aeon', '$ edit_file src/app.ts', 24);
  say(L, 'system', 'aeon', 'edited src/app.ts', 24);
  say(L, 'agent', 'aeon', "GET /health is live: it returns { status: 'ok', version } with the version read from package.json, and it is registered in src/app.ts.", 25);
  say(L, 'system', 'aeon', '⚖ attempt 1/3: met the criteria', 26);
  say(L, 'system', 'uriel', `picked up the task. Clearance 5; tools: ${CLR5}.`, 27);
  say(L, 'system', 'uriel', '⏸ awaiting your approval: $ write_file tests/health.test.ts', 28);
  say(L, 'user', null, '▹ you chose to proceed', 29);
  say(L, 'system', 'uriel', 'wrote 401 chars to tests/health.test.ts', 29);
  say(L, 'system', 'uriel', `⏸ awaiting your approval: ${uStep}`, 31);
}

// ---------------------------------------------------------------- the app

class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)(m);
        this.pending.delete(m.id);
      }
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const n = ++this.id;
      this.pending.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      this.ws.send(JSON.stringify({ id: n, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? expression);
    return r.result.value;
  }
  async until(expression, label, ms = 15_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await this.eval(expression).catch(() => false)) return;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${label}`);
  }
  async mouse(x, y) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  }
  /** Clicks the visible control whose label, title or text matches. */
  async click(label) {
    const box = await this.eval(`(() => {
      const want = ${JSON.stringify(label.toLowerCase())};
      const els = [...document.querySelectorAll('button,a,[role=button],select,input,label,li,[title],[aria-label]')]
        .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
      const text = (el) => [el.getAttribute('aria-label'), el.getAttribute('title'), el.innerText].filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim().toLowerCase();
      const el = els.find((e) => text(e) === want) || els.find((e) => text(e).startsWith(want)) || els.find((e) => text(e).includes(want));
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const b = el.getBoundingClientRect();
      return [b.x + b.width / 2, b.y + b.height / 2];
    })()`);
    if (!box) throw new Error(`no control labelled "${label}"`);
    await this.mouse(box[0], box[1]);
    await sleep(700);
  }
  /** Scrolls the nearest scrolling ancestor so the element with this exact text sits near the top. */
  async scrollTo(text, offset = 12) {
    const ok = await this.eval(`(() => {
      const el = [...document.querySelectorAll('span,label,p,h2,h3,div')].find((e) => e.children.length === 0 && (e.textContent || '').trim() === ${JSON.stringify(text)});
      if (!el) return false;
      let p = el.parentElement;
      while (p && !(p.scrollHeight > p.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
      if (!p) return false;
      p.scrollTop += el.getBoundingClientRect().top - p.getBoundingClientRect().top - ${offset};
      return true;
    })()`);
    if (!ok) throw new Error(`could not scroll to "${text}"`);
    await sleep(300);
  }
  async setValue(selector, value) {
    await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    })()`);
    await sleep(600);
  }
  async open(file) {
    await this.send('Page.navigate', { url: `app://./${file}` });
    await this.until('document.readyState === "complete"', file);
    await this.send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false });
  }
  async office() {
    await this.open('office.html');
    await this.until('!!document.querySelector("canvas") && document.querySelectorAll("[aria-label^=\'Terminal for\']").length > 10', 'the office');
    await sleep(2500);
  }
  async shot(name, clip) {
    await this.eval('document.activeElement && document.activeElement.blur(), 1');
    await this.send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    const area = clip ?? { x: 0, y: 0, ...VIEW };
    const r = await this.send('Page.captureScreenshot', { format: 'png', clip: { ...area, scale: SCALE } });
    const png = path.join(WORK, `${name}.png`);
    fs.writeFileSync(png, Buffer.from(r.data, 'base64'));
    fs.mkdirSync(OUT, { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-c:v', 'libwebp', '-quality', '92', '-compression_level', '6', path.join(OUT, `${name}.webp`)]);
    console.log(`  ${name}.webp`);
  }
  /** The box of the dialog or side panel holding text matching `pattern`; `fit` trims it to the content's height. */
  async panelBox(pattern, fit = false) {
    const box = await this.eval(`(() => {
      const re = new RegExp(${JSON.stringify(pattern)}, 'i');
      const area = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
      const anchor = [...document.querySelectorAll('aside,h2,h3,span,p,div,button')]
        .filter((e) => re.test((e.innerText || '').trim()) && area(e) > 0)
        .sort((a, b) => area(a) - area(b))[0];
      if (!anchor) {
        const near = [...document.querySelectorAll('span,h2,h3,p,div')].map((e) => (e.innerText || '').trim()).filter((t) => t && t.length < 40 && re.source.replace(/[\\^$]/g, '').split(' ')[0] && t.toLowerCase().includes(re.source.replace(/[\\^$]/g, '').split(' ')[0].toLowerCase()));
        return { miss: 'anchor', near: [...new Set(near)].slice(0, 6) };
      }
      let el = anchor;
      while (el && el !== document.body) {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const framed = el.tagName === 'ASIDE' || cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0;
        if (framed && b.width > 200 && b.height > 120 && b.width < innerWidth - 4) break;
        el = el.parentElement;
      }
      if (!el || el === document.body) return { miss: 'panel', anchor: anchor.tagName + ' ' + (anchor.innerText || '').slice(0, 30) };
      const b = el.getBoundingClientRect();
      let bottom = b.bottom;
      if (${fit}) bottom = Math.min(b.bottom, Math.max(...[...el.querySelectorAll('*')].filter((c) => c.children.length === 0).map((c) => c.getBoundingClientRect().bottom).filter((y) => y < b.bottom - 2)) + 14);
      const x = Math.max(0, b.left), y = Math.max(0, b.top);
      return { x, y, width: Math.min(innerWidth, b.right) - x, height: Math.min(innerHeight, bottom) - y };
    })()`);
    if (!box || box.miss) throw new Error(`no panel holding /${pattern}/: ${JSON.stringify(box)}`);
    return box;
  }
  async canvasBox() {
    return this.eval('(() => { const b = document.querySelector("canvas").getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })()');
  }
}

// ---------------------------------------------------------------- the pictures

const SHOTS = [
  { name: 'entrance', run: async (p) => { await p.open('index.html'); await sleep(1500); await p.shot('entrance'); } },
  { name: 'office', run: async (p) => { await p.office(); await sleep(2000); await p.shot('office'); } },
  { name: 'new-agent', run: async (p) => { await p.office(); await p.click('+ add'); await p.shot('new-agent', await p.panelBox('^New agent$')); } },
  { name: 'dossier', run: async (p) => { await p.office(); await p.click('Alden HQ'); await p.shot('dossier', await p.panelBox('^Dossier$')); } },
  {
    name: 'dossier-settings',
    run: async (p) => { await p.office(); await p.click('Alden HQ'); await p.scrollTo('Model'); await p.shot('dossier-settings', await p.panelBox('^Dossier$')); },
  },
  {
    name: 'dossier-leader',
    run: async (p) => { await p.office(); await p.click('Alden HQ'); await p.scrollTo('Supervision'); await p.shot('dossier-leader', await p.panelBox('^Dossier$')); },
  },
  { name: 'teams', run: async (p) => { await p.office(); await p.click('Manage teams'); await p.shot('teams', await p.panelBox('^Teams$')); } },
  {
    name: 'roles',
    run: async (p) => {
      await p.office();
      await p.click('Manage roles');
      await p.setValue('input[placeholder^="Search roles"]', 'Engineering Lead');
      await p.click('Engineering Lead');
      await p.setValue('input[placeholder^="Search roles"]', '');
      await p.shot('roles', await p.panelBox('^Roles$'));
    },
  },
  {
    name: 'personalities',
    run: async (p) => { await p.office(); await p.click('Manage personalities'); await p.click('Precise, unhurried'); await p.shot('personalities', await p.panelBox('^Personalities$')); },
  },
  { name: 'skills', run: async (p) => { await p.office(); await p.click('Manage skills'); await p.shot('skills', await p.panelBox('^Skills$')); } },
  { name: 'rules', run: async (p) => { await p.office(); await p.click('Manage standing rules'); await p.shot('rules', await p.panelBox('^Rules$')); } },
  { name: 'mcps', run: async (p) => { await p.office(); await p.click('Manage MCP servers'); await p.shot('mcps', await p.panelBox('^MCP servers$')); } },
  {
    name: 'terminal',
    run: async (p) => { await p.office(); await p.click('Terminal for Atum'); await sleep(800); await p.shot('terminal', await p.panelBox('— terminal$')); },
  },
  {
    name: 'leader-terminal',
    run: async (p) => { await p.office(); await p.click('Terminal for Alden'); await sleep(800); await p.shot('leader-terminal', await p.panelBox('— terminal$')); },
  },
  {
    name: 'inbox',
    run: async (p) => {
      await p.office();
      await p.click('Open inbox');
      await p.click('awaiting your approval: $ run_command npm run build');
      await sleep(800);
      await p.shot('inbox', await p.panelBox('^back$'));
    },
  },
  { name: 'fleet', run: async (p) => { await p.office(); await p.click('Open fleet view'); await p.shot('fleet'); } },
  {
    name: 'tree',
    run: async (p) => {
      await p.office();
      await p.click('Open fleet view');
      await p.click('Open the delegation tree for this task');
      await sleep(800);
      await p.shot('tree', await p.panelBox('^delegation —', true));
    },
  },
  { name: 'settings', run: async (p) => { await p.office(); await p.click('Open settings'); await sleep(2500); await p.shot('settings', await p.panelBox('^Settings$')); } },
  { name: 'floors', run: async (p) => { await p.office(); await p.click('edit'); await p.click('Manage floors'); await p.shot('floors', await p.panelBox('^Floors$')); } },
  { name: 'floor-editor', run: async (p) => { await p.office(); await p.click('edit'); await sleep(800); await p.shot('floor-editor'); } },
  {
    name: 'building',
    run: async (p) => {
      await p.office();
      const count = await p.eval('document.querySelector("select[aria-label=Floor]").options.length');
      for (let i = 0; i < count; i++) {
        await p.setValue('select[aria-label=Floor]', String(i));
        await sleep(1800);
        await p.shot(`floor-${i + 1}`, await p.canvasBox());
      }
      await p.setValue('select[aria-label=Floor]', '0');
    },
  },
];

// The cover's art: the entrance painting and five portraits of the cast, from the app's own assets.
const ART = [
  { name: 'cover', src: 'frontend/public/assets/floor/images/entrance.jpg', width: 1800 },
  ...['hg_aeon', 'hq_magician', 'hq_wizard', 'hq_uriel', 'hq_reddragon'].map((file) => ({
    name: `portrait-${file.slice(3)}`,
    src: `frontend/public/assets/character/hq/${file}.png`,
    width: 320,
  })),
];

function convertArt() {
  for (const a of ART.filter((x) => !ONLY.length || ONLY.includes(x.name) || ONLY.includes('art'))) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(ROOT, a.src), '-vf', `scale=${a.width}:-2`, '-c:v', 'libwebp', '-quality', '92', path.join(OUT, `${a.name}.webp`)]);
    console.log(`  ${a.name}.webp`);
  }
}

// ---------------------------------------------------------------- run

async function healthy(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'frontend', 'out', 'index.html'))) throw new Error('frontend/out is missing: run npm run build:frontend');
  if (!fs.existsSync(path.join(ROOT, 'dist-electron', 'main.js'))) throw new Error('dist-electron is missing: run npm run build:electron');
  if ((await healthy('http://localhost:3001/api/health')) || (await healthy('http://localhost:8000/health'))) {
    throw new Error('Sanctorum is already running: close it first, so the pictures come from the demo database.');
  }
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  fs.mkdirSync(OUT, { recursive: true });
  convertArt();
  if (ONLY.length && ONLY.every((n) => n === 'art' || ART.some((a) => a.name === n))) return;

  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  const dbFile = path.join(WORK, 'manual.db');
  fs.copyFileSync(path.join(ROOT, 'backend', 'database', 'seed.db'), dbFile);
  const db = new DatabaseSync(dbFile);
  stage(db);
  db.close();

  const env = { ...process.env, DATABASE_URL: `file:${dbFile.replace(/\\/g, '/')}` };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = createRequire(import.meta.url)('electron');
  const app = spawn(electron, [`--remote-debugging-port=${DEBUG_PORT}`, 'dist-electron/main.js'], { cwd: ROOT, env, stdio: 'ignore' });

  let page;
  try {
    const end = Date.now() + 90_000;
    let target;
    while (!target && Date.now() < end) {
      await sleep(1000);
      const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json()).catch(() => []);
      target = list.find((t) => t.type === 'page' && t.url.startsWith('app:'));
    }
    if (!target) throw new Error('the app window did not open');
    while (!(await healthy('http://localhost:3001/api/health')) && Date.now() < end) await sleep(1000);

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    page = new Page(ws);

    const todo = SHOTS.filter((s) => !ONLY.length || ONLY.includes(s.name));
    console.log(`taking ${todo.length} picture(s) into ${path.relative(ROOT, OUT)}`);
    for (const s of todo) {
      try {
        await s.run(page);
      } catch (err) {
        console.error(`  ${s.name} FAILED: ${err.message}`);
        process.exitCode = 1;
      }
    }
  } finally {
    await page?.eval('window.electronAPI.window.close(), 1').catch(() => undefined);
    await sleep(3000);
    if (app.exitCode === null) {
      try {
        execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        app.kill();
      }
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
