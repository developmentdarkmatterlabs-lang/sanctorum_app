"""The web-search tool, backed by Serper.

Reachable if `search` is granted (clearance 0). Returns an error string if no
Serper key is configured, so a run degrades gracefully rather than crashing.
"""

from __future__ import annotations

import httpx

from ..config.settings import settings


def search(query: str, api_key: str | None = None) -> str:
    # Prefer the run's key (from app settings), else the service env key.
    key = (api_key or "").strip() or settings.serper_api_key
    if not key:
        return "error: web search is not configured (no Serper key)"
    try:
        resp = httpx.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": key, "Content-Type": "application/json"},
            json={"q": query},
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:  # noqa: BLE001
        return f"error: search failed: {exc}"

    lines: list[str] = []
    for item in (data.get("organic") or [])[:5]:
        title = item.get("title", "")
        link = item.get("link", "")
        snippet = item.get("snippet", "")
        lines.append(f"- {title}\n  {link}\n  {snippet}")
    return "\n".join(lines) if lines else "no results"
