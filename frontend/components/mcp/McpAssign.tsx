import { useEffect, useState } from 'react';
import type { McpServer } from '@/lib/office/types';

type McpAssignProps = {
  /** The position (seat) whose MCP servers are edited, or null if unassigned. */
  positionId: string | null;
  /** The seat's clearance, to gray out servers it can't hold. */
  clearance: number;
  /** The whole library, to offer for assignment. */
  library: McpServer[];
  loadHeld: (positionId: string) => Promise<McpServer[]>;
  onAssign: (positionId: string, mcpServerId: string) => Promise<McpServer[]>;
  onUnassign: (positionId: string, mcpServerId: string) => Promise<McpServer[]>;
};

const label = 'font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--content-tertiary)]';

/** Assign/unassign MCP servers for the agent's seat, shown in the dossier. Servers
 *  live on the position — an unassigned agent (no seat) shows a hint instead. */
export default function McpAssign({
  positionId,
  clearance,
  library,
  loadHeld,
  onAssign,
  onUnassign,
}: McpAssignProps) {
  const [held, setHeld] = useState<McpServer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!positionId) {
      setHeld([]);
      return;
    }
    loadHeld(positionId)
      .then((s) => alive && setHeld(s))
      .catch(() => alive && setHeld([]));
    return () => {
      alive = false;
    };
  }, [positionId, loadHeld]);

  if (!positionId) {
    return (
      <div className="flex flex-col gap-1">
        <span className={label}>MCPs</span>
        <p className="font-mono text-[10px] leading-relaxed text-[var(--content-tertiary)]">
          MCP servers live on the seat. Assign this agent to a position to grant them.
        </p>
      </div>
    );
  }

  const heldIds = new Set(held.map((s) => s.id));
  const available = library.filter((s) => !heldIds.has(s.id));

  const run = async (fn: () => Promise<McpServer[]>) => {
    setBusy(true);
    setError(null);
    try {
      setHeld(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update MCPs.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className={label}>MCPs (on this seat)</span>

      {held.length === 0 ? (
        <p className="font-mono text-[10px] text-[var(--content-tertiary)]">None assigned.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {held.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded border border-[var(--border-primary)] px-2 py-1"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--content-primary)]">
                {s.name}
                <span className="ml-1 text-[9px] text-[var(--content-tertiary)]">
                  {s.transport}
                  {s.enabled ? '' : ' · off'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void run(() => onUnassign(positionId, s.id))}
                disabled={busy}
                aria-label={`Remove ${s.name}`}
                className="shrink-0 cursor-pointer rounded border border-[var(--border-primary)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--content-tertiary)] hover:border-[var(--semantic-error)] hover:text-[var(--semantic-error)] disabled:opacity-40"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {available.map((s) => {
            const blocked = clearance < s.minClearance;
            return (
              <button
                key={s.id}
                type="button"
                disabled={busy || blocked}
                title={
                  blocked
                    ? `Needs clearance ${s.minClearance}; this seat is ${clearance}`
                    : s.description || s.name
                }
                onClick={() => void run(() => onAssign(positionId, s.id))}
                className="cursor-pointer rounded border border-[var(--accent-secondary)]/40 px-2 py-0.5 font-mono text-[10px] text-[var(--accent-secondary)] hover:bg-[var(--accent-secondary)]/15 disabled:cursor-not-allowed disabled:opacity-30"
              >
                + {s.name}
                {blocked ? ` (clr ${s.minClearance})` : ''}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <p role="alert" className="font-mono text-[10px] text-[var(--semantic-error)]">
          {error}
        </p>
      )}
    </div>
  );
}
