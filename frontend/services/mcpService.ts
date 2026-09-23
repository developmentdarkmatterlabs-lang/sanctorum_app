import {
  assignMcp,
  createMcpServer,
  deleteMcpServer,
  fetchMcpServers,
  fetchPositionMcps,
  unassignMcp,
  updateMcpServer,
  type McpServerInput,
} from '@/api/mcp';
import { useOfficeStore } from '@/store/officeStore';
import type { McpServer } from '@/lib/office/types';

/**
 * MCP servers — the shared library of external MCP servers and their assignment to
 * positions. Follows Component -> Hook -> Service -> API. Library CRUD refreshes
 * the store's `mcpServers`; assignment returns the position's current list (per
 * seat, not global).
 */
export class McpService {
  async loadLibrary(): Promise<void> {
    useOfficeStore.getState().setMcpServers(await fetchMcpServers());
  }

  async create(input: McpServerInput): Promise<void> {
    await createMcpServer(input);
    await this.loadLibrary();
  }

  async update(id: string, input: Partial<McpServerInput>): Promise<void> {
    await updateMcpServer(id, input);
    await this.loadLibrary();
  }

  async remove(id: string): Promise<void> {
    await deleteMcpServer(id);
    await this.loadLibrary();
  }

  positionMcps(positionId: string): Promise<McpServer[]> {
    return fetchPositionMcps(positionId);
  }

  async assign(positionId: string, mcpServerId: string): Promise<McpServer[]> {
    await assignMcp(positionId, mcpServerId);
    return fetchPositionMcps(positionId);
  }

  async unassign(positionId: string, mcpServerId: string): Promise<McpServer[]> {
    await unassignMcp(positionId, mcpServerId);
    return fetchPositionMcps(positionId);
  }
}

export const mcpService = new McpService();
