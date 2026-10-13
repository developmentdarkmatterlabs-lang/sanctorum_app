# Sanctorum Security Policy

## Reporting a Vulnerability

Report suspected vulnerabilities in Sanctorum privately by email to
support.darkmatterlabs@gmail.com. Don't open public issues for security
reports. Dark Matter Labs, LLC aims to acknowledge reports within 72 hours.

## Security Model

Sanctorum's central claim is that an agent's capability comes from its seat in
the organisation, and is enforced in code rather than requested in a prompt.

- **The grant is computed outside the model.**
  [backend/runtime/ToolPolicy.ts](backend/runtime/ToolPolicy.ts) turns the
  clearance of the seat an agent holds into the list of tools it may use. The
  AI service's tool executor refuses any tool outside that list. A tool the
  grant leaves out has no code path, so no prompt can unlock it.
- **Delegation never lends clearance.** A delegated run executes at the
  clearance of the seat that receives it, never at its leader's.
- **Files stay in the working directory.** File tools resolve every path inside
  the run's working directory and refuse any path that escapes it. A real
  folder mounted for an agent is read-only unless you turn that off.
- **Commands get a minimal environment.** `run_command` receives only an
  allowlisted environment (`PATH` and the few variables Windows needs), never
  the host's secrets.
- **Approvals and limits.** A supervised agent pauses before every tool call,
  except read-only tools listed in `AUTO_APPROVE_TOOLS`. An unattended run
  pauses for a check-in at its step limit and at its cost ceiling.
- **Private addresses are refused when fetching.** `fetch_url` checks the
  address every request and every redirect resolves to, and refuses loopback,
  private and link-local addresses, including the cloud metadata endpoint. The
  agent browser applies the same check to each page an agent opens; the gaps
  below say what it misses.

## Process Security Posture

Sanctorum is an Electron app that runs these local processes:

- the Electron main process;
- the renderer (the React app);
- the Express backend, on port 3001;
- the Python AI service, on `127.0.0.1:8000`;
- a key bridge on a random `127.0.0.1` port;
- one embedded browser view for each agent run that browses.

- **Renderer lockdown.** The window runs with `contextIsolation: true` and
  `nodeIntegration: false`, and Electron's default renderer sandbox is left on.
  The page is served from the app's own `app://` protocol.
- **One bridge.** The renderer reaches the main process only through
  `window.electronAPI`, exposed by [electron/preload.ts](electron/preload.ts).
  Calls to the backend and the AI service are proxied through the `api-request`
  and `ai-request` IPC handlers.
- **Agent browser isolation.** Each browsing view is sandboxed, with context
  isolation on, Node integration off and web security on. Each agent gets its
  own persistent session, separate from the app's.
- **Keys in the OS keychain.**
  - Provider API keys are encrypted with Electron `safeStorage` (DPAPI on
    Windows, the Keychain on macOS) and stored as ciphertext.
  - The backend asks the main process to decrypt them through the key bridge,
    which listens on `127.0.0.1` only and requires a token created at each
    launch.
  - No route returns a key to the page: the page only learns whether a key is
    set, and its last four characters.
  - No keys ship in the app, and no `.env` file is packaged.
- **No HTML from data.** The frontend never sets `innerHTML`, uses
  `dangerouslySetInnerHTML`, or runs `eval` or `new Function`. Agent replies
  are shown as text through React.

## Known Hardening Gaps

These are known and tracked. You don't need to report them again:

- **The backend is open to the network and to web pages.**
  - It listens on every network interface, not only `127.0.0.1`.
  - It allows cross-origin requests from any website.
  - It has no authentication.

  While Sanctorum runs, another device on the network (if the firewall allows
  it) or a page open in your normal browser can call its API. That means
  reading conversations and memory, changing settings, registering MCP servers
  and sending tasks to agents. An unattended agent with `run_command`, or a
  local MCP server, turns that into running code on your machine. Fix: bind to
  `127.0.0.1`, allow only the app's own origins, and require a per-launch token
  from the renderer.
- **The agent browser only checks the pages it is told to open.** Redirects,
  pop-ups, links a page follows on its own, and requests made by a page's
  scripts aren't checked: the navigation check finishes too late to cancel the
  request, and pop-ups load without it. A page an agent visits can therefore
  reach local addresses, including the backend. Fix: filter every request in
  the agent's session.
- **The AI service has no authentication.** It trusts the grant inside every
  run request it receives, so any local program can start a run with any tools,
  without approval. A web page can't deliver such a request: the service only
  parses bodies declared as JSON, and a page can send those only after a
  cross-origin check the service doesn't answer.
- **`run_command` is not an OS sandbox.** It runs a shell with your own
  privileges. The working directory and the minimal environment are its only
  confinement, so a command can reach any file you can.
- **Content an agent reads can steer it.** Web pages, files, search results,
  memory and MCP output reach the model, and can contain instructions.
  - The grant and the approvals still hold, but an unattended agent with write
    or command tools can be steered within its grant.
  - Keep agents that browse or read untrusted content supervised, or at a low
    clearance.
- **Agent browser sessions persist sign-ins.** An agent signed in to a site can
  act as you there until you clear its session.
- **MCP server tokens are stored unencrypted** in the database, unlike provider
  keys. Local (stdio) MCP servers run whatever command was registered.
- **Keys are unencrypted outside Electron.** In browser development there is no
  keychain, so provider keys are stored in plain text in `dev.db`.
- **The `app://` handler doesn't confine paths.** It joins the requested path
  to the frontend folder without checking that the result stays inside it, so
  code running in the window could read other local files through it.
- **No Content Security Policy.** Neither the `app://` handler nor the frontend
  sets one.
- **Navigation isn't restricted in the main window.** It has no
  `setWindowOpenHandler` or `will-navigate` handler; only the agent browser
  views do.
- **The key bridge token isn't cryptographically random.** It is built from
  `Math.random()` rather than a secure random source.
- **Electron fuses aren't set.** Packaged builds still accept
  `--remote-debugging-port` and Node's inspect flags. The RunAsNode fuse must
  stay on, because the backend runs through `ELECTRON_RUN_AS_NODE`.
- **Builds are unsigned.** Windows and macOS releases aren't code-signed or
  notarised yet.

## Threat Model: Model Output

Unlike an editor's AI features, Sanctorum's agents use tools, so the model's
output is acted on. The model is treated as untrusted, and the grant is the
boundary:

- Every tool call is checked against the run's grant before it executes.
- File access is resolved inside the run's working directory.
- Pages an agent fetches or opens are checked against private and local
  address ranges.
- Consequential steps wait for a human when the agent is supervised.
- Replies, tool output and the agent's reasoning are shown as text, never run
  as code in the app.

If you find a way for a model, a web page, a file, search results or an MCP
server to:

- make an agent use a tool outside its grant;
- read or write outside its working directory;
- reach a private or local network address;
- skip an approval the agent's supervision requires;
- read another agent's or another team's memory;
- or run code in the renderer or the main process,

that's a vulnerability. Please report it.

## Out of Scope

- **Third-party services.** OpenRouter and the model makers behind it, Serper,
  the websites agents visit, and the MCP servers you add are run by their own
  operators. Report issues with them through their channels.
- **Actions inside a grant.** What an agent does with tools it was granted,
  after you approved the step or chose to run it unattended, is by design.
- **Compromised machines and modified builds.** This includes the
  environment-variable overrides used for development (`AISERVICE_URL`,
  `BACKEND_URL`, `AUTO_APPROVE_TOOLS`, `APP_USER_DATA`, `SANCTORUM_DATA_DIR`
  and similar). Setting them requires control of the process environment,
  which is equivalent to running code on the machine.
