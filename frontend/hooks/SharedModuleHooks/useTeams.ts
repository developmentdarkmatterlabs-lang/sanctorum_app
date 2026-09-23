import { useCallback } from 'react';
import { teamService } from '@/services/teamService';
import { useOfficeStore } from '@/store/officeStore';

/**
 * Hook seam for the org model (Component -> Hook -> Service -> API). Exposes the
 * teams from the store plus the team/position/assignment actions, so components
 * never call the service or API directly.
 */
export function useTeams() {
  const teams = useOfficeStore((s) => s.teams);

  return {
    teams,
    createTeam: useCallback(
      (
        name: string,
        mission: string,
        floorId: string | null,
        parentTeamId: string | null = null
      ) => teamService.createTeam(name, mission, floorId, parentTeamId),
      []
    ),
    updateTeam: useCallback(
      (
        teamId: string,
        patch: {
          name?: string;
          mission?: string;
          floorId?: string | null;
          parentTeamId?: string | null;
        }
      ) => teamService.updateTeam(teamId, patch),
      []
    ),
    deleteTeam: useCallback((teamId: string) => teamService.deleteTeam(teamId), []),
    createPosition: useCallback(
      (teamId: string, input: {
    roleId?: string | null;
    titleOverride?: string | null;
    clearanceOverride?: number | null;
    isLeader?: boolean;
  }) =>
        teamService.createPosition(teamId, input),
      []
    ),
    updatePosition: useCallback(
      (positionId: string, patch: {
    roleId?: string | null;
    /** null CLEARS the override, so the seat inherits from its role again. */
    titleOverride?: string | null;
    clearanceOverride?: number | null;
    isLeader?: boolean;
  }) =>
        teamService.updatePosition(positionId, patch),
      []
    ),
    deletePosition: useCallback(
      (positionId: string) => teamService.deletePosition(positionId),
      []
    ),
    assign: useCallback(
      (positionId: string, agentKey: string) => teamService.assign(positionId, agentKey),
      []
    ),
    unassign: useCallback((agentKey: string) => teamService.unassign(agentKey), []),
  };
}
