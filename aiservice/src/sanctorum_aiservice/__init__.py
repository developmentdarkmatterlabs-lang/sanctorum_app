"""Sanctorum AI service — implements the AgentRuntime contract.

Phase 1: a single solo agent that runs a real LLM (via OpenRouter/LiteLLM),
calls clearance-gated tools inside a confined workspace, and streams RuntimeEvents
back to the Node backend. Later phases add hierarchy (LangGraph), supervision,
resource grants, and connections — see 3Ai_touse.md.
"""
