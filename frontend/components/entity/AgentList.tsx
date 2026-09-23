import { useMemo, useState } from 'react';
import AgentCard from './AgentCard';
import type { OfficeImages } from '@/lib/office/sprites';
import type { AgentSummary, RosterEntry, SpriteKey } from '@/lib/office/types';

type AgentListProps = {
  agents: AgentSummary[];
  images: OfficeImages;
  /** Bumps as sprites decode, so faces repaint once their image lands. */
  spriteVersion: number;
  /** Full roster records, for each sheet's row order. */
  rosterByKey: Record<string, RosterEntry>;
  selectedKey: SpriteKey | null;
  onSelect: (key: SpriteKey) => void;
  onCommand: (key: SpriteKey, action: 'desk' | 'wander' | 'portal') => void;
  onMessage: (key: SpriteKey) => void;
  onTerminal: (key: SpriteKey) => void;
};

const field =
  'w-full rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 font-mono text-[11px] text-[var(--content-primary)] placeholder:text-[var(--content-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]';

export default function AgentList({
  agents,
  images,
  spriteVersion,
  rosterByKey,
  selectedKey,
  onSelect,
  onCommand,
  onMessage,
  onTerminal,
}: AgentListProps) {
  // Local view state: filtering the list is not something the office, the store
  // or the backend needs to know about, so it never leaves this component.
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    // Name, floor and status are all worth matching: "hq" finds a floor's staff
    // and "waiting" finds whoever is parked on a decision.
    return agents.filter((a) =>
      `${a.name} ${a.roomLabel} ${a.status}`.toLowerCase().includes(q)
    );
  }, [agents, query]);

  // The box only earns its space once the list is long enough to scroll past.
  const searchable = agents.length > 5;

  return (
    <div className="flex flex-col gap-2 px-2.5">
      {searchable && (
        <input
          type="search"
          className={field}
          placeholder="Search agents…"
          aria-label="Search agents by name, floor or status"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {shown.length === 0 ? (
        <p className="py-3 text-center font-mono text-[10px] text-[var(--content-tertiary)]">
          No agent matches “{query.trim()}”.
        </p>
      ) : (
        shown.map((agent) => (
          <AgentCard
            key={agent.key}
            agent={agent}
            sprite={images.sprites[agent.key]}
            spriteVersion={spriteVersion}
            rowOrder={rosterByKey[agent.key]?.rowOrder}
            selected={agent.key === selectedKey}
            onSelect={() => onSelect(agent.key)}
            onCommand={(action) => onCommand(agent.key, action)}
            onMessage={() => onMessage(agent.key)}
            onTerminal={() => onTerminal(agent.key)}
          />
        ))
      )}
    </div>
  );
}
