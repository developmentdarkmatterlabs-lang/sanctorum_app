"""Connect to the run's external MCP servers and expose their tools (Phase 3.7).

The seat's assigned MCP servers ride the RunSpec (`spec.mcpServers`). Here we build
a MultiServerMCPClient from them and fetch their tools as LangChain tools, which
`graph/build.py` merges into the ToolNode alongside the clearance-gated built-ins.
Those MCP tools then flow through the SAME supervision gate as any other tool.

HTTP-first: an `http` server becomes a `streamable_http` connection (url + auth
header + extra headers). `stdio` spawns a local subprocess (command/args) with the
grant's env (PATH/bootstrap, so it can find node/npx/etc.).

FAILURE ISOLATION: a server that's disabled, misconfigured, or unreachable is
skipped — its tools are simply omitted and a note is returned — so one bad server
never crashes the run. Returns (tools, notes): the merged tool list and any
human-readable "skipped X because Y" lines to surface as status.
"""

from __future__ import annotations

import json
from typing import Any

from ..runtime.models import McpServerConfig, RunSpec


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
        conn: dict[str, Any] = {"transport": "streamable_http", "url": server.url}
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
        }

    return None


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

    tools: list[Any] = []
    # Connect to all servers at once; if the batch fails, fall back to per-server so
    # one unreachable server doesn't lose the others.
    try:
        client = MultiServerMCPClient(connections)
        tools = await client.get_tools()
    except Exception:  # noqa: BLE001 — batch failed; try each server alone
        for name, conn in connections.items():
            try:
                client = MultiServerMCPClient({name: conn})
                tools.extend(await client.get_tools())
            except Exception as exc:  # noqa: BLE001
                notes.append(f"MCP server '{name}' skipped: {exc}.")

    return tools, notes
