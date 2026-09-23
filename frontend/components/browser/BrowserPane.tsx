import { Globe, LogOut } from 'lucide-react';
import { useBrowser } from '@/hooks/SharedModuleHooks/useBrowser';

type BrowserPaneProps = {
  /** The run whose page to show, or null to show nothing. */
  runId: string | null;
  /** Whose session it is — used to clear cookies. */
  agentKey: string | null;
};

/**
 * Where the agent's browser appears.
 *
 * The live page is a native WebContentsView that floats ABOVE this element, so
 * everything below is a frame around a deliberate hole: the bordered box is
 * empty, and `paneRef` exists only to be measured.
 *
 * Nothing here can drive the page. The agent navigates and clicks, and the user
 * approves each step in the terminal's existing approval bar — which now reads
 * `click [button 18] "Buy now"` rather than a pair of coordinates.
 */
export default function BrowserPane({ runId, agentKey }: BrowserPaneProps) {
  const { paneRef, url, shown, supported, clearSession } = useBrowser(runId, Boolean(runId));

  if (!runId) return null;

  if (!supported) {
    return (
      <p className="px-3 py-2 font-mono text-[10px] text-[var(--content-tertiary)]">
        The agent browser is only available in the desktop app.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--border-primary)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-primary)] bg-[var(--surface-secondary)] px-2.5 py-1.5">
        <Globe size={12} strokeWidth={1.75} className="shrink-0 text-[var(--content-tertiary)]" aria-hidden="true" />
        <span className="truncate font-mono text-[10px] text-[var(--content-secondary)]">
          {url || 'no page open'}
        </span>
        {agentKey && (
          <button
            type="button"
            onClick={() => void clearSession(agentKey)}
            title="Sign this agent out of every site"
            aria-label="Clear this agent's browser session"
            className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1 rounded border border-[var(--border-primary)] px-2 py-[2px] font-mono text-[9px] text-[var(--content-tertiary)] transition-colors hover:border-[var(--semantic-error)] hover:text-[var(--semantic-error)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
          >
            <LogOut size={10} strokeWidth={1.75} aria-hidden="true" />
            sign out
          </button>
        )}
      </div>

      {/* The hole. The native view covers this exactly; the message shows only
          while nothing is attached. */}
      <div ref={paneRef} className="relative min-h-[240px] flex-1 bg-[var(--surface-primary)]">
        {!url ? (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center font-mono text-[10px] leading-relaxed text-[var(--content-tertiary)]">
            This agent hasn&apos;t opened a page. It may be answering from search
            results instead — ask it to use the browse tool.
          </p>
        ) : !shown ? (
          <p className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-[var(--content-tertiary)]">
            Loading…
          </p>
        ) : null}
      </div>
    </div>
  );
}
