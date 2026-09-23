import { useEffect, useState, type FormEvent } from 'react';
import { isCompleteRowOrder, SHEET } from '@/lib/office/sheet';
import {
  DIRECTIONS,
  type DirectionName,
  type Role,
  type Room,
  type Taxonomy,
} from '@/lib/office/types';
import SheetRowPicker from './SheetRowPicker';
import { LevelSelect, RoleSelect } from './DossierFields';
import type { CreateAgentInput } from '@/api/agents';

type AddAgentFormProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CreateAgentInput) => Promise<unknown>;
  rooms: Room[];
  taxonomy: Taxonomy | null;
  /** The role library — the dossier's Role picker reads these, not the taxonomy. */
  roles: Role[];
};

const EMPTY_ROWS: (DirectionName | null)[] = [null, null, null, null];

const field =
  'w-full rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 font-mono text-[12px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]';
const label =
  'font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--content-tertiary)]';

export default function AddAgentForm({
  open,
  onClose,
  onSubmit,
  rooms,
  taxonomy,
  roles,
}: AddAgentFormProps) {
  const [name, setName] = useState('');
  const [room, setRoom] = useState(0);
  // null = "use the first free seat"; a number is an explicit user choice.
  const [seatChoice, setSeatChoice] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [tagline, setTagline] = useState('');
  const [role, setRole] = useState<string | null>(null);
  const [clearance, setClearance] = useState<number | null>(null);
  const [dataType, setDataType] = useState<number | null>(null);
  const [tenure, setTenure] = useState('');
  const [focus, setFocus] = useState('');
  const [responsibilities, setResponsibilities] = useState('');
  const [sprite, setSprite] = useState<File | null>(null);
  const [sheetImage, setSheetImage] = useState<HTMLImageElement | null>(null);
  const [rows, setRows] = useState<(DirectionName | null)[]>(EMPTY_ROWS);
  const [portrait, setPortrait] = useState<File | null>(null);
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

  /** Load the picked sheet so its rows can be shown and validated. */
  const handleSprite = (file: File | null) => {
    setSprite(file);
    setSheetImage(null);
    setRows(EMPTY_ROWS);
    setError(null);
    if (!file) return;

    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth !== SHEET.width || img.naturalHeight !== SHEET.height) {
        setError(
          `Sprite sheet must be ${SHEET.width}x${SHEET.height} ` +
            `(${SHEET.columns} frames x ${SHEET.rows} rows of ${SHEET.cell}px). ` +
            `That file is ${img.naturalWidth}x${img.naturalHeight}.`
        );
        setSprite(null);
        return;
      }
      setSheetImage(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // Usually the file changed on disk after being picked.
      setError('Could not read that image — try picking the file again.');
      setSprite(null);
    };
    img.src = url;
  };

  if (!open) return null;

  // Free desks by their stored `seat` index (not array position — floors can
  // have gaps), so the seat sent at creation matches an actual desk.
  const freeSeats = (rooms[room]?.seats ?? [])
    .filter((s) => !s.occupied)
    .map((s) => s.seat);
  // Derived: honour an explicit choice if it is still free, else the first free
  // seat. Avoids syncing a default into state inside an effect.
  const seat =
    seatChoice !== null && freeSeats.includes(seatChoice)
      ? seatChoice
      : (freeSeats[0] ?? null);
  const rowsComplete = isCompleteRowOrder(rows);

  // Derived rather than synced into state: the taxonomy supplies the defaults
  // until the user picks something.
  const effectiveRole = role ?? taxonomy?.defaults.role ?? null;
  const effectiveClearance = clearance ?? taxonomy?.defaults.clearance ?? null;
  const effectiveDataType = dataType ?? taxonomy?.defaults.dataType ?? null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!name.trim()) return setError('Name is required.');
    if (!sprite || !sheetImage) return setError('A sprite sheet is required.');
    if (!portrait) return setError('A portrait is required.');
    if (seat === null) return setError('No free seat in that room.');
    if (!isCompleteRowOrder(rows)) {
      return setError(
        `Label every row: each of ${DIRECTIONS.join(', ')} must be used exactly once.`
      );
    }
    if (
      !taxonomy ||
      effectiveRole === null ||
      effectiveClearance === null ||
      effectiveDataType === null
    ) {
      return setError('Role options are still loading — try again in a moment.');
    }

    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        room,
        seat,
        title: title.trim(),
        tagline: tagline.trim(),
        role: effectiveRole,
        clearance: effectiveClearance,
        dataType: effectiveDataType,
        tenure: tenure.trim(),
        focus: focus.trim(),
        rowOrder: rows,
        responsibilities: responsibilities
          .split('\n')
          .map((r) => r.trim())
          .filter(Boolean),
        sprite,
        portrait,
      });
      setName('');
      setSeatChoice(null);
      setTitle('');
      setTagline('');
      setRole(null);
      setClearance(null);
      setDataType(null);
      setTenure('');
      setFocus('');
      setResponsibilities('');
      setSprite(null);
      setSheetImage(null);
      setRows(EMPTY_ROWS);
      setPortrait(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add agent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={handleSubmit}
        aria-label="Add agent"
        className="flex max-h-full w-[460px] max-w-full flex-col gap-3 overflow-y-auto rounded-md border border-[var(--border-primary)] bg-[var(--surface-secondary)] p-4 shadow-2xl"
      >
        <div className="flex items-center">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
            New agent
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
            required
          />
        </label>

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>Floor</span>
            <select
              className={field}
              value={room}
              onChange={(e) => setRoom(Number(e.target.value))}
            >
              {rooms.map((r, i) => (
                <option key={r.id} value={i}>
                  {i + 1}. {r.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>Seat</span>
            <select
              className={field}
              value={seat ?? ''}
              onChange={(e) => setSeatChoice(Number(e.target.value))}
              disabled={freeSeats.length === 0}
            >
              {freeSeats.length === 0 && <option value="">floor is full</option>}
              {freeSeats.map((i) => (
                <option key={i} value={i}>
                  seat {i}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className={label}>Title</span>
          <input
            className={field}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Archmagus of Systems"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Tagline</span>
          <input
            className={field}
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="One line for the dossier"
          />
        </label>

        {taxonomy &&
          effectiveRole !== null &&
          effectiveClearance !== null &&
          effectiveDataType !== null && (
          <>
            <label className="flex flex-col gap-1">
              <span className={label}>Role</span>
              <RoleSelect roles={roles} value={effectiveRole} onChange={setRole} />
            </label>

            <label className="flex flex-col gap-1">
              <span className={label}>Clearance</span>
              <LevelSelect
                levels={taxonomy.clearanceLevels}
                value={effectiveClearance}
                onChange={setClearance}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className={label}>Data type</span>
              <LevelSelect
                levels={taxonomy.dataTypeLevels}
                value={effectiveDataType}
                onChange={setDataType}
              />
            </label>

            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1">
                <span className={label}>Tenure</span>
                <input
                  className={field}
                  value={tenure}
                  onChange={(e) => setTenure(e.target.value)}
                  placeholder="2 years"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className={label}>Focus</span>
                <input
                  className={field}
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                  placeholder="Deep work"
                />
              </label>
            </div>
          </>
        )}

        <label className="flex flex-col gap-1">
          <span className={label}>Responsibilities (one per line)</span>
          <textarea
            className={`${field} min-h-[64px] resize-y`}
            value={responsibilities}
            onChange={(e) => setResponsibilities(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>
            Sprite sheet — PNG, {SHEET.width}x{SHEET.height}
          </span>
          <input
            className={field}
            type="file"
            accept="image/png"
            onChange={(e) => handleSprite(e.target.files?.[0] ?? null)}
            required
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className={label}>Which way does each row walk?</span>
          <SheetRowPicker sheet={sheetImage} value={rows} onChange={setRows} />
        </div>

        <label className="flex flex-col gap-1">
          <span className={label}>Portrait — PNG or JPG</span>
          <input
            className={field}
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => setPortrait(e.target.files?.[0] ?? null)}
            required
          />
        </label>

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
          disabled={busy || freeSeats.length === 0 || !rowsComplete}
          className="mt-1 cursor-pointer rounded border border-[var(--accent-primary)] py-2 font-mono text-[11px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
        >
          {busy ? 'adding…' : 'add agent'}
        </button>
      </form>
    </div>
  );
}
