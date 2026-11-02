<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

In Sanctorum, Next.js is installed in `frontend/`, so its guides are in `frontend/node_modules/next/dist/docs/`.

# Sanctorum — rules for coding agents

Sanctorum is an open-source (AGPL-3.0) Electron desktop app for Windows and macOS: a pixel-art office of AI agents. Agents sit in seats (positions) on teams, and the seat decides what they may do: clearance, tools, skills, MCP servers and memory. Runs are supervised, self-critiquing and can delegate down the org tree. See [README.md](README.md) for the full feature list and architecture.

## Hard rules

- **Never run git commands.** Not even read-only ones (`status`, `log`, `diff`). The maintainer handles all version control.
- **Check the licence of every new dependency.** npm packages and Python packages must be compatible with AGPL-3.0.
- **Capability is enforced in code, never requested in a prompt.** Tool access comes from [backend/runtime/ToolPolicy.ts](backend/runtime/ToolPolicy.ts), and the AI service refuses anything outside the grant.
- **Ask before running anything that calls a model.** It spends the user's OpenRouter credit. The `StubRuntime` runs the app with no Python and no model calls.
- **Never break the user's database.** See "Data safety" below.

## Layout

| Folder | What it is | Port |
|---|---|---|
| `frontend/` | Next.js UI: the office canvas, panels, stores (Zustand) | 3000 |
| `backend/` | Express + Prisma + SQLite: permissions, org model, run tree, budgets | 3001 |
| `aiservice/` | Python FastAPI + LangGraph + LiteLLM: the agent loop, tool execution, checkpoints | 8000 |
| `electron/` | Main process, preload, the agent's browser, encrypted provider keys | — |
| `scripts/` | Seed database build, manual build and screenshots | — |
| `docs/` | The README's pictures and the user manual (`docs/manual/`) | — |
| `notes/` | Design notes and plans | — |

In the desktop app Electron spawns the backend and the AI service as children, and the page reaches them over IPC, never by port.

## Frontend data flow

- **Going down (user action):** Component → Hook → Service → API
- **Coming back (response):** API → Service → Hook → Component re-renders
- All API calls go through [frontend/api/client.ts](frontend/api/client.ts). It uses `window.electronAPI` (IPC) in Electron and `fetch` in the browser. No component calls `fetch` directly.
- IPC flows through the established `electronAPI` pattern in `api/client.ts` and [electron/preload.ts](electron/preload.ts). Don't open new channels around it.
- The frontend never talks to an LLM.

## Backend data flow

database → service → route → API called from the frontend (services in `backend/database/moduledb/moduleservices/`, routers in `backend/routes/moduleRoutes/`).

- Clearance is resolved from the seat through one resolver (`positionResolve`). The tool grant and the memory read gate both depend on it; keep it in that one file.
- Provider keys never go back to the frontend. Routes report only whether a key is set (masked).
- The backend never runs a tool. It builds a `RunSpec` with a `ToolGrant` and the AI service executes within it.

## The runtime contract

- [backend/runtime/AgentRuntime.ts](backend/runtime/AgentRuntime.ts) and [aiservice/src/sanctorum_aiservice/runtime/models.py](aiservice/src/sanctorum_aiservice/runtime/models.py) are one contract: change them together.
- `HttpRuntime` talks to the AI service; `StubRuntime` stands in for it. A change to the contract must keep both working.
- Every tool call goes through `ToolExecutor`, which re-checks the grant. External MCP tools are merged into the same tool list and pass the same approval gate.

## UI and theming

- Components respect the theme system and the presets of each theme ([frontend/styles/themes/](frontend/styles/themes/): `tokens.css` and `presets/`). Use theme tokens, never raw colours.
- Reuse components from [frontend/components/](frontend/components/) (`data-display`, `entity`, `forms`, `layout`, `ui` and the feature folders) when one fits.
- When a CSS fix isn't working, log the computed styles and the ancestor chain in the console before changing layers. Don't guess.

## Comments

Don't add many comments. Updating existing ones is fine. A new or updated comment should be one short line (about 30 words at most).

## Where things go

| Content | Location |
|---|---|
| To-do plans, notes and reminders for later | [notes/](notes/) |
| Images used in [README.md](README.md) | `docs/assets/readme/` |
| The user manual (PDF), its source and its pictures | `docs/manual/` |

## Data safety

Users' work lives in the app's SQLite database: their org, memory and run history.

1. **Migrations only add.** Schema changes go through a new Prisma migration in `backend/prisma/migrations/`. Never edit one that has shipped.
2. **`backend/database/seed.db` is build output** (`npm run seed:db`). It is the only database that ships; never ship or edit `dev.db`.
3. **Paused runs must survive a restart.** The AI service's checkpoint and run manifest rebuild them, so keep them readable across changes.

## Packaging gotchas

- **Native code can't run from inside the asar.** The AI service (PyInstaller) and the backend's `node_modules` (Prisma's query engine) ship in `extraResources`.
- **`npm run pack` and `dist:*` build everything first**, the AI service (PyInstaller) included. `electron-builder` on its own assumes those builds exist.
- **No `.env` file ships, and none is committed.** Development keys belong in `aiservice/.env`; users' keys are entered in Settings and encrypted by the OS (`electron/secrets.ts`).

## The user manual

**Everything created or updated that a user can see or use is also updated in the PDF manual** in `docs/manual/`.

- The source is `docs/manual/manual.html`. `scripts\build_manual.ps1` prints it to `docs/manual/Sanctorum_Manual.pdf` with Edge or Chrome (headless). It needs ffmpeg for the pictures.
- Pictures live in `docs/manual/images/` as **WebP** (quality 92). Reference them as `.webp`, never PNG.
- Take them as screenshots of the real app: `scripts\build_manual.ps1 -Screenshots` runs `scripts/manualShots.mjs`. It rebuilds the app, opens it in Electron against a staged demo database and converts the shots. A new picture is a new entry in that script's `SHOTS` list; `-Only name,name` retakes some, and `-SkipBuild` skips the rebuild.
- Close Sanctorum first: the script refuses to run while the app's ports are in use. Dialogs and side panels are cropped to the panel (`panelBox`); the office, fleet and floors are whole windows.
- Show only the demo data and Sanctorum's own cast and art in the pictures, never the maintainer's real database.
- The PDF is printed from a temporary copy with JPEG pictures (PNG for the portraits, which keep their transparency).
- Write for the people who use Sanctorum: menus and buttons by their names, no source paths or developer terms.
- A new feature that changes how the app looks or works updates its pages and the pictures that show it, then rebuilds the PDF. A change isn't done until the manual matches it.

## End of every session

Check the manual (`docs/manual/`) covers the session's work and rebuild its PDF. Review these files and update any that the session's work affects: [AGENTS.md](AGENTS.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [CONTRIBUTING.md](CONTRIBUTING.md), [PRIVACY.md](PRIVACY.md), [README.md](README.md), [SECURITY.md](SECURITY.md).
