"""Coerce a LangChain message's `.content` to a plain string.

Reasoning / "thinking" models (and some newer providers) return message content
as a LIST of blocks, e.g. `[{"type": "thinking", ...}, {"type": "text", "text":
"..."}]`, instead of a plain string. Our event stream (`RuntimeEvent.body: str`)
and the evaluator both assume a string, so a list crashes the run. This normalizes
either shape to the human-facing text: join the text blocks, drop the rest.
"""

from __future__ import annotations

from typing import Any


def as_text(content: Any) -> str:
    """The text of a message's content, whether it's a string or a block list."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                # Text-bearing blocks: {"type": "text", "text": "..."} and the
                # common {"content": "..."} shape. "thinking"/"reasoning" blocks
                # are internal — skip them from the user-facing text.
                btype = block.get("type")
                if btype in (None, "text"):
                    parts.append(str(block.get("text") or block.get("content") or ""))
            else:
                parts.append(str(block))
        return "".join(p for p in parts if p)
    return str(content)
