import { useEffect, useMemo, useState } from 'react';
import type { Role } from '@/lib/office/types';
import type { RoleInput } from '@/api/roles';

type RoleManagerProps = {
  open: boolean;
  roles: Role[];
  onClose: () => void;
  onCreate: (input: RoleInput) => Promise<unknown>;
  onUpdate: (id: string, input: RoleInput) => Promise<unknown>;
  /** Throws with the server's message when seats still hold the role. */
  onDelete: (id: string) => Promise<unknown>;
};

type Draft = {
  title: string;
  level: number;
  discipline: string;
  description: string;
  defaultClearance: number;
};

const EMPTY: Draft = { title: '', level: 0, discipline: '', description: '', defaultClearance: 1 };

const field =
  'w-full rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 font-mono text-[12px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]';
const label = 'font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--content-tertiary)]';

/**
 * The ROLE CATALOG — the job architecture. A role is defined once ("Sales
 * Representative") and referenced by many seats: one role, N headcount. Seats
 * INHERIT its title/clearance live, so editing a role moves every seat holding it
 * (except seats with an explicit override). A role held by any seat cannot be
 * deleted — reassign those seats first.
 */
export default function RoleManager({
  open,
  roles,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: RoleManagerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = roles.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    if (selected) {
      setDraft({
        title: selected.title,
        level: selected.level,
        discipline: selected.discipline,
        description: selected.description,
        defaultClearance: selected.defaultClearance,
      });
    } else {
      setDraft(EMPTY);
    }
    setError(null);
  }, [selected]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Disciplines the user has collapsed. Storing the CLOSED ones (rather than the
  // open ones) means a newly created discipline appears expanded by default.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (discipline: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(discipline)) next.delete(discipline);
      else next.add(discipline);
      return next;
    });

  // Local view state: filtering the catalog concerns nobody but this panel, so it
  // never reaches the store, a service or the API.
  const [query, setQuery] = useState('');

  // Group the catalog by discipline so it reads like an org chart, not a flat list.
  // The filter runs BEFORE grouping, so a search that matches nothing in a
  // discipline drops that whole heading rather than leaving an empty one.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const by = new Map<string, Role[]>();
    for (const r of roles) {
      const key = r.discipline.trim() || 'Unassigned discipline';
      // Match the discipline too, so "myths" pulls up the whole category.
      if (q && !`${r.title} ${key} ${r.description}`.toLowerCase().includes(q)) continue;
      by.set(key, [...(by.get(key) ?? []), r]);
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [roles, query]);

  const matches = useMemo(() => grouped.reduce((n, [, items]) => n + items.length, 0), [grouped]);
  const searching = query.trim().length > 0;

  if (!open) return null;

  const save = async () => {
    if (!draft.title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (selected) await onUpdate(selected.id, draft);
      else {
        await onCreate(draft);
        setDraft(EMPTY);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(selected.id);
      setSelectedId(null);
    } catch (err) {
      // The server refuses (409) while seats hold the role — show its message.
      setError(err instanceof Error ? err.message : 'Could not delete.');
    } finally {
      setBusy(false);
    }
  };

  // A role held by seats can't be deleted; say so up front rather than only on click.
  const heldBySeats = (selected?.seatCount ?? 0) > 0;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[600px] max-h-full w-[820px] max-w-full overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--surface-secondary)] shadow-2xl">
        {/* The catalog, grouped by discipline. */}
        <div className="flex w-[290px] shrink-0 flex-col border-r border-[var(--border-primary)]">
          <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
              Roles
            </span>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="ml-auto cursor-pointer rounded border border-[var(--accent-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15"
            >
              + new
            </button>
          </div>

          <div className="shrink-0 border-b border-[var(--border-primary)] px-2.5 py-2">
            <input
              type="search"
              className={`${field} text-[11px]`}
              placeholder="Search roles…"
              aria-label="Search roles by title, discipline or description"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {searching && (
              <p className="mt-1 font-mono text-[9px] text-[var(--content-tertiary)]">
                {matches} of {roles.length}
              </p>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {searching && matches === 0 ? (
              <p className="px-4 py-8 text-center font-mono text-[10px] leading-relaxed text-[var(--content-tertiary)]">
                No role matches &ldquo;{query.trim()}&rdquo;.
              </p>
            ) : roles.length === 0 ? (
              <p className="px-4 py-8 text-center font-mono text-[10px] leading-relaxed text-[var(--content-tertiary)]">
                No roles yet. Define one (e.g. &ldquo;Sales Representative&rdquo;), then point
                seats at it — several seats can share one role.
              </p>
            ) : (
              grouped.map(([discipline, items]) => (
                <div key={discipline}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(discipline)}
                    aria-expanded={searching || !collapsed.has(discipline)}
                    className="sticky top-0 z-[1] flex w-full items-center gap-1.5 bg-[var(--surface-secondary)] px-3 py-1 text-left font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--content-tertiary)] hover:text-[var(--content-secondary)]"
                  >
                    <span aria-hidden="true" className="inline-block w-2">
                      {!searching && collapsed.has(discipline) ? '▸' : '▾'}
                    </span>
                    {discipline}
                    <span className="ml-auto normal-case tracking-normal opacity-70">
                      {items.length}
                    </span>
                  </button>
                  <ul hidden={!searching && collapsed.has(discipline)}>
                    {items.map((r) => (
                      <li key={r.id} className="border-b border-[var(--border-primary)]">
                        <button
                          type="button"
                          onClick={() => setSelectedId(r.id)}
                          className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-[var(--surface-tertiary)] ${
                            selectedId === r.id ? 'bg-[var(--surface-tertiary)]' : ''
                          }`}
                        >
                          <span className="flex w-full items-center gap-2">
                            <span className="truncate font-mono text-[12px] text-[var(--content-primary)]">
                              {r.title}
                            </span>
                            {r.level > 0 && (
                              <span className="shrink-0 font-mono text-[9px] text-[var(--content-tertiary)]">
                                L{r.level}
                              </span>
                            )}
                            <span className="ml-auto shrink-0 font-mono text-[9px] text-[var(--accent-secondary)]">
                              clr {r.defaultClearance}
                            </span>
                          </span>
                          <span className="font-mono text-[9.5px] text-[var(--content-tertiary)]">
                            {r.seatCount === 0
                              ? 'no seats'
                              : `${r.seatCount} ${r.seatCount === 1 ? 'seat' : 'seats'}`}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>

        {/* The editor. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
              {selected ? 'Edit role' : 'New role'}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto cursor-pointer rounded border border-[var(--border-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
            >
              close
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
            <p className="font-mono text-[10px] leading-relaxed text-[var(--content-tertiary)]">
              A role is defined once and shared by every seat that references it.
              Seats <em className="not-italic text-[var(--content-secondary)]">inherit</em> its
              title and clearance, so editing here moves every seat holding it.
            </p>

            <div className="flex flex-col gap-1">
              <span className={label}>Title</span>
              <input
                className={field}
                value={draft.title}
                placeholder="e.g. Sales Representative"
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className={label}>Discipline</span>
              {/* Free text WITH suggestions: a discipline is just a string, so
                  typing a new one creates the category. The datalist offers the
                  ones already in use so you don't fragment the list with
                  "Engineering" vs "engineering". */}
              <input
                className={field}
                list="role-disciplines"
                value={draft.discipline}
                placeholder="Type to create a new category, or pick an existing one"
                onChange={(e) => setDraft({ ...draft, discipline: e.target.value })}
              />
              <datalist id="role-disciplines">
                {[...new Set(roles.map((r) => r.discipline.trim()).filter(Boolean))]
                  .sort()
                  .map((d) => (
                    <option key={d} value={d} />
                  ))}
              </datalist>
            </div>

            <div className="flex gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className={label}>Level (band)</span>
                <input
                  type="number"
                  min={0}
                  className={field}
                  value={draft.level}
                  onChange={(e) => setDraft({ ...draft, level: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className={label}>Default clearance</span>
                <input
                  type="number"
                  min={0}
                  max={8}
                  className={field}
                  value={draft.defaultClearance}
                  onChange={(e) =>
                    setDraft({ ...draft, defaultClearance: Number(e.target.value) || 0 })
                  }
                />
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-1">
              <span className={label}>Description</span>
              <textarea
                className={`${field} min-h-[110px] flex-1 resize-none`}
                value={draft.description}
                placeholder="What this job is responsible for."
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>

            {selected && (
              <p className="font-mono text-[10px] text-[var(--content-tertiary)]">
                Held by{' '}
                <span className="text-[var(--content-secondary)]">
                  {selected.seatCount} {selected.seatCount === 1 ? 'seat' : 'seats'}
                </span>
                {heldBySeats && ' — reassign them before deleting this role.'}
              </p>
            )}

            {error && (
              <p
                role="alert"
                className="rounded border border-[var(--semantic-error-muted)] px-2 py-1.5 font-mono text-[10px] text-[var(--semantic-error)]"
              >
                {error}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-primary)] p-2.5">
            {selected && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy || heldBySeats}
                title={
                  heldBySeats
                    ? `${selected.seatCount} seat(s) hold this role; reassign them first`
                    : 'Delete this role'
                }
                className="cursor-pointer rounded border border-[var(--semantic-error)] px-3 py-1.5 font-mono text-[10px] text-[var(--semantic-error)] hover:bg-[var(--semantic-error)]/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                delete
              </button>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !draft.title.trim()}
              className="ml-auto cursor-pointer rounded border border-[var(--accent-primary)] px-3 py-1.5 font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? '…' : selected ? 'save changes' : 'create role'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
