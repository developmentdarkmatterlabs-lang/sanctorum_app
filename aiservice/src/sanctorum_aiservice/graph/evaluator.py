"""The evaluator node and success-criterion derivation (Phase 3).

The evaluator is a SECOND LLM call that grades the worker's latest answer against
the success criterion, returning a typed `EvaluatorOutput` (met? / feedback /
needs-user?) via `with_structured_output`. The graph branches on that verdict:
met or needs-user -> END; otherwise loop back to the worker with the feedback.

`derive_criterion` turns the user's raw task into a one-line, testable criterion
when the user didn't supply one — so the UX stays "just send a task."

Both use the run's resolved model over LiteLLM/OpenRouter, same as the worker.
"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_litellm import ChatLiteLLM

from ..config.settings import settings
from ..runtime.models import RunSpec
from .content import as_text
from .schemas import CriterionOutput, EvaluatorOutput
from .state import State


def _llm(spec: RunSpec) -> ChatLiteLLM:
    return ChatLiteLLM(
        model=spec.model or settings.default_model,
        api_key=spec.openrouter_key(settings.openrouter_api_key),
    )


# Opens every retry message, so the evaluator can tell its own feedback from the user.
RETRY_PREFIX = "Your previous attempt did NOT meet the success criteria."


def derive_criterion(spec: RunSpec, tracker: Any = None) -> str:
    """One cheap LLM pass: turn the task into a single testable success criterion.
    Falls back to a generic criterion if the model output is unusable."""
    llm = _llm(spec).with_structured_output(CriterionOutput)
    system = (
        "You turn a user's task into ONE concrete, testable success criterion: a "
        "single sentence stating what a correct, complete answer must contain or "
        "do. Keep it specific and checkable; avoid vague words like 'good'."
    )
    try:
        out: Any = llm.invoke(
            [SystemMessage(content=system), HumanMessage(content=spec.task)],
            config={"callbacks": [tracker]} if tracker else None,
        )
        crit = (getattr(out, "success_criteria", "") or "").strip()
        return crit or _fallback_criterion(spec.task)
    except Exception:  # noqa: BLE001 — never let derivation crash the run
        return _fallback_criterion(spec.task)


def _fallback_criterion(task: str) -> str:
    return (
        f"The response fully and correctly addresses the task: {task.strip()} — "
        "accurate, complete, and directly responsive."
    )


def format_conversation(messages: list[Any]) -> str:
    """Render the message history as plain text for the evaluator prompt."""
    lines = ["Conversation history:", ""]
    for m in messages:
        if isinstance(m, HumanMessage):
            text = as_text(m.content)
            who = "Evaluator" if text.startswith(RETRY_PREFIX) else "User"
            lines.append(f"{who}: {text}")
        elif isinstance(m, AIMessage):
            text = as_text(m.content) or "[tool use]"
            lines.append(f"Assistant: {text}")
    return "\n".join(lines)


def make_evaluator(spec: RunSpec):
    """Build the evaluator node bound to this run's model."""
    llm = _llm(spec).with_structured_output(EvaluatorOutput)

    def evaluator(state: State) -> dict:
        last = state["messages"][-1]
        last_response = as_text(getattr(last, "content", ""))

        system = (
            "You are a strict but fair evaluator. Decide whether the assistant's "
            "last response meets the success criteria. Give concrete feedback and "
            "your verdict; flag if the assistant needs more input from the user."
        )
        user = (
            "You are evaluating a conversation between a User and an Assistant.\n\n"
            f"{format_conversation(state['messages'])}\n\n"
            f"The success criteria for this task is:\n{state['success_criteria']}\n\n"
            f"The Assistant's final response to evaluate is:\n{last_response}\n\n"
            "Respond with feedback and whether the criteria is met. Also decide if "
            "more user input is required (the assistant asked a question, needs a "
            "clarification, or is stuck)."
        )
        prior = state.get("feedback_on_work")
        if prior:
            user += (
                f"\n\nNote: in a prior attempt you gave this feedback: {prior}\n"
                "If the assistant is repeating the same mistakes, consider that "
                "user input may be required."
            )

        result: Any = llm.invoke(
            [SystemMessage(content=system), HumanMessage(content=user)]
        )
        attempts = state.get("attempts", 0) + 1
        update: dict = {
            "feedback_on_work": result.feedback,
            "success_criteria_met": result.success_criteria_met,
            "user_input_needed": result.user_input_needed,
            "attempts": attempts,
        }
        retry = (
            not result.success_criteria_met
            and not result.user_input_needed
            and attempts < state.get("max_attempts", 3)
        )
        if retry:
            # Feedback arrives as a message, so the system prompt (and its cache) stays fixed.
            note = f"{RETRY_PREFIX} Feedback:\n{result.feedback}\n\nRevise your work to address it."
            if spec.personaReminder:
                note += f"\n\n{spec.personaReminder}"
            update["messages"] = [HumanMessage(content=note)]
        return update

    return evaluator
