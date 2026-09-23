"""The solo agent runner — now a LangGraph graph with optional supervision.

Phase 2: the hand-rolled LLM/tool loop is replaced by a LangGraph graph
(`graph/build.py`) driven by the supervise manager (`graph/supervise.py`), which
handles the pause/resume for human-in-the-loop. Clearance/executor/event-stream
all still hold — the graph's tools come from the gated executor, and progress is
streamed as RuntimeEvents.
"""

from __future__ import annotations

from ..config.settings import settings
from ..graph import supervise
from ..runtime.emitter import EventEmitter
from ..runtime.models import RunSpec
from .base import BaseAgent


class SoloAgent(BaseAgent):
    async def run(self, spec: RunSpec, emitter: EventEmitter) -> None:
        # A key from the app settings (rides the run) OR the service's env unblocks
        # the LLM. Only error if neither is present.
        if not spec.openrouter_key(settings.openrouter_api_key):
            await emitter.emit("started")
            await emitter.emit(
                "error",
                body="no LLM key configured (add one in Settings or set "
                "OPENROUTER_API_KEY) — cannot run.",
            )
            return
        await supervise.start(spec, emitter)


solo_agent = SoloAgent()
