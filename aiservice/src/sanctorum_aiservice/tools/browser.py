"""The browser tools — `browse`, `click`, `type`, `scroll`, `back`, `read_page`.

NO BROWSER LOGIC LIVES HERE. The page is a WebContentsView owned by the Electron
main process, because Electron already ships Chromium — bundling Playwright would
ship a SECOND one, ~150 MB per platform, to drive the browser already running.

So this is a thin HTTP client, the same shape as delegate.py: Python asks Node,
Node asks the main process, and a rendered snapshot comes back.

WHAT THE AGENT SEES is a numbered list, not pixels:

    [link 12] Wikipedia
    [button 18] Search
    [input text 30] Search Wikipedia

so it acts by `click(18)` — a semantic reference. That is what makes the
approval the user reads `click [button 18] "Buy now"` rather than
`click at (840, 612)`, and it is ~10x cheaper than a vision model per page.

Everything returns a string for the model to read; a refusal is a normal result.
"""

from __future__ import annotations

import httpx

from ..config.settings import settings

_TIMEOUT = 90.0


async def _call(run_id: str, action: str, **args: object) -> str:
    url = f"{settings.backend_url.rstrip('/')}/api/runtime/runs/{run_id}/browser"
    payload: dict[str, object] = {"action": action}
    payload.update({k: v for k, v in args.items() if v is not None})
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:  # noqa: BLE001 — a failure is a tool result
        return f"error: the browser is unavailable: {exc}"
    return str(data.get("text") or "error: the browser returned nothing.")


async def browse(run_id: str, url: str) -> str:
    """Open a page and return its snapshot."""
    if not (url or "").strip():
        return "error: a url is required."
    return await _call(run_id, "browse", url=url.strip())


async def click(run_id: str, index: int) -> str:
    return await _call(run_id, "click", index=int(index))


async def type_text(run_id: str, index: int, text: str) -> str:
    return await _call(run_id, "type", index=int(index), text=text)


async def scroll(run_id: str, amount: int = 600) -> str:
    return await _call(run_id, "scroll", amount=int(amount))


async def back(run_id: str) -> str:
    return await _call(run_id, "back")


async def read_page(run_id: str) -> str:
    return await _call(run_id, "read")
