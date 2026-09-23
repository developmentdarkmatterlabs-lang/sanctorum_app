import type { Level, Role, Taxonomy } from '@/lib/office/types';

export const fieldClass =
  'w-full rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 font-mono text-[12px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]';

export const labelClass =
  'font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--content-tertiary)]';

export const levelText = (levels: Level[], value: number): string => {
  const found = levels.find((l) => l.level === value);
  return found ? `Level ${found.level} — ${found.label}` : `Level ${value}`;
};

/**
 * Role picker, fed by the ROLE LIBRARY — the same rows the Roles tab manages.
 *
 * It used to read the hardcoded taxonomy instead, which meant two lists of
 * "roles" that never agreed: a role you created in the Roles tab was not
 * offered here, and a label picked here referred to nothing the app knew about.
 * Both now come from one place, so what you can create you can also assign.
 *
 * Grouped by discipline (and showing each role's clearance) because the list
 * runs to a couple of hundred entries — a flat A-Z dropdown of that length is
 * unusable. Roles with no discipline fall into a trailing group rather than
 * disappearing.
 */
export function RoleSelect({
  roles,
  value,
  onChange,
  showClearance = false,
  id,
}: {
  roles: Role[];
  value: string;
  onChange: (role: string) => void;
  /** Show each role's default clearance. TRUE where the choice actually grants
   *  capability (a seat's role); FALSE in the dossier, where this is only a
   *  label — printing a clearance there implies a level the agent may not have. */
  showClearance?: boolean;
  id?: string;
}) {
  // Group by discipline, keeping each group's roles alphabetical.
  const groups = new Map<string, Role[]>();
  for (const r of [...roles].sort((a, b) => a.title.localeCompare(b.title))) {
    const key = r.discipline?.trim() || 'Other';
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)
  );

  // An agent may hold a label that no longer matches a role (renamed, deleted,
  // or seeded before the library existed). Offer it so the dossier does not
  // silently blank a value the user never changed.
  const orphan = value && !roles.some((r) => r.title === value) ? value : null;

  return (
    <select
      id={id}
      className={fieldClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {orphan && (
        <optgroup label="Not in the role library">
          <option value={orphan}>{orphan}</option>
        </optgroup>
      )}
      {ordered.map(([discipline, list]) => (
        <optgroup key={discipline} label={discipline}>
          {list.map((r) => (
            <option key={r.id} value={r.title}>
              {r.title}
              {showClearance ? ` (clr ${r.defaultClearance})` : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Ladder picker, for clearance and data sensitivity. */
export function LevelSelect({
  levels,
  value,
  onChange,
  id,
}: {
  levels: Level[];
  value: number;
  onChange: (level: number) => void;
  id?: string;
}) {
  return (
    <select
      id={id}
      className={fieldClass}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {levels.map((l) => (
        <option key={l.level} value={l.level}>
          Level {l.level} — {l.label}
        </option>
      ))}
    </select>
  );
}
