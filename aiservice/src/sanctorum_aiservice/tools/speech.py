"""The `generate_speech` tool — an audio file written into the agent's workspace.

THE SAME SHAPE AS `generate_image`, AND FOR THE SAME REASON. The agent's own
model reasons in text and cannot speak; the models that can mostly cannot call
tools. So the agent stays on its own model and this tool dispatches a SEPARATE
request to a speech model, returning a file path.

WHY THIS TALKS TO OPENROUTER DIRECTLY INSTEAD OF THROUGH LiteLLM.

`generate_image` uses `litellm.completion`, because an image model answers on
the chat/completions endpoint. Speech does not. Sending a TTS model there is
refused outright:

    "hexgrad/kokoro-82m is a text-to-speech model and cannot be used with the
     chat/completions endpoint. Use the /api/v1/audio/speech endpoint instead."

That is not an edge case — it is 18 of the 22 speech models OpenRouter serves.
The remaining four (gpt-audio, lyria) are conversational models that emit audio
from chat/completions, and they demand `stream: true` to do it. So the endpoint
is the primary path and chat/completions is the fallback, not the reverse.

VOICES ARE PER-MODEL AND SOMETIMES MANDATORY. minimax refuses without one
("An explicit voice is required for this TTS provider"), kokoro defaults
happily. The valid list lives in each model's `supported_voices`, which this
module fetches once and caches — so a wrong voice is corrected against the real
list rather than passed through to a 400 the agent cannot interpret.

THE COST MUST BE REPORTED BY HAND, AND IS ESTIMATED. `CostTracker` is a
LangChain callback and sees nothing of a direct HTTP call. Worse, /audio/speech
returns no cost header at all, so there is nothing to read. The spend is
therefore estimated from the input length and reported anyway: a ceiling that
silently stops counting is worse than one that is approximate, and the estimate
errs HIGH so the error is a stopped agent rather than an overspent budget.

CONFINEMENT IS UNCHANGED. The file is written through `files.write_bytes`,
which resolves the path with the same guard every other write uses.
"""

from __future__ import annotations

import base64
from typing import Any

import httpx

from . import files

_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech"
_MODELS_URL = "https://openrouter.ai/api/v1/models?output_modalities=speech"

# MP3 over the default PCM: OpenRouter returns raw `audio/pcm` when no format is
# asked for, which is 14x larger (94 KB vs 6.8 KB for one sentence) and will not
# open in an ordinary player because it carries no header. `wav` and `opus` are
# both rejected by the endpoint, so mp3 is the only real choice.
_FORMAT = "mp3"

_TIMEOUT = 120.0

# Rough USD per character, used because the endpoint reports no cost. Set above
# the going rate for every model in the catalogue: the number's job is to keep a
# budget ceiling meaningful, and erring high stops an agent rather than letting
# it spend unmetered.
_FALLBACK_USD_PER_CHAR = 0.00003

# Refuse rather than truncate past this. A very long input is usually a mistake
# — a whole document pasted in — and synthesising it would be slow and costly.
_MAX_CHARS = 5000

# Voices per model id, fetched once. A module-level cache is right here: the
# list is static per model, and the alternative is an extra HTTP round trip on
# every single call.
_VOICES: dict[str, list[str]] | None = None


def _voices_for(model_slug: str) -> list[str]:
    """The voices a model accepts, from OpenRouter's catalogue. [] if unknown."""
    global _VOICES
    if _VOICES is None:
        try:
            resp = httpx.get(_MODELS_URL, timeout=30.0)
            resp.raise_for_status()
            _VOICES = {
                str(row.get("id", "")): list(row.get("supported_voices") or [])
                for row in resp.json().get("data", [])
            }
        except Exception:  # noqa: BLE001 — never fail a call over the voice list
            _VOICES = {}
    return _VOICES.get(model_slug, [])


def _slug(model: str) -> str:
    """Strip the `openrouter/` prefix Node adds; this API wants the bare id."""
    return model[len("openrouter/") :] if model.startswith("openrouter/") else model


def _from_chat(payload: dict[str, Any]) -> tuple[bytes, str] | None:
    """Pull audio out of a chat/completions response (the 4 conversational models)."""
    try:
        message = payload["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return None

    audio = message.get("audio") if isinstance(message, dict) else None
    if isinstance(audio, dict):
        raw_b64 = audio.get("data")
        if isinstance(raw_b64, str) and raw_b64:
            fmt = str(audio.get("format") or _FORMAT).lower().lstrip(".")
            try:
                return base64.b64decode(raw_b64), f".{fmt}"
            except Exception:  # noqa: BLE001
                return None
    return None


def generate_speech(
    working_dir: str,
    path: str,
    text: str,
    *,
    model: str,
    api_key: str,
    voice: str = "",
    tracker: Any = None,
) -> str:
    """Speak `text` with a speech model and write the audio to `path`."""
    spoken = (text or "").strip()
    if not spoken:
        return "error: some text is required to generate speech."
    if len(spoken) > _MAX_CHARS:
        return (
            f"error: that is {len(spoken)} characters, over the {_MAX_CHARS} limit "
            f"for one call. Split it into shorter passages."
        )
    if not api_key:
        return (
            "refused: no OpenRouter key is configured, so no speech can be "
            "generated. Add one in the app's settings panel."
        )
    if not model:
        return (
            "refused: no speech model is configured. Set one in the app's "
            "settings panel, or give this agent its own speech model."
        )

    slug = _slug(model)
    known = _voices_for(slug)

    # Resolve the voice against the model's own list. A voice the model does not
    # know is silently dropped rather than forwarded, because the resulting 400
    # ("voice not found") tells the agent nothing it can act on — while several
    # providers REQUIRE one, so falling back to the first supported voice is
    # what makes those models work at all.
    chosen = voice.strip()
    if chosen and known and chosen not in known:
        chosen = ""
    if not chosen and known:
        chosen = known[0]

    body: dict[str, Any] = {"model": slug, "input": spoken, "response_format": _FORMAT}
    if chosen:
        body["voice"] = chosen

    try:
        resp = httpx.post(
            _SPEECH_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=body,
            timeout=_TIMEOUT,
        )
    except httpx.HTTPError as exc:
        return f"error: speech generation failed: {exc}"

    raw: bytes | None = None
    ext = f".{_FORMAT}"

    content_type = (resp.headers.get("content-type") or "").lower()
    if resp.status_code < 400 and content_type.startswith("audio/"):
        raw = resp.content
        if "mpeg" in content_type or "mp3" in content_type:
            ext = ".mp3"
        elif "wav" in content_type:
            ext = ".wav"
        elif "pcm" in content_type:
            # Raw samples with no header: no player will open it, and we asked
            # for mp3, so this means the model ignored the format request.
            ext = ".pcm"
    elif resp.status_code < 400:
        # A JSON body from this endpoint means the model answered like a chat
        # model. Try the conversational shape before giving up.
        try:
            found = _from_chat(resp.json())
        except Exception:  # noqa: BLE001
            found = None
        if found:
            raw, ext = found

    if raw is None:
        # Surface the provider's own words: "an explicit voice is required" is
        # actionable, "generation failed" is not.
        detail = ""
        try:
            err = resp.json().get("error") or {}
            detail = str(err.get("message") or "")[:200]
        except Exception:  # noqa: BLE001
            detail = resp.text[:200]
        hint = ""
        if known and "voice" in detail.lower():
            hint = f" Voices this model accepts include: {', '.join(known[:8])}."
        return f"error: '{model}' returned no audio (HTTP {resp.status_code}). {detail}{hint}"

    # Report the spend. Estimated, because /audio/speech returns no cost header
    # — and reported ANYWAY, because a budget that stops counting is a budget
    # that can be evaded.
    usd = round(len(spoken) * _FALLBACK_USD_PER_CHAR, 6)
    if tracker is not None and usd:
        tracker.record(usd)

    # Honour an extension the agent chose; otherwise use the one the response
    # declared, so the file opens in a player. See files.with_extension for why
    # this is not a bare `"." in name` test.
    target = files.with_extension(path, ext)

    try:
        written = files.write_bytes(working_dir, target, raw)
    except files.PathEscape as exc:
        return f"refused: {exc}"
    except Exception as exc:  # noqa: BLE001
        return f"error: could not write the audio: {exc}"

    spoke_as = f", voice {chosen}" if chosen else ""
    return (
        f"wrote {written} ({len(raw) // 1024} KB) using {model}{spoke_as} "
        f"— estimated cost ${usd:.4f}"
    )
