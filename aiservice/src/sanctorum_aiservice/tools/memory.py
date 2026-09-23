"""The `read_memory` / `write_memory` tools — knowledge that outlives a run.

Neither tool touches the database here. Both call back into Node, which resolves
WHO is asking and WHICH owner the scope maps to from the run id.

That indirection is the security design, not an accident of layering:

  - The agent sends a SCOPE ('agent' | 'position' | 'team'), never an owner id
    and never an identity. If it could name an ownerId it would read another
    seat's memory; if it could name an agentKey it would impersonate a
    higher-clearance reader — and that identity is exactly what the row-level
    filter in `memoryService.readMemory` keys on.
  - The same gate serves the UI and the agent, so the two can never disagree
    about what a given seat may see.

Memory lives on the SEAT, not the person. Reassign an agent and the knowledge
stays with the desk — which is what makes a team's third run smarter than its
first.

Everything here returns a string for the model to read. A refusal ("you hold no
seat, so you have no seat memory") is a normal result it should adapt to, never
an exception that aborts an otherwise healthy run.
"""

from __future__ import annotations

import httpx

from ..config.settings import settings

# The stream would balloon if an agent read a long team history verbatim, and the
# model rarely needs every entry. Cap what we render; say what was withheld.
_MAX_ENTRIES = 25
_MAX_BODY = 600


def _url(run_id: str, action: str) -> str:
    return f"{settings.backend_url.rstrip('/')}/api/runtime/runs/{run_id}/memory/{action}"


async def read_memory(run_id: str, scope: str) -> str:
    """Read one memory scope, already filtered by the reader's clearance."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(_url(run_id, "read"), json={"scope": scope})
            data = resp.json()
    except Exception as exc:  # noqa: BLE001 — a transport failure reads as a refusal
        return f"error: could not read memory: {exc}"

    if not isinstance(data, dict) or not data.get("ok"):
        reason = (data or {}).get("error") if isinstance(data, dict) else None
        return f"refused: {reason or 'memory is not available for that scope.'}"

    entries = data.get("entries") or []
    if not entries:
        return f"({scope} memory is empty — nothing has been recorded yet.)"

    shown = entries[:_MAX_ENTRIES]
    lines: list[str] = []
    for e in shown:
        body = str(e.get("body", "")).strip()
        if len(body) > _MAX_BODY:
            body = body[:_MAX_BODY] + f"… (+{len(str(e.get('body', ''))) - _MAX_BODY} more chars)"
        author = e.get("authorAgentKey") or "manual"
        when = str(e.get("createdAt", ""))[:10]
        lines.append(f"- [{e.get('kind', 'note')}] ({when}, by {author}) {body}")

    header = f"{scope} memory — {len(shown)} of {len(entries)} entr{'y' if len(entries) == 1 else 'ies'}:"
    tail = (
        f"\n… {len(entries) - len(shown)} older entr"
        f"{'y' if len(entries) - len(shown) == 1 else 'ies'} not shown."
        if len(entries) > len(shown)
        else ""
    )
    return header + "\n" + "\n".join(lines) + tail


async def write_memory(
    run_id: str, scope: str, body: str, kind: str = "insight", clearance: int = 0
) -> str:
    """Record something worth keeping. Clearance is capped at the writer's own."""
    payload = {"scope": scope, "body": body, "kind": kind, "clearance": clearance}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(_url(run_id, "write"), json=payload)
            data = resp.json()
    except Exception as exc:  # noqa: BLE001
        return f"error: could not write memory: {exc}"

    if not isinstance(data, dict) or not data.get("ok"):
        reason = (data or {}).get("error") if isinstance(data, dict) else None
        return f"refused: {reason or 'that memory could not be recorded.'}"

    entry = data.get("entry") or {}
    stored = entry.get("clearance", clearance)
    note = (
        f" (clearance {stored} — capped to your own)"
        if isinstance(stored, int) and stored < clearance
        else f" (clearance {stored})"
    )
    return f"Recorded to {scope} memory as a '{entry.get('kind', kind)}'{note}."
