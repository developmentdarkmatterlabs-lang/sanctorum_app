"""A shared SQLite checkpointer so a supervised run's paused state survives.

When the graph interrupts (before a tool), LangGraph writes the state to this
checkpointer keyed by thread_id. A later resume (`graph.invoke(None, config)`)
restores it and continues — even if minutes passed. Persisting to a file (not
in-memory) means a pause also survives a service restart.
"""

from __future__ import annotations

import sqlite3

from langgraph.checkpoint.sqlite import SqliteSaver

from ..paths import data_file

# Distinct from Node's app.db. Resolved through `paths.data_file` rather than
# from __file__: this connect() runs at IMPORT time, and in a packaged app the
# bundle directory is read-only, so computing the path from __file__ would make
# the service fail to start rather than fail a run. From a source checkout the
# location is unchanged.
_DB_PATH = data_file("runs.db")

# check_same_thread=False: the graph runs in a worker thread (asyncio.to_thread).
_conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
checkpointer = SqliteSaver(_conn)

# A tiny sidecar table alongside the LangGraph checkpoint: the run's manifest (its
# RunSpec JSON), written when a run pauses. The checkpoint holds the graph STATE
# (messages); this holds what we need to REBUILD the graph + emitter — policy,
# model, thread/agent ids — so a decision can resume a run even if the service
# restarted and lost the in-memory registry. Deleted with the checkpoint on finish.
_conn.execute(
    "CREATE TABLE IF NOT EXISTS run_manifest (run_id TEXT PRIMARY KEY, spec_json TEXT NOT NULL)"
)
_conn.commit()


def save_manifest(run_id: str, spec_json: str) -> None:
    """Persist a paused run's RunSpec so it can be rehydrated after a restart."""
    try:
        _conn.execute(
            "INSERT OR REPLACE INTO run_manifest (run_id, spec_json) VALUES (?, ?)",
            (run_id, spec_json),
        )
        _conn.commit()
    except Exception as exc:  # noqa: BLE001
        print(f"[checkpoint] failed to save manifest {run_id}: {exc}", flush=True)


def load_manifest(run_id: str) -> str | None:
    """The stored RunSpec JSON for a run, or None if it has no manifest."""
    try:
        row = _conn.execute(
            "SELECT spec_json FROM run_manifest WHERE run_id = ?", (run_id,)
        ).fetchone()
        return row[0] if row else None
    except Exception as exc:  # noqa: BLE001
        print(f"[checkpoint] failed to load manifest {run_id}: {exc}", flush=True)
        return None


def delete_checkpoint(run_id: str) -> None:
    """Drop a finished run's saved state so runs.db doesn't grow unbounded.

    Called when a run reaches a terminal state (done/error): its checkpoint is no
    longer resumable, so keeping it just accumulates dead rows. A paused run is
    NEVER deleted — its state is the whole point. Best-effort: a failed cleanup
    must not break the run that just finished. Also drops the run's manifest.
    """
    try:
        checkpointer.delete_thread(run_id)
    except Exception as exc:  # noqa: BLE001
        print(f"[checkpoint] failed to delete {run_id}: {exc}", flush=True)
    try:
        _conn.execute("DELETE FROM run_manifest WHERE run_id = ?", (run_id,))
        _conn.commit()
    except Exception as exc:  # noqa: BLE001
        print(f"[checkpoint] failed to delete manifest {run_id}: {exc}", flush=True)
