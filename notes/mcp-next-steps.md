# MCP — next steps

Written 2026-10-23, after MCP worked end to end with the `everything` test server and a local app (HaloGuitar in FL Studio). The bug fixes from that session are in [mcp-tool-calls-bug.md](mcp-tool-calls-bug.md).

## Where it stands

Sanctorum is an MCP **client**: any MCP server, local (stdio) or online (http), can be granted to a seat, and its tools run under the seat's clearance, the agent's supervision, the task's step and cost limits, and delegation. That's the difference from a single-assistant client like Claude Desktop or Cursor: external tools sit inside the org model.

Tested so far: local test server, local app. Still to test: online servers (below).

## 1. Finish the online tests

Try each in the MCP Inspector first, then in Sanctorum on a supervised agent with a user-set success criterion.

- [ ] **No sign-in:** http server `https://example-server.modelcontextprotocol.io/mcp`. Proves the http transport.
- [ ] **Token:** GitHub, http server `https://api.githubcopilot.com/mcp/` with a read-only personal access token. Proves the http transport with `Authorization: Bearer`.
- [ ] **OAuth:** Canva through the `mcp-remote` bridge: stdio, command `npx`, args `["-y","mcp-remote","https://mcp.canva.com/mcp"]`, signed in once in a terminal first. Check what happens when the sign-in expires mid-run (browser opens; the call times out after 120 s).

## 2. Fixes, most important first

### Tool name clashes (check first)
- [ ] Verify: MCP tools are not prefixed with their server's name (`tool_name_prefix` is off), and Sanctorum has a built-in `search`. A server with its own `search`, or two servers sharing a tool name, would likely give the model two tools of one name, or replace the built-in one in the `ToolNode`.
- [ ] Fix: prefix MCP tool names with the server name (the adapter supports it), or refuse a clashing tool with a skip note. Keep names within providers' limits (letters, digits, `_`, `-`, 64 characters).

### Read-only tools run without a pause
- [ ] MCP tools can mark themselves read-only (`readOnlyHint`); the adapter already puts the annotations in each tool's `metadata`. Let a supervised run skip the pause for those, as an opt-in per server, since the hint is the server's own claim.
- [ ] Show which MCP tools are read-only in the approval prompt.

### Per-tool access
- [ ] Today a grant gives a seat every tool on a server. Add an allow list (or deny list) of tool names per server, or per seat assignment, enforced in the AI service like the built-in grant.
- [ ] Until then, the manual should say to limit access through the server's own token (for example a read-only GitHub token).

### Tests (step 3 of the bug note)
- [ ] `pytest`, a local FastMCP test server, and tests for the sync wrapper, the timeout, server errors, a crashing server, `_explain`, and the client name. The one-off checks from 2026-10-23 cover all of these and can become the tests.

### Encrypt MCP access tokens
- [ ] Tokens are stored in plain text in the database (the manual warns about it). Store them like provider keys, encrypted by the OS through Electron's `safeStorage` (`electron/secrets.ts`), and keep the masked view in the UI.

### Large tool results
- [ ] A big result (HaloGuitar's song JSON, a GitHub listing) is sent to the model again at every later step. Consider a size cap per MCP result with a note saying it was cut, or summarise older tool results.

### Clearer errors from the provider
- [ ] OpenRouter's out-of-credit error is code 402 with "requires more credits", which the "no credit" hint doesn't catch. Match the 402.
- [ ] Set a sensible `max_tokens` (a setting), so OpenRouter doesn't reserve credit for the model's full 65,536-token maximum on every call.
- [ ] Say so in the terminal when the success-criterion step falls back to the generic criterion.

## 3. Later

- **Browser sign-in (OAuth) in Sanctorum itself,** so Canva-style servers work over http without `mcp-remote`. The MCP library has an OAuth client; tokens would be stored encrypted, per server.
- **One connection per run instead of per call,** for servers that keep state in memory. It has to survive long approval pauses and a restart, so it needs care.
- **More of MCP than tools:** resources (files and data a server offers), prompts, and requests from the server (asking the user a question, asking the model). Each needs a decision about who approves it.
- **Prompt injection from outside content.** Results and tool descriptions from a server can contain instructions aimed at the agent. Consider marking MCP results as untrusted in the worker prompt, and showing a server's tool descriptions when it's added.
- **Sanctorum as an MCP server,** so Claude on claude.ai, Claude Desktop or a local model could drive it (give a task to a seat, read a run). Today the connection is one-way.
- **The async graph** (see the bug note), which would also remove the sync wrapper.
