import { useCallback, useEffect, useRef, useState } from 'react';
import { browserService } from '@/services/browserService';

/**
 * Keeps the native browser view over the pane React drew.
 *
 * A WebContentsView is not in the DOM, so it cannot be laid out by CSS. This
 * measures the placeholder and reports it — on resize, on scroll, and whenever
 * the window changes shape (maximize moves everything by 8px).
 *
 * ResizeObserver catches the element changing; the window listeners catch the
 * element staying the same size while MOVING, which an observer never fires for.
 */
/** How often to ask whether the run has opened a page. Cheap: an IPC call
 *  returning a string, and only while a run is live. */
const POLL_MS = 1200;

export function useBrowser(runId: string | null, live: boolean) {
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);
  const [url, setUrl] = useState('');

  const measure = useCallback(() => {
    const el = paneRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    browserService.place({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, []);

  // The URL comes from the MAIN PROCESS, which knows what actually loaded.
  // Deriving it from log text made a blank pane look like a broken browser.
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      if (!runId || !browserService.supported()) return;
      void browserService.liveUrl(runId).then((next) => {
        if (!cancelled) setUrl(next);
      });
    };
    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      // Clearing on unmount, not in the body: a run switch must not leave the
      // previous page's URL on screen.
      setUrl('');
    };
  }, [runId, live]);

  // Only place the view once a page exists; before that there is nothing to show.
  const visible = Boolean(url);

  useEffect(() => {
    if (!visible || !runId || !browserService.supported()) return;

    measure();
    const observer = new ResizeObserver(measure);
    if (paneRef.current) observer.observe(paneRef.current);
    window.addEventListener('resize', measure);
    // Capture phase: a scroll in any ancestor moves the pane too.
    window.addEventListener('scroll', measure, true);

    // Measure AFTER attaching: the main process may have attached the view
    // already (the agent browsed before this pane mounted), and it holds a zero
    // rect until something reports one.
    void browserService.show(runId).then((ok) => {
      setShown(ok);
      measure();
    });

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      void browserService.hide(runId);
      setShown(false);
    };
  }, [runId, visible, measure]);

  return {
    paneRef,
    /** The page actually open, or '' — what the pane and the layout key off. */
    url,
    /** True once a page is open and the view is placed. */
    visible,
    /** True once the main process confirms a view is attached. */
    shown,
    supported: browserService.supported(),
    clearSession: useCallback((agentKey: string) => browserService.clearSession(agentKey), []),
  };
}
