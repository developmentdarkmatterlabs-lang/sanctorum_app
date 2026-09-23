import { useCallback, useEffect } from 'react';
import { roleService } from '@/services/roleService';
import { useOfficeStore } from '@/store/officeStore';
import type { RoleInput } from '@/api/roles';

/**
 * Hook seam for the role catalog (Component -> Hook -> Service -> API). Exposes the
 * roles + CRUD; loads the catalog once on mount. Note that `update`/`remove` also
 * refresh teams + roster, because seats inherit a role's title/clearance.
 */
export function useRoles() {
  const roles = useOfficeStore((s) => s.roles);

  useEffect(() => {
    void roleService.load();
  }, []);

  return {
    roles,
    create: useCallback((input: RoleInput) => roleService.create(input), []),
    update: useCallback((id: string, input: RoleInput) => roleService.update(id, input), []),
    remove: useCallback((id: string) => roleService.remove(id), []),
  };
}
