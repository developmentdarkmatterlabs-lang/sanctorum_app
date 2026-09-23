"""The `generate_image` tool — a picture written into the agent's workspace.

HOW THIS DIFFERS FROM THE OTHER TOOLS. Every other tool acts on the filesystem or
calls back into Node. This one makes an LLM call of its own, because the agent's
model is almost never an image model: Claude cannot draw, and the image models
that can (`google/gemini-2.5-flash-image` and friends) mostly cannot call tools.
So the agent stays on its own model and the tool dispatches a SEPARATE completion
to an image model, returning a file path.

THE COST MUST BE REPORTED BY HAND. `CostTracker` is a LangChain callback, so it
sees calls made through the graph and nothing else. A direct `litellm.completion`
here is invisible to it, and an image at ~4 cents is not a rounding error against
a $2.00 tree ceiling — ten of them is a fifth of the budget. So the tool reads the
cost LiteLLM attaches to the response and reports it via `tracker.record`, which
is what keeps `maxCostPerTree` honest.

CONFINEMENT IS UNCHANGED. The file is written through `files.write_bytes`, which
resolves the path with the same guard every other write uses — an agent cannot
place an image outside its workspace, and a read-only mount blocks the tool
entirely (it is absent from READ_ONLY_TOOLS on the Node side).
"""

from __future__ import annotations

import base64
from typing import Any

import litellm

from . import files

# Extensions we accept from a data URI, so a provider returning JPEG or WebP is
# written with the right suffix rather than mislabelled .png.
_MIME_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _extract(resp: Any) -> tuple[bytes, str] | None:
    """Pull the first image out of a completion response.

    Returns (raw bytes, extension), or None when the model answered in words
    rather than pictures — which happens, and is a refusal to report, not a crash.
    """
    try:
        message = resp.choices[0].message
    except (AttributeError, IndexError):
        return None

    data = message.model_dump() if hasattr(message, "model_dump") else dict(message)
    images = data.get("images") or []
    if not images:
        return None

    entry = images[0]
    url = ""
    if isinstance(entry, dict):
        holder = entry.get("image_url")
        url = (holder or {}).get("url", "") if isinstance(holder, dict) else str(holder or "")
    elif isinstance(entry, str):
        url = entry

    if not url.startswith("data:"):
        # A plain URL would need a second fetch. No provider we target returns
        # one today; say so rather than silently writing an empty file.
        return None

    header, _, b64 = url.partition(",")
    mime = header[5:].split(";")[0].strip().lower()
    try:
        raw = base64.b64decode(b64)
    except Exception:  # noqa: BLE001
        return None

    return raw, _MIME_EXT.get(mime, ".png")


def _cost_of(resp: Any) -> float:
    """The USD LiteLLM attached to this response, or 0 when it did not."""
    hidden = getattr(resp, "_hidden_params", None) or {}
    for key in ("response_cost", "cost"):
        value = hidden.get(key) if isinstance(hidden, dict) else None
        if isinstance(value, (int, float)) and value > 0:
            return float(value)
    usage = getattr(resp, "usage", None)
    value = getattr(usage, "cost", None)
    return float(value) if isinstance(value, (int, float)) and value > 0 else 0.0


def generate_image(
    working_dir: str,
    path: str,
    prompt: str,
    *,
    model: str,
    api_key: str,
    tracker: Any = None,
) -> str:
    """Generate an image for `prompt` and write it to `path` in the workspace."""
    if not prompt.strip():
        return "error: a prompt is required to generate an image."
    if not api_key:
        return (
            "refused: no OpenRouter key is configured, so no image can be "
            "generated. Add one in the app's settings panel."
        )

    try:
        resp = litellm.completion(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            api_key=api_key,
        )
    except Exception as exc:  # noqa: BLE001 — a provider failure is a tool result
        return f"error: image generation failed: {exc}"

    # Report the spend even when no image came back: the call was still billed,
    # and a ceiling that ignores failed attempts is a ceiling that can be evaded
    # by failing repeatedly.
    usd = _cost_of(resp)
    if tracker is not None and usd:
        tracker.record(usd)

    found = _extract(resp)
    if found is None:
        said = ""
        try:
            said = (resp.choices[0].message.content or "").strip()[:200]
        except Exception:  # noqa: BLE001
            pass
        return (
            f"error: '{model}' returned no image"
            + (f" — it replied: {said}" if said else "")
            + ". Try a more explicit prompt, or a different image model."
        )

    raw, ext = found
    # Honour an extension the agent chose; otherwise use the one the data URI
    # declared, so the file opens correctly.
    target = files.with_extension(path, ext)

    try:
        written = files.write_bytes(working_dir, target, raw)
    except files.PathEscape as exc:
        return f"refused: {exc}"
    except Exception as exc:  # noqa: BLE001
        return f"error: could not write the image: {exc}"

    return (
        f"wrote {written} ({len(raw) // 1024} KB) using {model}"
        + (f" — cost ${usd:.4f}" if usd else "")
    )
