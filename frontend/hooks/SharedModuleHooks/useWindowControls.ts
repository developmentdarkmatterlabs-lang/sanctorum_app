import { useCallback, useEffect, useState } from 'react';
import { windowService, type TitleBarChrome } from '@/services/windowService';

/**
 * Hook seam for the app-drawn title bar (Component -> Hook -> Service -> API).
 *
 * SUBSCRIBES RATHER THAN POLLS, which is the opposite of `useRuns` and for a
 * good reason: a run's progress is only observable by asking, but a window
 * announces its own state changes. And it changes behind our back constantly —
 * Win+arrow, dragging to a screen edge, double-clicking the bar and the Windows
 * snap flyout all maximize without touching our buttons. Polling would leave the
 * restore icon wrong for up to an interval after each one.
 *
 * THE INITIAL STATE IS PESSIMISTIC. `visible: false` until the main process
 * answers, so a browser tab — where the answer never changes it — renders no bar
 * at all rather than flashing one for a frame and removing it.
 */

const HIDDEN: TitleBarChrome = {
  visible: false,
  showControls: false,
  paddingLeft: 0,
  paddingRight: 0,
  isMaximized: false,
  isFullScreen: false,
};

export function useWindowControls() {
  const [chrome, setChrome] = useState<TitleBarChrome>(HIDDEN);

  useEffect(() => {
    // `cancelled` guards the await: in React strict mode the effect runs twice,
    // and a resolve landing after unmount would set state on a dead component.
    let cancelled = false;

    void windowService.current().then((initial) => {
      if (!cancelled) setChrome(initial);
    });

    // Subscribe BEFORE the promise above resolves, so a maximize during that
    // round trip is not missed.
    const unsubscribe = windowService.watch((next) => {
      if (!cancelled) setChrome(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return {
    /** Everything the bar needs to lay itself out: visibility, control
     *  ownership and per-platform padding, already resolved to numbers. */
    chrome,
    minimize: useCallback(() => windowService.minimize(), []),
    toggleMaximize: useCallback(() => windowService.toggleMaximize(), []),
    close: useCallback(() => windowService.close(), []),
  };
}
