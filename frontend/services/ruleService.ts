import {
  createRule,
  deleteRule,
  fetchEffectiveRules,
  fetchRules,
  reorderRules,
  updateRule,
  type RuleInput,
} from '@/api/rules';
import { useOfficeStore } from '@/store/officeStore';
import type { Rule } from '@/lib/office/types';

/**
 * Standing rules — "how we always work", scoped global/team/position and inherited
 * by every seat in scope. Follows Component -> Hook -> Service -> API; CRUD
 * refreshes the store's `rules`. `effectiveFor` resolves what one seat follows
 * (read-only, for the dossier) — not stored globally, it's per-seat.
 */
export class RuleService {
  async load(): Promise<void> {
    useOfficeStore.getState().setRules(await fetchRules());
  }

  async create(input: RuleInput): Promise<void> {
    await createRule(input);
    await this.load();
  }

  async update(id: string, input: RuleInput): Promise<void> {
    await updateRule(id, input);
    await this.load();
  }

  async remove(id: string): Promise<void> {
    await deleteRule(id);
    await this.load();
  }

  async reorder(items: { id: string; order: number }[]): Promise<void> {
    await reorderRules(items);
    await this.load();
  }

  /** The rules a given seat follows, inherited (global + team + position). */
  effectiveFor(teamId: string | null, positionId: string | null): Promise<Rule[]> {
    return fetchEffectiveRules(teamId, positionId);
  }
}

export const ruleService = new RuleService();
