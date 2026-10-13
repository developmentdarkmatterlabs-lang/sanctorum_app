"""Per-run cost accounting (Phase 4).

Phase 1 called `litellm.completion(...)` directly and priced each response with
`LLM.cost_of`. Phase 2 replaced that loop with LangGraph + `ChatLiteLLM`, and
NOTHING has priced a call since: `cost_of` has no callers on the graph path. That
was harmless while cost was cosmetic — it is not harmless now, because Phase 4's
cost ceiling gates delegation. An unmeasured ceiling reads as $0.00 forever and
is silently unlimited, which is worse than having no ceiling at all: you'd trust
it.

So we meter the graph where every LLM call passes through anyway — a LangChain
callback handler. `ChatLiteLLM._create_chat_result` puts the provider's raw usage
and the resolved model into `LLMResult.llm_output`:

    llm_output = {"token_usage": {...}, "model": "openrouter/anthropic/..."}

which is exactly what `litellm.cost_per_token` prices. The handler is attached to
every `graph.invoke` for a run, so it sees the worker's calls, the evaluator's
structured-output call, and the criterion derivation alike.

Everything here is best-effort by design: a pricing failure must never break a
run. An unknown model simply contributes 0, and the ceiling behaves as if that
call were free (the run count cap still bounds the tree).
"""

from __future__ import annotations

from typing import Any, NamedTuple
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult


def _get(obj: Any, key: str) -> Any:
    """Read `key` from a dict or an object; LiteLLM hands us either."""
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


class CallUsage(NamedTuple):
    """One LLM call as the provider reported it."""

    model: str = ""
    prompt: int = 0
    completion: int = 0
    # Prompt tokens read from / written to the provider's cache (part of `prompt`).
    cached: int = 0
    written: int = 0
    # USD the provider itself billed, when it says (OpenRouter does). 0 = unknown.
    billed: float = 0.0


def _cached_from(usage: Any) -> int:
    """Prompt tokens served from the provider's cache (a subset of the prompt)."""
    cached = _get(usage, "cache_read_input_tokens")
    if not cached:
        cached = _get(_get(usage, "prompt_tokens_details"), "cached_tokens")
    return int(cached or 0)


def _written_from(usage: Any) -> int:
    """Prompt tokens written to the cache; billed above the normal input rate."""
    written = _get(usage, "cache_creation_input_tokens")
    if not written:
        written = _get(_get(usage, "prompt_tokens_details"), "cache_write_tokens")
    return int(written or 0)


def _billed_from(usage: Any) -> float:
    value = _get(usage, "cost")
    return float(value) if isinstance(value, (int, float)) and value > 0 else 0.0


def _usage_from(result: LLMResult) -> CallUsage:
    """The call's model, tokens and cache counts from an LLMResult.

    Prefers `llm_output.token_usage` (what ChatLiteLLM sets from the provider's
    raw response) and falls back to the message's `usage_metadata`, which the
    streaming path populates instead. Returns zeros when neither is present.
    """
    out = result.llm_output or {}
    model = str(out.get("model") or "")

    usage = out.get("token_usage")
    if usage:
        prompt = int(_get(usage, "prompt_tokens") or 0)
        completion = int(_get(usage, "completion_tokens") or 0)
        if prompt or completion:
            return CallUsage(
                model,
                prompt,
                completion,
                _cached_from(usage),
                _written_from(usage),
                _billed_from(usage),
            )

    # Fallback: usage_metadata on the generated message (streaming path).
    for generations in result.generations:
        for gen in generations:
            message = getattr(gen, "message", None)
            meta = getattr(message, "usage_metadata", None)
            if meta:
                details = meta.get("input_token_details") or {}
                return CallUsage(
                    model,
                    int(meta.get("input_tokens") or 0),
                    int(meta.get("output_tokens") or 0),
                    int(details.get("cache_read") or 0),
                    int(details.get("cache_creation") or 0),
                )
    return CallUsage(model)


def price(
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    cached_tokens: int = 0,
    written_tokens: int = 0,
) -> float:
    """USD for one call, cache reads and writes included. 0.0 for an unknown model."""
    if not model or (not prompt_tokens and not completion_tokens):
        return 0.0
    try:
        import litellm

        prompt_cost, completion_cost = litellm.cost_per_token(
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cache_read_input_tokens=cached_tokens,
            cache_creation_input_tokens=written_tokens,
        )
        return float(prompt_cost or 0.0) + float(completion_cost or 0.0)
    except Exception:  # noqa: BLE001 — an unpriceable model must not break a run
        return 0.0


class CostTracker(BaseCallbackHandler):
    """Accumulates the USD spend of every LLM call made during one run.

    One instance per run, attached to each `graph.invoke` via
    `config={"callbacks": [tracker]}`. LangGraph threads it through every node,
    so the worker, the evaluator and the tool loop all report into the same
    total.
    """

    def __init__(self) -> None:
        self.total: float = 0.0
        self.calls: int = 0
        self.prompt_tokens: int = 0
        self.completion_tokens: int = 0
        self.cached_tokens: int = 0
        # Per-call records not yet reported to Node; drained after each step.
        self._pending: list[dict[str, Any]] = []

    def _note(self, model: str, prompt: int, completion: int, cached: int, usd: float) -> None:
        self._pending.append(
            {
                "model": model,
                "promptTokens": prompt,
                "completionTokens": completion,
                "cachedTokens": cached,
                "cost": usd,
            }
        )

    def drain(self) -> list[dict[str, Any]]:
        """Hand over the calls recorded since the last drain, oldest first."""
        pending, self._pending = self._pending, []
        return pending

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: UUID | None = None,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        try:
            call = _usage_from(response)
            # The provider's own figure wins; the price map is the fallback.
            usd = call.billed or price(
                call.model, call.prompt, call.completion, call.cached, call.written
            )
            self.calls += 1
            self.prompt_tokens += call.prompt
            self.completion_tokens += call.completion
            self.cached_tokens += call.cached
            self.total += usd
            self._note(call.model, call.prompt, call.completion, call.cached, usd)
        except Exception:  # noqa: BLE001 — accounting never breaks the run
            pass

    def record(self, usd: float, *, prompt: int = 0, completion: int = 0) -> None:
        """Add a cost this handler could not observe.

        `on_llm_end` only fires for calls made THROUGH LangChain. A tool that
        calls a provider directly — `generate_image` does, because the agent's own
        model is not an image model — is invisible to the callback, so its spend
        would escape the tree's cost ceiling entirely. That is precisely the
        failure this module was written to remove, so the tool reports here
        instead.

        Best-effort like everything else here: a bad figure must never break a
        run, so a non-finite or negative value is dropped rather than raised.
        """
        try:
            amount = float(usd)
        except (TypeError, ValueError):
            return
        if amount <= 0 or amount != amount or amount == float("inf"):
            return
        self.total += amount
        self.calls += 1
        self.prompt_tokens += max(0, int(prompt or 0))
        self.completion_tokens += max(0, int(completion or 0))
        self._note("", max(0, int(prompt or 0)), max(0, int(completion or 0)), 0, amount)

    def summary(self) -> str:
        """The line emitted with `done`. Node parses the dollar figure out of it
        and stores it on the run, which is how a tree's spend is summed."""
        return (
            f"cost: ${self.total:.4f} "
            f"({self.calls} call(s), {self.prompt_tokens} in / {self.completion_tokens} out)"
        )
