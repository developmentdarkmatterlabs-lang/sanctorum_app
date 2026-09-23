import { StatusPill } from '@/components/ui';
import AgentFace from './AgentFace';
import type { AgentSummary, DirectionName } from '@/lib/office/types';

type AgentAction = 'desk' | 'wander' | 'portal';

const ACTIONS: AgentAction[] = ['desk', 'wander', 'portal'];

type AgentCardProps = {
  agent: AgentSummary;
  sprite: HTMLImageElement | undefined;
  spriteVersion: number;
  rowOrder?: DirectionName[];
  selected: boolean;
  onSelect: () => void;
  onCommand: (action: AgentAction) => void;
  /** Open a chat thread with this agent. */
  onMessage: () => void;
  /** Open the live terminal (activity read-out) for this agent. */
  onTerminal: () => void;
};

export default function AgentCard({
  agent,
  sprite,
  spriteVersion,
  rowOrder,
  selected,
  onSelect,
  onCommand,
  onMessage,
  onTerminal,
}: AgentCardProps) {
  return (
    <div
      className={`rounded-md border bg-[var(--surface-tertiary)] px-2.5 py-2 transition-colors ${
        selected
          ? 'border-[var(--accent-primary)]'
          : 'border-[var(--border-primary)] hover:border-[var(--content-tertiary)]'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex w-full cursor-pointer items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
      >
        <AgentFace sprite={sprite} spriteVersion={spriteVersion} rowOrder={rowOrder} />
        <span className="font-mono text-[12.5px] font-semibold text-[var(--content-primary)]">
          {agent.name}
        </span>
        <span className="ml-auto font-mono text-[9px] tracking-wider text-[var(--content-tertiary)]">
          {agent.roomLabel}
        </span>
        <StatusPill status={agent.status} />
      </button>

      <div className="mt-2 flex gap-[5px]">
        {ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => onCommand(action)}
            className="flex-1 cursor-pointer rounded border border-[var(--border-primary)] bg-[var(--border-secondary)] py-1 font-mono text-[10px] text-[var(--content-secondary)] hover:border-[var(--content-tertiary)] hover:text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
          >
            {action}
          </button>
        ))}
        <button
          type="button"
          onClick={onMessage}
          aria-label={`Message ${agent.name}`}
          className="flex-1 cursor-pointer rounded border border-[var(--accent-primary)]/60 bg-[var(--border-secondary)] py-1 font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
        >
          message
        </button>
        <button
          type="button"
          onClick={onTerminal}
          aria-label={`Terminal for ${agent.name}`}
          title="Live activity terminal"
          className="cursor-pointer rounded border border-[var(--border-primary)] bg-[var(--border-secondary)] px-1.5 py-1 font-mono text-[10px] text-[var(--content-secondary)] hover:border-[var(--content-tertiary)] hover:text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
        >
          {'>_'}
        </button>
      </div>
    </div>
  );
}
