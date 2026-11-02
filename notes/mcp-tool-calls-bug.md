# MCP tool calls fail every run — next steps

Found 2026-10-23 while testing the reference server `@modelcontextprotocol/server-everything` on Alden (Claude Opus 5.5).

## What happens

- Registering, assigning and connecting work: the terminal prints `MCP tools available: echo, get-env, …`.
- The first MCP tool call fails the run with:
  `run failed: the model 'openrouter/anthropic/claude-opus-5.5' does not support tool use … (provider said: StructuredTool does not support sync invocation.)`
- The same server and tools work in the MCP Inspector, so the server is fine.

## Cause

**Bug 1 — MCP tools can't run.** The graph runs synchronously (`run.graph.invoke` in a worker thread, `graph/supervise.py` `_advance`). Tools from `langchain-mcp-adapters` (0.3.0) are async-only, so the `ToolNode` can't call them. Built-in tools work because they're plain functions. Every MCP server is affected, including Blender and Canva.

**Bug 2 — the error blames the model.** `_explain` in `graph/supervise.py` treats any error containing "tool" and "not support" as "the model does not support tool use". The tool's own error matches, so the user is told to switch models, which doesn't help.

## Decision

Fix it now with a synchronous wrapper around each MCP tool. Leave the graph synchronous. Making the graph async is the long-term shape, but it's a separate phase (see below), because it touches the checkpointer and the restart-safe pause.

## Next steps

### 1. Synchronous wrapper for MCP tools (`aiservice/src/sanctorum_aiservice/mcp/client.py`) — done 2026-10-23

- [x] In `load_mcp_tools`, capture the running event loop (it runs on the FastAPI loop).
- [x] Give each MCP tool a synchronous function that schedules the tool's async call on that loop (`asyncio.run_coroutine_threadsafe`) and waits for the result.
- [x] Timeout on every call: `MCP_CALL_TIMEOUT` in `config/settings.py`, 120 s by default. It runs on the loop side, because the MCP library swallows cancellation and the abandoned task's error would otherwise be logged as never retrieved.
- [x] Return a failed or timed-out call to the agent as the tool's result (a clear error naming the server and tool), not an exception that fails the run. Errors the server itself reports still go through the adapter's own handler.
- [x] Guard: refuse with a clear error if the wrapper is ever called on the loop's own thread (that would deadlock).
- [x] Keep one session per call (the adapter's default). Runs can wait hours for approval, so long-lived connections don't fit.
- [x] Servers load as one task each, so the skip note names the failing server and its cause.
- [x] Sanctorum introduces itself to servers as `Sanctorum <version>` (MCP `clientInfo`, via the adapter's `session_kwargs`) instead of the library's default `mcp`. Checked with a `whoami` test tool.

Checked without a model against a local FastMCP server, through a real `ToolNode` in a worker thread: a good call returns its result; an error raised in the tool, a hung call (timeout), a server that dies mid-call and an on-loop call each come back as an error result; an unknown command is skipped with a note. Checked in the app on 2026-10-23: Alden ran `get-env` and `echo` from `everything` and met the criteria on the first attempt.

### 2. Honest error messages (`_explain` in `graph/supervise.py`) — done 2026-10-23

- [x] Show the "model does not support tool use" message only for errors raised by the model call (LiteLLM's exceptions, all `openai.OpenAIError`), and only for the provider's real wording ("no endpoints found that support tool use", or LiteLLM's "does not support parameters: ['tools']"). The "no endpoints" and "no credit" hints are limited to model errors too.
- [x] Label tool errors as such, with the tools of the failed step: `_failed_step` reads the failed task's node from the checkpoint, e.g. `the tool step (get_env) failed: ValueError: …`.
- [x] Keep the original error text in every message, as now.

Checked without a model against a checkpointed graph: the old sync-invocation error is now reported as a tool error naming the tool, a LiteLLM `NotFoundError` with the real wording still gets the model hint, and any other error passes through as it is.

### 3. Tests

The AI service has no tests yet, and `StubRuntime` never reaches Python, which is how this got through.

- [ ] Add `pytest` to the dev dependency group in `aiservice/pyproject.toml`.
- [ ] A tiny local MCP server for tests (FastMCP from the `mcp` package, over stdio) with one tool, e.g. `add`.
- [ ] Test: `load_mcp_tools` returns its tool, and the synchronous wrapper calls it from a worker thread and gets the result.
- [ ] Test: a server that hangs times out and comes back as a tool error, not an exception.
- [ ] Test: `_explain` keeps the model message for the provider's real wording and does not use it for `StructuredTool does not support sync invocation`.
- [ ] Test (no model call): build the graph with the test server's tools and run the `ToolNode` on a hand-made tool call.

### 4. Check it in the app (ask first, it spends OpenRouter credit)

- [x] Re-run the original task on Alden with `everything`: "Use the get-env tool and tell me what it returns, then use echo to say hello."
- [ ] On a supervised agent: each MCP call pauses for approval, and proceed runs it.
- [ ] Pause a run before an MCP call, restart the AI service, then proceed: the call still runs.
- [x] Compare `get-env` output inside Sanctorum with the Inspector's. Stdio servers get the grant's env plus the MCP library's standard set (`APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, `USERNAME`, …) and `npx`'s own `npm_*` variables; no keys or tokens.
- [ ] Then try Blender (`uvx blender-mcp`) and Canva (`npx -y mcp-remote https://mcp.canva.com/mcp`, signed in once in a terminal first).

### 5. Docs

- [x] Manual (`docs/manual/manual.html`): "Trying a local server" in chapter 10, with the steps for `everything` and what the terminal shows. PDF rebuilt.
- [x] README Guardrails table and `SECURITY.md`: the wider environment stdio MCP servers get.
- [ ] A screenshot of the MCP servers window with a stdio server filled in, if the manual needs one.

## Later: make the graph async (separate phase)

Do this when cancelling an in-flight tool call is wanted, or many runs at once start running out of worker threads.

- `run.graph.ainvoke` instead of `asyncio.to_thread(run.graph.invoke, …)`.
- An async worker and evaluator (`llm.ainvoke`).
- `AsyncSqliteSaver` instead of `SqliteSaver` (`aiosqlite` is already in `uv.lock` as an indirect dependency).
- Prove that runs paused before the switch still resume after it.
- Remove the synchronous wrapper from step 1 once MCP tools run natively.
- Built-in synchronous tools can stay as they are; LangGraph runs them in a thread under `ainvoke`.
