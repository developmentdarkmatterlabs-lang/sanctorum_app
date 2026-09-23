"""The `delegate` tool — hand a piece of work to one of your reports (Phase 4).

This does NOT run the subordinate here. It calls back into Node, which:

  1. validates the target (same team, your report, you hold the leader seat),
  2. checks the tree's depth / run-count / cost budget,
  3. spawns a CHILD RUN built from the SUBORDINATE'S seat.

That last point is the whole design: the child's capability grant comes from its
own seat, so clearance is never inherited. A lead with `run_command` delegating
"run the tests" to a clearance-2 intern produces a refusal inside the child run,
not execution.

Everything here returns a string for the model to read. A refusal ("not one of
your reports", "run limit reached") is a normal, expected result the leader must
adapt to — never an exception, which would abort an otherwise healthy run.
"""

from __future__ import annotations

import httpx

from ..config.settings import settings


async def delegate(run_id: str, agent_key: str | None, position_id: str, task: str) -> str:
    """Delegate `task` to the seat `position_id`. Returns the tool result text."""
    url = f"{settings.backend_url.rstrip('/')}/api/runtime/runs/{run_id}/delegate"
    payload = {"agentKey": agent_key or "", "positionId": position_id, "task": task}

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, json=payload)
            data = response.json()
    except Exception as exc:  # noqa: BLE001 — a transport failure is a refusal
        return f"error: could not delegate: {exc}"

    if not isinstance(data, dict):
        return "error: the delegation service returned an unexpected response."

    if not data.get("ok"):
        return f"refused: {data.get('reason') or 'delegation was refused.'}"

    remaining = data.get("remaining", -1)
    budget = (
        "There is no run limit on this task."
        if not isinstance(remaining, int) or remaining < 0
        else f"{remaining} more delegation(s) fit in this task's budget."
    )
    return (
        f"Delegated to {data.get('agentName', 'your report')} "
        f"(run {str(data.get('childRunId', ''))[:8]}). They are working on it now; "
        f"their report will come back to you for review before you continue. {budget}"
    )
