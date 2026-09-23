import { nextRotation } from '@/lib/office/editor/tools';
import { useEditorStore } from '@/store/editorStore';

const btn =
  'cursor-pointer rounded border px-2 py-[3px] font-mono text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]';
const on = 'border-[var(--accent-primary)] text-[var(--accent-primary)]';
const off =
  'border-[var(--border-primary)] text-[var(--content-secondary)] hover:text-[var(--content-primary)]';

/** Edit-mode toggle plus the tile/erase tools and rotation. */
export default function EditorToolbar() {
  const active = useEditorStore((s) => s.active);
  const tool = useEditorStore((s) => s.tool);
  const rotation = useEditorStore((s) => s.rotation);
  const setActive = useEditorStore((s) => s.setActive);
  const setTool = useEditorStore((s) => s.setTool);
  const setRotation = useEditorStore((s) => s.setRotation);

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setActive(!active)}
        aria-pressed={active}
        className={`${btn} ${active ? on : off}`}
      >
        {active ? 'editing' : 'edit'}
      </button>

      {active && (
        <>
          <span className="mx-0.5 h-4 w-px bg-[var(--border-primary)]" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setTool('tile')}
            aria-pressed={tool === 'tile'}
            className={`${btn} ${tool === 'tile' ? on : off}`}
          >
            paint
          </button>
          <button
            type="button"
            onClick={() => setTool('seat')}
            aria-pressed={tool === 'seat'}
            className={`${btn} ${tool === 'seat' ? on : off}`}
          >
            seats
          </button>
          <button
            type="button"
            onClick={() => setTool('block')}
            aria-pressed={tool === 'block'}
            className={`${btn} ${tool === 'block' ? on : off}`}
            title="Paint invisible collision — click to block a tile, click again to clear"
          >
            block
          </button>
          <button
            type="button"
            onClick={() => setTool('erase')}
            aria-pressed={tool === 'erase'}
            className={`${btn} ${tool === 'erase' ? on : off}`}
          >
            erase
          </button>
          <button
            type="button"
            onClick={() => setRotation(nextRotation(rotation))}
            className={`${btn} ${off}`}
            title="Rotate the tile being placed"
          >
            ↻ {rotation}°
          </button>
        </>
      )}
    </div>
  );
}
