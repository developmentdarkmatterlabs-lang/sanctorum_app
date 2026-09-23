# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the Sanctorum AI service.

    cd aiservice
    uv run pyinstaller aiservice.spec --noconfirm

Output: aiservice/dist/aiservice/ (onedir), containing aiservice.exe. That folder
is what electron-builder copies via `extraResources` — see electron-builder.yml.

WHAT THIS BUNDLE IS NOT. Sanctorum's AI service is cloud-backed: every model call
goes out through LiteLLM. There is no local model, no vector store, no native
inference library, so this bundle is tens of MB rather than gigabytes. The whole
problem here is DYNAMIC IMPORTS — libraries that resolve modules and read data
files at runtime, which PyInstaller's static analysis cannot see.

EXPECT TO ITERATE. A frozen Python app fails at RUNTIME with ModuleNotFoundError,
not at build time. Build it, run it, and add whatever it names to hiddenimports.
That loop cannot be skipped by reasoning about it.
"""

from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

SPEC_DIR = Path(SPECPATH)
SRC_DIR = SPEC_DIR / "src"

# NOT api/main.py directly. PyInstaller executes the entry point as a TOP-LEVEL
# SCRIPT, and that module imports with relative paths (`from ..config.settings`),
# which need a parent package to resolve against. Pointing at it directly fails
# at startup with "attempted relative import with no known parent package".
# launcher.py imports it by absolute package path instead. See launcher.py.
ENTRY = SPEC_DIR / "launcher.py"

# ---------------------------------------------------------------------------
# Dynamic-import collection
# ---------------------------------------------------------------------------

# litellm ships tokenizer DATA FILES (litellm_core_utils/tokenizers/*.json plus
# hash-named blobs) and a large dynamically-imported provider tree. Naming a few
# modules in hiddenimports is NOT enough: the data files never get copied, and
# the frozen app dies with
#     No module named 'litellm.litellm_core_utils.tokenizers'
# on the first model call. Every Sanctorum run goes through ChatLiteLLM, so this
# is the single most important line in this file.
litellm_datas, litellm_binaries, litellm_hiddenimports = collect_all("litellm")

# LangGraph and LangChain resolve a great deal at runtime — checkpointer
# backends, tool adapters, the structured-output path used by the evaluator.
langgraph_datas, langgraph_binaries, langgraph_hidden = collect_all("langgraph")
lcc_datas, lcc_binaries, lcc_hidden = collect_all("langchain_core")

# tiktoken finds its encodings through a PLUGIN REGISTRY: it scans for modules
# named tiktoken_ext.* at runtime and asks each what encodings it provides.
# Nothing imports them directly, so PyInstaller sees no reference and drops the
# whole namespace package — and the frozen app dies on import of litellm with
#     ValueError: Unknown encoding cl100k_base.  Plugins found: []
# litellm imports tiktoken at module scope (default_encoding.py), so this is a
# startup crash, not a lazy one.
tiktoken_datas, tiktoken_binaries, tiktoken_hidden = collect_all("tiktoken")
tiktoken_ext_hidden = collect_submodules("tiktoken_ext")

# trafilatura, for turning a fetched web page into readable text (`fetch_url`).
# collect_all rather than a hiddenimport, because it ships DATA: language models
# for metadata extraction and a compiled lxml backend. Listing the module alone
# would freeze an import that then fails at the first fetch, deep inside a run.
#
# The tool degrades gracefully if it is missing (it falls back to a regex tag
# strip), so a broken bundle here would NOT crash — it would quietly return worse
# text, which is the harder failure to notice.
trafilatura_datas, trafilatura_binaries, trafilatura_hidden = collect_all("trafilatura")

# Our own package: submodules are imported through the graph and tool registry
# rather than by direct import from the entry point, so let PyInstaller find
# them all rather than listing them and missing one.
own_hidden = collect_submodules("sanctorum_aiservice")

a = Analysis(
    [str(ENTRY)],
    # The package lives under src/ (a src-layout project), so the analyser needs
    # that on the path to resolve `sanctorum_aiservice.*` at all.
    pathex=[str(SRC_DIR)],
    datas=litellm_datas + langgraph_datas + lcc_datas + tiktoken_datas + trafilatura_datas,
    binaries=litellm_binaries
    + langgraph_binaries
    + lcc_binaries
    + tiktoken_binaries
    + trafilatura_binaries,
    hiddenimports=[
        # --- uvicorn -------------------------------------------------------
        # uvicorn picks its event loop and protocol implementations by NAME at
        # startup ("auto" resolves to httptools/uvloop if importable). None of
        # that is traceable statically, so every candidate is named here.
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.http.httptools_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.protocols.websockets.wsproto_impl",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        # --- FastAPI / pydantic -------------------------------------------
        "fastapi",
        "fastapi.middleware",
        "fastapi.middleware.cors",
        "pydantic",
        "pydantic_settings",
        # --- LangGraph / LangChain ----------------------------------------
        "langgraph.checkpoint.sqlite",
        "langchain_litellm",
        "langchain_mcp_adapters",
        # --- LiteLLM ------------------------------------------------------
        "litellm",
        "litellm.llms",
        "litellm.llms.custom_httpx",
        # --- misc ---------------------------------------------------------
        "httpx",
        "orjson",
        "sqlite3",
        # --- tiktoken (see collect_all above) -----------------------------
        "tiktoken",
        "tiktoken_ext",
        "tiktoken_ext.openai_public",
    ]
    + litellm_hiddenimports
    + langgraph_hidden
    + lcc_hidden
    + tiktoken_hidden
    + tiktoken_ext_hidden
    + trafilatura_hidden
    + own_hidden,
    hookspath=[],
    runtime_hooks=[],
    # Excluding what a cloud-only service never touches keeps the bundle small
    # and the build fast. If any of these ever becomes a real dependency, drop
    # it from this list — the failure would otherwise look like a missing module.
    excludes=[
        "tkinter",
        "matplotlib",
        "torch",
        "chromadb",
        "sentence_transformers",
        "sklearn",
        "numpy.distutils",
        "test",
        "unittest",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="aiservice",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    # No UPX: it slows startup and is a reliable source of antivirus false
    # positives on an unsigned binary.
    upx=False,
    # Console stays ON for now — Electron pipes this process's stdout/stderr into
    # its own log, and a silent AI service is very hard to debug. Turn it off
    # once packaging is proven, or the user sees a console window.
    console=True,
)

COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    # onedir, not onefile: a onefile build unpacks to a temp directory on every
    # launch, which is slow and makes the child process harder for Electron to
    # kill cleanly on quit.
    name="aiservice",
)
