# Contributing to Sanctorum

Sanctorum is open-source software, licensed under the GNU Affero General Public
License v3.0 and maintained by Dark Matter Labs, LLC. This file covers the local
setup, the checks a change must pass, and the conventions used in this
repository.

## How changes land here

Development happens on `master`. Releases are built by GitHub Actions when a
`v*` tag is pushed (see [.github/workflows/release.yml](.github/workflows/release.yml)).
Open an issue to discuss a larger change before starting it. Small fixes can go
straight to a pull request. Maintainers at Dark Matter Labs, LLC review and
merge every change.

## Repository layout

- `frontend/` — the Next.js UI (a static export in the desktop app, port 3000
  in browser development).
  - Data flows `components/` → `hooks/` → `services/` → `api/`, with state in
    `store/`. `api/client.ts` switches between Electron IPC and `fetch`.
  - The pixel office is in `lib/office/` and `modules/`, themes in
    `styles/themes/`.
- `backend/` — Express with Prisma and SQLite, on port 3001.
  - Routers are in `routes/moduleRoutes/`, and the services behind them in
    `database/moduledb/moduleservices/`.
  - `runtime/` holds the run contract (`AgentRuntime.ts`) and the capability
    layer (`ToolPolicy.ts`), which turns a seat's clearance into the tools a
    run may use.
  - `prisma/` holds the schema, the migrations and the seed scripts.
- `aiservice/` — the Python AI service (FastAPI, LangGraph, and LiteLLM through
  OpenRouter), on `127.0.0.1:8000`.
  - `graph/` is the agent loop: worker and evaluator, pauses and approvals,
    cost metering and prompt caching.
  - `tools/` holds every tool an agent can be granted, behind one executor that
    refuses anything outside the grant.
  - `runtime/models.py` mirrors `backend/runtime/AgentRuntime.ts`.
  - `aiservice.spec` packages it with PyInstaller for the desktop app.
- `electron/` — the main process:
  - the window and the `app://` protocol;
  - the IPC bridge (`preload.ts`);
  - starting the backend and the AI service;
  - preparing the user's database at launch (`database.ts`);
  - encrypting API keys with the OS keychain (`secrets.ts`, `secretsBridge.ts`);
  - the agent browser (`browser.ts`).
- `scripts/buildSeedDb.js` — builds `backend/database/seed.db`, the database a
  new install starts from.
- `.github/workflows/` — the release builds.
- `.claude/skills/` — step-by-step guides to each phase of the build, and to
  shipping Windows and macOS builds.

## Getting started

Prerequisites:

- Node.js 22+ (CI builds with 22)
- Python 3.11+ (CI uses 3.12) and [uv](https://docs.astral.sh/uv/)
- An [OpenRouter](https://openrouter.ai/keys) key, for runs that call a model
- Optional: a [Serper](https://serper.dev) key, for the web search tool

```bash
npm run install:all      # root, backend and frontend packages, then `uv sync` for the AI service
```

Create the two environment files. Both are gitignored.

- `backend/.env`:

  ```
  PORT=3001
  DATABASE_URL="file:../database/dev.db"
  AISERVICE_URL=http://localhost:8000
  ```

  Leave out `AISERVICE_URL` to work without spending credit: the backend then
  uses a stub runtime that makes no model calls.

- `aiservice/.env`: copy `aiservice/.env.example` and fill in your keys.

Create the development database:

```bash
npm run prisma:migrate   # creates backend/database/dev.db and applies every migration
npm run db:seed          # floors, teams and the starting cast
npm run db:seed:roles    # the role library
```

Run it:

```bash
npm run dev:all          # backend, frontend and AI service; open localhost:3000 in a browser
npm run dev:electron     # the desktop window over the Next dev server
npm run desktop          # full build, including the packaged AI service, then the desktop app
```

`npm run dev` starts the backend and frontend without the AI service, and
`npm run dev:ai` starts the AI service alone. In the desktop app, Electron
starts the backend and the AI service itself.

Two things catch people out:

- **VS Code and Cursor terminals set `ELECTRON_RUN_AS_NODE`.** Electron then
  starts as plain Node and fails with `Cannot read properties of undefined
  (reading 'registerSchemesAsPrivileged')`. Run the Electron scripts from a
  normal terminal, or clear the variable first (`unset ELECTRON_RUN_AS_NODE` in
  bash, `Remove-Item Env:ELECTRON_RUN_AS_NODE` in PowerShell).
- **A stale static build hides frontend changes.** If `frontend/out/index.html`
  exists, Electron loads it instead of the dev server. Run
  `npm run build:frontend`, or delete `frontend/out` to get hot reload.

## Checks every change must pass

Before opening a pull request, run these and say in it which ones you ran:

```bash
cd frontend && npm run lint          # ESLint
cd frontend && npx tsc --noEmit      # frontend types
cd backend && npx tsc --noEmit       # backend types
npm run build:electron               # tsc for electron/
```

The AI service has no test suite or linter yet. For a change to it, start it
(`npm run dev:ai`) and complete a run that exercises the change.

Then run the checks that match the change:

| The change touches | Run |
|---|---|
| The database schema or migrations | `npm run build:backend && npm run seed:db`. It builds a fresh database from every migration plus the seed, and fails if the result holds personal data. Then check your own database with `cd backend && npx prisma migrate status`. |
| The run contract (`RunSpec`, `RuntimeEvent`) | Change `backend/runtime/AgentRuntime.ts` and `aiservice/src/sanctorum_aiservice/runtime/models.py` together, then complete a real run. |
| Tool grants (`ToolPolicy.ts`, the tool executor) | A run at a clearance below the tool's rung, confirming the tool is refused. |
| Packaging (`electron/`, `electron-builder.yml`, `aiservice.spec`) | `npm run pack`, then launch the unpacked app in `release/`. |

Live runs spend real OpenRouter credit on your key. Keep them short, and say in
the pull request which ones you did.

Finally, check the change by hand in the running app, in the desktop app as
well as the browser when it touches Electron, packaging or file paths.

## Building installers

```bash
npm run dist:win      # Windows installer in release/
npm run dist:mac      # macOS dmg (build on a Mac)
npm run pack          # unpacked build for a quick local check
```

All three:

- build the backend, the frontend export and the Electron code;
- package the AI service with PyInstaller;
- rebuild `seed.db`, stopping the build if it finds personal data or the file
  is over 4 MB;
- run electron-builder.

The AI service is a native binary, so each platform is built on that platform.
Pushing a `v*` tag builds Windows x64, macOS Apple Silicon and macOS Intel on
GitHub Actions and attaches them to a draft release.
`.claude/skills/ship_CrossPlatformBuilds` explains the setup. Builds aren't
code-signed yet.

## Environment variables

API keys are normally entered in the app's **Settings**, and those take
precedence over the variables below. The desktop app encrypts them with the OS
keychain, while browser development stores them unencrypted in `dev.db`.

| Variable | Where | Effect |
|---|---|---|
| `PORT`, `DATABASE_URL` | `backend/.env` | The backend's port and its SQLite file |
| `AISERVICE_URL` | `backend/.env` | Where the AI service is. Unset, the backend uses a stub runtime that makes no model calls. |
| `OPENROUTER_API_KEY`, `SERPER_API_KEY` | `aiservice/.env` | Provider keys used when none is set in Settings |
| `DEFAULT_MODEL`, `IMAGE_MODEL`, `SPEECH_MODEL` | `aiservice/.env` | Fallback models when neither Settings nor the agent names one |
| `PORT`, `BACKEND_URL` | `aiservice/.env` | The AI service's port, and where it sends run events |
| `AUTO_APPROVE_TOOLS` | `aiservice/.env` | Comma-separated read-only tools that run without a pause in supervised runs |
| `SANCTORUM_TRACE` | both `.env` files | `1` prints a timestamped trace of every step, pause and delegation |
| `SANCTORUM_DATA_DIR` | AI service | Where the AI service keeps `runs.db` |
| `LITELLM_LOCAL_MODEL_COST_MAP` | AI service | `True` stops LiteLLM downloading its model price list at startup |
| `PRISMA_LOG_QUERIES` | backend | `1` logs every database query |
| `APP_USER_DATA`, `SANCTORUM_SECRETS_URL`, `SANCTORUM_SECRETS_TOKEN` | set by Electron | Where user data lives, and how the backend reaches the keychain. Set them only to test outside Electron. |

Never commit a `.env` file. None is packaged into the installer.

## Coding conventions

Follow [CLAUDE.md](CLAUDE.md); its rules apply to human and AI contributors
alike. In short:

- **Frontend flow:** Component → Hook → Service → API, and back the same way.
  All calls go through `frontend/api/client.ts`.
- **Backend flow:** database → service → route → API.
- **Capability lives in code, never in a prompt.** Tool access is decided in
  `backend/runtime/ToolPolicy.ts`, and the AI service refuses anything outside
  the grant. Don't add a capability by telling the model about it.
- **Keep the run contract in sync** between `AgentRuntime.ts` and
  `runtime/models.py`.
- **Theming:** use theme tokens, never raw colours, and keep every preset
  working.
- **Reuse** components from `frontend/components/` before writing new ones.
- **Comments:** few, and one short line each.
- **TypeScript everywhere** on the JS side. Avoid new `any` where a precise
  type is cheap.
- **File size:** if you're adding a substantial new concern to an already large
  file, prefer a new module.

### Licences

Sanctorum is AGPL-3.0, so every new npm or Python package needs a compatible
licence. MIT, BSD, ISC, Apache-2.0, LGPL, GPL-3.0 and AGPL-3.0 are fine.
GPL-2.0-only, SSPL, and non-commercial or proprietary licences are not. There's
no automated licence check yet, so say in the pull request what you checked.

### Data safety

A user's `app.db` is the only copy of their organisation. Migrations that have
shipped are never edited: add a new one, and try it on a copy of a real
database, where every table should keep the same rows. `seed.db` is build
output, so never edit or commit it.

## Commit and PR guidelines

- Small, focused commits with short imperative subject lines
  (for example `pause unattended runs at the step limit`).
- A PR should explain _why_ the change is needed and list the checks and live
  runs you did.
- Say whether the change needs a migration, changes the run contract, or
  changes what is sent to a provider. The last one also means updating
  [PRIVACY.md](PRIVACY.md).

## Reporting bugs and requesting features

Open an issue, or email support.darkmatterlabs@gmail.com. For suspected
security issues, don't open an issue: follow [SECURITY.md](SECURITY.md).

## Code of conduct

Everyone working on Sanctorum follows the
[Sanctorum Code of Conduct](CODE_OF_CONDUCT.md).

## License

Sanctorum is licensed under the
[GNU Affero General Public License v3.0](LICENSE). By contributing, you agree
that your contribution is licensed under the same terms. If you run a modified
version as a network service, the AGPL requires you to offer its source to that
service's users.
