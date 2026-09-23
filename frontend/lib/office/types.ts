export type AgentStatus = 'idle' | 'working' | 'walking' | 'waiting';

/** A reusable skill (.md playbook) in the shared library. Assigned to positions
 *  (seats); injected into a run's system prompt when the seat's holder runs. */
export type Skill = {
  id: string;
  name: string;
  description: string;
  body: string;
  /** Minimum seat clearance to be granted this skill (0 = any). */
  minClearance: number;
  createdAt: string;
  updatedAt: string;
};

/** Where a standing rule applies. Broader scopes are inherited by narrower ones:
 *  a seat follows global + its team's + its position's rules, in that order. */
export type RuleScope = 'global' | 'team' | 'position';

/** A standing rule — "how we always work", injected into EVERY run of the seats in
 *  scope. Distinct from a Skill (a task playbook, applied situationally). */
/** Who an agent is and how it speaks. Assigned to the AGENT, not the seat. */
export type Personality = {
  id: string;
  name: string;
  summary: string;
  /** The voice itself — tone, vocabulary, what this character cares about. */
  body: string;
  /** How to answer "are you an AI?". Blank = the server's default stance. */
  stance: string;
  enabled: boolean;
  /** How many agents wear it, so a delete is never silent. */
  agentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Rule = {
  id: string;
  title: string;
  body: string;
  scope: RuleScope;
  /** The team/position id for team/position scope; null for global. */
  ownerId: string | null;
  order: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Masked view of an MCP server's auth token (never the raw value on read). */
export type AuthStatus = { set: boolean; hint: string };

/** An external MCP server in the shared library. Assigned to positions (seats);
 *  its tools merge into the run's tool list, gated + supervised like any tool. */
export type McpServer = {
  id: string;
  name: string;
  description: string;
  transport: 'http' | 'stdio';
  url: string;
  /** Masked — the raw token is never returned. */
  auth: AuthStatus;
  headers: string;
  command: string;
  args: string;
  minClearance: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/** A logical facing, not a spritesheet row — see `RosterEntry.rowOrder`. */
export type Direction = 0 | 1 | 2 | 3;

export const DIRECTIONS = ['down', 'right', 'up', 'left'] as const;
export type DirectionName = (typeof DIRECTIONS)[number];

export type Point = { x: number; y: number };

/** A prop on a floor. Seeded props are non-blocking (decorative); editor props
 *  block a tile. */
export type Prop = {
  id: string;
  kind: string;
  x: number;
  y: number;
  rotation: number;
  blocking: boolean;
};

/** A decorative floor tile — cosmetic, does not affect walkability. */
export type Tile = {
  id: string;
  kind: string;
  x: number;
  y: number;
  /** Quarter-turn rotation: 0, 90, 180, 270. */
  rotation: number;
};

/** A desk with stable identity, loaded from the API. */
export type Seat = {
  id: string;
  /** The desk's stored seat index on its floor. Use this — not the array
   *  position — when referencing a desk by index: a floor can have gaps. */
  seat: number;
  /** Optional human label for the desk; '' = none (falls back to "seat <index>"). */
  name: string;
  x: number;
  y: number;
  /** Whether an agent currently sits here. */
  occupied: boolean;
};

/**
 * A floor, as delivered by GET /api/rooms. Rooms are runtime data now, not a
 * compile-time constant, so `bg` is a URL and there is an `id`. The portal pad
 * is not carried — it is the shared PAD constant on every floor.
 */
export type Room = {
  id: string;
  /** Position in the building, top to bottom. */
  order: number;
  name: string;
  /** Background image URL (/assets or /api/uploads). */
  bg: string;
  /** Walkability grid: 0 = walkable, 1 = blocked. Indexed [y][x]. */
  M: number[][];
  props: Prop[];
  /** Decorative floor tiles, painted under agents. */
  tiles: Tile[];
  /** Desks on this floor, loaded from the API with stable ids. */
  seats: Seat[];
};

/** A ROLE in the catalog (job architecture) — defined once, referenced by many
 *  seats. Seats INHERIT its title/defaultClearance live, so editing a role moves
 *  every seat holding it (unless that seat sets an override). */
export type Role = {
  id: string;
  title: string;
  /** Seniority band (0 = unbanded). */
  level: number;
  /** Free text: Engineering / Design / Ops / Sales … */
  discipline: string;
  description: string;
  /** The clearance seats inherit unless they override it. */
  defaultClearance: number;
  /** How many seats currently instantiate this role (headcount). */
  seatCount: number;
  createdAt: string;
  updatedAt: string;
};

/** A seat on a team — an instance of a Role that an agent holds. Clearance lives
 *  here (not on the agent's dossier). `title`/`clearance` are the RESOLVED values
 *  (the seat's override if set, else inherited from the role); `overridden` says
 *  which of them are per-seat exceptions. `agentKey` is the holder, or null. */
export type Position = {
  id: string;
  teamId: string;
  title: string;
  clearance: number;
  isLeader: boolean;
  order: number;
  agentKey: string | null;
  /** The role this seat instantiates, or null if it has none. */
  roleId: string | null;
  roleTitle: string | null;
  /** Which values are per-seat exceptions rather than inherited. */
  overridden: { title: boolean; clearance: boolean };
};

/** An org unit: a name, mission, a home floor (by building order), and its
 *  positions. Delivered by GET /api/teams. */
export type Team = {
  id: string;
  name: string;
  mission: string;
  floorId: string | null;
  /** The home floor's building order, or null if the team has no space. */
  floorOrder: number | null;
  /** The team this one reports into, or null for a top-level team. A leader may
   *  delegate to the LEADER of a team whose parent is its own — downward only. */
  parentTeamId: string | null;
  positions: Position[];
};

export type Trait = { label: string; value: string };

/** A rung on the clearance or data-sensitivity ladder. */
export type Level = { level: number; label: string };

/** Vocabularies for the dossier dropdowns, served by GET /api/agents/taxonomy. */
export type Taxonomy = {
  roleGroups: { group: string; roles: string[] }[];
  clearanceLevels: Level[];
  dataTypeLevels: Level[];
  defaults: { role: string; clearance: number; dataType: number; tenure: string };
};

/**
 * One agent, as delivered by GET /api/agents. Carries its own asset paths and
 * dossier rather than being looked up in a compile-time table.
 */
export type RosterEntry = {
  key: SpriteKey;
  name: string;
  room: number;
  seat: number;
  /** Stable desk handle; null only for legacy rows. Position still derives
   *  from room/seat until rooms move into the database. */
  seatId: string | null;
  /** The team position this agent holds, or null if unassigned (on the bench). */
  positionId: string | null;
  /** Per-agent LLM model override (OpenRouter id), or null = global default. */
  model: string | null;
  /** Per-agent IMAGE model for `generate_image`, or null = global default. */
  imageModel: string | null;
  /** Per-agent SPEECH model for `generate_speech`, or null = global default. */
  speechModel: string | null;
  /** The voice this agent wears, or null. A property of the AGENT, not the
   *  seat: move it to another desk and its clearance changes, its voice does not. */
  personalityId: string | null;
  /** 'fetch' | 'browse' | 'both', or null = the global default. */
  webMode: string | null;
  /** USD ceiling for this agent's own delegation subtree (itself plus everything
   *  it delegates), or null = inherit the global ceiling. Both are enforced and
   *  the lower binds — a department's budget nested inside the company's. */
  maxCost: number | null;
  /** A real directory this agent works in instead of the default sandbox, or null. */
  workspaceDir: string | null;
  /** Read-only mount for a real-folder workspace (default true): observe, never mutate. */
  workspaceReadOnly: boolean;
  /** Human-in-the-loop: true (default) = pauses for approval; false = runs unattended. */
  supervised: boolean;
  /** Phase 4: a leader that may fan work out to its reports WITHOUT approving each
   *  delegation. Separate from `supervised` — writes and commands still pause. */
  trustedDelegator: boolean;
  spritePath: string;
  portraitPath: string;
  title: string;
  tagline: string;
  role: string;
  /** Clearance ladder level; the label comes from the taxonomy. */
  clearance: number;
  /** Data sensitivity ladder level. */
  dataType: number;
  tenure: string;
  focus: string;
  /** Which direction each spritesheet row faces, top row first. */
  rowOrder: DirectionName[];
  responsibilities: string[];
};

/** The fields the dossier panel can edit. Clearance is NOT here — it belongs to
 *  the Position (the seat) and is edited on the team, not the character. */
export type AgentEdit = {
  role?: string;
  dataType?: number;
  tenure?: string;
  focus?: string;
  title?: string;
  tagline?: string;
  rowOrder?: DirectionName[];
  /** Per-agent model override (OpenRouter id); '' clears it (use global default). */
  model?: string;
  /** Per-agent image model for `generate_image`; '' clears it. */
  imageModel?: string;
  /** Per-agent speech model for `generate_speech`; '' clears it. */
  speechModel?: string;
  /** The voice to wear; '' clears it. */
  personalityId?: string | null;
  /** Web tools offered; '' clears it (inherit the global). */
  webMode?: string | null;
  /** USD ceiling for this agent's own delegation subtree; null or 0 clears it
   *  (inherit the global ceiling). */
  maxCost?: number | null;
  /** A real directory to work in; '' clears it (back to the default sandbox). */
  workspaceDir?: string;
  /** Read-only mount toggle for a real-folder workspace. */
  workspaceReadOnly?: boolean;
  /** Human-in-the-loop toggle: false = the agent runs unattended. */
  supervised?: boolean;
  /** Phase 4: let this leader delegate without approving each fan-out. */
  trustedDelegator?: boolean;
  /** Reseat the agent. Sent together to move them to a new floor/desk. */
  room?: number;
  seat?: number;
};

/**
 * Agent identifier. Deliberately a plain string rather than a union: agents
 * come from the database at runtime, so the set of keys is not known at
 * compile time.
 */
export type SpriteKey = string;

/**
 * Static shared assets — just the portal now. Props come from the generated
 * PROP_KINDS (drawn by URL into the backgrounds bank), and floor backgrounds are
 * room data loaded from the API by URL.
 */
export type AssetKey = 'portalBig' | 'portalSmall';

/** Serializable snapshot of an agent, published to the UI layer. */
export type AgentSummary = {
  key: SpriteKey;
  name: string;
  status: AgentStatus;
  room: number;
  roomLabel: string;
};

export type LogEntry = {
  id: number;
  time: string;
  name: string;
  message: string;
};

/** Canvas colors resolved from CSS custom properties on theme change. */
export type OfficePalette = {
  selection: string;
  bubbleFg: string;
  bubbleBg: string;
  bubbleWaitingFg: string;
  bubbleWaitingBg: string;
  emptyBg: string;
  shadow: string;
};

export type SimulationEvents = {
  statusChanged: () => void;
  logged: (name: string, message: string) => void;
  roomChanged: (room: number) => void;
};
