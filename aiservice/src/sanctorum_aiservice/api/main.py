"""FastAPI surface for the AI service (Phase 1).

  GET  /health          liveness + whether an LLM key is present
  POST /run             start a run (accepts a RunSpec), returns 202 immediately

The run executes in the background; progress/results are streamed to the Node
backend as RuntimeEvents (see runtime/emitter.py), not returned from /run.
"""

from __future__ import annotations

from fastapi import BackgroundTasks, FastAPI

from ..agents.runner import solo_agent
from ..config.settings import settings
from ..graph import supervise
from ..runtime.emitter import EventEmitter
from ..runtime.models import ApprovalDecision, RunSpec

app = FastAPI(title="sanctorum-aiservice")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "hasLlm": settings.has_llm}


async def _execute(spec: RunSpec) -> None:
    emitter = EventEmitter(spec.runId, spec.threadId, spec.agentKey)
    try:
        await solo_agent.run(spec, emitter)
    except Exception as exc:  # noqa: BLE001 — a crash still reports as an error event
        await emitter.emit("error", body=f"run crashed: {exc}")


@app.post("/run", status_code=202)
async def run(spec: RunSpec, background: BackgroundTasks) -> dict:
    # Return immediately; the run streams events back to the backend as it goes.
    background.add_task(_execute, spec)
    return {"runId": spec.runId}


@app.post("/runs/{run_id}/decision", status_code=202)
async def decide(run_id: str, body: ApprovalDecision, background: BackgroundTasks) -> dict:
    # Resume/cancel in the background; follow-up events stream to the webhook via
    # the run's own emitter (held in the supervise registry).
    background.add_task(
        supervise.decide, run_id, body.decision, body.edited, bool(body.reportsReady)
    )
    return {"ok": True}


@app.post("/runs/{run_id}/cancel", status_code=202)
async def cancel(run_id: str, background: BackgroundTasks) -> dict:
    # Hard stop: works whether the run is paused OR mid-flight (unlike a `stop`
    # decision, which only lands at an approval pause).
    background.add_task(supervise.cancel, run_id)
    return {"ok": True}


def main() -> None:
    """Entry point: `python -m sanctorum_aiservice.api.main` or `uv run ...`."""
    import uvicorn

    from ..net import free_port

    # Self-heal: clear a stale process holding our port from a prior crashed run,
    # so `dev:all` doesn't cascade-fail on WinError 10048.
    free_port(settings.port)
    uvicorn.run(app, host="127.0.0.1", port=settings.port)


if __name__ == "__main__":
    main()
