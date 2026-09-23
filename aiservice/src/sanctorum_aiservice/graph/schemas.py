"""Typed outputs for the worker-evaluator loop (Phase 3).

The worker does the task; the evaluator GRADES it against a one-line success
criterion and returns typed feedback — not prose — so the graph can branch on it
(`with_structured_output`). A separate tiny schema lets us derive the criterion
from the user's task when the user didn't supply one.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class EvaluatorOutput(BaseModel):
    """The evaluator's verdict on the worker's latest answer."""

    feedback: str = Field(
        description="Concrete feedback on the worker's response — what is good, "
        "and specifically what must change to meet the success criteria."
    )
    success_criteria_met: bool = Field(
        description="True only if the worker's response fully satisfies the "
        "success criteria."
    )
    user_input_needed: bool = Field(
        description="True if the worker asked the user a question, needs a "
        "clarification, or is stuck and cannot proceed without help."
    )


class CriterionOutput(BaseModel):
    """A one-line success criterion derived from the user's task."""

    success_criteria: str = Field(
        description="A single, concrete sentence stating what a correct, complete "
        "answer to the task must contain or do — testable, not vague."
    )
