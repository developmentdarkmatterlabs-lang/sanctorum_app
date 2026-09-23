"""Where the service is allowed to write.

Mirrors `backend/paths.ts` on the Node side, and exists for the same reason: a
path computed from `__file__` is fine while running from a source checkout and
wrong the moment the app is packaged.

Frozen by PyInstaller, `__file__` points inside the bundle — `resources/aiservice/`
next to app.asar, under `Program Files` on Windows or inside a signed `.app` on
macOS. Those are read-only, and on macOS writing there breaks the code signature.
A module-level `sqlite3.connect()` against such a path raises at IMPORT time, so
the service would not fail gracefully later; it would never start.

Resolution order:
  1. SANCTORUM_DATA_DIR      explicit override; Electron passes the same
                             userData directory the backend gets, so both
                             services keep their state in one place.
  2. frozen                  per-user application data.
  3. source checkout         the package directory, as before — so running from
                             the repo behaves exactly as it always has.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _is_frozen() -> bool:
    """True when running from a PyInstaller bundle."""
    return getattr(sys, "frozen", False)


def _platform_data_dir() -> Path:
    """The OS's per-user application data directory."""
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")
    return Path(base) / "Sanctorum"


def data_dir() -> Path:
    """The directory this service may write to. Created if missing."""
    override = os.environ.get("SANCTORUM_DATA_DIR")
    if override:
        path = Path(override)
    elif _is_frozen():
        path = _platform_data_dir()
    else:
        # Source checkout: the package directory, which is where runs.db has
        # always lived. Keeps dev behaviour identical.
        path = Path(__file__).resolve().parent

    path.mkdir(parents=True, exist_ok=True)
    return path


def data_file(name: str) -> str:
    """Absolute path to a file in the writable data directory."""
    return str(data_dir() / name)
