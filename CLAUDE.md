@AGENTS.md

# Rules for working in this repository

- **NEVER RUN GIT COMMANDS.**
- Frontend: Component → Hook → Service → API going down, and API → Service → Hook → Component re-rendering on the way back.
- Backend: database → service → route → API.
- Respect the theme settings and the presets of each theme, and reuse components from `frontend/components`.
- IPC goes through the `electronAPI` pattern in `api/client.ts`.
- Capability is enforced in code, never requested in a prompt: tool access comes from `backend/runtime/ToolPolicy.ts`, and the AI service refuses anything outside the grant.
- `backend/runtime/AgentRuntime.ts` and `aiservice/src/sanctorum_aiservice/runtime/models.py` are one contract: change them together.
- Never edit a migration that has shipped; add a new one. `backend/database/seed.db` is build output.
- New dependencies must be compatible with AGPL-3.0.
- Ask before running anything that calls a model: it spends the user's OpenRouter credit.
- Comments: few, and one short line each (about 30 words at most). Update existing ones rather than adding new ones.

## Where things go

| Content | Location |
|---|---|
| To-do plans, notes and reminders for later | [notes/](notes/) |
| Images used in [README.md](README.md) | `docs/assets/readme/` |
| The user manual (PDF), its source and its pictures | `docs/manual/` |

## Keep the PDF manual current

Everything you create or change that a user can see or use must also be updated in the user manual in `docs/manual/`:

- Write it in `docs/manual/manual.html` and rebuild the PDF with `scripts\build_manual.ps1`, which saves `docs/manual/Sanctorum_Manual.pdf`.
- If a page needs pictures, take screenshots of the real app (`scripts\build_manual.ps1 -Screenshots`, or `-Screenshots -Only name,name` for some). Add a new picture to the `SHOTS` list in `scripts/manualShots.mjs`. The pictures are kept in `docs/manual/images/` as WebP (the script converts them with ffmpeg).
- When a new feature changes how the app looks or works, update the affected pictures and pages too, and rebuild the PDF.