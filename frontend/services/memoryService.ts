import {
  deleteMemory,
  fetchMemory,
  writeMemory,
  type MemoryEntry,
  type MemoryKind,
  type MemoryScope,
} from '@/api/memory';

/**
 * Memory reads/writes. Memory is viewed on demand (in a panel), not held in the
 * global store like teams or rooms, so this service returns entries to the
 * caller rather than patching a store. The clearance/membership gate lives on
 * the server; `asAgentKey` opts a read into it.
 */
export class MemoryService {
  /** Read an owner's memory, optionally gated as a given agent. */
  read(scope: MemoryScope, ownerId: string, asAgentKey?: string): Promise<MemoryEntry[]> {
    return fetchMemory(scope, ownerId, asAgentKey);
  }

  /**
   * Add an entry, then return the fresh list AS THE SAME READER that loaded it.
   *
   * `asAgentKey` is not optional in practice: refetching without it returns the
   * UNFILTERED list, so a clearance-8 entry written into a clearance-3 seat's
   * memory would appear in a view that had correctly hidden it a moment earlier.
   * The gate itself was never wrong — this refresh was silently bypassing it.
   */
  async add(
    scope: MemoryScope,
    ownerId: string,
    input: { body: string; kind?: MemoryKind; clearance?: number; authorAgentKey?: string | null },
    asAgentKey?: string
  ): Promise<MemoryEntry[]> {
    await writeMemory(scope, ownerId, input);
    return fetchMemory(scope, ownerId, asAgentKey);
  }

  /** Delete an entry, then return the fresh list as the same reader (see `add`). */
  async remove(
    id: string,
    scope: MemoryScope,
    ownerId: string,
    asAgentKey?: string
  ): Promise<MemoryEntry[]> {
    await deleteMemory(id);
    return fetchMemory(scope, ownerId, asAgentKey);
  }
}

export const memoryService = new MemoryService();
