"""The graph's shared state for the worker-evaluator loop (Phase 3).

Phase 2 used just `{messages}`. Phase 3 carries the loop's working data: the
success criterion the worker aims at, the evaluator's latest feedback, whether it
passed / needs the user, and an attempt counter to cap retries.

Only `messages` uses the `add_messages` reducer (append). The rest are plain
values overwritten each update — the evaluator sets them fresh every pass.
"""

from __future__ import annotations

from typing import Annotated, Optional

from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


class State(TypedDict):
    messages: Annotated[list, add_messages]
    # The one-line bar the worker's answer must clear (derived or user-supplied).
    success_criteria: str
    # The evaluator's feedback from the last grade, injected into the worker's
    # next attempt. None before the first evaluation.
    feedback_on_work: Optional[str]
    # The evaluator's verdict on the last answer.
    success_criteria_met: bool
    # True when the worker asked a question / needs clarification / is stuck.
    user_input_needed: bool
    # How many worker->evaluator rounds have completed; caps retries.
    attempts: int
    # The ceiling: stop retrying past this many attempts (best answer wins).
    max_attempts: int
