import type { ReactNode } from 'react';
import TitleBar from './TitleBar';

type OfficeShellProps = {
  topBar: ReactNode;
  canvas: ReactNode;
  sidebar: ReactNode;
  panel?: ReactNode;
  /** Editor palette, above the sidebar; shown only in edit mode. */
  palette?: ReactNode;
  /** Modal layer above the canvas and panel. */
  overlay?: ReactNode;
  /** Live supervision state for the window title bar - a pending-approval
   *  badge, the tree's cost. Ignored in a browser, where no bar renders. */
  titleBarStatus?: ReactNode;
};

export default function OfficeShell({
  topBar,
  canvas,
  sidebar,
  panel,
  palette,
  overlay,
  titleBarStatus,
}: OfficeShellProps) {
  return (
    // h-screen with the title bar INSIDE it, not above it: the bar is a flex
    // child like topBar, so it takes its 32px out of the same column rather
    // than pushing the canvas past the viewport and producing a page scrollbar.
    // `min-h-0` on the row below is what lets the canvas shrink to fit.
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--surface-primary)] text-[var(--content-primary)]">
      <TitleBar status={titleBarStatus} />
      {topBar}
      <div className="relative flex min-h-0 flex-1">
        {panel}
        {canvas}
        <aside className="hidden min-h-0 w-[290px] min-w-[290px] flex-col border-l border-[var(--border-primary)] bg-[var(--surface-secondary)] md:flex">
          {palette}
          {sidebar}
        </aside>
        {overlay}
      </div>
    </div>
  );
}
