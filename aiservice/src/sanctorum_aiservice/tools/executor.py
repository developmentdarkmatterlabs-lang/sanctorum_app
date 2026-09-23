"""The policy-enforcing tool executor — THE TEETH of the clearance model.

Node computes a ToolGrant (allowedTools, workingDir, env) per seat. This module:
  1. Exposes ONLY the granted tools' schemas to the LLM (so the model is never
     even offered a tool it can't use).
  2. On every call, re-checks the tool is granted, then runs it confined to the
     grant's workingDir/env.

Gating lives here, not in a prompt. A tool not in `allowedTools` has no code path
to execution — the model can ask, and it gets a refusal.
"""

from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import Field, create_model

from ..runtime.models import ToolGrant
from . import files, search, shell


def _args_model(tool_name: str, params: dict[str, Any]):
    """Build a pydantic args model from a catalogue JSON-schema `parameters`
    block, so the LLM sees real named arguments (not an opaque kwargs blob)."""
    props = params.get("properties", {})
    required = set(params.get("required", []))
    fields: dict[str, Any] = {}
    for pname, pschema in props.items():
        # All our tool args are strings; default "" when optional.
        default = ... if pname in required else pschema.get("default", "")
        fields[pname] = (str, Field(default, description=pschema.get("description", "")))
    return create_model(f"{tool_name}_Args", **fields)

# The full tool catalogue: name -> (JSON schema for the LLM, python callable spec).
# `schema` follows the OpenAI/LiteLLM tool format. The executor filters this to
# the grant's allowedTools before handing schemas to the model.
_CATALOGUE: dict[str, dict[str, Any]] = {
    "read_file": {
        "schema": {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read a text file, relative to the working directory.",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string"}},
                    "required": ["path"],
                },
            },
        },
    },
    "list_dir": {
        "schema": {
            "type": "function",
            "function": {
                "name": "list_dir",
                "description": "List entries in a directory, relative to the working directory.",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string", "default": "."}},
                },
            },
        },
    },
    "search": {
        "schema": {
            "type": "function",
            "function": {
                "name": "search",
                "description": (
                    "Search the web to FIND pages. Returns titles, links and a "
                    "one-line snippet for each — these locate a page, they are not "
                    "an answer. A snippet is truncated and often out of date, so "
                    "never quote a figure, price, date or statistic from one: open "
                    "the page and read it before relying on anything specific."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                },
            },
        },
    },
    # The other half of `search`: open one of those links and read it. Granted
    # at clearance 1 — one rung above search, because the model names an
    # arbitrary address rather than picking from curated results — and included
    # in READ_ONLY_TOOLS, since it only observes.
    "fetch_url": {
        "schema": {
            "type": "function",
            "function": {
                "name": "fetch_url",
                "description": (
                    "Fetch a web page and read it as text. Use this to actually "
                    "READ a result from `search` — a snippet is not an answer, this "
                    "gives you the page. It reads static content only: it cannot run "
                    "JavaScript, click, fill in forms or log in, so a page that "
                    "renders entirely in the browser may come back empty."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "The full http(s) URL of the page to read.",
                        }
                    },
                    "required": ["url"],
                },
            },
        },
    },
    "write_file": {
        "schema": {
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "Write (or overwrite) a text file, relative to the working directory.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "content": {"type": "string"},
                    },
                    "required": ["path", "content"],
                },
            },
        },
    },
    "edit_file": {
        "schema": {
            "type": "function",
            "function": {
                "name": "edit_file",
                "description": "Replace the first occurrence of `find` with `replace` in a file.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "find": {"type": "string"},
                        "replace": {"type": "string"},
                    },
                    "required": ["path", "find", "replace"],
                },
            },
        },
    },
    "run_command": {
        "schema": {
            "type": "function",
            "function": {
                "name": "run_command",
                "description": "Run a shell command in the working directory.",
                "parameters": {
                    "type": "object",
                    "properties": {"command": {"type": "string"}},
                    "required": ["command"],
                },
            },
        },
    },
    # Memory — knowledge that outlives the run. The agent names a SCOPE only;
    # Node resolves whose memory that is from the run id, so an agent cannot read
    # another seat's notes by naming them.
    "read_memory": {
        "schema": {
            "type": "function",
            "function": {
                "name": "read_memory",
                "description": (
                    "Read what has been recorded in one of your memory scopes. Use this "
                    "BEFORE starting work that may have prior context — decisions already "
                    "made, conventions agreed, things that went wrong last time. Scopes: "
                    "'agent' (your own notes), 'position' (this seat's memory, kept when "
                    "the seat changes hands), 'team' (shared with your team)."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "scope": {
                            "type": "string",
                            "description": "One of: agent, position, team.",
                        }
                    },
                    "required": ["scope"],
                },
            },
        },
    },
    "write_memory": {
        "schema": {
            "type": "function",
            "function": {
                "name": "write_memory",
                "description": (
                    "Record something worth keeping for future runs — a decision, a "
                    "correction, a reusable insight. Write CONCLUSIONS, not transcripts. "
                    "Scope 'agent' is private to you, 'position' stays with the seat, "
                    "'team' is shared. Clearance is capped at your own."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "scope": {
                            "type": "string",
                            "description": "One of: agent, position, team.",
                        },
                        "body": {
                            "type": "string",
                            "description": "What to remember, stated so it is useful without context.",
                        },
                        "kind": {
                            "type": "string",
                            "description": "One of: task, result, insight, note. Defaults to insight.",
                            "default": "insight",
                        },
                        "clearance": {
                            "type": "string",
                            "description": "Minimum clearance to read this back (0 = open).",
                            "default": "0",
                        },
                    },
                    "required": ["scope", "body"],
                },
            },
        },
    },
    # Generate an image into the workspace. Granted at clearance 3, alongside the
    # other tools that CREATE files — and blocked entirely on a read-only mount,
    # since it writes.
    "generate_image": {
        "schema": {
            "type": "function",
            "function": {
                "name": "generate_image",
                "description": (
                    "Generate an image from a text prompt and save it into your "
                    "working directory. Describe the image completely — subject, "
                    "style, composition, colours — because the image model sees "
                    "only this prompt and none of your conversation. Each image "
                    "costs real money and counts against the task's budget, so "
                    "generate deliberately rather than speculatively."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": (
                                "Where to save it, relative to your working "
                                "directory (e.g. 'art/cover.png'). An extension is "
                                "added if you omit one."
                            ),
                        },
                        "prompt": {
                            "type": "string",
                            "description": "What to draw, stated completely and self-containedly.",
                        },
                    },
                    "required": ["path", "prompt"],
                },
            },
        },
    },
    # Speak text into the workspace. Granted at clearance 3 beside
    # `generate_image`: producing media writes a file and spends real money,
    # whatever the medium. Blocked entirely on a read-only mount.
    "generate_speech": {
        "schema": {
            "type": "function",
            "function": {
                "name": "generate_speech",
                "description": (
                    "Turn text into spoken audio and save it into your working "
                    "directory. Write out exactly the words to be spoken — the "
                    "speech model sees only this text and none of your "
                    "conversation, so do not include stage directions or notes. "
                    "Each call costs real money and counts against the task's "
                    "budget, so generate deliberately rather than speculatively."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": (
                                "Where to save it, relative to your working "
                                "directory (e.g. 'audio/intro.mp3'). An extension "
                                "is added if you omit one."
                            ),
                        },
                        "text": {
                            "type": "string",
                            "description": "The exact words to speak.",
                        },
                        "voice": {
                            "type": "string",
                            "description": (
                                "Optional voice name, if the configured speech "
                                "model supports choosing one."
                            ),
                        },
                    },
                    "required": ["path", "text"],
                },
            },
        },
    },
    # The browser. Clearance 5, beside run_command: both act on the world
    # outside the workspace. Elements are addressed by the NUMBER a snapshot
    # gave them, never by coordinates.
    "browse": {
        "schema": {
            "type": "function",
            "function": {
                "name": "browse",
                "description": (
                    "Open a web page in your browser and read it. Use this AFTER "
                    "`search` to actually read a page you found — search gives you a "
                    "link, this gives you the page. Returns the page text plus a "
                    "numbered list of things you can interact with, like "
                    "'[button 18] Search'. Use those numbers with click and type. It "
                    "runs JavaScript and keeps you logged in between pages, so it "
                    "works on sites that plain fetching cannot read."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {"url": {"type": "string", "description": "The full http(s) URL."}},
                    "required": ["url"],
                },
            },
        },
    },
    "click": {
        "schema": {
            "type": "function",
            "function": {
                "name": "click",
                "description": (
                    "Click an element by the number the page snapshot gave it. The "
                    "page usually changes, so a fresh snapshot comes back."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "index": {
                            "type": "string",
                            "description": "The element's number, e.g. 18 for '[button 18]'.",
                        }
                    },
                    "required": ["index"],
                },
            },
        },
    },
    "type": {
        "schema": {
            "type": "function",
            "function": {
                "name": "type",
                "description": "Type text into an input field, by its number in the snapshot.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "index": {"type": "string", "description": "The field's number."},
                        "text": {"type": "string", "description": "What to type."},
                    },
                    "required": ["index", "text"],
                },
            },
        },
    },
    "scroll": {
        "schema": {
            "type": "function",
            "function": {
                "name": "scroll",
                "description": "Scroll the page to reveal more. Positive is down.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "amount": {"type": "string", "description": "Pixels; default 600."}
                    },
                },
            },
        },
    },
    "back": {
        "schema": {
            "type": "function",
            "function": {
                "name": "back",
                "description": "Go back to the previous page.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
    },
    "read_page": {
        "schema": {
            "type": "function",
            "function": {
                "name": "read_page",
                "description": (
                    "Re-read the current page without changing it. Use after the page "
                    "updates itself, or when your element numbers look stale."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
        },
    },
    # Phase 4 — delegate to one of your reports. Granted only to a leader seat at
    # clearance 6+; Node re-validates the target on every call, so naming a seat
    # that isn't yours is refused rather than executed.
    "delegate": {
        "schema": {
            "type": "function",
            "function": {
                "name": "delegate",
                "description": (
                    "Delegate a self-contained piece of work to one of your reports. "
                    "Use the seat id exactly as listed in your reports. State the task "
                    "completely, including what a finished result must contain — they "
                    "cannot see your conversation. They work at their own clearance, "
                    "which may be lower than yours."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "positionId": {
                            "type": "string",
                            "description": "The seat id of the report, from your reports list.",
                        },
                        "task": {
                            "type": "string",
                            "description": "The task, stated completely and self-containedly.",
                        },
                    },
                    "required": ["positionId", "task"],
                },
            },
        },
    },
}


class ToolExecutor:
    """Holds one run's grant and executes only what it permits."""

    def __init__(
        self,
        grant: ToolGrant,
        serper_key: str | None = None,
        run_id: str | None = None,
        agent_key: str | None = None,
        openrouter_key: str | None = None,
        image_model: str | None = None,
        speech_model: str | None = None,
        cost_tracker: Any = None,
    ) -> None:
        self._grant = grant
        # The run's Serper key (from app settings), preferred by the search tool
        # over the service env. None -> search falls back to env.
        self._serper_key = serper_key
        # Phase 4 — `delegate` calls back into Node, which needs to know WHICH run
        # is delegating (to place the child in the tree and check its budget) and
        # WHO is asking (to re-derive that leader's legal targets). The grant
        # doesn't carry identity, so they're passed in here.
        self._run_id = run_id
        self._agent_key = agent_key
        # `generate_image` dispatches its own completion, so it needs the run's
        # key and image model — and the run's CostTracker, because a direct
        # provider call is invisible to the LangChain callback that meters
        # everything else. Without this the spend would escape maxCostPerTree.
        self._openrouter_key = openrouter_key
        self._image_model = image_model
        self._speech_model = speech_model
        self._cost_tracker = cost_tracker
        # Only granted, known tools are visible.
        self._allowed = [
            t for t in grant.allowedTools if t in _CATALOGUE
        ]

    def schemas(self) -> list[dict[str, Any]]:
        """The tool schemas offered to the LLM — granted tools only."""
        return [_CATALOGUE[t]["schema"] for t in self._allowed]

    def has_any(self) -> bool:
        return bool(self._allowed)

    def call(self, name: str, arguments: str) -> str:
        """Execute a tool call. Refuses anything not granted."""
        if name not in self._allowed:
            return (
                f"refused: '{name}' is not permitted at your clearance "
                f"({self._grant.clearance}). Allowed: {', '.join(self._allowed) or 'none'}."
            )
        try:
            args = json.loads(arguments) if arguments else {}
        except json.JSONDecodeError:
            return f"error: could not parse arguments for {name}"

        wd = self._grant.workingDir
        try:
            if name == "read_file":
                return files.read_file(wd, args["path"])
            if name == "list_dir":
                return files.list_dir(wd, args.get("path", "."))
            if name == "write_file":
                return files.write_file(wd, args["path"], args["content"])
            if name == "edit_file":
                return files.edit_file(wd, args["path"], args["find"], args["replace"])
            if name == "run_command":
                return shell.run_command(wd, self._grant.env, args["command"])
            if name == "search":
                return search.search(args["query"], self._serper_key)
            if name == "fetch_url":
                # Imported lazily so the optional readability dependency is only
                # loaded by a run that actually reaches the web.
                from . import web as _web

                return _web.fetch_url(args["url"])
            if name in ("read_memory", "write_memory"):
                if not self._run_id:
                    return "error: memory is unavailable in this run."
                import asyncio

                from . import memory as _memory_mod

                if name == "read_memory":
                    return asyncio.run(_memory_mod.read_memory(self._run_id, args["scope"]))
                # Clearance arrives as a string (every catalogue arg is a string —
                # see _args_model); coerce, and treat junk as 0 rather than failing.
                try:
                    clearance = int(str(args.get("clearance", "0")).strip() or 0)
                except ValueError:
                    clearance = 0
                return asyncio.run(
                    _memory_mod.write_memory(
                        self._run_id,
                        args["scope"],
                        args["body"],
                        args.get("kind") or "insight",
                        clearance,
                    )
                )
            if name == "generate_image":
                from . import images as _images

                return _images.generate_image(
                    wd,
                    args["path"],
                    args["prompt"],
                    model=self._image_model or "",
                    api_key=self._openrouter_key or "",
                    tracker=self._cost_tracker,
                )
            if name == "generate_speech":
                from . import speech as _speech

                return _speech.generate_speech(
                    wd,
                    args["path"],
                    args["text"],
                    model=self._speech_model or "",
                    api_key=self._openrouter_key or "",
                    voice=args.get("voice") or "",
                    tracker=self._cost_tracker,
                )
            if name in ("browse", "click", "type", "scroll", "back", "read_page"):
                if not self._run_id:
                    return "error: the browser is unavailable in this run."
                import asyncio

                from . import browser as _browser

                def _num(key: str, default: int = 0) -> int:
                    try:
                        return int(str(args.get(key, default)).strip() or default)
                    except ValueError:
                        return default

                if name == "browse":
                    return asyncio.run(_browser.browse(self._run_id, args["url"]))
                if name == "click":
                    return asyncio.run(_browser.click(self._run_id, _num("index")))
                if name == "type":
                    return asyncio.run(
                        _browser.type_text(self._run_id, _num("index"), args.get("text") or "")
                    )
                if name == "scroll":
                    return asyncio.run(_browser.scroll(self._run_id, _num("amount", 600)))
                if name == "back":
                    return asyncio.run(_browser.back(self._run_id))
                return asyncio.run(_browser.read_page(self._run_id))
            if name == "delegate":
                if not self._run_id:
                    return "error: delegation is unavailable in this run."
                # `call` is sync but delegate is async. This is always invoked
                # from a worker thread (asyncio.to_thread in the supervise loop),
                # so there is no running loop here to clash with — asyncio.run is
                # safe. Calling `call` directly from async code would raise
                # "cannot be called from a running event loop".
                import asyncio

                from .delegate import delegate as _delegate

                return asyncio.run(
                    _delegate(self._run_id, self._agent_key, args["positionId"], args["task"])
                )
        except files.PathEscape as exc:
            return f"refused: {exc}"
        except KeyError as exc:
            return f"error: missing argument {exc} for {name}"
        except Exception as exc:  # noqa: BLE001
            return f"error: {name} failed: {exc}"

        return f"error: unknown tool {name}"

    def langchain_tools(self) -> list[StructuredTool]:
        """The granted tools as LangChain StructuredTools, for a LangGraph
        ToolNode. Each still routes through `call`, so the gate is enforced
        exactly the same way — the ToolNode never bypasses it."""
        tools: list[StructuredTool] = []
        for name in self._allowed:
            fn = _CATALOGUE[name]["schema"]["function"]
            args_model = _args_model(name, fn.get("parameters", {}))

            def make(tool_name: str):
                def _run(**kwargs: Any) -> str:
                    return self.call(tool_name, json.dumps(kwargs))

                return _run

            tools.append(
                StructuredTool.from_function(
                    func=make(name),
                    name=name,
                    description=fn.get("description", name),
                    args_schema=args_model,
                )
            )
        return tools
