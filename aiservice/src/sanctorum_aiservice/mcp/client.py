"""Connect to the run's external MCP servers and expose their tools (Phase 3.7).

The seat's assigned MCP servers ride the RunSpec (`spec.mcpServers`). Here we build
a MultiServerMCPClient from them and fetch their tools as LangChain tools, which
`graph/build.py` merges into the ToolNode alongside the clearance-gated built-ins.
Those MCP tools then flow through the SAME supervision gate as any other tool.

HTTP-first: an `http` server becomes a `streamable_http` connection (url + auth
header + extra headers). `stdio` spawns a local subprocess (command/args) with the
grant's env (PATH/bootstrap, so it can find node/npx/etc.).

SYNC BRIDGE: the adapter's tools are async-only, but the graph runs synchronously
in a worker thread. Each tool gets a sync function that runs the call on the
service's event loop and waits, with a timeout; a failed call goes back to the
agent as the tool's result instead of failing the run.

FAILURE ISOLATION: a server that's disabled, misconfigured, or unreachable is
skipped — its tools are simply omitted and a note is returned — so one bad server
never crashes the run. Returns (tools, notes): the merged tool list and any
human-readable "skipped X because Y" lines to surface as status.
"""

from __future__ import annotations

import asyncio
import functools
import json
from importlib.metadata import PackageNotFoundError, version
from typing import Any

from langchain_core.tools import BaseTool, ToolException
from mcp.types import Implementation

from ..config.settings import settings
from ..runtime.models import McpServerConfig, RunSpec

try:
    _VERSION = version("sanctorum-aiservice")
except PackageNotFoundError:  # the frozen build may carry no package metadata
    _VERSION = "0.1.0"


def _session_kwargs() -> dict[str, Any]:
    """How Sanctorum introduces itself to a server (the MCP library's default name is "mcp")."""
    return {"client_info": Implementation(name="Sanctorum", version=_VERSION)}


class McpCallError(ToolException):
    """An MCP call that failed or timed out, reported to the agent as the tool's result."""


def _connection_for(server: McpServerConfig, base_env: dict[str, str]) -> dict[str, Any] | None:
    """The MultiServerMCPClient connection dict for one server, or None if it's
    misconfigured (so we can skip it)."""
    transport = (server.transport or "http").lower()

    if transport in ("http", "streamable_http", "sse"):
        if not server.url:
            return None
        headers: dict[str, str] = {}
        if server.headers:
            try:
                parsed = json.loads(server.headers)
                if isinstance(parsed, dict):
                    headers = {str(k): str(v) for k, v in parsed.items()}
            except Exception:  # noqa: BLE001 — bad headers JSON just means no headers
                headers = {}
        if server.authToken:
            headers.setdefault("Authorization", f"Bearer {server.authToken}")
        conn: dict[str, Any] = {
            "transport": "streamable_http",
            "url": server.url,
            "session_kwargs": _session_kwargs(),
        }
        if headers:
            conn["headers"] = headers
        return conn

    if transport == "stdio":
        if not server.command:
            return None
        args: list[str] = []
        if server.args:
            try:
                parsed = json.loads(server.args)
                if isinstance(parsed, list):
                    args = [str(a) for a in parsed]
            except Exception:  # noqa: BLE001
                args = []
        # Give the subprocess the grant's env so it can resolve node/npx/etc.
        return {
            "transport": "stdio",
            "command": server.command,
            "args": args,
            "env": dict(base_env),
            "session_kwargs": _session_kwargs(),
        }

    return None


def _describe(exc: BaseException) -> str:
    """A readable cause, unwrapping the task groups the MCP transports raise."""
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    return f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__


def _with_sync_call(
    tool: BaseTool, server: str, loop: asyncio.AbstractEventLoop, timeout: float
) -> BaseTool:
    """A copy of an async-only MCP tool that the synchronous ToolNode can call."""
    coroutine = tool.coroutine  # type: ignore[attr-defined]
    label = f"MCP tool '{tool.name}' on server '{server}'"

    async def timed(*args: Any, **kwargs: Any) -> Any:
        # The timeout runs on the loop, so a cancelled call's late error is still collected.
        timer = asyncio.timeout(timeout)
        try:
            async with timer:
                return await coroutine(*args, **kwargs)
        except Exception:
            if timer.expired():
                raise TimeoutError from None
            raise

    @functools.wraps(coroutine)
    def call(*args: Any, **kwargs: Any) -> Any:
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            # Blocking the loop's own thread on a task scheduled to that loop would deadlock.
            raise McpCallError(f"{label} was called on the event loop thread and was refused.")
        future = asyncio.run_coroutine_threadsafe(timed(*args, **kwargs), loop)
        try:
            # The margin is a backstop for a call that ignores cancellation.
            return future.result(timeout=timeout + 5)
        except TimeoutError:
            future.cancel()
            raise McpCallError(f"{label} timed out after {timeout:g} s.") from None
        except ToolException:
            raise  # the adapter's own error results; its handler formats them
        except Exception as exc:  # noqa: BLE001 — transport/session failures become tool errors
            raise McpCallError(f"{label} failed: {_describe(exc)}") from exc

    original = tool.handle_tool_error

    def handle(exc: ToolException) -> Any:
        if isinstance(exc, McpCallError):
            return str(exc)
        if callable(original):
            return original(exc)
        raise exc

    return tool.model_copy(update={"func": call, "handle_tool_error": handle})


async def load_mcp_tools(spec: RunSpec) -> tuple[list[Any], list[str]]:
    """Fetch the tools of the run's MCP servers. Best-effort per server: a bad one
    is skipped with a note, never raised. Returns (tools, notes)."""
    servers = spec.mcpServers or []
    if not servers:
        return [], []

    base_env = dict(spec.policy.env or {})
    connections: dict[str, dict[str, Any]] = {}
    notes: list[str] = []

    for s in servers:
        conn = _connection_for(s, base_env)
        if conn is None:
            notes.append(f"MCP server '{s.name}' skipped: misconfigured.")
            continue
        connections[s.name] = conn

    if not connections:
        return [], notes

    # Import lazily so the rest of the service works even if the adapter is absent.
    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient
    except Exception as exc:  # noqa: BLE001
        return [], notes + [f"MCP disabled: adapter not available ({exc})."]

    # The tools' calls are scheduled back onto this loop (the service's) from the graph's thread.
    loop = asyncio.get_running_loop()
    timeout = settings.mcp_call_timeout
    client = MultiServerMCPClient(connections)
    names = list(connections)
    # One task per server, so an unreachable server loses only its own tools.
    results = await asyncio.gather(
        *(client.get_tools(server_name=name) for name in names), return_exceptions=True
    )

    tools: list[Any] = []
    for name, result in zip(names, results):
        if isinstance(result, BaseException):
            notes.append(f"MCP server '{name}' skipped: {_describe(result)}.")
            continue
        tools.extend(_with_sync_call(t, name, loop, timeout) for t in result)

    return tools, notes
