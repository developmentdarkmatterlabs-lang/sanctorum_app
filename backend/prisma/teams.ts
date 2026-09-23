// Seed data for the Team / Position tables — a couple of starter org units so
// the app isn't empty. Mirrors the rooms.ts pattern: deterministic ids keep the
// seed idempotent (upsert by id), and positions carry the clearance that used
// to live on the agent's dossier.
//
// A team optionally homes on a floor by its `order` (resolved to the Room id at
// seed time). Positions list their title, clearance and whether they lead the
// team. Agents are NOT assigned here — assignment happens in the app (Phase 2).

export type PositionSeed = {
  id: string;
  title: string;
  clearance: number;
  isLeader: boolean;
  order: number;
};

export type TeamSeed = {
  id: string;
  name: string;
  mission: string;
  /** Home floor by its Room.order, or null for a team with no space yet. */
  floorOrder: number | null;
  positions: PositionSeed[];
};

export const TEAM_SEEDS: TeamSeed[] = [
  {
    id: 'team_engineering',
    name: 'Engineering',
    mission: 'Keep the core systems running and ship the roadmap.',
    floorOrder: 0, // HQ
    positions: [
      { id: 'pos_eng_lead', title: 'Engineering Lead', clearance: 7, isLeader: true, order: 0 },
      { id: 'pos_eng_backend', title: 'Backend Engineer', clearance: 5, isLeader: false, order: 1 },
      { id: 'pos_eng_frontend', title: 'Frontend Engineer', clearance: 5, isLeader: false, order: 2 },
      { id: 'pos_eng_intern', title: 'Engineering Intern', clearance: 2, isLeader: false, order: 3 },
      // A ready-to-run seat for testing supervised runs: clearance 5 grants
      // read/list/search + write/edit + run_command, so a task actually calls
      // tools (and thus pauses). Held by the seeded `tester` agent below.
      { id: 'pos_eng_tester', title: 'Test Runner', clearance: 5, isLeader: false, order: 4 },
    ],
  },
  {
    id: 'team_marketing',
    name: 'Marketing',
    mission: 'Tell the story and grow the audience.',
    floorOrder: 3, // Marketing floor
    positions: [
      { id: 'pos_mkt_lead', title: 'Marketing Lead', clearance: 6, isLeader: true, order: 0 },
      { id: 'pos_mkt_content', title: 'Content Strategist', clearance: 4, isLeader: false, order: 1 },
      { id: 'pos_mkt_designer', title: 'Brand Designer', clearance: 4, isLeader: false, order: 2 },
    ],
  },
];
