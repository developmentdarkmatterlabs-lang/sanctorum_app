"""Streams RuntimeEvents back to the Node backend.

The backend's `/api/runtime/events` webhook (built in Phase 5) turns each event
into a thread message and drives the agent's "running" marker. This is the
out-of-process path: the service returns 202 from /run immediately, then reports
progress here as it happens.
"""

from __future__ import annotations

import datetime

import httpx

from ..config.settings import settings
from .models import RuntimeEvent, RuntimeEventType


class EventEmitter:
    """Posts events for one run. Awaiting each POST preserves ordering."""

    def __init__(self, run_id: str, thread_id: str, agent_key: str | None) -> None:
        self._run_id = run_id
        self._thread_id = thread_id
        self._agent_key = agent_key
        self._url = f"{settings.backend_url.rstrip('/')}/api/runtime/events"

    async def emit(
        self,
        type_: RuntimeEventType,
        body: str | None = None,
        ref: str | None = None,
    ) -> None:
        # Defense in depth: `body` is typed str, but a caller might hand us a
        # non-string (e.g. a reasoning model's block-list content). Coerce here so
        # a stray shape can never crash a run at RuntimeEvent validation.
        if body is not None and not isinstance(body, str):
            body = str(body)
        event = RuntimeEvent(
            runId=self._run_id,
            threadId=self._thread_id,
            agentKey=self._agent_key,
            type=type_,
            body=body,
            ref=ref,
            at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        )
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(self._url, json=event.model_dump(exclude_none=True))
        except Exception as exc:  # noqa: BLE001 — never let a failed POST crash a run
            # The run continues; a dropped event just won't appear in the inbox.
            print(f"[emitter] failed to POST {type_} event: {exc}", flush=True)
