import { useEffect, useState } from 'react';
import type { Position, RosterEntry, Team } from '@/lib/office/types';

type AssignPositionFormProps = {
  /** The position being filled, or null when closed. */
  position: Position | null;
  teams: Team[];
  roster: RosterEntry[];
  onClose: () => void;
  onAssign: (positionId: string, agentKey: string) => Promise<unknown>;
};

/**
 * Pick an agent to fill a position. Any agent can be chosen; if they already
 * hold another position, assigning here reassigns them (that is shown inline so
 * the move is deliberate). The server refuses only a position already held by a
 * different agent.
 */
export default function AssignPositionForm({
  position,
  teams,
  roster,
  onClose,
  onAssign,
}: AssignPositionFormProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!position) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [position, onClose]);

  if (!position) return null;

  // Where each agent currently sits, so reassignment reads as intentional.
  const currentTitle = (agentKey: string): string | null => {
    for (const t of teams) {
      const held = t.positions.find((p) => p.agentKey === agentKey);
      if (held) return `${t.name} · ${held.title}`;
    }
    return null;
  };

  const pick = (agentKey: string) => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await onAssign(position.id, agentKey);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not assign that agent.');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-full w-[380px] max-w-full flex-col gap-3 overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--surface-secondary)] p-4 shadow-2xl">
        <div className="flex items-center">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
            Assign — {position.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto cursor-pointer rounded border border-[var(--border-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
          >
            close
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded border border-[var(--semantic-error-muted)] bg-[var(--semantic-error)]/10 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-[var(--semantic-error)]"
          >
            {error}
          </p>
        )}

        <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {roster.map((a) => {
            const where = currentTitle(a.key);
            return (
              <li key={a.key}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => pick(a.key)}
                  className={`flex w-full items-center gap-2 rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 text-left transition-colors hover:border-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]`}
                >
                  <span className="font-mono text-[12px] text-[var(--content-primary)]">
                    {a.name}
                  </span>
                  {where && (
                    <span className="ml-auto font-mono text-[9.5px] text-[var(--content-tertiary)]">
                      now: {where}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
