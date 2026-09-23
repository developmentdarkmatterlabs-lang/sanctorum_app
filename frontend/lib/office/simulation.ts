import { Agent, type AgentHost } from './agent';
import { HIT_TEST, MANUAL_HOLD, MAX_DT } from './constants';
import { walkable } from './grid';
import { roomLabel } from './rooms';
import type { AgentSummary, Room, RosterEntry, SpriteKey } from './types';

export type SimulationListeners = {
  /** Coarse state changed (status/room) — republish summaries. */
  onAgentsChanged: (summaries: AgentSummary[]) => void;
  onLog: (name: string, message: string) => void;
};

/**
 * Owns the agents and the clock. Deliberately framework-free: it mutates in
 * place at frame rate and only notifies listeners on coarse changes, so React
 * re-renders a few times a second rather than sixty.
 */
export class Simulation {
  readonly agents: Agent[] = [];
  /** Roster entries by key, for dossiers and sprite paths. */
  readonly roster = new Map<SpriteKey, RosterEntry>();
  /** The building's floors, loaded from the API. Owned here so the agents can
   *  read live grids and names without importing a global. */
  private roomList: Room[] = [];

  private auto = true;
  private selectedKey: SpriteKey | null = null;
  private listeners: SimulationListeners | null = null;
  private dirty = false;
  private readonly host: AgentHost;

  constructor() {
    this.host = {
      onStatusChanged: () => {
        this.dirty = true;
      },
      onRoomChanged: () => {
        this.dirty = true;
      },
      onLog: (name, message) => this.listeners?.onLog(name, message),
      isAutoEnabled: () => this.auto,
      rooms: () => this.roomList,
    };
  }

  get rooms(): Room[] {
    return this.roomList;
  }

  /** Sets the floor list. Must be called before setRoster, since agents need
   *  their room's seats and grid to spawn. */
  setRooms(rooms: Room[]): void {
    this.roomList = rooms;
  }

  /** Replaces the population. Called once the roster arrives from the API. */
  setRoster(entries: RosterEntry[]): void {
    this.agents.length = 0;
    this.roster.clear();

    entries.forEach((entry) => {
      // The agent needs its floor to exist; its desk is resolved by seatId with
      // a pad fallback, so a missing seat no longer crashes the constructor.
      if (!this.roomList[entry.room]) {
        console.error(
          `Agent "${entry.key}" references room ${entry.room}, which does not exist; skipping.`
        );
        return;
      }
      this.roster.set(entry.key, entry);
      this.agents.push(new Agent(entry, this.host));
    });

    if (this.selectedKey && !this.roster.has(this.selectedKey)) {
      this.selectedKey = null;
    }
    this.publish();
  }

  subscribe(listeners: SimulationListeners): void {
    this.listeners = listeners;
    this.publish();
  }

  unsubscribe(): void {
    this.listeners = null;
  }

  get summaries(): AgentSummary[] {
    return this.agents.map((a) => ({
      key: a.key,
      name: a.name,
      status: a.status,
      room: a.room,
      roomLabel: roomLabel(this.roomList, a.room),
    }));
  }

  private publish(): void {
    this.listeners?.onAgentsChanged(this.summaries);
    this.dirty = false;
  }

  setAuto(auto: boolean): void {
    this.auto = auto;
  }

  get selected(): Agent | null {
    return this.agents.find((a) => a.key === this.selectedKey) ?? null;
  }

  select(key: SpriteKey | null): void {
    this.selectedKey = key;
    this.dirty = true;
  }

  find(key: SpriteKey): Agent | undefined {
    return this.agents.find((a) => a.key === key);
  }

  /**
   * Applies real run state to every agent: `running` = a live run, `blocked` = a
   * run parked on a decision. Clears both on everyone else. Cheap per frame.
   *
   * On the RISING edge (idle -> running) the agent walks to its seat, then
   * settles into the working animation on arrival. Status itself is set by
   * `applyRunState`, which outranks the idle auto-scheduler — so `working` and
   * `waiting` mean what they say instead of being randomly chosen.
   */
  setRunning(running: Set<SpriteKey>, blocked: Set<SpriteKey> = new Set()): void {
    for (const a of this.agents) {
      const isRunning = running.has(a.key);
      const isBlocked = blocked.has(a.key);
      if (a.running !== isRunning || a.blocked !== isBlocked) {
        this.dirty = true;
        // Just picked up work → head to the desk. (Stopping just clears the
        // flags; the auto-scheduler resumes its normal idle behaviour.)
        if (isRunning && !a.running) a.goDesk();
      }
      a.applyRunState(isRunning, isBlocked);
    }
  }

  /** Agent at a world position, for canvas clicks. */
  agentAt(room: number, wx: number, wy: number): Agent | null {
    return (
      this.agents.find(
        (a) =>
          a.room === room &&
          Math.abs(a.px - wx) < HIT_TEST.x &&
          Math.abs(a.py - HIT_TEST.yOffset - wy) < HIT_TEST.y
      ) ?? null
    );
  }

  command(key: SpriteKey, action: 'desk' | 'wander' | 'portal'): void {
    const agent = this.find(key);
    if (!agent) return;

    agent.holdFor(MANUAL_HOLD);
    if (action === 'desk') {
      agent.goDesk();
      this.listeners?.onLog(agent.name, 'was sent to their desk');
    } else if (action === 'wander') {
      agent.wander();
      this.listeners?.onLog(agent.name, 'was sent to wander');
    } else {
      agent.travelRooms();
      this.listeners?.onLog(agent.name, 'was sent through the portal');
    }
  }

  /** Send the selected agent to a tile. Returns false when it isn't walkable. */
  moveSelectedTo(room: number, gx: number, gy: number): boolean {
    const agent = this.selected;
    const grid = this.roomList[room]?.M ?? [];
    if (!agent || !walkable(grid, gx, gy)) return false;

    const viaPortal = agent.room !== room;
    agent.holdFor(MANUAL_HOLD);
    agent.commandTo(room, gx, gy);
    this.listeners?.onLog(
      agent.name,
      `walks to ${gx},${gy}${viaPortal ? ' (via portal)' : ''}`
    );
    return true;
  }

  tick(dtSeconds: number): void {
    const dt = Math.min(MAX_DT, dtSeconds);
    this.agents.forEach((a) => a.update(dt));
    if (this.dirty) this.publish();
  }

  get openingMessage(): string {
    const total = this.agents.length;
    const floors = this.roomList.length;
    const occupied = this.roomList
      .map((room, index) => ({
        name: room.name,
        count: this.agents.filter((a) => a.room === index).length,
      }))
      .filter((r) => r.count > 0);

    const agentWord = total === 1 ? 'agent' : 'agents';
    const floorWord = floors === 1 ? 'floor' : 'floors';

    if (occupied.length === 0) {
      return `facility opened — no agents across ${floors} ${floorWord}`;
    }

    const breakdown = occupied.map((r) => `${r.count} in ${r.name}`).join(', ');
    return `facility opened — ${total} ${agentWord} across ${floors} ${floorWord}: ${breakdown}`;
  }
}
