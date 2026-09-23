import { useCallback, useEffect } from 'react';
import { personalityService } from '@/services/personalityService';
import { useOfficeStore } from '@/store/officeStore';
import type { PersonalityInput } from '@/api/personalities';

/**
 * Hook seam for personalities (Component -> Hook -> Service -> API). Loads on
 * mount; assignment to an agent rides the ordinary agent save, not this.
 */
export function usePersonalities() {
  const personalities = useOfficeStore((s) => s.personalities);

  useEffect(() => {
    void personalityService.load();
  }, []);

  return {
    personalities,
    create: useCallback((input: PersonalityInput) => personalityService.create(input), []),
    update: useCallback(
      (id: string, input: PersonalityInput) => personalityService.update(id, input),
      []
    ),
    remove: useCallback((id: string) => personalityService.remove(id), []),
  };
}
