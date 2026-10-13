# Sanctorum Privacy

Last updated: October 12, 2026

Sanctorum runs on your computer. Your organisation (floors, teams, roles,
seats and agents), conversations, run history, agent memory, skills, standing
rules and settings are stored in a database on your own disk. Agents work in
folders on your disk too.

Sanctorum's job, though, is to hand work to language models, so a run sends
data to the provider you chose. This page says exactly what leaves your
computer, when, and where it goes.

## What leaves your computer, and when

- **Agent runs (OpenRouter).** Every run sends what the model needs to
  OpenRouter, with your key.
  - **What is sent:**
    - the agent's instructions: its personality, role, skills, the standing
      rules in effect, and the list of reports it can delegate to;
    - the task you gave it;
    - the run's whole conversation so far. That includes the output of every
      tool the agent used: the contents of files it read, pages it fetched,
      search results, and memory entries it read.

    The conversation is sent again with each step of the run. The calls that
    set a run's success criterion and grade its answer send the task and
    conversation too.
  - **Where it goes:** OpenRouter passes the request to the maker of the model
    you picked, in Settings or for that agent (for example Anthropic, OpenAI or
    Google).
  - **Images and speech:** generating an image or audio sends the prompt the
    agent wrote, to the image or speech model you chose, through OpenRouter.
  - **What providers keep:** OpenRouter's and each model maker's own terms
    decide how long they keep what you send, along with any logging options in
    your OpenRouter account. Sanctorum has no account with them on your behalf;
    the requests are made with your key, under your account.
- **Web search (Serper).** When an agent searches, its query goes to Serper
  (google.serper.dev) with your Serper key.
- **Reading web pages.** When an agent fetches a page, Sanctorum requests the
  address the agent chose and identifies itself as Sanctorum. The site sees
  your IP address, as with any visit.
- **The agent browser.** When agents are allowed to browse, they open pages in
  a real browser inside the app. Each agent has its own browser profile, kept
  on disk between runs: cookies, and any site you or the agent sign in to,
  persist until you clear that agent's session from its browser pane.
- **MCP servers.** Servers you register receive the calls agents make to them,
  with their arguments, which can include data from the run, and the access
  token you entered. A local (stdio) server runs as a program on your computer.
- **The model list.** Opening the model picker downloads OpenRouter's public
  model catalogue. No key and no data of yours is sent.
- **A price list at startup.** Each time the AI service starts, LiteLLM, the
  library Sanctorum uses to talk to OpenRouter, downloads its public model
  price list from raw.githubusercontent.com. Nothing of yours is sent.

Nothing else is sent. Sanctorum doesn't check for updates on its own, has no
account or sign-in, and doesn't contact a licence server. Announcements (the
chime and the spoken summaries) use your operating system's own voice and run
locally.

## Usage analytics

Sanctorum sends **no usage analytics, telemetry or crash reports**.

## Your files and settings

The desktop app keeps its data in `%APPDATA%\Sanctorum` on Windows and
`~/Library/Application Support/Sanctorum` on macOS. It contains:

- `database/app.db`: your organisation, conversations, run history and token
  usage, memory, skills, rules, personalities, MCP servers and settings.
  - API keys are encrypted with your operating system's keychain.
  - **MCP server access tokens are stored unencrypted.**
- `database/app.db.bak-<version>`: a copy made before each upgrade changes the
  database
- `agent-workspaces`: the folders agents work in, and the files they write
- `uploads`: sprites and portraits uploaded for agents
- `runs.db`: the saved state of runs that are paused, so they survive a
  restart. Each run's entry is deleted when the run ends.
- `Partitions`: each agent's browser profile, including cookies and sign-ins
- Interface preferences, kept in the app's browser storage

If you point an agent at a real folder on your computer, it works in that
folder directly: read-only by default, and able to change files only if you
allowed it.

Uninstalling Sanctorum leaves this folder in place, so a reinstall finds your
organisation intact. Deleting it removes all of the above. Back it up if you
want to keep your organisation and history.

## Contact

Questions about privacy: support.darkmatterlabs@gmail.com.
