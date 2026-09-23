import { CircleDollarSign, Hand } from 'lucide-react';

/**
 * What the title bar says when there is something to say.
 *
 * THE ARGUMENT FOR IT. Replacing the OS title bar bought ~32px of permanently
 * visible space. Spending it on the word "Sanctorum" would be a worse use than
 * the OS made of it. In a product whose whole claim is SUPERVISED orchestration,
 * the two facts a supervisor should never have to open a panel to discover are:
 *
 *   1. an agent is blocked waiting for their decision
 *   2. what the delegation tree has spent
 *
 * Both are already in the app; neither was glanceable. A supervisor who has to
 * go looking to find out an agent is waiting on them is not really supervising.
 *
 * SILENT WHEN THERE IS NOTHING TO REPORT. No waiting agents and no cost means
 * this renders nothing at all, so the bar stays quiet in the common case and an
 * indicator appearing is itself the signal.
 */

/** Below this, the number is noise — a tenth of a cent on a $2.00 ceiling is
 *  not information, and a figure that flickers over sub-cent changes trains
 *  people to ignore it. */
const COST_FLOOR_USD = 0.005;

type SupervisionStatusProps = {
  /** Agents parked on a decision — tool approvals and questions. */
  waiting: number;
  /** USD across the open delegation tree. */
  cost: number;
  /** True while any run in the tree is still working, which is what makes the
   *  cost figure "so far" rather than final. */
  live: boolean;
  /** Opens the inbox. The badge is the fastest path to the decision it reports,
   *  so it is a button, not a label. */
  onOpenInbox: () => void;
};

export default function SupervisionStatus({
  waiting,
  cost,
  live,
  onOpenInbox,
}: SupervisionStatusProps) {
  const showCost = cost >= COST_FLOOR_USD;
  if (!waiting && !showCost) return null;

  return (
    <>
      {waiting > 0 && (
        <button
          type="button"
          onClick={onOpenInbox}
          // Warning, not error: someone waiting on you is a prompt, not a
          // failure. Error red here would cry wolf on the normal case.
          className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--semantic-warning-muted)] bg-[var(--surface-tertiary)] px-2 py-[2px] font-mono text-[10px] text-[var(--semantic-warning)] transition-colors hover:border-[var(--semantic-warning)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
          aria-label={`${waiting} ${waiting === 1 ? 'agent is' : 'agents are'} waiting for a decision. Open the inbox.`}
          title="Waiting for your decision"
        >
          <Hand size={11} strokeWidth={1.75} aria-hidden="true" />
          {waiting}
        </button>
      )}

      {showCost && (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-[var(--border-primary)] px-2 py-[2px] font-mono text-[10px] text-[var(--content-secondary)]"
          // "so far" while the tree is live, because the number will keep
          // moving — a bare figure would read as final.
          title={live ? 'Spent so far on the open run' : 'Spent on the open run'}
        >
          <CircleDollarSign size={11} strokeWidth={1.75} aria-hidden="true" />
          {cost.toFixed(3)}
          {live && (
            <span
              aria-hidden="true"
              className="ml-0.5 h-[5px] w-[5px] animate-pulse rounded-full bg-[var(--semantic-success)]"
            />
          )}
        </span>
      )}
    </>
  );
}
