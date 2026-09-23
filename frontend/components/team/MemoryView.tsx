import { useEffect, useState } from 'react';
import { memoryService } from '@/services/memoryService';
import type { MemoryEntry, MemoryKind, MemoryScope } from '@/api/memory';

type MemoryViewProps = {
  scope: MemoryScope;
  ownerId: string;
  /** Human label for the owner (team/position/agent name), for the heading. */
  ownerLabel: string;
  /** When set, reads are gated as this agent (what they may see). Omit for the
   *  unfiltered management view. */
  asAgentKey?: string;
  /** Position memory is clearance-tagged; show the clearance control for it. */
  showClearance?: boolean;
};

const KINDS: MemoryKind[] = ['task', 'result', 'insight', 'note'];

const field =
  'w-full rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 font-mono text-[12px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]';
const label =
  'font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--content-tertiary)]';

/** A memory kind's dot colour, so entries scan quickly by type. */
const kindColor: Record<MemoryKind, string> = {
  task: 'var(--accent-secondary)',
  result: 'var(--accent-primary)',
  insight: 'var(--semantic-success, var(--accent-primary))',
  note: 'var(--content-tertiary)',
};

/**
 * Views (and edits) the memory of a team, position, or agent. Loads on mount and
 * whenever the owner changes — derived from props, refetched imperatively rather
 * than synced into state. The server enforces the read gate; this only shows
 * what it returns.
 */
export default function MemoryView({
  scope,
  ownerId,
  ownerLabel,
  asAgentKey,
  showClearance = false,
}: MemoryViewProps) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<MemoryKind>('note');
  const [clearance, setClearance] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    memoryService
      .read(scope, ownerId, asAgentKey)
      .then((rows) => live && setEntries(rows))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load memory.'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [scope, ownerId, asAgentKey]);

  const add = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // Pass `asAgentKey` so the refreshed list is filtered the same way the
      // initial load was — otherwise writing a high-clearance entry makes it
      // appear in a view that should not show it.
      const rows = await memoryService.add(
        scope,
        ownerId,
        {
          body: body.trim(),
          kind,
          clearance: showClearance ? clearance : undefined,
        },
        asAgentKey
      );
      setEntries(rows);
      setBody('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      setEntries(await memoryService.remove(id, scope, ownerId, asAgentKey));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <h4 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
        {ownerLabel} — memory
        {asAgentKey && (
          <span className="ml-1 normal-case tracking-normal text-[var(--content-tertiary)]">
            (as seen by this agent)
          </span>
        )}
      </h4>

      {error && (
        <p
          role="alert"
          className="rounded border border-[var(--semantic-error-muted)] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--semantic-error)]"
        >
          {error}
        </p>
      )}

      {loading ? (
        <p className="font-mono text-[10px] text-[var(--content-tertiary)]">loading…</p>
      ) : entries.length === 0 ? (
        <p className="font-mono text-[10px] text-[var(--content-tertiary)]">nothing yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((m) => (
            <li
              key={m.id}
              className="flex items-start gap-2 rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5"
            >
              <span
                aria-hidden="true"
                className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: kindColor[m.kind] }}
                title={m.kind}
              />
              <div className="min-w-0 flex-1">
                <p className="break-words font-mono text-[11.5px] leading-snug text-[var(--content-primary)]">
                  {m.body}
                </p>
                <p className="mt-0.5 font-mono text-[9px] text-[var(--content-tertiary)]">
                  {m.kind}
                  {m.scope === 'position' && m.clearance > 0 ? ` · clearance ${m.clearance}` : ''}
                  {/* Agents write memory too (via the `write_memory` tool), so say
                      WHO recorded an entry — otherwise a note an agent made during
                      a run is indistinguishable from one you typed. */}
                  {m.authorAgentKey ? (
                    <span className="text-[var(--accent-secondary)]"> · by {m.authorAgentKey}</span>
                  ) : (
                    ' · manual'
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(m.id)}
                disabled={busy}
                aria-label="Delete memory"
                className="shrink-0 cursor-pointer rounded border border-[var(--border-primary)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--content-tertiary)] hover:border-[var(--semantic-error)] hover:text-[var(--semantic-error)] disabled:opacity-40"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add form */}
      <div className="flex flex-col gap-1.5 border-t border-[var(--border-primary)] pt-2">
        <textarea
          className={`${field} min-h-[44px] resize-y`}
          placeholder="Add a memory…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1">
            <span className={label}>Kind</span>
            <select
              className="cursor-pointer rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-1 py-0.5 font-mono text-[10px] text-[var(--content-primary)]"
              value={kind}
              onChange={(e) => setKind(e.target.value as MemoryKind)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>

          {showClearance && (
            <label
              className="flex items-center gap-1"
              title="Minimum clearance to read this entry back. Above the seat's own clearance, it disappears from this view — which is the gate working, not a bug."
            >
              <span className={label}>Clr</span>
              <select
                className="cursor-pointer rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-1 py-0.5 font-mono text-[10px] text-[var(--content-primary)]"
                value={clearance}
                onChange={(e) => setClearance(Number(e.target.value))}
              >
                {Array.from({ length: 9 }, (_, i) => i).map((c) => (
                  <option key={c} value={c}>
                    {c}{c === 0 ? ' (open)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            onClick={() => void add()}
            disabled={busy || !body.trim()}
            className="ml-auto shrink-0 cursor-pointer rounded border border-[var(--accent-primary)] px-2.5 py-1 font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            add
          </button>
        </div>
      </div>
    </div>
  );
}
