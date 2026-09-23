import {
  assignAgent,
  createPosition,
  createTeam,
  deletePosition,
  deleteTeam,
  fetchTeams,
  unassignAgent,
  updatePosition,
  updateTeam,
} from '@/api/teams';
import { fetchAgents } from '@/api/agents';
import { useOfficeStore } from '@/store/officeStore';

/**
 * Org edits — teams, positions, and agent assignment. Follows
 * Component -> Hook -> Service -> API, then refreshes the store so the change
 * shows up. Team CRUD refreshes teams; assignment also refreshes the roster,
 * because an agent's effective clearance comes from its position.
 */
export class TeamService {
  /** Reload teams into the store. */
  async loadTeams(): Promise<void> {
    useOfficeStore.getState().setTeams(await fetchTeams());
  }

  /** Reload the roster entries (not the sim): assignment changes an agent's
   *  clearance/position, which the dossier reads from rosterByKey. */
  private async refreshRoster(): Promise<void> {
    useOfficeStore.getState().setRosterEntries(await fetchAgents());
  }

  // ---- teams --------------------------------------------------------------

  async createTeam(
    name: string,
    mission: string,
    floorId: string | null,
    parentTeamId: string | null = null
  ): Promise<void> {
    await createTeam(name, mission, floorId, parentTeamId);
    await this.loadTeams();
  }

  async updateTeam(
    teamId: string,
    patch: {
      name?: string;
      mission?: string;
      floorId?: string | null;
      parentTeamId?: string | null;
    }
  ): Promise<void> {
    await updateTeam(teamId, patch);
    await this.loadTeams();
  }

  async deleteTeam(teamId: string): Promise<void> {
    await deleteTeam(teamId);
    // Deleting a team unassigns its holders (FK), so refresh both.
    await this.loadTeams();
    await this.refreshRoster();
  }

  // ---- positions ----------------------------------------------------------

  async createPosition(
    teamId: string,
    input: {
    roleId?: string | null;
    titleOverride?: string | null;
    clearanceOverride?: number | null;
    isLeader?: boolean;
  }
  ): Promise<void> {
    await createPosition(teamId, input);
    await this.loadTeams();
  }

  async updatePosition(
    positionId: string,
    patch: {
    roleId?: string | null;
    /** null CLEARS the override, so the seat inherits from its role again. */
    titleOverride?: string | null;
    clearanceOverride?: number | null;
    isLeader?: boolean;
  }
  ): Promise<void> {
    await updatePosition(positionId, patch);
    // A clearance change alters its holder's effective clearance.
    await this.loadTeams();
    await this.refreshRoster();
  }

  async deletePosition(positionId: string): Promise<void> {
    await deletePosition(positionId);
    await this.loadTeams();
    await this.refreshRoster();
  }

  // ---- assignment ---------------------------------------------------------

  /** Assign (or reassign) an agent to a position. Throws the server's reason on
   *  a conflict (e.g. the position is already held). */
  async assign(positionId: string, agentKey: string): Promise<void> {
    await assignAgent(positionId, agentKey);
    await this.loadTeams();
    await this.refreshRoster();
  }

  /** Remove an agent from its position (back to the bench). */
  async unassign(agentKey: string): Promise<void> {
    await unassignAgent(agentKey);
    await this.loadTeams();
    await this.refreshRoster();
  }
}

export const teamService = new TeamService();
