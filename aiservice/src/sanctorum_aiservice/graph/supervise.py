"""Runs the agent graph and manages supervised pause / resume.

The flow, for a supervised run:
  start -> graph runs until it INTERRUPTS before a tool -> we read the pending
  tool call, emit `awaiting_approval` describing it, and STOP (state is
  checkpointed). The user's decision arrives later:
    - proceed -> resume the graph; it runs the tool, loops, and either interrupts
      again (next tool) or finishes;
    - stop    -> abandon the run;
    - edit    -> replace the pending step with a fresh instruction, then resume.
Hands-off runs never interrupt, so `start` drives straight to the finish.

We keep a small registry of in-flight runs (their compiled graph + config +
emitter) so a decision can resume the right one. LangGraph's checkpointer holds
the actual state; this registry just holds the live objects.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from typing import Any

from langchain_core.messages import HumanMessage, ToolMessage

from ..config.settings import settings
from ..runtime.emitter import EventEmitter
from ..runtime.models import RunSpec
from ..mcp.client import load_mcp_tools
from .build import build_graph
from .checkpoint import delete_checkpoint, load_manifest, save_manifest
from .content import as_text
from .cost import CostTracker
from .trace import trace
from .evaluator import derive_criterion


async def _build_with_mcp(
    spec: RunSpec, emitter: EventEmitter, cost: CostTracker | None = None
) -> Any:
    """Build the run's graph, first fetching its external MCP servers' tools and
    merging them in. MCP failures are isolated (skipped + a status note), so a bad
    server never blocks the run."""
    mcp_tools: list[Any] = []
    if spec.mcpServers:
        mcp_tools, notes = await load_mcp_tools(spec)
        for note in notes:
            await emitter.emit("status", body=note)
        if mcp_tools:
            names = ", ".join(sorted({getattr(t, "name", "?") for t in mcp_tools}))
            await emitter.emit("status", body=f"MCP tools available: {names}")
    return build_graph(spec, mcp_tools, cost)


def _finish(run_id: str) -> None:
    """Drop a terminated run from the live registry AND purge its checkpoint.

    Every terminal path (done, error, stop, failed edit) routes through here, so a
    finished run leaves nothing behind in memory or in runs.db. A still-paused run
    must never call this — its checkpoint is what a resume restores."""
    _runs.pop(run_id, None)
    delete_checkpoint(run_id)


@dataclass
class _Run:
    graph: Any
    config: dict
    emitter: EventEmitter
    spec: RunSpec
    # Set by a hard cancel (stop mid-flow). Checked between steps so the loop
    # abandons the run instead of pausing or continuing. A tool already running
    # in a worker thread finishes, but no further step is taken.
    cancelled: bool = field(default=False)
    # The evaluator attempt count we've already surfaced, so a new grade emits
    # exactly one `attempt` event (Phase 3 loop observability).
    reported_attempts: int = field(default=0)
    # Phase 4 — meters every LLM call this run makes. Its total rides the `done`
    # event, which Node stores on the run; a tree's spend is the sum over its
    # runs, and that is what gates further delegation. Rebuilt (from zero) after
    # a restart: the tokens spent before the restart were already reported.
    cost: CostTracker = field(default_factory=CostTracker)
    # Phase 4 — True between "this run delegated" and "its reports came back".
    # While set, the run is PARKED: no approval decision may step the graph, or
    # the leader would keep planning while its reports are still working and
    # spawn duplicate children (three `world.md` writers, in the bug that made
    # this necessary). Cleared by the reports-delivering resume, which arrives as
    # decide('edit') from Node's maybeResumeParent.
    awaiting_reports: bool = field(default=False)
    # Serializes _advance for this run. `decide` is dispatched as a FastAPI
    # BACKGROUND TASK, so two decisions arriving close together would otherwise
    # run two _advance loops over the SAME graph + checkpoint concurrently: each
    # reads its own stale message count, re-plans, and calls the tool again. That
    # is how one approval round spawned three duplicate children.
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    # True while a step is executing. A decision arriving now is a DUPLICATE of
    # the one being processed (the UI's approval bar lingers during the LLM call,
    # so a second click is the expected human behaviour, not a mistake) — it is
    # DROPPED rather than queued, because queueing would just run the same stale
    # approval a moment later.
    stepping: bool = field(default=False)


_runs: dict[str, _Run] = {}


async def _rebuild_run(run_id: str) -> _Run | None:
    """Reconstruct a run from its persisted manifest after a restart lost the
    in-memory registry. The checkpoint still holds the graph STATE; the manifest
    holds the RunSpec, so we can rebuild the graph + emitter and resume. Returns
    None if there's no manifest (nothing to resume)."""
    spec_json = load_manifest(run_id)
    if not spec_json:
        return None
    spec = RunSpec.model_validate_json(spec_json)
    config = {"configurable": {"thread_id": spec.runId}}
    emitter = EventEmitter(spec.runId, spec.threadId, spec.agentKey)
    # The tracker is built FIRST so `generate_image` can report into the very
    # instance that rides `done` — a second tracker would meter into a total
    # nobody reads, and the image spend would vanish from the tree's ceiling.
    cost = CostTracker()
    graph = await _build_with_mcp(spec, emitter, cost)
    run = _Run(graph=graph, config=config, emitter=emitter, spec=spec, cost=cost)
    # Sync the evaluation counter to the checkpointed state so a resume doesn't
    # re-announce grades that already happened before the restart.
    try:
        run.reported_attempts = graph.get_state(config).values.get("attempts", 0)
    except Exception:  # noqa: BLE001
        pass
    _runs[run_id] = run
    return run


def _terminal_line_for_tool_call(tc: dict) -> str:
    """A `$ ...` line describing a pending tool call, for awaiting_approval."""
    name = tc.get("name", "tool")
    args = tc.get("args", {}) or {}
    if name == "run_command":
        return f"$ {args.get('command', '')}"
    if name in ("read_file", "list_dir", "write_file", "edit_file"):
        return f"$ {name} {args.get('path', '')}".rstrip()
    if name == "search":
        return f"$ search {args.get('query', '')}"
    inner = ", ".join(f"{k}={v}" for k, v in args.items())
    return f"$ {name}({inner})"


def _pending_tool_calls(graph: Any, config: dict) -> list[dict]:
    """The tool calls the graph is interrupted before, if any."""
    state = graph.get_state(config)
    if not state.next or "tools" not in state.next:
        return []
    msgs = state.values.get("messages", [])
    last = msgs[-1] if msgs else None
    return list(getattr(last, "tool_calls", None) or [])


async def _drain_after_step(run: _Run, before_count: int) -> None:
    """Emit terminal-style output for any tool messages produced since
    `before_count`, plus new assistant prose."""
    state = run.graph.get_state(run.config)
    msgs = state.values.get("messages", [])
    for m in msgs[before_count:]:
        mtype = getattr(m, "type", None)
        if mtype == "tool":
            # Content may be a block list (reasoning models) — coerce to text.
            body = as_text(getattr(m, "content", "")).rstrip()
            if body:
                await run.emitter.emit("status", body=body)
        elif mtype == "ai":
            # Assistant prose with no tool calls is a (possibly final) message.
            content = as_text(getattr(m, "content", ""))
            if content and not getattr(m, "tool_calls", None):
                await run.emitter.emit("message", body=content)


def _delegated_in_step(run: _Run, before_count: int) -> bool:
    """True when the step just completed dispatched work to a report (Phase 4).

    Looks for a `delegate` ToolMessage added since `before_count` whose result is
    NOT a refusal. A refused delegation ("not one of your reports", "run limit
    reached") must NOT park the leader — nothing is coming back, so it has to keep
    going and adapt. Only a real dispatch means a report is now working.
    """
    try:
        msgs = run.graph.get_state(run.config).values.get("messages", [])
    except Exception:  # noqa: BLE001 — never let this check break a run
        return False
    for m in msgs[before_count:]:
        if getattr(m, "type", None) != "tool":
            continue
        if getattr(m, "name", None) != "delegate":
            continue
        body = as_text(getattr(m, "content", "")).lstrip().lower()
        if body.startswith("refused:") or body.startswith("error:"):
            continue
        return True
    return False


def _msg_count(graph: Any, config: dict) -> int:
    state = graph.get_state(config)
    return len(state.values.get("messages", []))


async def _surface_evaluation(run: _Run) -> None:
    """Emit an `evaluated` event for each grade the evaluator produced since we
    last looked, so the loop is visible: pass/fail, the feedback, and whether a
    retry is coming. Fires once per new attempt (the evaluator bumps `attempts`)."""
    state = run.graph.get_state(run.config)
    v = state.values
    attempts = v.get("attempts", 0)
    if attempts <= run.reported_attempts:
        return  # no new evaluation this step
    run.reported_attempts = attempts

    met = bool(v.get("success_criteria_met"))
    needs_user = bool(v.get("user_input_needed"))
    feedback = (v.get("feedback_on_work") or "").strip()
    max_attempts = v.get("max_attempts", 3)

    if met:
        verdict = "met the criteria"
    elif needs_user:
        verdict = "needs your input"
    elif attempts >= max_attempts:
        verdict = f"did not meet the criteria — out of attempts ({attempts}/{max_attempts})"
    else:
        verdict = f"not yet — revising (attempt {attempts}/{max_attempts})"

    body = f"attempt {attempts}/{max_attempts}: {verdict}"
    if feedback and not met:
        body += f"\n{feedback}"
    await run.emitter.emit("evaluated", body=body)


async def start(spec: RunSpec, emitter: EventEmitter) -> None:
    """Begin a run. Drives the worker-evaluator loop to its first interrupt or to
    completion, deriving the success criterion first if the user didn't set one."""
    await emitter.emit("started")
    await emitter.emit(
        "status",
        body=(
            f"picked up the task. Clearance {spec.policy.clearance}; "
            f"tools: {', '.join(spec.policy.allowedTools) or 'none'}."
        ),
    )

    # Ensure the confined workspace exists before any tool touches it.
    try:
        os.makedirs(spec.policy.workingDir, exist_ok=True)
    except Exception as exc:  # noqa: BLE001
        await emitter.emit("error", body=f"could not prepare workspace: {exc}")
        return

    # The bar the worker aims at: user-supplied if given, else derived from the
    # task (one cheap LLM pass). Surfaced so the user sees what it's judged against.
    criterion = (spec.successCriteria or "").strip()
    if not criterion:
        criterion = await asyncio.to_thread(derive_criterion, spec)
    max_attempts = spec.maxAttempts or 3
    await emitter.emit("criteria", body=criterion)

    # Built BEFORE the graph so `generate_image` reports into the very instance
    # that rides `done`. A tool making its own provider call is invisible to the
    # LangChain callback, so without this the image spend escapes the tree's cost
    # ceiling entirely — which is the failure the ceiling exists to prevent.
    cost = CostTracker()
    graph = await _build_with_mcp(spec, emitter, cost)
    config = {"configurable": {"thread_id": spec.runId}}
    run = _Run(graph=graph, config=config, emitter=emitter, spec=spec, cost=cost)
    _runs[spec.runId] = run

    # The worker owns the system prompt (rebuilt each turn with criterion +
    # feedback), so we seed only the user task plus the loop's state fields.
    initial = {
        "messages": [{"role": "user", "content": spec.task}],
        "success_criteria": criterion,
        "feedback_on_work": None,
        "success_criteria_met": False,
        "user_input_needed": False,
        "attempts": 0,
        "max_attempts": max_attempts,
    }
    # Same serialization as `decide`: the very first approval can arrive while the
    # opening step is still running, and must not start a second _advance.
    async with run.lock:
        run.stepping = True
        try:
            await _advance(run, initial)
        finally:
            run.stepping = False


def _all_auto_approved(pending: list[dict], spec: RunSpec | None = None) -> bool:
    """True when every pending tool call may run without pausing.

    Two sources of exemption:
      - the deployment's auto-approve list (read-only tools, opt-in, empty by
        default);
      - `delegate`, when this run's agent is a TRUSTED DELEGATOR (Phase 4).

    A mixed step (one exempt + one consequential) is NOT auto-approved — it
    pauses like any other, so trusting a leader to fan out never quietly
    approves a `write_file` that happens to share the step.
    """
    if not pending:
        return False
    allow = set(settings.auto_approve)
    # Trust removes the CLICK, not the ceiling: Node still checks the same-team
    # target rule and the depth/run/cost caps on every delegation.
    if spec is not None and spec.trustedDelegator:
        allow.add("delegate")
    return all(tc.get("name") in allow for tc in pending)


def _explain(exc: Exception, spec: RunSpec) -> str:
    """Turn a provider error into something the user can act on.

    A model that cannot call tools fails with a raw LiteLLM/OpenRouter 404 —
    several hundred characters of nested JSON whose actionable content is one
    clause. Sanctorum ALWAYS sends the seat's tool schemas (capability comes from
    the position), so picking a search-only model for a seated agent is an easy
    mistake with an unreadable symptom.

    Anything we do not recognise is passed through verbatim: a vague guess would
    be worse than the real error.
    """
    text = str(exc)
    low = text.lower()

    if "no endpoints found that support tool use" in low or (
        "tool" in low and "not support" in low
    ):
        return (
            f"the model '{spec.model}' does not support tool use, and this agent's "
            "seat grants tools — so every run sends them and the provider refuses. "
            "Pick a model showing the 'tools' badge in the model picker. "
            f"(provider said: {text})"
        )

    if "no endpoints found" in low:
        return (
            f"no provider is currently serving '{spec.model}' with the options this "
            f"run needs. Try another model. (provider said: {text})"
        )

    if "insufficient" in low and "credit" in low:
        return f"the OpenRouter account has no credit left. (provider said: {text})"

    return text


async def _advance(run: _Run, graph_input: Any) -> None:
    """Run the graph from the given input (initial state, or None to resume),
    then pause at the next interrupt, auto-run a safe step, or finish. Loops so
    consecutive auto-approved steps flow without a round-trip to the user."""
    trace(run.spec.runId, "ADVANCE-enter", f"input={'initial' if graph_input is not None else 'resume'}")
    while True:
        # A hard cancel between steps abandons the run before doing more work.
        if run.cancelled:
            await run.emitter.emit("status", body="run stopped by user.")
            await run.emitter.emit("done", body=run.cost.summary())
            _finish(run.spec.runId)
            return

        before = 0 if graph_input is not None else _msg_count(run.graph, run.config)
        # Phase 4 — meter this step. The callback rides the invoke config so every
        # LLM call inside the graph (worker, evaluator, tool loop) is priced into
        # the run's running total.
        step_config = {**run.config, "callbacks": [run.cost]}
        try:
            await asyncio.to_thread(run.graph.invoke, graph_input, step_config)
        except Exception as exc:  # noqa: BLE001
            await run.emitter.emit("error", body=f"run failed: {_explain(exc, run.spec)}")
            _finish(run.spec.runId)
            return

        trace(run.spec.runId, "STEP-done", f"msgs {before}->{_msg_count(run.graph, run.config)}")
        await _drain_after_step(run, before)
        await _surface_evaluation(run)

        # Phase 4 — BACKPRESSURE. If the step just dispatched work to a report,
        # PARK here. The child runs out-of-process over seconds or minutes; if we
        # kept stepping, the leader would immediately read a file its report has
        # not written yet, get "not a file", and poll in a loop — paying for an
        # LLM call (and, when supervised, an approval click) each time round.
        #
        # This is the "interrupt" half of interrupt-and-resume. The resume half
        # already exists: Node's maybeResumeParent calls decide('edit') with the
        # reports once every child finishes, which re-enters _advance. Parking is
        # just a return — the checkpoint holds the state, exactly as it does for
        # an approval pause, so a restart can still rehydrate from the manifest.
        if _delegated_in_step(run, before):
            trace(run.spec.runId, "PARK", "delegated -> waiting for reports")
            run.awaiting_reports = True
            save_manifest(run.spec.runId, run.spec.model_dump_json())
            await run.emitter.emit(
                "status", body="waiting for the report(s) to come back…"
            )
            return

        pending = _pending_tool_calls(run.graph, run.config)
        if not pending:
            trace(run.spec.runId, "FINISH", "no pending tool calls")
            # No pending tool -> the run finished.
            await run.emitter.emit("done", body=run.cost.summary())
            _finish(run.spec.runId)
            return

        if _all_auto_approved(pending, run.spec):
            # Selective supervision: every proposed call is read-only, so run it
            # without pausing. Note it, then loop to resume (graph_input=None).
            step = "; ".join(_terminal_line_for_tool_call(tc) for tc in pending)
            await run.emitter.emit("status", body=f"auto-approved (read-only): {step}")
            graph_input = None
            continue

        # A consequential step: persist the manifest so a restart can rehydrate,
        # then describe the proposed step and wait for the user's decision.
        save_manifest(run.spec.runId, run.spec.model_dump_json())
        step = "; ".join(_terminal_line_for_tool_call(tc) for tc in pending)
        names = ",".join(tc.get("name", "?") for tc in pending)
        trace(run.spec.runId, "PAUSE", f"awaiting approval: {names}")
        await run.emitter.emit("awaiting_approval", body=step)
        return


async def decide(
    run_id: str, decision: str, edited: str | None, reports_ready: bool = False
) -> None:
    """Resume or cancel a paused run per the user's decision.

    `reports_ready` marks the ONE resume that delivers a parked leader its
    reports (Phase 4). Node sets it on the decide() it sends from
    maybeResumeParent; a human approval never carries it."""
    trace(
        run_id,
        "DECIDE",
        f"{decision}{' (with text)' if edited else ''}{' [reports]' if reports_ready else ''}",
    )
    run = _runs.get(run_id)
    if run is None:
        # Not in memory — the service may have restarted while this run was paused.
        # Rebuild it from its manifest + checkpoint and carry on.
        run = await _rebuild_run(run_id)
        if run is None:
            return  # unknown / already finished / no manifest to resume from

    # `stop` is the one decision that must ALWAYS get through, even mid-step —
    # it is the user's escape hatch. It only flags + finalizes; it never steps
    # the graph, so it cannot race with an in-flight _advance.
    if decision == "stop":
        run.cancelled = True
        await run.emitter.emit("status", body="run stopped by user.")
        await run.emitter.emit("done", body=run.cost.summary())
        _finish(run_id)
        return

    # A decision that lands while this run is already stepping is a duplicate of
    # the one in flight (see `stepping`). Drop it: queueing it on the lock would
    # replay a stale approval against a graph that has already moved on.
    if run.stepping:
        trace(run_id, "DECIDE-dropped", f"{decision} while a step is in flight")
        return

    # Phase 4 — a PARKED leader (one that has delegated and is waiting on its
    # reports) may only be stepped by the reports coming back. The reports arrive
    # as decide('edit') from Node's maybeResumeParent, carrying the digest; that
    # is `reports_ready`. Anything else here is a stale approval for a step the
    # leader proposed BEFORE it parked — stepping on it would let the leader keep
    # planning while its reports are still working, and it would delegate the
    # same task again. (That is exactly how one round produced three duplicate
    # `world.md` writers.) Ignore it; the run resumes when the reports land.
    if run.awaiting_reports and not reports_ready:
        trace(run_id, "DECIDE-ignored", f"{decision} while awaiting reports")
        return

    if reports_ready:
        run.awaiting_reports = False

    if decision == "edit" and edited:
        # The graph is parked before `tools`, so the last message is an AI turn
        # with unanswered tool_calls. We can't just append a user message — a
        # tool-calling turn MUST be followed by a ToolMessage for each call, or
        # the provider rejects the history. So we ANSWER each pending call with a
        # "superseded" ToolMessage, THEN add the revised instruction, then resume.
        # The model sees its proposed step was cancelled and re-plans from the edit.
        try:
            pending = _pending_tool_calls(run.graph, run.config)
            supersede = [
                ToolMessage(
                    content="Superseded by the user before running.",
                    tool_call_id=tc.get("id", ""),
                )
                for tc in pending
                if tc.get("id")
            ]
            # as_node="tools": write these AS the tools node's output, so the
            # resume proceeds to `chatbot` (re-plan) instead of re-entering the
            # tools node and running the superseded call for real.
            run.graph.update_state(
                run.config,
                {"messages": [*supersede, HumanMessage(content=edited)]},
                as_node="tools",
            )
        except Exception as exc:  # noqa: BLE001 — surface, don't die silently
            await run.emitter.emit("error", body=f"could not apply edit: {exc}")
            _finish(run_id)
            return

    # proceed (or edit): resume the graph from the checkpoint. The lock is what
    # actually guarantees one-at-a-time; `stepping` is the fast path that lets a
    # duplicate be dropped instead of waiting.
    async with run.lock:
        run.stepping = True
        try:
            await _advance(run, None)
        finally:
            run.stepping = False


async def cancel(run_id: str) -> None:
    """Hard stop: abandon a run whether it's paused OR mid-flight.

    Unlike a `stop` decision (which only lands at an approval pause), this flags a
    live run so its loop abandons at the next step boundary — useful to interrupt a
    long, auto-approved read loop. A tool ALREADY running in the worker thread runs
    to its end (we don't kill the subprocess); nothing after it does. If the run is
    only paused (not looping), we finalize it here."""
    run = _runs.get(run_id)
    if run is None:
        # Paused across a restart: rebuild just to emit a clean stop + clean up.
        run = await _rebuild_run(run_id)
        if run is None:
            return
    run.cancelled = True
    # A run parked at a pause won't reach the loop's cancel check on its own, so
    # finalize it directly. A mid-flight run will see the flag at its next step.
    state = run.graph.get_state(run.config)
    if state.next:  # still has pending work (paused before a node)
        await run.emitter.emit("status", body="run stopped by user.")
        await run.emitter.emit("done", body=run.cost.summary())
        _finish(run_id)
