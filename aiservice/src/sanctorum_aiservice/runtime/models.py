"""Pydantic mirrors of Sanctorum's runtime contract.

Source of truth is the TypeScript at backend/runtime/AgentRuntime.ts and
backend/runtime/ToolPolicy.ts. Keep these in sync. Phase 1 uses the solo subset;
the hierarchy/resource/supervision fields exist in the TS contract but are not
consumed yet here (a solo run doesn't send them).
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

RuntimeEventType = Literal[
    "started", "status", "message", "result", "awaiting_approval",
    # Phase 3 worker-evaluator loop:
    "criteria",   # the success criterion the answer is graded against
    "evaluated",  # one grade: pass/fail + feedback + attempt N/M
    # Phase 4 delegation:
    "delegated",  # this run handed work to one of its reports
    "reported",   # a child run's result coming back to its leader
    "done", "error",
]


class ToolGrant(BaseModel):
    """The clearance-gated capability grant. The runtime executes WITHIN this."""

    allowedTools: list[str]
    workingDir: str
    env: dict[str, str] = {}
    clearance: int = 0


class ProviderKeys(BaseModel):
    """Provider API keys entered in the app settings, preferred over env."""

    openrouter: Optional[str] = None
    serper: Optional[str] = None
    replicate: Optional[str] = None


class McpServerConfig(BaseModel):
    """An external MCP server to connect to for a run (Phase 3.7). HTTP-first
    (url + authToken/headers); stdio (command/args) is the advanced local option."""

    name: str
    transport: str = "http"  # 'http' | 'stdio'
    url: Optional[str] = None
    authToken: Optional[str] = None
    headers: Optional[str] = None  # JSON object string, or None
    command: Optional[str] = None
    args: Optional[str] = None  # JSON array string, or None


class MemoryContext(BaseModel):
    """Which memory scopes a run may address. Resolved by Node from the seat."""

    agentKey: Optional[str] = None
    positionId: Optional[str] = None
    teamId: Optional[str] = None


class RunSpec(BaseModel):
    """What Node sends to start a run (Phase 1: the solo subset)."""

    runId: str
    threadId: str
    agentKey: Optional[str] = None
    task: str
    systemPrompt: str
    policy: ToolGrant
    # Phase 4: the seat this run executes as (audit trail). Clearance always comes
    # from THIS seat, never from a leader that delegated the work.
    positionId: Optional[str] = None
    # The memory scopes this run may address (agent / position / team). The tool
    # sends the SCOPE, never an identity — Node resolves who is asking from the
    # run id, so an agent cannot read another's memory by naming it.
    memoryContext: Optional["MemoryContext"] = None
    # The model Node resolved (per-task -> agent -> global default). Omitted when
    # none is set, so the service falls back to its own env default.
    model: Optional[str] = None
    # What `generate_image` draws with. Separate from `model`: that one must
    # support tool calling, this one must output images.
    imageModel: Optional[str] = None
    speechModel: Optional[str] = None
    personaReminder: Optional[str] = None
    # Phase 2: when true, the run PAUSES before each tool call and waits for the
    # user's proceed/stop/edit. Defaults to hands-off.
    supervised: Optional[bool] = False
    # Phase 4: this run's agent is a trusted delegator — `delegate` calls skip the
    # approval pause. Every OTHER consequential tool still obeys `supervised`, and
    # the budget caps + same-team check still run on every delegation.
    trustedDelegator: Optional[bool] = False
    # Phase 3 (worker-evaluator loop): the success criterion the answer is graded
    # against. None -> derived from the task. And the retry ceiling.
    successCriteria: Optional[str] = None
    maxAttempts: Optional[int] = None
    # Phase 3.6: provider API keys entered in the app's settings. Prefer these over
    # the service's own env keys. Only non-empty ones are sent.
    providerKeys: Optional["ProviderKeys"] = None
    # Phase 3.7: external MCP servers assigned to this run's seat. The service
    # connects to each and merges its tools into the run's tool list.
    mcpServers: list["McpServerConfig"] = []

    def openrouter_key(self, env_default: str) -> str:
        """The OpenRouter key to use: the run's (from settings) if set, else env."""
        k = (self.providerKeys.openrouter or "") if self.providerKeys else ""
        return k.strip() or env_default

    def serper_key(self, env_default: str) -> str:
        k = (self.providerKeys.serper or "") if self.providerKeys else ""
        return k.strip() or env_default

    def replicate_key(self, env_default: str) -> str:
        k = (self.providerKeys.replicate or "") if self.providerKeys else ""
        return k.strip() or env_default


class ApprovalDecision(BaseModel):
    """The user's answer at a supervised pause (mirrors AgentRuntime.ts)."""

    decision: Literal["proceed", "stop", "edit"]
    edited: Optional[str] = None
    # Phase 4: set ONLY by Node when this resume is delivering a parked leader
    # its reports. A human approval never sets it, which is what lets a parked
    # leader ignore stale approvals without ignoring its reports.
    reportsReady: Optional[bool] = False


class RuntimeEvent(BaseModel):
    """One event streamed back to Node, POSTed to /api/runtime/events."""

    runId: str
    threadId: str
    agentKey: Optional[str] = None
    type: RuntimeEventType
    body: Optional[str] = None
    ref: Optional[str] = None
    at: Optional[str] = None
