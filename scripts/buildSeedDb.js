#!/usr/bin/env node
/**
 * Build the database that ships to new users.
 *
 * `backend/database/seed.db` is copied into the user's data directory on first
 * launch, and ONLY on first launch — an existing user's database is never
 * overwritten. It must be schema-current, fully seeded, and contain no trace of
 * whoever built it.
 *
 * WHY THIS EXISTS. The alternative is shipping `backend/database/dev.db`, the
 * development database. That file is also where you talk to agents, so it
 * accumulates threads, messages, run history and memory entries — 695 messages
 * and 21 runs at the time this was written. Shipping it would hand every user a
 * copy of this machine's conversations, and the failure is silent: the app works
 * perfectly, it just arrives full of someone else's data.
 *
 * Building the shipped database instead of maintaining one removes the problem
 * rather than guarding against it. There is nothing to remember to clean.
 *
 * It also means a new user — the one person with no data at risk — arrives with
 * ZERO pending migrations instead of running all 26 on first launch, on a machine
 * we cannot reach or debug.
 *
 * The output is BUILD OUTPUT, not a file to maintain. Hand-edit it and the next
 * packaged build discards your changes. It is gitignored for the same reason.
 *
 * Wired into `pack`, `dist:win` and `dist:mac` ahead of the compile steps, so a
 * failed safety check stops the build before minutes of compilation rather than
 * after. Deliberately NOT wired into `npm run desktop`, which runs from source
 * against dev.db and never reads this file.
 *
 * Run:  npm run seed:db   (from the repo root)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const BACKEND = path.join(root, 'backend');
const SCHEMA = path.join(BACKEND, 'prisma', 'schema.prisma');
const SEED_SCRIPT = path.join(BACKEND, 'dist', 'prisma', 'seed.js');
const ROLES_SCRIPT = path.join(BACKEND, 'dist', 'prisma', 'seedRoles.js');
const SEED = path.join(BACKEND, 'database', 'seed.db');
const PRISMA_CLI = path.join(BACKEND, 'node_modules', 'prisma', 'build', 'index.js');

/**
 * Anything larger than this is not a freshly seeded database.
 *
 * A seeded Sanctorum database — 11 floors, 292 seats, 245 roles, 15 agents — is
 * about 0.3 MB. The development database with real conversations in it is 1.1 MB
 * and grows. The ceiling is the blunt instrument that catches "we shipped the
 * wrong file", which is a mistake that has happened to this kind of build before.
 */
const MAX_SEED_BYTES = 4 * 1024 * 1024;

/** Tables that must be EMPTY in a shipped database: produced by using the app,
 *  never by seeding it. Checked by byte-scanning, then by row count. */
const MUST_BE_EMPTY = ['Message', 'Thread', 'Run', 'Memory'];

const log = (msg) => console.log(`[seed] ${msg}`);

function fail(msg) {
  console.error(`\n[seed] FAILED: ${msg}\n`);
  process.exit(1);
}

/** Prisma wants a file: URL with forward slashes, even on Windows. */
const databaseUrl = (file) => `file:${file.replace(/\\/g, '/')}`;

/**
 * Run a Node script with DATABASE_URL pointed at the database being built.
 *
 * The CLI's JS entry point is invoked with THIS Node binary rather than `npx`:
 * on Windows npx resolves to npx.cmd, and Node refuses to spawn a batch file
 * without a shell (EINVAL). Calling the entry point directly avoids the shell,
 * and is the same approach electron/database.ts uses on a user's machine.
 */
function runNode(script, args, dbFile, label) {
  try {
    execFileSync(process.execPath, [script, ...args], {
      cwd: BACKEND,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl(dbFile),
        // The CLI's update banner writes box-drawing characters that clutter
        // build logs.
        CHECKPOINT_DISABLE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = err && err.stderr ? err.stderr.toString().trim() : '';
    fail(`${label} exited ${err && err.status}\n${stderr}`);
  }
}

function main() {
  if (!fs.existsSync(SCHEMA)) fail(`schema not found at ${SCHEMA}`);
  if (!fs.existsSync(PRISMA_CLI)) {
    fail(`Prisma CLI not found at ${PRISMA_CLI} — run npm install in backend/`);
  }
  for (const [label, script] of [
    ['seed', SEED_SCRIPT],
    ['role seed', ROLES_SCRIPT],
  ]) {
    if (!fs.existsSync(script)) {
      fail(
        `compiled ${label} not found at ${script}. ` +
          'Build the backend first:  npm run build:backend'
      );
    }
  }

  // Built in a temp directory and moved into place only on success, so a failed
  // run cannot leave a half-migrated or oversized database behind.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanctorum-seed-'));
  const tmpDb = path.join(tmpDir, 'seed.db');

  try {
    log('running migrations against a fresh database');

    // `migrate deploy`, NOT `db push`. Deploy writes the _prisma_migrations
    // history, which is what lets a fresh install arrive with zero pending
    // migrations. Push would produce the right columns but no history, so every
    // new user would be baselined and then run all 26 migrations on first launch
    // — exactly the problem this script exists to remove.
    runNode(PRISMA_CLI, ['migrate', 'deploy', '--schema', SCHEMA], tmpDb, 'prisma migrate deploy');

    if (!fs.existsSync(tmpDb)) fail('migrate deploy produced no database');

    // The floors, the role library and the cast. Without this a new user opens an
    // empty building: correct schema, nothing in it.
    log('seeding floors, teams and the cast');
    runNode(SEED_SCRIPT, [], tmpDb, 'seed');

    // The professional role library — 217 roles across 21 disciplines. Shipped
    // rather than left as an optional `npm run db:seed:roles`, because a new user
    // opening the Roles tab should find a real job architecture, not the eight
    // roles the demo teams happen to reference. Idempotent and additive: it only
    // inserts titles that do not already exist, so the mythic roles the cast
    // wears (seeded above) are untouched.
    log('seeding the professional role taxonomy');
    runNode(ROLES_SCRIPT, [], tmpDb, 'role seed');

    // --- Safety checks -----------------------------------------------------
    const bytes = fs.statSync(tmpDb).size;
    const mb = (bytes / 1048576).toFixed(2);

    if (bytes > MAX_SEED_BYTES) {
      fail(
        `database is ${mb} MB, over the ${MAX_SEED_BYTES / 1048576} MB ceiling.\n` +
          `A freshly seeded database is about 0.3 MB. This looks like real data — ` +
          `do NOT ship it.`
      );
    }

    const buf = fs.readFileSync(tmpDb);
    if (!buf.includes(Buffer.from('_prisma_migrations'))) {
      fail('no _prisma_migrations table — was db push used instead of migrate deploy?');
    }

    // Row counts, via the Prisma client the backend already depends on. The byte
    // scan above is coarse; this is exact, and it is the check that would catch a
    // seed script accidentally creating a thread.
    log('verifying the database is free of personal data');
    const verifier = path.join(tmpDir, 'verify.js');
    fs.writeFileSync(
      verifier,
      `const { PrismaClient } = require(${JSON.stringify(
        path.join(BACKEND, 'node_modules', '@prisma', 'client')
      )});
const p = new PrismaClient();
const MUST_BE_EMPTY = ${JSON.stringify(MUST_BE_EMPTY)};
(async () => {
  const dirty = [];
  for (const t of MUST_BE_EMPTY) {
    const n = await p[t[0].toLowerCase() + t.slice(1)].count();
    if (n > 0) dirty.push(t + '=' + n);
  }
  const agents = await p.agent.count();
  const rooms = await p.room.count();
  const roles = await p.role.count();
  await p.$disconnect();
  if (dirty.length) {
    console.error('DIRTY:' + dirty.join(','));
    process.exit(2);
  }
  console.log('OK:' + [agents, rooms, roles].join(','));
})().catch((e) => { console.error(String(e)); process.exit(3); });`
    );

    let out;
    try {
      out = execFileSync(process.execPath, [verifier], {
        cwd: BACKEND,
        env: { ...process.env, DATABASE_URL: databaseUrl(tmpDb) },
        encoding: 'utf8',
      }).trim();
    } catch (err) {
      const stderr = err && err.stderr ? err.stderr.toString().trim() : '';
      fail(`verification failed\n${stderr}`);
    }

    const [agents, rooms, roles] = out.replace(/^OK:/, '').split(',');
    if (Number(agents) === 0 || Number(rooms) === 0) {
      fail(`database is empty (agents=${agents}, rooms=${rooms}) — did the seed run?`);
    }

    // --- Move into place ---------------------------------------------------
    fs.mkdirSync(path.dirname(SEED), { recursive: true });
    fs.copyFileSync(tmpDb, SEED);

    log(
      `wrote ${path.relative(root, SEED)} — ${mb} MB, ` +
        `${agents} agents, ${rooms} floors, ${roles} roles, no personal data`
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
