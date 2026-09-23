"""LiteLLM wrapper — provider-agnostic LLM calls, routed to OpenRouter.

Switching models is a settings change (any `openrouter/...` string), never a code
change. LiteLLM also surfaces token/cost, captured here for Phase-1 logging and
future per-run cost reporting.
"""

from __future__ import annotations

from typing import Any

import litellm

from ..config.settings import settings


class LLM:
    def __init__(self, model: str | None = None) -> None:
        self._model = model or settings.default_model

    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> Any:
        """One chat completion. Returns the raw LiteLLM response.

        The caller inspects `.choices[0].message` for content and tool_calls, and
        `.usage` / `._hidden_params` for cost. Keeping the raw response avoids
        hiding provider details the agent loop needs.
        """
        kwargs: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "api_key": settings.openrouter_api_key,
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        return litellm.completion(**kwargs)

    @staticmethod
    def cost_of(response: Any) -> float:
        """Best-effort USD cost of a response; 0.0 if unavailable."""
        try:
            return float(litellm.completion_cost(completion_response=response) or 0.0)
        except Exception:  # noqa: BLE001
            return 0.0
