import { useEffect, useState } from 'react';
import { fieldClass, labelClass } from '@/components/forms/DossierFields';
import type { Personality } from '@/lib/office/types';
import type { PersonalityInput } from '@/api/personalities';

type PersonalityManagerProps = {
  open: boolean;
  personalities: Personality[];
  onClose: () => void;
  onCreate: (input: PersonalityInput) => Promise<unknown>;
  onUpdate: (id: string, input: PersonalityInput) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
};

type Draft = {
  name: string;
  summary: string;
  body: string;
  stance: string;
  enabled: boolean;
};

const EMPTY: Draft = { name: '', summary: '', body: '', stance: '', enabled: true };

/** Shown as the placeholder so the default behaviour is visible, not implied. */
const DEFAULT_STANCE =
  'If asked directly whether you are an AI, say so plainly in one sentence and ' +
  'continue in character. Never claim to be human, and never lecture about it.';

/**
 * Personalities — who an agent is and how it speaks. Assigned to the AGENT in its
 * dossier, not to a seat: move an agent to another desk and its clearance and
 * skills change, its voice should not.
 */
export default function PersonalityManager({
  open,
  personalities,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: PersonalityManagerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = personalities.find((p) => p.id === selectedId) ?? null;

  // Reset the draft during render when the selection changes, rather than in an
  // effect: an effect would render once with the previous personality's text.
  const [draftFor, setDraftFor] = useState<string | null>(null);
  if (draftFor !== selectedId) {
    setDraftFor(selectedId);
    setDraft(
      selected
        ? {
            name: selected.name,
            summary: selected.summary,
            body: selected.body,
            stance: selected.stance,
            enabled: selected.enabled,
          }
        : EMPTY
    );
    setError(null);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    if (!draft.name.trim() || !draft.body.trim() || busy) return;
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
      setError(err instanceof Error ? err.message : 'Could not delete.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[600px] max-h-full w-[820px] max-w-full overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--surface-secondary)] shadow-2xl">
        <div className="flex w-[260px] shrink-0 flex-col border-r border-[var(--border-primary)]">
          <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
              Personalities
            </span>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="ml-auto cursor-pointer rounded border border-[var(--accent-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15"
            >
              + new
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {personalities.length === 0 ? (
              <p className="px-4 py-8 text-center font-mono text-[10px] leading-relaxed text-[var(--content-tertiary)]">
                No personalities yet. Without one an agent answers in its model&apos;s
                default voice — add one to give a character its own.
              </p>
            ) : (
              <ul>
                {personalities.map((p) => (
                  <li key={p.id} className="border-b border-[var(--border-primary)]">
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-[var(--surface-tertiary)] ${
                        selectedId === p.id ? 'bg-[var(--surface-tertiary)]' : ''
                      }`}
                    >
                      <span className="flex w-full items-center gap-2">
                        <span
                          className={`truncate font-mono text-[12px] ${
                            p.enabled
                              ? 'text-[var(--content-primary)]'
                              : 'text-[var(--content-tertiary)] line-through'
                          }`}
                        >
                          {p.name}
                        </span>
                        {p.agentCount > 0 && (
                          <span className="ml-auto shrink-0 font-mono text-[9px] text-[var(--content-tertiary)]">
                            {p.agentCount}
                          </span>
                        )}
                      </span>
                      {p.summary && (
                        <span className="truncate font-mono text-[10px] text-[var(--content-tertiary)]">
                          {p.summary}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center border-b border-[var(--border-primary)] px-3 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
              {selected ? selected.name : 'New personality'}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto cursor-pointer rounded border border-[var(--border-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
            >
              close
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            {error && (
              <p role="alert" className="font-mono text-[10px] text-[var(--semantic-error)]">
                {error}
              </p>
            )}

            <label className="flex flex-col gap-1">
              <span className={labelClass}>Name</span>
              <input
                className={fieldClass}
                value={draft.name}
                onChange={(e) => patch('name', e.target.value)}
                placeholder="Ebon"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className={labelClass}>Summary</span>
              <input
                className={fieldClass}
                value={draft.summary}
                onChange={(e) => patch('summary', e.target.value)}
                placeholder="Wry, terse, fond of metaphor"
              />
            </label>

            <label className="flex min-h-0 flex-1 flex-col gap-1">
              <span className={labelClass}>Voice</span>
              <textarea
                className={`${fieldClass} min-h-[170px] flex-1 resize-none leading-relaxed`}
                value={draft.body}
                onChange={(e) => patch('body', e.target.value)}
                placeholder={
                  'How this character speaks and what it cares about. Markdown is fine.\n\n' +
                  'You are a magician of the old school — precise, a little theatrical, ' +
                  'impatient with padding. You favour short sentences and concrete images.'
                }
              />
              <span className="font-mono text-[9px] text-[var(--content-tertiary)]">
                Leads the prompt, ahead of standing rules and the seat&apos;s role.
              </span>
            </label>

            <label className="flex flex-col gap-1">
              <span className={labelClass}>Identity stance</span>
              <textarea
                className={`${fieldClass} min-h-[62px] resize-none leading-relaxed`}
                value={draft.stance}
                onChange={(e) => patch('stance', e.target.value)}
                placeholder={DEFAULT_STANCE}
              />
              <span className="font-mono text-[9px] leading-relaxed text-[var(--content-tertiary)]">
                How to answer &ldquo;are you an AI?&rdquo;. Blank uses the default above.
                Re-sent on every retry so a long run does not drift back to the
                model&apos;s own voice.
              </span>
            </label>

            <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] text-[var(--content-secondary)]">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => patch('enabled', e.target.checked)}
                className="accent-[var(--accent-primary)]"
              />
              Enabled
            </label>
          </div>

          <div className="flex items-center gap-2 border-t border-[var(--border-primary)] px-3 py-2.5">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !draft.name.trim() || !draft.body.trim()}
              className="cursor-pointer rounded border border-[var(--accent-primary)] px-3 py-[5px] font-mono text-[11px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 disabled:cursor-default disabled:opacity-40"
            >
              {selected ? 'save' : 'create'}
            </button>
            {selected && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                title={
                  selected.agentCount > 0
                    ? `${selected.agentCount} agent(s) wear this; they keep working, without a voice.`
                    : undefined
                }
                className="ml-auto cursor-pointer rounded border border-[var(--border-primary)] px-3 py-[5px] font-mono text-[11px] text-[var(--content-tertiary)] hover:border-[var(--semantic-error)] hover:text-[var(--semantic-error)] disabled:opacity-40"
              >
                delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
