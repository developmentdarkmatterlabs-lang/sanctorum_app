import { useCallback, useEffect } from 'react';
import { skillService } from '@/services/skillService';
import { useOfficeStore } from '@/store/officeStore';
import type { SkillInput } from '@/api/skills';

/**
 * Hook seam for skills (Component -> Hook -> Service -> API). Exposes the library
 * from the store plus CRUD + assignment actions. Loads the library once on mount.
 */
export function useSkills() {
  const skills = useOfficeStore((s) => s.skills);

  useEffect(() => {
    void skillService.loadLibrary();
  }, []);

  return {
    skills,
    create: useCallback((input: SkillInput) => skillService.create(input), []),
    update: useCallback(
      (id: string, input: Partial<SkillInput>) => skillService.update(id, input),
      []
    ),
    remove: useCallback((id: string) => skillService.remove(id), []),
    positionSkills: useCallback((positionId: string) => skillService.positionSkills(positionId), []),
    assign: useCallback(
      (positionId: string, skillId: string) => skillService.assign(positionId, skillId),
      []
    ),
    unassign: useCallback(
      (positionId: string, skillId: string) => skillService.unassign(positionId, skillId),
      []
    ),
  };
}
