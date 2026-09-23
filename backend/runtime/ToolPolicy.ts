import path from 'path';
import { DATA_ROOT } from '../paths';

// The capability layer. Clearance and floor decide what an agent is ALLOWED to
// do; this is computed in Node and handed to the runtime, which must execute
// within it. Gating lives here, outside the model — a low-clearance agent
// literally receives a smaller tool list and a confined working directory, so no
// prompt can talk its way into more. This is the one place to change the rules.

/** The resolved grant a runtime receives. */
export type ToolGrant = {
  /** Tool names the agent may call. The runtime rejects anything not listed. */
  allowedTools: string[];
  /** The directory the agent is confined to. Absolute, under DATA_ROOT. */
  workingDir: string;
  /** Environment the run may see (never leak host secrets — allowlist only). */
  env: Record<string, string>;
  /** Echoed back for logging/telemetry, not a capability. */
  clearance: number;
};

/** The inputs the policy reads. Kept minimal and provider-free. */
export type PolicyPosition = {
  id: string;
  title: string;
  clearance: number;
  teamId: string;
} | null;

export type PolicyFloor = {
  id: string;
  name: string;
  order: number;
} | null;

// The tool ladder: each rung adds capability. A run gets every tool at or below
// its clearance. Read-only tools sit low; anything that writes or executes sits
// high, so only senior seats can reach it. Tool NAMES are contract strings the
// runtime maps to real implementations — Node never runs them, it only permits.
const TOOL_LADDER: { minClearance: number; tools: string[] }[] = [
  // `read_memory` sits at 0 ON PURPOSE. The ladder is the wrong place to gate it:
  // memoryService.readMemory already filters row by row against the READER's
  // clearance (and agent-scoped memory is owner-only). Gating it here too would
  // mean a low-clearance agent couldn't read even its own notes.
  { minClearance: 0, tools: ['read_file', 'list_dir', 'search', 'read_memory'] },
  // `fetch_url` sits ONE RUNG ABOVE `search`, and the gap is the point: search
  // returns a curated list of snippets from one provider, while fetch_url opens
  // an ARBITRARY url the model chose. It only reads — no file is written, no
  // command runs — so it stays far below `write_file`, but "any address the
  // model can name" is a wider surface than "the top five Google results".
  //
  // The confinement that matters for this tool is not clearance, it is the SSRF
  // guard in tools/web.py: without it, an agent could read the app's own backend
  // on localhost through a capability we handed it deliberately.
  { minClearance: 1, tools: ['fetch_url'] },
  // Writing memory is consequential — it is durable, other agents will read it,
  // and it outlives the run. Same rung as writing a file.
  // `generate_speech` sits beside `generate_image` and for the same reason: it
  // WRITES A FILE into the workspace and spends real money doing it. Producing
  // media is a consequential act whatever the medium.
  {
    minClearance: 3,
    tools: ['write_file', 'edit_file', 'write_memory', 'generate_image', 'generate_speech'],
  },
  // The browser sits with `run_command`: both act on the world outside the
  // workspace. `read_page` is read-only but ships with the rest, since a
  // session that can read is one click from acting.
  {
    minClearance: 5,
    tools: ['run_command', 'browse', 'click', 'type', 'scroll', 'back', 'read_page'],
  },
  // Phase 4 — hand work to your own reports. A high rung, because a fan-out
  // multiplies both cost and blast radius. Clearance is only HALF this gate: the
  // caller must also hold its team's leader seat, checked in delegationService.
  // Clearance says "senior enough"; isLeader says "actually their manager".
  { minClearance: 6, tools: ['delegate'] },
  { minClearance: 7, tools: ['network', 'manage_secrets'] },
];

// The read-only subset — the tools that only observe, never mutate. A real-folder
// mount in read-only mode is confined to exactly these, regardless of clearance.
// `fetch_url` belongs here: a read-only mount is a promise about the USER'S
// FILES, not a vow of silence towards the internet. An agent asked to review a
// folder without touching it still needs to look things up.
const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_dir',
  'search',
  'read_memory',
  'fetch_url',
]);

/** Which web tools an agent is OFFERED. Not a permission — clearance already
 *  decides what is reachable, and a mode can only ever remove from that. */
export type WebMode = 'fetch' | 'browse' | 'both';

export const isWebMode = (v: unknown): v is WebMode =>
  v === 'fetch' || v === 'browse' || v === 'both';

/** The browser tools, as one set, so the ladder and the mode filter agree. */
const BROWSER_TOOLS = new Set(['browse', 'click', 'type', 'scroll', 'back', 'read_page']);

/** An agent's override to work in a specific real directory instead of the default
 *  per-floor sandbox. `readOnly` (the safe default) strips all mutating tools so
 *  the agent can look at the folder but never change it. */
export type WorkspaceOverride = {
  dir: string;
  readOnly: boolean;
};

/** Slugifies a name into a safe directory segment. */
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'floor';

/**
 * Computes what an agent may do, from its position (clearance) and floor (space).
 * Pure and deterministic — same inputs, same grant. The working directory is
 * per-floor and confined under DATA_ROOT/agent-workspaces, so a team's agents
 * share a space and can't reach outside it. Unassigned agents (null position)
 * get the lowest, read-only grant.
 */
export function toolPolicy(
  position: PolicyPosition,
  floor: PolicyFloor,
  workspace?: WorkspaceOverride | null,
  webMode: WebMode = 'fetch'
): ToolGrant {
  const clearance = position?.clearance ?? 0;

  let allowedTools = TOOL_LADDER.filter((r) => clearance >= r.minClearance).flatMap(
    (r) => r.tools
  );

  // A real-folder mount in read-only mode is capped to observe-only tools, no
  // matter the clearance — the agent can read the folder but never mutate it.
  if (workspace?.readOnly) {
    allowedTools = allowedTools.filter((t) => READ_ONLY_TOOLS.has(t));
  }

  // Web mode narrows what is left. Applied AFTER the ladder on purpose: an agent
  // below clearance 5 set to 'browse' gets nothing web, because the rung already
  // removed the browser and a mode can only subtract.
  if (webMode === 'fetch') {
    allowedTools = allowedTools.filter((t) => !BROWSER_TOOLS.has(t));
  } else if (webMode === 'browse') {
    allowedTools = allowedTools.filter((t) => t !== 'fetch_url');
  }

  // Working directory: the override (a real folder) if set, else a floor's
  // sandbox workspace, else a shared bench workspace.
  const segment = floor ? `${floor.order}-${slug(floor.name)}` : 'bench';
  const workingDir = workspace?.dir
    ? path.resolve(workspace.dir)
    : path.join(DATA_ROOT, 'agent-workspaces', segment);

  // Minimal env. Deliberately does NOT spread process.env — only what's granted.
  const env: Record<string, string> = {
    SANCTORUM_CLEARANCE: String(clearance),
    SANCTORUM_FLOOR: floor?.name ?? 'bench',
    SANCTORUM_WORKDIR: workingDir,
    SANCTORUM_MOUNT: workspace?.dir ? (workspace.readOnly ? 'ro' : 'rw') : 'sandbox',
  };

  // Let `run_command` find real tools (node/npm/git/…). Without PATH a stripped
  // env can't resolve any executable ("'npm' is not recognized"). PATH is not a
  // secret; we pass ONLY it plus the handful of OS-bootstrap vars a shell needs to
  // even start — NOT the rest of the host environment (no tokens/keys). On Windows
  // `cmd.exe` itself needs COMSPEC/SYSTEMROOT, and resolving `npm.cmd` needs
  // PATHEXT; without these even `where` fails. This is the allowlist, nothing more.
  const PASSTHROUGH_ENV = [
    'PATH',
    'Path', // Windows sometimes cases it this way
    'PATHEXT', // resolve .cmd/.exe/.bat on Windows
    'SYSTEMROOT', // cmd.exe / many Windows tools
    'SystemRoot',
    'COMSPEC', // the shell cmd.exe uses
    'ComSpec',
    'WINDIR',
    'TEMP', // scratch space many installers need
    'TMP',
    'HOME', // POSIX tool config
    'LANG',
  ];
  for (const key of PASSTHROUGH_ENV) {
    const val = process.env[key];
    if (val) env[key] = val;
  }
  // Normalize to uppercase PATH so the Python side (and POSIX tools) find it even
  // when the host provided "Path".
  if (!env.PATH && env.Path) env.PATH = env.Path;

  return { allowedTools, workingDir, env, clearance };
}
