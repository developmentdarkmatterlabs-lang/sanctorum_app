"""Answers a repeat read of an unchanged file with a note; the first copy is still in context."""

from __future__ import annotations

from . import files

_NOTE = (
    "unchanged: '{path}' is identical to the copy you already read earlier in "
    "this run, so it was not repeated. Use that copy. If you can no longer see "
    "it, call read_file on it again and the full text will be returned."
)


class ReadCache:
    """One run's memory of which files it has read, and at which version."""

    def __init__(self) -> None:
        # resolved path -> ((mtime, size), whether the note was just given)
        self._seen: dict[str, tuple[tuple[int, int], bool]] = {}

    def read(self, working_dir: str, path: str) -> str:
        sig = files.signature(working_dir, path)
        if sig is None:
            return files.read_file(working_dir, path)
        key, version = sig[0], (sig[1], sig[2])
        if self._seen.get(key) == (version, False):
            self._seen[key] = (version, True)
            return _NOTE.format(path=path)
        # A first read, a changed file, or a second ask in a row: send it in full.
        self._seen[key] = (version, False)
        return files.read_file(working_dir, path)

    def clear(self) -> None:
        self._seen.clear()
