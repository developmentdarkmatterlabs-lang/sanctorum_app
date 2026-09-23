"""File tools, confined to the run's working directory.

Every path is resolved under `working_dir` and rejected if it escapes (no `..`,
no absolute paths outside the root). The executor passes the grant's workingDir;
these functions never see anything else.
"""

from __future__ import annotations

import os
from pathlib import Path


class PathEscape(Exception):
    """Raised when a requested path resolves outside the working directory."""


def _resolve(working_dir: str, rel: str) -> Path:
    """Resolve `rel` under `working_dir`, refusing any escape."""
    root = Path(working_dir).resolve()
    # A relative path is joined; an absolute one is checked against the root.
    candidate = (root / rel).resolve() if not os.path.isabs(rel) else Path(rel).resolve()
    if root != candidate and root not in candidate.parents:
        raise PathEscape(f"path '{rel}' is outside the working directory")
    return candidate


def read_file(working_dir: str, path: str) -> str:
    p = _resolve(working_dir, path)
    if not p.is_file():
        return f"error: '{path}' is not a file"
    return p.read_text(encoding="utf-8", errors="replace")


def list_dir(working_dir: str, path: str = ".") -> str:
    p = _resolve(working_dir, path)
    if not p.is_dir():
        return f"error: '{path}' is not a directory"
    entries = sorted(
        f"{'d' if e.is_dir() else 'f'} {e.name}" for e in p.iterdir()
    )
    return "\n".join(entries) if entries else "(empty)"


def write_file(working_dir: str, path: str, content: str) -> str:
    p = _resolve(working_dir, path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return f"wrote {len(content)} chars to {path}"


def write_bytes(working_dir: str, path: str, data: bytes) -> str:
    """Write binary content under the working directory, returning the relative
    path written. Shares `_resolve` with the text writers, so a generated image
    is confined exactly like a generated file."""
    p = _resolve(working_dir, path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    try:
        return str(p.relative_to(Path(working_dir).resolve()))
    except ValueError:
        return path


def with_extension(path: str, ext: str) -> str:
    """Append `ext` to `path` unless it already ends in a plausible extension.

    NOT `"." in name`. That was the first version, and it is wrong: a model id
    like `speech-2.8-turbo` or a file called `v1.2-draft` contains a dot that is
    part of the NAME, so the check reported "already has an extension" and the
    file was written with none — unopenable by any player, and silently so.

    A real extension is short and alphanumeric, so that is what is tested for.
    """
    name = path.rsplit("/", 1)[-1]
    head, dot, tail = name.rpartition(".")
    if dot and head and 1 <= len(tail) <= 5 and tail.isalnum():
        return path
    return f"{path}{ext}"


def edit_file(working_dir: str, path: str, find: str, replace: str) -> str:
    p = _resolve(working_dir, path)
    if not p.is_file():
        return f"error: '{path}' is not a file"
    text = p.read_text(encoding="utf-8")
    if find not in text:
        return f"error: text to replace was not found in {path}"
    p.write_text(text.replace(find, replace, 1), encoding="utf-8")
    return f"edited {path}"
