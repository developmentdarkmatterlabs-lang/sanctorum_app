import { Simulation } from '@/lib/office/simulation';
import { worldToTile } from '@/lib/office/grid';
import { ensureAgentSprites, ensureBackgrounds } from '@/lib/office/spriteStore';
import type { Zoom } from '@/lib/office/constants';
import { useOfficeStore } from '@/store/officeStore';
import type { AgentEdit, RosterEntry, SpriteKey } from '@/lib/office/types';
import {
  createAgent,
  deleteAgent,
  fetchAgents,
  fetchTakenSeats,
  fetchTaxonomy,
  updateAgent,
  type CreateAgentInput,
} from '@/api/agents';
import {
  createFloor,
  deleteFloor,
  fetchRooms,
  renameFloor,
  reorderFloor,
} from '@/api/rooms';
import { teamService } from './teamService';

/**
 * The layer between UI and the simulation. Actions flow
 * Component -> Hook -> Service -> API, and results come back by way of the
 * store: API -> Service -> store -> Hook -> component re-renders.
 */
export class OfficeService {
  constructor(private readonly sim: Simulation) {}

  /** Unsubscribe for the store->sim rooms mirror, torn down on disconnect. */
  private unsubRooms: (() => void) | null = null;

  /** Live agent instances, for the render loop only. */
  get agents() {
    return this.sim.agents;
  }

  /** Wire simulation events into the store, then load rooms and the roster. */
  connect(): void {
    const { setAgents, appendLog } = useOfficeStore.getState();
    this.sim.subscribe({
      onAgentsChanged: setAgents,
      onLog: appendLog,
    });
    // Mirror the store's rooms into the simulation, so an optimistic edit (a
    // painted collision cell, a moved seat) reaches agent pathfinding at once —
    // agents read grids from the sim's roomList, not the store.
    this.unsubRooms = useOfficeStore.subscribe((state, prev) => {
      if (state.rooms !== prev.rooms) this.sim.setRooms(state.rooms);
    });
    // Rooms must land before the roster: agents need their floor's seats and
    // grid to spawn. The roster load is chained after.
    void this.loadRooms().then(() => this.loadRoster({ announce: true }));
    void this.loadTaxonomy();
    void teamService.loadTeams();
  }

  /** Component -> Hook -> Service -> API: GET /api/rooms. */
  async loadRooms(): Promise<void> {
    const { setRooms, setRosterError, appendLog } = useOfficeStore.getState();
    try {
      const rooms = await fetchRooms();
      this.sim.setRooms(rooms);
      setRooms(rooms);
      ensureBackgrounds(rooms.map((r) => r.bg));
    } catch (error) {
      setRosterError(error instanceof Error ? error.message : String(error));
      appendLog('system', 'could not reach the backend — is it running on :3001?');
      console.error('Failed to load rooms:', error);
    }
  }

  /** Dropdown vocabularies for the dossier and the add form. */
  async loadTaxonomy(): Promise<void> {
    try {
      useOfficeStore.getState().setTaxonomy(await fetchTaxonomy());
    } catch (error) {
      console.error('Failed to load taxonomy:', error);
    }
  }

  disconnect(): void {
    this.sim.unsubscribe();
    this.unsubRooms?.();
    this.unsubRooms = null;
  }

  /** Component -> Hook -> Service -> API: GET /api/agents. */
  async loadRoster({ announce = false }: { announce?: boolean } = {}): Promise<void> {
    const { setRoster, setRosterError, appendLog } = useOfficeStore.getState();
    try {
      const entries = await fetchAgents();
      this.applyRoster(entries);
      setRosterError(null);
      if (announce) appendLog('system', this.sim.openingMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRosterError(message);
      appendLog('system', 'could not reach the backend — is it running on :3001?');
      console.error('Failed to load roster:', error);
    } finally {
      setRoster(true);
    }
  }

  private applyRoster(entries: RosterEntry[]): void {
    ensureAgentSprites(entries);
    this.sim.setRoster(entries);
    useOfficeStore.getState().setRosterEntries(entries);
  }

  tick(dt: number): void {
    this.sim.tick(dt);
  }

  /** Mark which agents are "running" a task, so the renderer can flag them. */
  setRunning(keys: Set<SpriteKey>, blocked?: Set<SpriteKey>): void {
    this.sim.setRunning(keys, blocked);
  }

  selectAgent(key: SpriteKey | null): void {
    const { selectedKey, setSelectedKey, setViewRoom } = useOfficeStore.getState();
    const next = selectedKey === key ? null : key;

    this.sim.select(next);
    setSelectedKey(next);

    // Follow the agent into its room, so the next tile click targets what the
    // user is actually looking at.
    if (next) {
      const agent = this.sim.find(next);
      if (agent) setViewRoom(agent.room);
    }
  }

  /** Canvas click: select an agent under the cursor, else move the selected one. */
  handleCanvasClick(offsetX: number, offsetY: number): void {
    const { viewRoom, zoom } = useOfficeStore.getState();
    const worldX = offsetX / zoom;
    const worldY = offsetY / zoom;

    const hit = this.sim.agentAt(viewRoom, worldX, worldY);
    if (hit) {
      this.selectAgent(hit.key);
      return;
    }

    const { x, y } = worldToTile(worldX, worldY);
    this.sim.moveSelectedTo(viewRoom, x, y);
  }

  command(key: SpriteKey, action: 'desk' | 'wander' | 'portal'): void {
    this.sim.command(key, action);
  }

  /** POST /api/agents, then refresh so the new agent walks in. */
  async addAgent(input: CreateAgentInput): Promise<RosterEntry> {
    const created = await createAgent(input);
    await this.loadRoster();
    useOfficeStore.getState().appendLog('system', `${created.name} joined the facility`);
    return created;
  }

  /**
   * PATCH /api/agents/:key with whatever the dossier changed, then refresh so
   * the simulation picks up a new row order or seat immediately.
   */
  async saveAgent(key: SpriteKey, edit: AgentEdit): Promise<RosterEntry> {
    const updated = await updateAgent(key, edit);
    await this.loadRoster();
    useOfficeStore.getState().appendLog('system', `${updated.name}'s dossier updated`);
    return updated;
  }

  /** DELETE /api/agents/:key, then refresh. */
  async removeAgent(key: SpriteKey): Promise<void> {
    const name = this.sim.roster.get(key)?.name ?? key;
    await deleteAgent(key);
    if (useOfficeStore.getState().selectedKey === key) {
      this.sim.select(null);
      useOfficeStore.getState().setSelectedKey(null);
    }
    await this.loadRoster();
    useOfficeStore.getState().appendLog('system', `${name} left the facility`);
  }

  /** Seats already occupied, so the form can offer only free ones. */
  takenSeats(room: number): Promise<{ room: number; taken: number[] }> {
    return fetchTakenSeats(room);
  }

  // ---- floors --------------------------------------------------------------

  /** Keeps the viewed floor in range after a delete/reorder shifts indices. */
  private clampViewRoom(): void {
    const { rooms, viewRoom, setViewRoom } = useOfficeStore.getState();
    const clamped = Math.max(0, Math.min(rooms.length - 1, viewRoom));
    if (clamped !== viewRoom) setViewRoom(clamped);
  }

  /**
   * POST /api/rooms (name + background), then reload and jump to the new floor.
   * It starts fully walkable — the collision grid is painted in later.
   */
  async createFloor(name: string, background: File): Promise<void> {
    const room = await createFloor(name, background);
    await this.loadRooms();
    useOfficeStore.getState().setViewRoom(room.order);
    useOfficeStore.getState().appendLog('system', `floor "${room.name}" added`);
  }

  /** PATCH /api/rooms/:id/name, then reload so the label updates everywhere. */
  async renameFloor(roomId: string, name: string): Promise<void> {
    await renameFloor(roomId, name);
    await this.loadRooms();
    useOfficeStore.getState().appendLog('system', `floor renamed to "${name}"`);
  }

  /**
   * PATCH /api/rooms/:id/order, then reload rooms AND the roster: reordering
   * renumbers every floor's `order` and its agents' room index server-side, so
   * the simulation must re-read both to keep agents on the right floor.
   */
  async reorderFloor(roomId: string, order: number): Promise<void> {
    await reorderFloor(roomId, order);
    await this.loadRooms();
    await this.loadRoster();
    this.clampViewRoom();
  }

  /**
   * DELETE /api/rooms/:id, then reload rooms and the roster (the floors below
   * renumber). Rejects with the server's reason if agents still live there.
   */
  async deleteFloor(roomId: string): Promise<void> {
    const name = useOfficeStore.getState().rooms.find((r) => r.id === roomId)?.name ?? 'floor';
    await deleteFloor(roomId);
    await this.loadRooms();
    await this.loadRoster();
    this.clampViewRoom();
    useOfficeStore.getState().appendLog('system', `floor "${name}" removed`);
  }

  setViewRoom(room: number): void {
    useOfficeStore.getState().setViewRoom(room);
  }

  setZoom(zoom: Zoom): void {
    useOfficeStore.getState().setZoom(zoom);
  }

  toggleAuto(): void {
    const { auto, setAuto } = useOfficeStore.getState();
    const next = !auto;
    this.sim.setAuto(next);
    setAuto(next);
  }
}

export const createOfficeService = () => new OfficeService(new Simulation());
