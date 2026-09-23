r"""Builds the single-agent worker-evaluator LangGraph graph (Phase 3).

Phase 2 was chatbot <-> ToolNode. Phase 3 splits the chatbot's job in two and
loops:

    START -> worker --(tool calls)--> tools -> worker        (do the task)
                    \--(final answer)--> evaluator           (grade it)
    evaluator --(met | needs user | out of attempts)--> END
              \--(not yet)--> worker                         (retry with feedback)

The worker is the tool-calling node from Phase 2, now steered by a success
criterion and the evaluator's prior feedback. The evaluator is a second LLM call
with structured output (see evaluator.py). Supervision is unchanged: with
`interrupt_before=["tools"]` the graph still PAUSES before each tool call.

Sanctorum adaptations (same as Phase 2): ChatLiteLLM -> OpenRouter with the run's
model; tools from the clearance-gated ToolExecutor; SQLite checkpointer.
"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import SystemMessage
from langchain_litellm import ChatLiteLLM
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode

from ..config.settings import settings
from ..runtime.models import RunSpec
from ..tools.executor import ToolExecutor
from .checkpoint import checkpointer
from .evaluator import make_evaluator
from .state import State


def _worker_system_prompt(spec: RunSpec, state: State) -> str:
    """The worker's system prompt: the role, the success criterion, and — on a
    retry — the evaluator's feedback so the next attempt is criticism-driven."""
    prompt = (
        f"{spec.systemPrompt}\n\n"
        "Work toward this success criterion until you meet it or must ask the "
        f"user a question:\n{state.get('success_criteria', '')}\n\n"
        "Reply either with your final answer (no question), or — if you genuinely "
        "need input — a single clear question beginning with 'Question:'."
    )
    feedback = state.get("feedback_on_work")
    if feedback:
        prompt += (
            "\n\nYour previous attempt did NOT meet the success criteria. Feedback:\n"
            f"{feedback}\n\nRevise your work to address it."
        )
    # The voice goes LAST, after the criterion and any feedback: the persona sits
    # at the top of spec.systemPrompt, and by attempt three it is buried under
    # corrections and the model drifts back to its default assistant tone.
    if spec.personaReminder:
        prompt += f"\n\n{spec.personaReminder}"
    return prompt


def build_graph(
    spec: RunSpec, mcp_tools: list[Any] | None = None, cost: Any = None
) -> Any:
    """Compile the worker-evaluator graph for one run. Supervised runs interrupt
    before the tools node; hands-off runs run straight through.

    `mcp_tools` are the (already-fetched) tools of the run's external MCP servers
    (Phase 3.7). They're merged with the clearance-gated built-ins into one tool
    list — so MCP tools go through the same ToolNode + supervision gate."""
    executor = ToolExecutor(
        spec.policy,
        spec.serper_key(settings.serper_api_key),
        run_id=spec.runId,
        agent_key=spec.agentKey,
        # `generate_image` makes its own provider call, so it needs the key, the
        # image model, and the run's cost tracker — the LangChain callback cannot
        # see a direct completion, and unmetered spend escapes the tree ceiling.
        openrouter_key=spec.openrouter_key(settings.openrouter_api_key),
        # Cascade resolved by Node (agent -> global); the env default is the
        # last resort, for a run that named neither.
        image_model=spec.imageModel or settings.image_model,
        speech_model=spec.speechModel or settings.speech_model,
        cost_tracker=cost,
    )
    tools = [*executor.langchain_tools(), *(mcp_tools or [])]

    llm = ChatLiteLLM(
        model=spec.model or settings.default_model,
        api_key=spec.openrouter_key(settings.openrouter_api_key),
    )
    llm_with_tools = llm.bind_tools(tools) if tools else llm

    def worker(state: State) -> dict:
        # Rebuild the system message each turn so the criterion + latest feedback
        # are always current (replace the existing one if present).
        system = _worker_system_prompt(spec, state)
        msgs = [m for m in state["messages"] if not isinstance(m, SystemMessage)]
        msgs = [SystemMessage(content=system), *msgs]
        return {"messages": [llm_with_tools.invoke(msgs)]}

    def worker_router(state: State) -> str:
        """If the worker requested tools, run them; else send it to be graded."""
        last = state["messages"][-1]
        if getattr(last, "tool_calls", None):
            return "tools"
        return "evaluator"

    def route_after_eval(state: State) -> str:
        """Done when the criteria is met, the user is needed, or we're out of
        attempts; otherwise loop back to the worker with the feedback."""
        if state.get("success_criteria_met") or state.get("user_input_needed"):
            return "END"
        if state.get("attempts", 0) >= state.get("max_attempts", 3):
            return "END"  # ceiling reached — keep the best attempt
        return "worker"

    builder = StateGraph(State)
    builder.add_node("worker", worker)
    builder.add_node("tools", ToolNode(tools=tools))
    builder.add_node("evaluator", make_evaluator(spec))

    builder.add_conditional_edges(
        "worker", worker_router, {"tools": "tools", "evaluator": "evaluator"}
    )
    builder.add_edge("tools", "worker")
    builder.add_conditional_edges(
        "evaluator", route_after_eval, {"worker": "worker", "END": END}
    )
    builder.add_edge(START, "worker")

    interrupt_before = ["tools"] if spec.supervised else []
    return builder.compile(checkpointer=checkpointer, interrupt_before=interrupt_before)
