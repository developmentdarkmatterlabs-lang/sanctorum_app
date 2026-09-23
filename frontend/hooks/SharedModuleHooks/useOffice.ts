import { useCallback, useEffect, useMemo, useRef } from 'react';
import { canvasSize, render } from '@/lib/office/renderer';
import { readPalette } from '@/lib/office/palette';
import { createOfficeService } from '@/services/officeService';
import { useOfficeStore } from '@/store/officeStore';
import { useEditorStore } from '@/store/editorStore';
import { useInboxStore } from '@/store/inboxStore';
import type { OfficeImages } from '@/lib/office/sprites';
import type { AgentEdit, SpriteKey } from '@/lib/office/types';
import type { Zoom } from '@/lib/office/constants';
import { useAppSettings } from '@/contexts/AppSettingsContext';

type UseOfficeArgs = { images: OfficeImages };

/**
 * Owns the canvas, the animation loop, and the service instance.
 *
 * The loop mutates the simulation and draws every frame without touching React
 * state; only coarse changes (status, room, log) reach the store, so components
 * re-render a few times a second instead of sixty. It reads view state straight
 * from the store rather than through props, so it never needs re-subscribing.
 */
export function useOffice({ images }: UseOfficeArgs) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const service = useMemo(() => createOfficeService(), []);
  const { theme } = useAppSettings();

  const zoom = useOfficeStore((s) => s.zoom);

  useEffect(() => {
    service.connect();
    return () => service.disconnect();
  }, [service]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Canvas cannot resolve CSS custom properties, so the theme tokens are read
    // once here and refreshed whenever the theme changes.
    const palette = readPalette();

    let frame = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;

      service.tick(dt);

      // Real run state drives the sprite, not the auto-scheduler:
      //   activeRunId  -> a run is in flight            -> "working"
      //   pendingRunId -> that run is parked on a human -> "waiting"
      // The thread list this reads is refreshed by useInbox's poll; without that
      // poll these sets never change and every agent looks permanently idle.
      const inbox = useInboxStore.getState();
      const runningKeys = new Set<SpriteKey>();
      const blockedKeys = new Set<SpriteKey>();
      for (const t of inbox.threads) {
        if (!t.agentKey) continue;
        if (t.pendingRunId) blockedKeys.add(t.agentKey);
        else if (t.activeRunId) runningKeys.add(t.agentKey);
      }
      service.setRunning(runningKeys, blockedKeys);

      const {
        viewRoom,
        zoom: currentZoom,
        selectedKey,
        rooms,
      } = useOfficeStore.getState();
      const { active: editing, stranded, tool } = useEditorStore.getState();
      render(ctx, {
        images,
        agents: service.agents,
        viewRoom,
        room: rooms[viewRoom],
        zoom: currentZoom,
        selectedKey,
        palette,
        stranded: editing ? stranded : undefined,
        showSeats: editing && tool === 'seat',
        showBlocks: editing && tool === 'block',
      });

      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [service, images, theme]);

  const onCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      service.handleCanvasClick(event.clientX - rect.left, event.clientY - rect.top);
    },
    [service]
  );

  const { width, height } = canvasSize(zoom);

  return {
    canvasRef,
    width,
    height,
    onCanvasClick,
    selectAgent: useCallback((key: SpriteKey) => service.selectAgent(key), [service]),
    command: useCallback(
      (key: SpriteKey, action: 'desk' | 'wander' | 'portal') =>
        service.command(key, action),
      [service]
    ),
    setViewRoom: useCallback((room: number) => service.setViewRoom(room), [service]),
    setZoom: useCallback((z: Zoom) => service.setZoom(z), [service]),
    toggleAuto: useCallback(() => service.toggleAuto(), [service]),
    addAgent: useCallback(
      (input: Parameters<typeof service.addAgent>[0]) => service.addAgent(input),
      [service]
    ),
    removeAgent: useCallback((key: SpriteKey) => service.removeAgent(key), [service]),
    saveAgent: useCallback(
      (key: SpriteKey, edit: AgentEdit) => service.saveAgent(key, edit),
      [service]
    ),
    takenSeats: useCallback((room: number) => service.takenSeats(room), [service]),
    createFloor: useCallback(
      (name: string, background: File) => service.createFloor(name, background),
      [service]
    ),
    renameFloor: useCallback(
      (roomId: string, name: string) => service.renameFloor(roomId, name),
      [service]
    ),
    reorderFloor: useCallback(
      (roomId: string, order: number) => service.reorderFloor(roomId, order),
      [service]
    ),
    deleteFloor: useCallback((roomId: string) => service.deleteFloor(roomId), [service]),
  };
}
