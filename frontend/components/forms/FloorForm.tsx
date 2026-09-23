import { useEffect, useState, type FormEvent } from 'react';

type FloorFormProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string, background: File) => Promise<unknown>;
};

const field =
  'w-full rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 font-mono text-[12px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]';
const label =
  'font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--content-tertiary)]';

/** Largest background the backend will accept (matches MAX_BG_BYTES). */
const MAX_BG_BYTES = 12 * 1024 * 1024;

/**
 * Adds a floor: a name and a background image. The new floor starts fully
 * walkable — its collision grid, props and seats are drawn on afterwards with
 * the editor tools.
 */
export default function FloorForm({ open, onClose, onSubmit }: FloorFormProps) {
  const [name, setName] = useState('');
  const [background, setBackground] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleBackground = (file: File | null) => {
    setError(null);
    if (file && file.size > MAX_BG_BYTES) {
      setBackground(null);
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)}MB — keep it under 12MB.`);
      return;
    }
    setBackground(file);
  };

  if (!open) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!name.trim()) return setError('Name is required.');
    if (!background) return setError('A background image is required.');

    setBusy(true);
    try {
      await onSubmit(name.trim(), background);
      setName('');
      setBackground(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add floor.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={handleSubmit}
        aria-label="Add floor"
        className="flex max-h-full w-[440px] max-w-full flex-col gap-3 overflow-y-auto rounded-md border border-[var(--border-primary)] bg-[var(--surface-secondary)] p-4 shadow-2xl"
      >
        <div className="flex items-center">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
            New floor
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto cursor-pointer rounded border border-[var(--border-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
          >
            close
          </button>
        </div>

        <label className="flex flex-col gap-1">
          <span className={label}>Name</span>
          <input
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Observatory"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Background — PNG or JPG, square</span>
          <input
            className={field}
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => handleBackground(e.target.files?.[0] ?? null)}
            required
          />
        </label>

        <p className="rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2.5 py-2 font-mono text-[10.5px] leading-[1.6] text-[var(--content-tertiary)]">
          Agents arrive and leave through the portal at the{' '}
          <em className="not-italic text-[var(--content-secondary)]">bottom-center</em> of the
          floor, so leave a doorway there — draw the room with an opening at the bottom middle.
          The floor starts fully walkable; paint its walls, props and desks afterward with the
          editor.
        </p>

        {error && (
          <p
            role="alert"
            className="rounded border border-[var(--semantic-error-muted)] bg-[var(--semantic-error)]/10 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-[var(--semantic-error)]"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !name.trim() || !background}
          className="mt-1 cursor-pointer rounded border border-[var(--accent-primary)] py-2 font-mono text-[11px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
        >
          {busy ? 'adding…' : 'add floor'}
        </button>
      </form>
    </div>
  );
}
