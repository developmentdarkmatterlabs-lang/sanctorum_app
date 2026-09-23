import { useEffect, useState } from 'react';
import type { Skill } from '@/lib/office/types';
import type { SkillInput } from '@/api/skills';

type SkillManagerProps = {
  open: boolean;
  skills: Skill[];
  onClose: () => void;
  onCreate: (input: SkillInput) => Promise<unknown>;
  onUpdate: (id: string, input: Partial<SkillInput>) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
};

type Draft = { name: string; description: string; body: string; minClearance: number };

const EMPTY: Draft = { name: '', description: '', body: '', minClearance: 0 };

const field =
  'w-full rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 font-mono text-[12px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]';
const label = 'font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--content-tertiary)]';

/** The shared skill library: create, edit, and delete .md playbooks. Assignment
 *  to a position happens in the agent dossier (SkillAssign), not here. */
export default function SkillManager({
  open,
  skills,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: SkillManagerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = skills.find((s) => s.id === selectedId) ?? null;

  // Load the selected skill into the draft; "new" resets to empty.
  useEffect(() => {
    if (selected) {
      setDraft({
        name: selected.name,
        description: selected.description,
        body: selected.body,
        minClearance: selected.minClearance,
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

  if (!open) return null;

  const save = async () => {
    if (!draft.name.trim() || !draft.body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (selected) {
        await onUpdate(selected.id, draft);
      } else {
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
      setError(err instanceof Error ? err.message : 'Could not delete.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[560px] max-h-full w-[720px] max-w-full overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--surface-secondary)] shadow-2xl">
        {/* Library list */}
        <div className="flex w-[240px] shrink-0 flex-col border-r border-[var(--border-primary)]">
          <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
              Skills
            </span>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="ml-auto cursor-pointer rounded border border-[var(--accent-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15"
            >
              + new
            </button>
          </div>
          <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {skills.length === 0 ? (
              <li className="m-auto px-4 py-8 text-center font-mono text-[10px] leading-relaxed text-[var(--content-tertiary)]">
                No skills yet. Create one to teach agents a task.
              </li>
            ) : (
              skills.map((s) => (
                <li key={s.id} className="border-b border-[var(--border-primary)]">
                  <button
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-[var(--surface-tertiary)] ${
                      selectedId === s.id ? 'bg-[var(--surface-tertiary)]' : ''
                    }`}
                  >
                    <span className="truncate font-mono text-[12px] text-[var(--content-primary)]">
                      {s.name}
                    </span>
                    {s.description && (
                      <span className="w-full truncate font-mono text-[10px] text-[var(--content-tertiary)]">
                        {s.description}
                      </span>
                    )}
                    {s.minClearance > 0 && (
                      <span className="font-mono text-[9px] text-[var(--accent-secondary)]">
                        min clearance {s.minClearance}
                      </span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        {/* Editor */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
              {selected ? 'Edit skill' : 'New skill'}
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
            <div className="flex flex-col gap-1">
              <span className={label}>Name</span>
              <input
                className={field}
                value={draft.name}
                spellCheck={false}
                placeholder="e.g. code-review"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className={label}>Description</span>
              <input
                className={field}
                value={draft.description}
                placeholder="One-line summary"
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className={label}>Minimum clearance</span>
              <input
                type="number"
                min={0}
                max={8}
                className={field}
                value={draft.minClearance}
                onChange={(e) =>
                  setDraft({ ...draft, minClearance: Number(e.target.value) || 0 })
                }
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1">
              <span className={label}>Body (Markdown — injected into the prompt)</span>
              <textarea
                className={`${field} min-h-[160px] flex-1 resize-none`}
                value={draft.body}
                spellCheck={false}
                placeholder="When asked to do X, follow these steps…"
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </div>

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
                disabled={busy}
                className="cursor-pointer rounded border border-[var(--semantic-error)] px-3 py-1.5 font-mono text-[10px] text-[var(--semantic-error)] hover:bg-[var(--semantic-error)]/15 disabled:opacity-40"
              >
                delete
              </button>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !draft.name.trim() || !draft.body.trim()}
              className="ml-auto cursor-pointer rounded border border-[var(--accent-primary)] px-3 py-1.5 font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? '…' : selected ? 'save changes' : 'create skill'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
