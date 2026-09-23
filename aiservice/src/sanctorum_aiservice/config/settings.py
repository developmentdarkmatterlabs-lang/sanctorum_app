"""Environment-backed settings. Loaded once, from .env, at import time."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # LLM (via OpenRouter through LiteLLM).
    openrouter_api_key: str = ""
    default_model: str = "openrouter/anthropic/claude-3.5-sonnet"

    # Web search (Serper). Optional.
    serper_api_key: str = ""

    # The model `generate_image` dispatches to. The agent's OWN model is almost
    # never an image model, so the tool makes a separate call to this one. Priced
    # at roughly 4 cents an image, which the tree's cost ceiling meters.
    image_model: str = "openrouter/google/gemini-2.5-flash-image"

    # The model `generate_speech` dispatches to, for the same reason the image
    # model is separate: a model that reasons almost never speaks. Left EMPTY on
    # purpose — unlike images there is no single obvious default, and a wrong
    # guess would fail at the provider with a confusing error. Unset means the
    # tool refuses with a message naming the settings panel.
    speech_model: str = ""

    # This service.
    port: int = 8000

    # The Node backend — RuntimeEvents are POSTed to `${backend_url}/api/runtime/events`.
    backend_url: str = "http://localhost:3001"

    # Selective supervision: tool names a supervised run may run WITHOUT pausing
    # for approval. DEFAULT IS EMPTY — every tool (reads included) pauses for the
    # user's proceed/edit/stop, which is what supervision means. The mechanism is
    # kept so you can opt in later: set e.g. AUTO_APPROVE_TOOLS="read_file,list_dir,
    # search" to let read-only tools flow without a pause (the confinement already
    # contains them). A step that mixes an auto-approved tool with a consequential
    # one still pauses.
    auto_approve_tools: str = ""

    # Phase 4 — delegation tracing. "1" prints a timestamped, run-id-tagged line
    # at each step/park/resume decision. Off by default (verbose).
    sanctorum_trace: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def has_llm(self) -> bool:
        """True when an LLM key is present, so runs can actually call a model."""
        return bool(self.openrouter_api_key)

    @property
    def auto_approve(self) -> set[str]:
        """The set of tool names that skip the approval pause (read-only)."""
        return {t.strip() for t in self.auto_approve_tools.split(",") if t.strip()}


settings = Settings()
