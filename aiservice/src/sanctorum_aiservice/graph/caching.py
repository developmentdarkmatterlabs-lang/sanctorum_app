"""Prompt-cache breakpoints for providers, like Anthropic, that only cache when asked."""

from __future__ import annotations

from typing import Any

_MARKER = {"type": "ephemeral"}

# Model-id fragments whose provider needs explicit breakpoints.
_NEEDS_MARKERS = ("claude", "anthropic/")


def needs_markers(model: str | None) -> bool:
    low = (model or "").lower()
    return any(tag in low for tag in _NEEDS_MARKERS)


def _marked(message: Any) -> Any:
    """A copy of `message` whose last content block carries a breakpoint."""
    content = getattr(message, "content", None)
    if isinstance(content, str) and content:
        blocks: list[Any] = [{"type": "text", "text": content, "cache_control": _MARKER}]
    elif isinstance(content, list) and content:
        last = content[-1]
        if isinstance(last, str):
            last = {"type": "text", "text": last}
        if not isinstance(last, dict):
            return message
        blocks = [*content[:-1], {**last, "cache_control": _MARKER}]
    else:
        return message
    return message.model_copy(update={"content": blocks})


def with_cache_markers(model: str | None, messages: list[Any]) -> list[Any]:
    """Mark the system prompt and latest turn, on copies so markers never pile up in state."""
    if not messages or not needs_markers(model):
        return messages
    out = list(messages)
    out[0] = _marked(out[0])
    if len(out) > 1:
        out[-1] = _marked(out[-1])
    return out
