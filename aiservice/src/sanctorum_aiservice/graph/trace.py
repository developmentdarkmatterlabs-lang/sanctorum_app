"""Delegation tracing (Phase 4 debugging).

The delegation loop spans two processes — the leader's graph steps here, the
child runs are spawned by Node, and the resume comes back over HTTP. When
something goes wrong (a duplicate child, a leader that never resumes) the
symptom appears in one process and the cause in the other, so the only way to
read it is a timestamped trace from both sides with the run id on every line.

Enable with `SANCTORUM_TRACE=1` in aiservice/.env (or the environment). Off by
default: these lines are verbose and only useful while debugging the handoff.

Format:  [trace 12:34:56.789] ad9f671d STEP park-after-delegate | children=1
         └ time              └ run id  └ event  └ detail
"""

from __future__ import annotations

import datetime
import os


_OFF = ("", "0", "false", "False")


def enabled() -> bool:
    """True when tracing is switched on.

    Checks the process environment FIRST (so it can be flipped for one launch),
    then the service's own settings — which is what actually loads aiservice/.env.
    Reading os.environ alone would silently ignore the .env setting, and the
    trace would just never appear.
    """
    raw = os.environ.get("SANCTORUM_TRACE")
    if raw is not None:
        return raw.strip() not in _OFF
    try:
        from ..config.settings import settings

        return str(getattr(settings, "sanctorum_trace", "")).strip() not in _OFF
    except Exception:  # noqa: BLE001 — tracing must never break a run
        return False


def trace(run_id: str, event: str, detail: str = "") -> None:
    """One trace line. Never raises — debugging output must not break a run."""
    if not enabled():
        return
    try:
        now = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
        short = (run_id or "--------")[:8]
        tail = f" | {detail}" if detail else ""
        print(f"[trace {now}] {short} {event}{tail}", flush=True)
    except Exception:  # noqa: BLE001
        pass
