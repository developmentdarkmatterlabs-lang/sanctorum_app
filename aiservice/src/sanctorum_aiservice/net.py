"""Port cleanup — frees the service's port before binding.

On Windows especially, a uvicorn process that didn't shut down cleanly can keep
the port held, so the next start fails with WinError 10048. Because the root
`dev:all` uses concurrently --kill-others, that one failure tears down the backend
and frontend too. Freeing the port on startup makes the service self-heal.

This only ever kills a process that is LISTENING on our own port — never anything
else.
"""

from __future__ import annotations

import subprocess
import sys


def free_port(port: int) -> None:
    """Best-effort: kill whatever is listening on `port`. Silent on failure."""
    try:
        if sys.platform == "win32":
            _free_port_windows(port)
        else:
            _free_port_posix(port)
    except Exception as exc:  # noqa: BLE001 — never block startup on cleanup
        print(f"[net] could not free port {port}: {exc}", flush=True)


def _free_port_windows(port: int) -> None:
    # netstat lists connections; find the LISTENING one on our port and taskkill it.
    out = subprocess.run(
        ["netstat", "-ano"], capture_output=True, text=True, timeout=10
    ).stdout
    pids: set[str] = set()
    needle = f":{port}"
    for line in out.splitlines():
        parts = line.split()
        # e.g.  TCP    127.0.0.1:8000   0.0.0.0:0   LISTENING   12140
        if len(parts) >= 5 and parts[3] == "LISTENING" and parts[1].endswith(needle):
            pid = parts[-1]
            if pid.isdigit() and pid != "0":
                pids.add(pid)
    for pid in pids:
        subprocess.run(["taskkill", "/PID", pid, "/F"], capture_output=True, timeout=10)
        print(f"[net] freed port {port} (killed PID {pid})", flush=True)


def _free_port_posix(port: int) -> None:
    result = subprocess.run(
        ["lsof", "-ti", f"tcp:{port}", "-sTCP:LISTEN"],
        capture_output=True,
        text=True,
        timeout=10,
    )
    for pid in result.stdout.split():
        if pid.isdigit():
            subprocess.run(["kill", "-9", pid], capture_output=True, timeout=10)
            print(f"[net] freed port {port} (killed PID {pid})", flush=True)
