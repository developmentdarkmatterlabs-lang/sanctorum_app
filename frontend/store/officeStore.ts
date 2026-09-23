import { create } from 'zustand';
import { LOG_LIMIT, type Zoom } from '@/lib/office/constants';
import type {
  AgentSummary,
  LogEntry,
  McpServer,
  Personality,
  Role,
  Rule,
  Room,
  RosterEntry,
  Skill,
  SpriteKey,
  Taxonomy,
  Team,
} from '@/lib/office/types';

type OfficeState = {
  agents: AgentSummary[];
  /** The building's floors, loaded from GET /api/rooms. */
  rooms: Room[];
  roomsLoaded: boolean;
  /** Org units with their positions, loaded from GET /api/teams. */
  teams: Team[];
  /** The shared skill library, loaded from GET /api/skills. */
  skills: Skill[];
  /** The shared MCP server library, loaded from GET /api/mcp. */
  mcpServers: McpServer[];
  /** Standing rules (global/team/position), loaded from GET /api/rules. */
  rules: Rule[];
  /** Personalities, loaded from GET /api/personalities. */
  personalities: Personality[];
  /** The role catalog (job architecture), loaded from GET /api/roles. */
  roles: Role[];
  /** Full roster records, for dossiers. Keyed lookups go through `rosterByKey`. */
  rosterEntries: RosterEntry[];
  rosterByKey: Record<string, RosterEntry>;
  rosterLoaded: boolean;
  rosterError: string | null;
  /** Dropdown vocabularies; null until the API answers. */
  taxonomy: Taxonomy | null;
  log: LogEntry[];
  selectedKey: SpriteKey | null;
  viewRoom: number;
  zoom: Zoom;
  auto: boolean;

  setAgents: (agents: AgentSummary[]) => void;
  setRooms: (rooms: Room[]) => void;
  setTeams: (teams: Team[]) => void;
  setSkills: (skills: Skill[]) => void;
  setMcpServers: (mcpServers: McpServer[]) => void;
  setRules: (rules: Rule[]) => void;
  setPersonalities: (personalities: Personality[]) => void;
  setRoles: (roles: Role[]) => void;
  setRosterEntries: (entries: RosterEntry[]) => void;
  setRoster: (loaded: boolean) => void;
  setRosterError: (error: string | null) => void;
  setTaxonomy: (taxonomy: Taxonomy | null) => void;
  appendLog: (name: string, message: string) => void;
  setSelectedKey: (key: SpriteKey | null) => void;
  setViewRoom: (room: number) => void;
  setZoom: (zoom: Zoom) => void;
  setAuto: (auto: boolean) => void;
};

let logId = 0;

export const useOfficeStore = create<OfficeState>((set) => ({
  agents: [],
  rooms: [],
  roomsLoaded: false,
  teams: [],
  skills: [],
  mcpServers: [],
  rules: [],
  personalities: [],
  roles: [],
  rosterEntries: [],
  rosterByKey: {},
  rosterLoaded: false,
  rosterError: null,
  taxonomy: null,
  log: [],
  selectedKey: null,
  viewRoom: 0,
  zoom: 2,
  auto: true,

  setAgents: (agents) => set({ agents }),
  setRooms: (rooms) => set({ rooms, roomsLoaded: true }),
  setTeams: (teams) => set({ teams }),
  setSkills: (skills) => set({ skills }),
  setMcpServers: (mcpServers) => set({ mcpServers }),
  setRules: (rules) => set({ rules }),
  setPersonalities: (personalities) => set({ personalities }),
  setRoles: (roles) => set({ roles }),

  setRosterEntries: (entries) =>
    set({
      rosterEntries: entries,
      rosterByKey: Object.fromEntries(entries.map((e) => [e.key, e])),
    }),

  setRoster: (rosterLoaded) => set({ rosterLoaded }),
  setRosterError: (rosterError) => set({ rosterError }),
  setTaxonomy: (taxonomy) => set({ taxonomy }),

  appendLog: (name, message) =>
    set((state) => {
      const entry: LogEntry = {
        id: logId++,
        time: new Date().toTimeString().slice(0, 5),
        name,
        message,
      };
      const log = [...state.log, entry];
      return { log: log.length > LOG_LIMIT ? log.slice(log.length - LOG_LIMIT) : log };
    }),

  setSelectedKey: (selectedKey) => set({ selectedKey }),
  setViewRoom: (viewRoom) => set({ viewRoom }),
  setZoom: (zoom) => set({ zoom }),
  setAuto: (auto) => set({ auto }),
}));
