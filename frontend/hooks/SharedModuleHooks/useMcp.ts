import { useCallback, useEffect } from 'react';
import { mcpService } from '@/services/mcpService';
import { useOfficeStore } from '@/store/officeStore';
import type { McpServerInput } from '@/api/mcp';

/**
 * Hook seam for MCP servers (Component -> Hook -> Service -> API). Exposes the
 * library + CRUD + assignment. Loads the library once on mount.
 */
export function useMcp() {
  const mcpServers = useOfficeStore((s) => s.mcpServers);

  useEffect(() => {
    void mcpService.loadLibrary();
  }, []);

  return {
    mcpServers,
    create: useCallback((input: McpServerInput) => mcpService.create(input), []),
    update: useCallback(
      (id: string, input: Partial<McpServerInput>) => mcpService.update(id, input),
      []
    ),
    remove: useCallback((id: string) => mcpService.remove(id), []),
    positionMcps: useCallback((positionId: string) => mcpService.positionMcps(positionId), []),
    assign: useCallback(
      (positionId: string, mcpServerId: string) => mcpService.assign(positionId, mcpServerId),
      []
    ),
    unassign: useCallback(
      (positionId: string, mcpServerId: string) => mcpService.unassign(positionId, mcpServerId),
      []
    ),
  };
}
