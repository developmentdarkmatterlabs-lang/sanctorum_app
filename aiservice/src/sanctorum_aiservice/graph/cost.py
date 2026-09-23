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

from typing import Any
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult


def _usage_from(result: LLMResult) -> tuple[str, int, int]:
    """(model, prompt_tokens, completion_tokens) from an LLMResult.

    Prefers `llm_output.token_usage` (what ChatLiteLLM sets from the provider's
    raw response) and falls back to the message's `usage_metadata`, which the
    streaming path populates instead. Returns zeros when neither is present.
    """
    out = result.llm_output or {}
    model = str(out.get("model") or "")

    usage = out.get("token_usage") or {}
    if isinstance(usage, dict) and usage:
        prompt = int(usage.get("prompt_tokens") or 0)
        completion = int(usage.get("completion_tokens") or 0)
        if prompt or completion:
            return model, prompt, completion

    # Fallback: usage_metadata on the generated message (streaming path).
    for generations in result.generations:
        for gen in generations:
            message = getattr(gen, "message", None)
            meta = getattr(message, "usage_metadata", None)
            if meta:
                return (
                    model,
                    int(meta.get("input_tokens") or 0),
                    int(meta.get("output_tokens") or 0),
                )
    return model, 0, 0


def price(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """USD for one call. 0.0 when the model is unknown to LiteLLM's price map."""
    if not model or (not prompt_tokens and not completion_tokens):
        return 0.0
    try:
        import litellm

        prompt_cost, completion_cost = litellm.cost_per_token(
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
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

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: UUID | None = None,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        try:
            model, prompt, completion = _usage_from(response)
            self.calls += 1
            self.prompt_tokens += prompt
            self.completion_tokens += completion
            self.total += price(model, prompt, completion)
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

    def summary(self) -> str:
        """The line emitted with `done`. Node parses the dollar figure out of it
        and stores it on the run, which is how a tree's spend is summed."""
        return (
            f"cost: ${self.total:.4f} "
            f"({self.calls} call(s), {self.prompt_tokens} in / {self.completion_tokens} out)"
        )
