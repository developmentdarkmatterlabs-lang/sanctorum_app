import { useEffect, useState } from 'react';
import type { Rule } from '@/lib/office/types';

type RulesInEffectProps = {
  /** The seat's team + position, which decide what it inherits. Null/null for an
   *  unassigned agent (it still gets the global rules). */
  teamId: string | null;
  positionId: string | null;
  /** Resolve the inherited rules for that seat. */
  load: (teamId: string | null, positionId: string | null) => Promise<Rule[]>;
};

const SCOPE_TAG: Record<string, string> = {
  global: 'global',
  team: 'team',
  position: 'seat',
};

/**
 * Read-only: the standing rules this agent will actually follow, inherited from
 * global + its team + its seat. Rules aren't assigned per-agent (they're scoped),
 * so this exists to make the inheritance legible — "why is it behaving this way?".
 * Edit them in the Rules panel.
 */
export default function RulesInEffect({ teamId, positionId, load }: RulesInEffectProps) {
  const [rules, setRules] = useState<Rule[]>([]);

  useEffect(() => {
    let alive = true;
    load(teamId, positionId)
      .then((r) => alive && setRules(r))
      .catch(() => alive && setRules([]));
    return () => {
      alive = false;
    };
  }, [teamId, positionId, load]);

  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
        Rules in effect
      </span>
      {rules.length === 0 ? (
        <p className="font-mono text-[10px] text-[var(--content-tertiary)]">
          None. (Agents work fine without rules.)
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rules.map((r) => (
            <li
              key={r.id}
              className="flex items-start gap-2 rounded border border-[var(--border-primary)] px-2 py-1"
            >
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--accent-secondary)]">
                {SCOPE_TAG[r.scope] ?? r.scope}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[11px] text-[var(--content-primary)]">
                  {r.title}
                </span>
                <span className="block font-mono text-[9.5px] leading-snug text-[var(--content-tertiary)]">
                  {r.body}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
