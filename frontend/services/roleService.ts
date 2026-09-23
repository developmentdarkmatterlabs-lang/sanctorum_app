import { createRole, deleteRole, fetchRoles, updateRole, type RoleInput } from '@/api/roles';
import { fetchTeams } from '@/api/teams';
import { fetchAgents } from '@/api/agents';
import { useOfficeStore } from '@/store/officeStore';

/**
 * The role catalog (job architecture). Follows Component -> Hook -> Service -> API.
 *
 * Editing a role PROPAGATES: seats inherit its title/clearance live, and an agent's
 * dossier clearance comes from its seat. So a role edit refreshes the roster and
 * teams too — otherwise the UI would keep showing stale seat values after a change
 * that really did move them.
 */
export class RoleService {
  async load(): Promise<void> {
    useOfficeStore.getState().setRoles(await fetchRoles());
  }

  /** Reload everything a role change can touch: the catalog, the seats that
   *  inherit from it, and the agents whose clearance those seats decide. */
  private async refreshInherited(): Promise<void> {
    const [roles, teams, roster] = await Promise.all([
      fetchRoles(),
      fetchTeams(),
      fetchAgents(),
    ]);
    const store = useOfficeStore.getState();
    store.setRoles(roles);
    store.setTeams(teams);
    store.setRosterEntries(roster);
  }

  async create(input: RoleInput): Promise<void> {
    await createRole(input);
    await this.load(); // a new role holds no seats yet — nothing else can change
  }

  async update(id: string, input: RoleInput): Promise<void> {
    await updateRole(id, input);
    await this.refreshInherited();
  }

  /** Throws with the server's message ("N seats hold this role…") when in use. */
  async remove(id: string): Promise<void> {
    await deleteRole(id);
    await this.refreshInherited();
  }
}

export const roleService = new RoleService();
