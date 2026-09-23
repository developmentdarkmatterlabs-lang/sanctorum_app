import type { AgentStatus } from '@/lib/office/types';

/** The lifecycle of a RUN, as the backend reports it on `Run.status`. A distinct
 *  vocabulary from AgentStatus: an agent is idle/working/walking/waiting in the
 *  office; a run is running/paused/done/error/cancelled. They overlap in colour,
 *  not in meaning — which is why both live here rather than one being cast to
 *  the other. */
export type RunStatus = 'running' | 'paused' | 'done' | 'error' | 'cancelled';

export type PillStatus = AgentStatus | RunStatus;

/** Token classes per status. Exported so a view that needs the pill's colours
 *  without its markup (a compact tile, an inline badge) reuses these rather
 *  than copying hex or re-deriving the mapping. */
export const STATUS_STYLES: Record<PillStatus, string> = {
  // Agent lifecycle (office view)
  idle: 'text-[var(--content-secondary)] border-[var(--border-primary)]',
  working: 'text-[var(--semantic-success)] border-[var(--semantic-success-muted)]',
  walking: 'text-[var(--semantic-info)] border-[var(--semantic-info-muted)]',
  waiting: 'text-[var(--accent-primary)] border-[var(--accent-muted)]',
  // Run lifecycle (terminal / fleet / delegation tree)
  running: 'text-[var(--semantic-success)] border-[var(--semantic-success-muted)]',
  paused: 'text-[var(--accent-primary)] border-[var(--accent-muted)]',
  done: 'text-[var(--content-secondary)] border-[var(--border-primary)]',
  error: 'text-[var(--semantic-error)] border-[var(--semantic-error-muted)]',
  cancelled: 'text-[var(--content-tertiary)] border-[var(--border-primary)]',
};

type StatusPillProps = {
  status: PillStatus;
  /** Smaller variant for dense views (the delegation tree, fleet tiles). */
  compact?: boolean;
  className?: string;
};

export default function StatusPill({ status, compact = false, className = '' }: StatusPillProps) {
  // An unknown status still renders rather than crashing on `undefined` classes.
  const styles = STATUS_STYLES[status] ?? STATUS_STYLES.idle;
  const size = compact ? 'px-[7px] py-[2px] text-[9px]' : 'ml-1.5 px-[7px] py-[2px] text-[10px]';
  return (
    <span className={`rounded-full border font-mono ${size} ${styles} ${className}`}>{status}</span>
  );
}
