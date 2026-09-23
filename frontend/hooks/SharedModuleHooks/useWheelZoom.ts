import { useEffect, type RefObject } from 'react';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, quantizeZoom, type Zoom } from '@/lib/office/constants';
import { useOfficeStore } from '@/store/officeStore';

type UseWheelZoomArgs = {
  /** The scrolling box around the canvas. */
  scrollRef: RefObject<HTMLElement | null>;
  /** The canvas itself — the anchor is measured against it, not the box. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onZoom: (zoom: Zoom) => void;
};

/**
 * Mouse-wheel zoom over the office, anchored to the cursor: the tile under the
 * pointer stays under the pointer, rather than the view jumping to wherever
 * the old scroll offset happens to land. Steps in ZOOM_STEP increments so a
 * flick of the wheel eases through the range instead of snapping 1x <-> 2x.
 */
export function useWheelZoom({ scrollRef, canvasRef, onZoom }: UseWheelZoomArgs): void {
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const onWheel = (event: WheelEvent) => {
      // Let the browser page-zoom on ctrl+wheel.
      if (event.ctrlKey || event.metaKey) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const { zoom } = useOfficeStore.getState();
      const direction = event.deltaY < 0 ? 1 : -1;
      const next = quantizeZoom(zoom + direction * ZOOM_STEP);

      // At the end of the range, let the wheel scroll the box as usual.
      if (next === zoom) {
        const atEdge =
          (direction > 0 && zoom >= ZOOM_MAX) || (direction < 0 && zoom <= ZOOM_MIN);
        if (atEdge) return;
      }

      event.preventDefault();
      if (next === zoom) return;

      // Anchor against the canvas, not the scroll box: `margin:auto` centres a
      // canvas smaller than the box, and that gutter is not part of the image.
      const canvasRect = canvas.getBoundingClientRect();
      const scrollRect = scroller.getBoundingClientRect();

      // Cursor position within the image, 0..1 on each axis.
      const fracX = (event.clientX - canvasRect.left) / canvasRect.width;
      const fracY = (event.clientY - canvasRect.top) / canvasRect.height;

      // Where the cursor sits inside the scroll box's viewport.
      const viewX = event.clientX - scrollRect.left;
      const viewY = event.clientY - scrollRect.top;

      onZoom(next);

      // The canvas resizes on the next paint; re-anchor once it has, using its
      // real post-resize geometry rather than an assumed ratio.
      requestAnimationFrame(() => {
        const grown = canvas.getBoundingClientRect();
        scroller.scrollLeft = canvas.offsetLeft + fracX * grown.width - viewX;
        scroller.scrollTop = canvas.offsetTop + fracY * grown.height - viewY;
      });
    };

    // Not passive: zooming has to be able to preventDefault.
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, [scrollRef, canvasRef, onZoom]);
}
