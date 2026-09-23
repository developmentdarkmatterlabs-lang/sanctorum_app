"""PyInstaller entry point for the frozen AI service.

WHY THIS FILE EXISTS. `sanctorum_aiservice/api/main.py` imports with relative
paths (`from ..config.settings import settings`), which is correct for a module
inside a package and is how `python -m sanctorum_aiservice.api.main` runs it.

PyInstaller does not run the entry point as a package module — it executes it as
a top-level script, where a relative import has no parent package to resolve
against. Pointing the spec at main.py directly fails at startup with:

    ImportError: attempted relative import with no known parent package

So the frozen binary starts HERE instead, and imports the real entry point by its
absolute package path. That keeps the source honest: nothing in the package is
reshaped to suit the packaging tool.
"""

from __future__ import annotations

from sanctorum_aiservice.api.main import main

if __name__ == "__main__":
    main()
