import Image from 'next/image';
import { Copy, Minus, Square, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useWindowControls } from '@/hooks/SharedModuleHooks/useWindowControls';

/**
 * The app's own title bar, replacing the one the OS used to draw.
 *
 * WHY REPLACE IT AT ALL. The strip is ~32px of permanently visible space that
 * was spending all of it on the word "Sanctorum", which the user already knows.
 * In a product about SUPERVISED orchestration, that space is better spent on the
 * two things a supervisor should never have to open a panel to learn: whether an
 * agent is waiting on them, and what the run is costing. That is the `status`
 * slot below.
 *
 * ONE COMPONENT, BOTH PLATFORMS. It never checks the platform. `useWindowControls`
 * hands down a chrome descriptor the MAIN PROCESS decided, and this renders it:
 *
 *   Windows/Linux  showControls: true   we draw the three buttons at the right
 *   macOS          showControls: false  the OS keeps its traffic lights; we just
 *                                       leave paddingLeft clear for them
 *   browser        visible: false       nothing renders
 *
 * DRAG REGIONS ARE THE WHOLE TRICK. A div is not a title bar, so the strip is
 * marked `app-region: drag` to make the window movable — and every interactive
 * child MUST then be marked `no-drag`, or it renders correctly and ignores every
 * click. That is the single most common way this component gets broken; the
 * classes are named as constants below so it is hard to forget one.
 *
 * Double-click-to-maximize comes free with the drag region, which is why there
 * is no dblclick handler here.
 */

/** Marks the movable strip. Text inside a drag region cannot be selected and
 *  does not take a right-click menu — which is correct for a title bar. */
const DRAG = '[-webkit-app-region:drag]';

/** MUST be on every button, link and control inside the strip. Without it the
 *  drag region swallows the click and the control looks broken. */
const NO_DRAG = '[-webkit-app-region:no-drag]';

/** 32px matches the Windows 11 title bar so the app does not sit oddly tall
 *  next to other windows. It is also the height OfficeShell subtracts. */
export const TITLE_BAR_HEIGHT = 32;

const BUTTON =
  `${NO_DRAG} inline-flex h-8 w-[46px] cursor-pointer items-center justify-center ` +
  'text-[var(--content-secondary)] transition-colors hover:bg-[var(--surface-tertiary)] ' +
  'hover:text-[var(--content-primary)] focus-visible:outline-2 focus-visible:-outline-offset-2 ' +
  'focus-visible:outline-[var(--accent-primary)]';

type TitleBarProps = {
  /** Shown centred-left after the logo. The window's own title. */
  title?: string;
  /** Live supervision state — a pending-approval badge, the tree's cost. Sits
   *  right of the title and left of the buttons. Reuse ui/Chip or ui/StatusPill
   *  here rather than inventing new badge markup. */
  status?: ReactNode;
};

export default function TitleBar({ title = 'Sanctorum', status }: TitleBarProps) {
  const { chrome, minimize, toggleMaximize, close } = useWindowControls();

  // A browser tab has no window to control. Render nothing rather than a strip
  // of buttons that would do nothing when clicked.
  if (!chrome.visible) return null;

  return (
    <header
      className={`${DRAG} flex shrink-0 select-none items-center border-b border-[var(--border-primary)] bg-[var(--surface-secondary)]`}
      style={{
        height: TITLE_BAR_HEIGHT,
        // Platform padding, already resolved by windowService: room for the
        // macOS traffic lights on the left, and on Windows the 8px a maximized
        // frameless window overflows the screen by on the right.
        paddingLeft: chrome.paddingLeft,
        paddingRight: chrome.paddingRight,
      }}
    >
      {/* Not a landmark and not content: the title is decorative here, since
          the page's real heading lives in the app below. */}
      <div className="flex min-w-0 items-center gap-2 pl-2.5">
        <Image
          src="/logo-mark.png"
          alt=""
          width={18}
          height={18}
          // A 64px source for an 18px slot, so it stays sharp on a Retina or
          // 150%-scaled display rather than being upscaled from 18.
          className="shrink-0 rounded-[4px]"
          priority
        />
        <span className="truncate font-mono text-[11px] tracking-[0.08em] text-[var(--content-tertiary)]">
          {title}
        </span>
      </div>

      {/* The spacer is the draggable area that does the real work: it grows to
          fill whatever the title and status leave, so most of the bar moves the
          window. */}
      <div className="flex-1" />

      {status ? <div className={`${NO_DRAG} flex items-center gap-1.5 pr-2`}>{status}</div> : null}

      {chrome.showControls && (
        <div className="flex items-stretch">
          <button
            type="button"
            className={BUTTON}
            onClick={minimize}
            aria-label="Minimize"
            title="Minimize"
          >
            {/* 14px at 1.5 stroke. Lucide's defaults (24px, stroke 2) read as
                cartoonish next to native Windows glyphs, which are 10px hairlines. */}
            <Minus size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>

          <button
            type="button"
            className={BUTTON}
            onClick={toggleMaximize}
            aria-label={chrome.isMaximized ? 'Restore' : 'Maximize'}
            title={chrome.isMaximized ? 'Restore' : 'Maximize'}
          >
            {/* `Copy` is the conventional stand-in for Windows' overlapping
                "restore" glyph — Lucide has no exact match. Slightly rounder
                than the native mark, close enough to read correctly. */}
            {chrome.isMaximized ? (
              <Copy size={12} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Square size={12} strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            // Close is the one button with a destructive hover, matching every
            // other Windows app. The white-on-red is deliberate and not themed:
            // it must stay legible under every preset.
            className={`${BUTTON} hover:!bg-[var(--semantic-error)] hover:!text-white`}
            onClick={close}
            aria-label="Close"
            title="Close"
          >
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      )}
    </header>
  );
}
