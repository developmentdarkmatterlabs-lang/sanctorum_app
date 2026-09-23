import { useEffect, useMemo, useState } from 'react';
import type { Rule, RuleScope, Team } from '@/lib/office/types';
import type { RuleInput } from '@/api/rules';

type RuleManagerProps = {
  open: boolean;
  rules: Rule[];
  /** Teams (with positions) so a team/position-scoped rule can pick its owner. */
  teams: Team[];
  onClose: () => void;
  onCreate: (input: RuleInput) => Promise<unknown>;
  onUpdate: (id: string, input: RuleInput) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
};

type Draft = {
  title: string;
  body: string;
  scope: RuleScope;
  ownerId: string;
  order: number;
  enabled: boolean;
};

const EMPTY: Draft = {
  title: '',
  body: '',
  scope: 'global',
  ownerId: '',
  order: 0,
  enabled: true,
};

const field =
  'w-full rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 font-mono text-[12px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]';
const label = 'font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--content-tertiary)]';

const SCOPE_LABEL: Record<RuleScope, string> = {
  global: 'Global — every agent',
  team: 'Team',
  position: 'Position (one seat)',
};

/**
 * Standing rules — "how we always work", injected into EVERY run of the seats in
 * scope. Scoped global | team | position and INHERITED (a seat follows global + its
 * team's + its own), so a rule is written once, not assigned per seat.
 */
export default function RuleManager({
  open,
  rules,
  teams,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: RuleManagerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = rules.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    if (selected) {
      setDraft({
        title: selected.title,
        body: selected.body,
        scope: selected.scope,
        ownerId: selected.ownerId ?? '',
        order: selected.order,
        enabled: selected.enabled,
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

  // Owner options depend on the chosen scope: a team list, or every position.
  const owners = useMemo(() => {
    if (draft.scope === 'team') return teams.map((t) => ({ id: t.id, label: t.name }));
    if (draft.scope === 'position') {
      return teams.flatMap((t) =>
        t.positions.map((p) => ({ id: p.id, label: `${t.name} · ${p.title}` }))
      );
    }
    return [];
  }, [draft.scope, teams]);

  // Name a rule's owner for the list.
  const ownerLabel = (r: Rule): string => {
    if (r.scope === 'global') return 'global';
    if (r.scope === 'team') return teams.find((t) => t.id === r.ownerId)?.name ?? 'team';
    const tp = teams
      .flatMap((t) => t.positions.map((p) => ({ t, p })))
      .find((x) => x.p.id === r.ownerId);
    return tp ? `${tp.t.name} · ${tp.p.title}` : 'position';
  };

  if (!open) return null;

  const save = async () => {
    if (!draft.title.trim() || !draft.body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const input: RuleInput = {
        title: draft.title,
        body: draft.body,
        scope: draft.scope,
        ownerId: draft.scope === 'global' ? null : draft.ownerId || null,
        order: draft.order,
        enabled: draft.enabled,
      };
      if (selected) await onUpdate(selected.id, input);
      else {
        await onCreate(input);
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

  // Group the list by scope so the inheritance is legible.
  const grouped: { scope: RuleScope; items: Rule[] }[] = (
    ['global', 'team', 'position'] as RuleScope[]
  ).map((scope) => ({ scope, items: rules.filter((r) => r.scope === scope) }));

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[600px] max-h-full w-[820px] max-w-full overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--surface-secondary)] shadow-2xl">
        {/* The rule list, grouped by scope. */}
        <div className="flex w-[280px] shrink-0 flex-col border-r border-[var(--border-primary)]">
          <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
              Rules
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
            {rules.length === 0 ? (
              <p className="px-4 py-8 text-center font-mono text-[10px] leading-relaxed text-[var(--content-tertiary)]">
                No rules yet. Agents work fine without them — add one to set a
                convention everyone follows.
              </p>
            ) : (
              grouped.map(({ scope, items }) =>
                items.length === 0 ? null : (
                  <div key={scope}>
                    <p className="sticky top-0 bg-[var(--surface-secondary)] px-3 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--content-tertiary)]">
                      {scope}
                    </p>
                    <ul>
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
                              <span
                                className={`truncate font-mono text-[12px] ${
                                  r.enabled
                                    ? 'text-[var(--content-primary)]'
                                    : 'text-[var(--content-tertiary)] line-through'
                                }`}
                              >
                                {r.title}
                              </span>
                              <span className="ml-auto shrink-0 font-mono text-[9px] text-[var(--content-tertiary)]">
                                #{r.order}
                              </span>
                            </span>
                            <span className="w-full truncate font-mono text-[9.5px] text-[var(--content-tertiary)]">
                              {ownerLabel(r)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )
            )}
          </div>
        </div>

        {/* The editor. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
              {selected ? 'Edit rule' : 'New rule'}
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
              Standing rules are added to <em className="not-italic text-[var(--content-secondary)]">every</em>{' '}
              run of the seats in scope, ahead of their skills. A seat follows global +
              its team&apos;s + its own.
            </p>

            <div className="flex flex-col gap-1">
              <span className={label}>Title</span>
              <input
                className={field}
                value={draft.title}
                placeholder="e.g. Frontend layering"
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>

            <div className="flex gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className={label}>Scope</span>
                <select
                  className={field}
                  value={draft.scope}
                  onChange={(e) =>
                    setDraft({ ...draft, scope: e.target.value as RuleScope, ownerId: '' })
                  }
                >
                  {(['global', 'team', 'position'] as RuleScope[]).map((s) => (
                    <option key={s} value={s}>
                      {SCOPE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex w-[90px] shrink-0 flex-col gap-1">
                <span className={label}>Order</span>
                <input
                  type="number"
                  className={field}
                  value={draft.order}
                  onChange={(e) => setDraft({ ...draft, order: Number(e.target.value) || 0 })}
                />
              </div>
            </div>

            {draft.scope !== 'global' && (
              <div className="flex flex-col gap-1">
                <span className={label}>Applies to</span>
                <select
                  className={field}
                  value={draft.ownerId}
                  onChange={(e) => setDraft({ ...draft, ownerId: e.target.value })}
                >
                  <option value="">Choose a {draft.scope}…</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] text-[var(--content-secondary)]">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                className="accent-[var(--accent-primary)]"
              />
              Enabled (uncheck to pause without deleting)
            </label>

            <div className="flex min-h-0 flex-1 flex-col gap-1">
              <span className={label}>Rule</span>
              <textarea
                className={`${field} min-h-[140px] flex-1 resize-none`}
                value={draft.body}
                placeholder="e.g. Follow API → Service → Hook → Component → Module, and the same path back."
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
              disabled={busy || !draft.title.trim() || !draft.body.trim()}
              className="ml-auto cursor-pointer rounded border border-[var(--accent-primary)] px-3 py-1.5 font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? '…' : selected ? 'save changes' : 'create rule'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
