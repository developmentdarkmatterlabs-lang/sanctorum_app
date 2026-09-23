import { useCallback, useEffect } from 'react';
import { ruleService } from '@/services/ruleService';
import { useOfficeStore } from '@/store/officeStore';
import type { RuleInput } from '@/api/rules';

/**
 * Hook seam for standing rules (Component -> Hook -> Service -> API). Exposes the
 * rule list + CRUD + the per-seat "effective rules" resolver. Loads on mount.
 */
export function useRules() {
  const rules = useOfficeStore((s) => s.rules);

  useEffect(() => {
    void ruleService.load();
  }, []);

  return {
    rules,
    create: useCallback((input: RuleInput) => ruleService.create(input), []),
    update: useCallback((id: string, input: RuleInput) => ruleService.update(id, input), []),
    remove: useCallback((id: string) => ruleService.remove(id), []),
    reorder: useCallback(
      (items: { id: string; order: number }[]) => ruleService.reorder(items),
      []
    ),
    effectiveFor: useCallback(
      (teamId: string | null, positionId: string | null) =>
        ruleService.effectiveFor(teamId, positionId),
      []
    ),
  };
}
