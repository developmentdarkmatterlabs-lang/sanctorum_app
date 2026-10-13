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
