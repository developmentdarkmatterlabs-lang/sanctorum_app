import {
  close,
  getState,
  minimize,
  subscribe,
  toggleMaximize,
  type WindowChrome,
} from '@/api/window';

/**
 * The window frame, as the app draws it.
 *
 * WHAT THIS LAYER IS FOR. Every other service in this folder owns a slice of
 * domain state and patches a store. This one owns something smaller but of the
 * same kind: the single place that knows the difference between Windows, macOS
 * and a browser tab, so that nothing above it does.
 *
 * `TitleBar` asks for `padding` and gets a number. It never learns that the
 * number is 78 because macOS puts traffic lights there, or 8 because a maximized
 * Windows frame overflows the screen. When the macOS path is finally tested on
 * real hardware, the correction lands HERE — one constant in one file — rather
 * than in a component that had grown its own platform conditionals.
 *
 * DELIBERATELY NOT A ZUSTAND STORE. The other services patch officeStore,
 * runStore and friends because that state is read from many places at once.
 * Chrome state is read by exactly one component, so a store would add a global
 * for a single consumer. `useWindowControls` holds it in local state and
 * subscribes; if a second consumer ever appears, promoting this to a store is a
 * contained change.
 */

/** Windows draws a maximized frameless window ~8px larger than the visible work
 *  area on every side, so a button flush to the right edge is clipped in half.
 *  Compensating is not optional — it is the difference between a close button
 *  that works and one that is half off-screen. */
const MAXIMIZED_OVERFLOW_PX = 8;

/** What a title bar needs to render itself, with every platform difference
 *  already resolved into numbers and booleans. */
export type TitleBarChrome = {
  /** Whether to render a title bar at all. False in a browser tab. */
  visible: boolean;
  /** Whether to render our own minimize/maximize/close buttons. */
  showControls: boolean;
  /** Left padding, clearing the macOS traffic lights when they are present. */
  paddingLeft: number;
  /** Right padding, compensating for the maximized-window overflow. */
  paddingRight: number;
  /** Drives the maximize button's glyph and its accessible label. */
  isMaximized: boolean;
  isFullScreen: boolean;
};

export class WindowService {
  /** Resolve the raw chrome descriptor into pixel values a component can use
   *  without any further reasoning about the platform. */
  toTitleBarChrome(state: WindowChrome): TitleBarChrome {
    const custom = state.controls === 'custom';
    return {
      visible: state.controls !== 'none',
      showControls: custom,
      paddingLeft: state.inset.left,
      // Only the platform that draws its own buttons has anything to clip, and
      // only while maximized. Fullscreen on macOS has no overflow.
      paddingRight:
        state.inset.right + (custom && state.isMaximized ? MAXIMIZED_OVERFLOW_PX : 0),
      isMaximized: state.isMaximized,
      isFullScreen: state.isFullScreen,
    };
  }

  /** The chrome as it stands, for a component mounting into an existing window
   *  (a reload against an already-maximized frame). */
  async current(): Promise<TitleBarChrome> {
    return this.toTitleBarChrome(await getState());
  }

  /** Watch for changes the user made without our buttons — Win+arrow,
   *  drag-to-edge, double-click. Returns an unsubscribe. */
  watch(onChange: (chrome: TitleBarChrome) => void): () => void {
    return subscribe((state) => onChange(this.toTitleBarChrome(state)));
  }

  minimize(): void {
    minimize();
  }

  /** One button, both directions: the icon follows the state event this causes,
   *  so the service never has to predict the result. */
  toggleMaximize(): void {
    toggleMaximize();
  }

  close(): void {
    close();
  }
}

export const windowService = new WindowService();
