import { useEffect, useState } from 'react';
import type { Room } from '@/lib/office/types';

type FloorManagerProps = {
  open: boolean;
  rooms: Room[];
  onClose: () => void;
  onAdd: () => void;
  onRename: (roomId: string, name: string) => Promise<unknown>;
  onReorder: (roomId: string, order: number) => Promise<unknown>;
  onDelete: (roomId: string) => Promise<unknown>;
};

const ctl =
  'cursor-pointer rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:border-[var(--accent-secondary)] hover:text-[var(--content-primary)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]';

/**
 * Reorder, rename, and delete floors, plus a shortcut to add one. Renaming edits
 * a draft keyed by floor id, committed on blur or Enter — no per-floor effects.
 * All the hard rules (can't delete an occupied or last floor) are enforced by
 * the server; a rejection surfaces here as an inline message.
 */
export default function FloorManager({
  open,
  rooms,
  onClose,
  onAdd,
  onRename,
  onReorder,
  onDelete,
}: FloorManagerProps) {
  // Draft names keyed by floor id, so re-fetches don't clobber an in-progress edit.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const run = async (id: string, action: () => Promise<unknown>) => {
    setError(null);
    setBusyId(id);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change was refused.');
    } finally {
      setBusyId(null);
    }
  };

  const commitRename = (room: Room) => {
    const draft = drafts[room.id];
    if (draft === undefined) return;
    const next = draft.trim();
    // Clear the draft either way; if unchanged or empty, keep the current name.
    setDrafts((d) => {
      const { [room.id]: _drop, ...rest } = d;
      return rest;
    });
    if (!next || next === room.name) return;
    void run(room.id, () => onRename(room.id, next));
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-full w-[440px] max-w-full flex-col gap-3 overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--surface-secondary)] p-4 shadow-2xl">
        <div className="flex items-center">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
            Floors
          </h2>
          <button
            type="button"
            onClick={onAdd}
            className="ml-auto cursor-pointer rounded border border-[var(--accent-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
          >
            + add floor
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-2 cursor-pointer rounded border border-[var(--border-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
          >
            close
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded border border-[var(--semantic-error-muted)] bg-[var(--semantic-error)]/10 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-[var(--semantic-error)]"
          >
            {error}
          </p>
        )}

        <ul className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
          {rooms.map((room, index) => {
            const value = drafts[room.id] ?? room.name;
            const busy = busyId === room.id;
            return (
              <li
                key={room.id}
                className="flex items-center gap-2 rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5"
              >
                <span className="w-5 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--content-tertiary)]">
                  {index + 1}
                </span>

                <input
                  aria-label={`Floor ${index + 1} name`}
                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[12px] text-[var(--content-primary)] hover:border-[var(--border-primary)] focus-visible:border-[var(--accent-primary)] focus-visible:outline-none"
                  value={value}
                  disabled={busy}
                  onChange={(e) => setDrafts((d) => ({ ...d, [room.id]: e.target.value }))}
                  onBlur={() => commitRename(room)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />

                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className={ctl}
                    aria-label={`Move ${room.name} up`}
                    disabled={busy || index === 0}
                    onClick={() => void run(room.id, () => onReorder(room.id, index - 1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={ctl}
                    aria-label={`Move ${room.name} down`}
                    disabled={busy || index === rooms.length - 1}
                    onClick={() => void run(room.id, () => onReorder(room.id, index + 1))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={`${ctl} hover:border-[var(--semantic-error)] hover:text-[var(--semantic-error)]`}
                    aria-label={`Delete ${room.name}`}
                    disabled={busy || rooms.length <= 1}
                    onClick={() => void run(room.id, () => onDelete(room.id))}
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="shrink-0 font-mono text-[10px] leading-[1.6] text-[var(--content-tertiary)]">
          A floor with agents on it can't be deleted — move them off first. The portal
          cycles floors in this order.
        </p>
      </div>
    </div>
  );
}
