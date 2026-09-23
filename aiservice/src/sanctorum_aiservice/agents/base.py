"""Base agent contract.

Phase-1 signature: an agent runs a RunSpec and emits RuntimeEvents. (Later phases
run agents as nodes in a LangGraph; the shape stays event-driven.)
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from ..runtime.emitter import EventEmitter
from ..runtime.models import RunSpec


class BaseAgent(ABC):
    @abstractmethod
    async def run(self, spec: RunSpec, emitter: EventEmitter) -> None:
        """Execute the task, streaming progress/results as events."""
        ...
