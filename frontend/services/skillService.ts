import {
  assignSkill,
  createSkill,
  deleteSkill,
  fetchPositionSkills,
  fetchSkills,
  unassignSkill,
  updateSkill,
  type SkillInput,
} from '@/api/skills';
import { useOfficeStore } from '@/store/officeStore';
import type { Skill } from '@/lib/office/types';

/**
 * Skills — the shared library of .md playbooks and their assignment to positions.
 * Follows Component -> Hook -> Service -> API. Library CRUD refreshes the store's
 * `skills`; assignment returns the position's current skills for the caller to
 * show (position skills are not held globally — they're per-seat).
 */
export class SkillService {
  /** Reload the library into the store. */
  async loadLibrary(): Promise<void> {
    useOfficeStore.getState().setSkills(await fetchSkills());
  }

  async create(input: SkillInput): Promise<void> {
    await createSkill(input);
    await this.loadLibrary();
  }

  async update(id: string, input: Partial<SkillInput>): Promise<void> {
    await updateSkill(id, input);
    await this.loadLibrary();
  }

  async remove(id: string): Promise<void> {
    await deleteSkill(id);
    await this.loadLibrary();
  }

  /** The skills a position holds (for the assign UI). */
  positionSkills(positionId: string): Promise<Skill[]> {
    return fetchPositionSkills(positionId);
  }

  /** Assign a skill to a position, then return the updated list. */
  async assign(positionId: string, skillId: string): Promise<Skill[]> {
    await assignSkill(positionId, skillId);
    return fetchPositionSkills(positionId);
  }

  /** Remove a skill from a position, then return the updated list. */
  async unassign(positionId: string, skillId: string): Promise<Skill[]> {
    await unassignSkill(positionId, skillId);
    return fetchPositionSkills(positionId);
  }
}

export const skillService = new SkillService();
