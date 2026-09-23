"""The run_command tool, confined and env-limited.

Only reachable if `run_command` is in the grant's allowedTools (the executor
checks). cwd is pinned to the working directory; env is EXACTLY the grant's env
— never the host os.environ.
"""

from __future__ import annotations

import subprocess


def run_command(working_dir: str, env: dict[str, str], command: str) -> str:
    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=working_dir,
            env=env,  # grant env only — no host secrets
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        return "error: command timed out after 120s"
    except Exception as exc:  # noqa: BLE001
        return f"error: {exc}"

    out = (result.stdout or "").strip()
    err = (result.stderr or "").strip()
    parts = [f"exit code: {result.returncode}"]
    if out:
        parts.append(f"stdout:\n{out}")
    if err:
        parts.append(f"stderr:\n{err}")
    return "\n".join(parts)
