import { useEffect, useState } from 'react';
import type { Position, Role, Room, RosterEntry, Team } from '@/lib/office/types';
import MemoryView from './MemoryView';

type TeamManagerProps = {
  open: boolean;
  teams: Team[];
  rooms: Room[];
  /** All agents, so positions can show their holder and offer assignment. */
  roster: RosterEntry[];
  /** The role catalog — a seat is created from a role and inherits its
   *  title/clearance unless it sets an override. */
  roles: Role[];
  onClose: () => void;
  onCreateTeam: (name: string, mission: string, floorId: string | null) => Promise<unknown>;
  onUpdateTeam: (
    teamId: string,
    patch: {
      name?: string;
      mission?: string;
      floorId?: string | null;
      parentTeamId?: string | null;
    }
  ) => Promise<unknown>;
  onDeleteTeam: (teamId: string) => Promise<unknown>;
  onCreatePosition: (
    teamId: string,
    input: {
      roleId?: string | null;
      titleOverride?: string | null;
      clearanceOverride?: number | null;
      isLeader?: boolean;
    }
  ) => Promise<unknown>;
  onUpdatePosition: (
    positionId: string,
    patch: {
      roleId?: string | null;
      /** null CLEARS the override, so the seat goes back to inheriting. */
      titleOverride?: string | null;
      clearanceOverride?: number | null;
      isLeader?: boolean;
    }
  ) => Promise<unknown>;
  onDeletePosition: (positionId: string) => Promise<unknown>;
  /** Open the assign dialog for a position (holder handled there). */
  onAssign: (position: Position) => void;
  onUnassign: (agentKey: string) => Promise<unknown>;
};

const field =
  'w-full rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 font-mono text-[12px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]';
const label =
  'font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--content-tertiary)]';
const ctl =
  'cursor-pointer rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:border-[var(--accent-secondary)] hover:text-[var(--content-primary)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]';

/** Clearance ladder 0..8; label resolved elsewhere, the number is enough here. */
const CLEARANCES = Array.from({ length: 9 }, (_, i) => i);

/**
 * Create/edit teams and their positions, bind a team to a floor, and reach the
 * assign dialog. Mirrors FloorManager: drafts keyed by id (no per-row effects),
 * a shared `run` for busy/error, server-enforced rules surfaced inline. All
 * theme-token styled.
 */
export default function TeamManager({
  open,
  teams,
  rooms,
  roster,
  roles,
  onClose,
  onCreateTeam,
  onUpdateTeam,
  onDeleteTeam,
  onCreatePosition,
  onUpdatePosition,
  onDeletePosition,
  onAssign,
  onUnassign,
}: TeamManagerProps) {
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Draft text keyed by id (team name/mission, position title), so re-fetches
  // don't clobber an in-progress edit.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // New-team form.
  const [newName, setNewName] = useState('');
  const [newMission, setNewMission] = useState('');
  // New-position: the ROLE chosen for the seat, keyed by team id. A seat is an
  // instance of a role — you pick the job, not retype its title.
  const [newPos, setNewPos] = useState<Record<string, string>>({});

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

  const draftKey = (id: string) => `d:${id}`;
  const draftOf = (id: string, current: string) =>
    drafts[draftKey(id)] ?? current;
  const setDraft = (id: string, value: string) =>
    setDrafts((d) => ({ ...d, [draftKey(id)]: value }));
  const clearDraft = (id: string) =>
    setDrafts((d) => {
      const { [draftKey(id)]: _drop, ...rest } = d;
      return rest;
    });

  const commitText = (
    id: string,
    current: string,
    save: (next: string) => Promise<unknown>
  ) => {
    const next = (drafts[draftKey(id)] ?? '').trim();
    clearDraft(id);
    if (drafts[draftKey(id)] === undefined || !next || next === current) return;
    void run(id, () => save(next));
  };

  // Floors not already hosting a different team, for the home-floor selector.
  const floorOptions = (team: Team) =>
    rooms.filter(
      (r) => !teams.some((t) => t.id !== team.id && t.floorId === r.id)
    );

  /**
   * Teams this one may report into: anything that is not itself and not already
   * somewhere BENEATH it. Offering a descendant would create a cycle — the
   * backend refuses it (teamService.wouldCycle), but a picker that lists an
   * option only to have the save fail is a worse experience than one that never
   * offers it.
   */
  const parentOptions = (team: Team) => {
    const descendants = new Set<string>([team.id]);
    // Repeat until no new descendants appear: the team list is small and
    // unordered, so one pass could miss a grandchild listed before its parent.
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of teams) {
        if (t.parentTeamId && descendants.has(t.parentTeamId) && !descendants.has(t.id)) {
          descendants.add(t.id);
          grew = true;
        }
      }
    }
    return teams.filter((t) => !descendants.has(t.id));
  };

  const holderName = (agentKey: string | null) =>
    agentKey ? roster.find((a) => a.key === agentKey)?.name ?? agentKey : null;

  const createTeam = () => {
    const name = newName.trim();
    if (!name) return;
    void run('new-team', async () => {
      await onCreateTeam(name, newMission.trim(), null);
      setNewName('');
      setNewMission('');
    });
  };

  const addPosition = (teamId: string) => {
    const roleId = (newPos[teamId] ?? '').trim();
    if (!roleId) return;
    // No overrides: the new seat inherits the role's title and clearance.
    void run(teamId, async () => {
      await onCreatePosition(teamId, { roleId, isLeader: false });
      setNewPos((p) => ({ ...p, [teamId]: '' }));
    });
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-full w-[560px] max-w-full flex-col gap-3 overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--surface-secondary)] p-4 shadow-2xl">
        <div className="flex items-center">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
            Teams
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto cursor-pointer rounded border border-[var(--border-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
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

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          {teams.map((team) => (
            <div
              key={team.id}
              // A sub-team is indented and accented so the org reads as a tree at
              // a glance, rather than a flat list where nesting is only visible
              // by opening each picker.
              style={team.parentTeamId ? { marginLeft: '18px' } : undefined}
              className={`flex flex-col gap-2 rounded border bg-[var(--surface-tertiary)] p-2.5 ${
                team.parentTeamId
                  ? 'border-l-2 border-[var(--border-primary)] border-l-[var(--accent-muted)]'
                  : 'border-[var(--border-primary)]'
              }`}
            >
              {/* The name gets its own row. Sharing one row with the floor AND
                  parent pickers left `min-w-0 flex-1` nothing to work with, and
                  the name collapsed to invisible once a third control landed
                  beside it. */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={`Team name`}
                  className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[13px] font-semibold text-[var(--content-primary)] hover:border-[var(--border-primary)] focus-visible:border-[var(--accent-primary)] focus-visible:outline-none"
                  value={draftOf(`${team.id}:name`, team.name)}
                  disabled={busyId === team.id}
                  onChange={(e) => setDraft(`${team.id}:name`, e.target.value)}
                  onBlur={() =>
                    commitText(`${team.id}:name`, team.name, (name) =>
                      onUpdateTeam(team.id, { name })
                    )
                  }
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
                <select
                  aria-label="Home floor"
                  className={`${field} min-w-0 flex-1`}
                  value={team.floorId ?? ''}
                  disabled={busyId === team.id}
                  onChange={(e) =>
                    void run(team.id, () =>
                      onUpdateTeam(team.id, { floorId: e.target.value || null })
                    )
                  }
                >
                  <option value="">no floor</option>
                  {floorOptions(team).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.order + 1}. {r.name}
                    </option>
                  ))}
                </select>
                {/* Parent team — makes the org a tree. A leader may delegate to
                    the LEADER of a team that reports into its own. */}
                <select
                  aria-label="Reports into"
                  title="The team this one reports into. Its leader may delegate work to this team's leader."
                  className={`${field} min-w-0 flex-1`}
                  value={team.parentTeamId ?? ''}
                  disabled={busyId === team.id}
                  onChange={(e) =>
                    void run(team.id, () =>
                      onUpdateTeam(team.id, { parentTeamId: e.target.value || null })
                    )
                  }
                >
                  <option value="">top level</option>
                  {parentOptions(team).map((t) => (
                    <option key={t.id} value={t.id}>
                      ↳ reports into {t.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={`${ctl} hover:border-[var(--semantic-error)] hover:text-[var(--semantic-error)]`}
                  aria-label={`Delete ${team.name}`}
                  disabled={busyId === team.id}
                  onClick={() => void run(team.id, () => onDeleteTeam(team.id))}
                >
                  ✕
                </button>
              </div>

              <input
                aria-label="Mission"
                className={field}
                placeholder="Mission"
                value={draftOf(`${team.id}:mission`, team.mission)}
                disabled={busyId === team.id}
                onChange={(e) => setDraft(`${team.id}:mission`, e.target.value)}
                onBlur={() =>
                  commitText(`${team.id}:mission`, team.mission, (mission) =>
                    onUpdateTeam(team.id, { mission })
                  )
                }
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />

              <div className="flex flex-col gap-1">
                {team.positions.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-1.5 rounded border px-2 py-1 ${
                      p.isLeader
                        ? 'border-l-2 border-[var(--accent-primary)] bg-[var(--accent-primary)]/8'
                        : 'border-[var(--border-primary)] bg-[var(--surface-secondary)]'
                    }`}
                  >
                    {/* The seat's ROLE. Changing it re-points the seat, which
                        re-inherits that role's title/clearance. */}
                    <select
                      aria-label="Seat role"
                      title={
                        p.overridden.title
                          ? `Title overridden (role: ${p.roleTitle ?? 'none'})`
                          : 'Inherits its title from this role'
                      }
                      className="min-w-0 flex-1 cursor-pointer rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[12px] text-[var(--content-primary)] hover:border-[var(--border-primary)] focus-visible:border-[var(--accent-primary)] focus-visible:outline-none"
                      value={p.roleId ?? ''}
                      disabled={busyId === p.id}
                      onChange={(e) =>
                        void run(p.id, () =>
                          onUpdatePosition(p.id, { roleId: e.target.value || null })
                        )
                      }
                    >
                      <option value="">(no role)</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title}
                        </option>
                      ))}
                    </select>

                    {/* Clearance: inherited from the role unless overridden. The
                        "inherit" option CLEARS the override (null), so the seat
                        follows its role again. */}
                    <label
                      className="flex items-center gap-1"
                      title={
                        p.overridden.clearance
                          ? 'Overridden for this seat — pick "inherit" to follow the role again'
                          : 'Inherited from the role'
                      }
                    >
                      <span
                        className={
                          p.overridden.clearance
                            ? 'font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--accent-secondary)]'
                            : label
                        }
                      >
                        C
                      </span>
                      <select
                        aria-label={`${p.title} clearance`}
                        className={`cursor-pointer rounded border bg-[var(--surface-tertiary)] px-1 py-0.5 font-mono text-[11px] ${
                          p.overridden.clearance
                            ? 'border-[var(--accent-secondary)] text-[var(--accent-secondary)]'
                            : 'border-[var(--border-primary)] text-[var(--content-tertiary)]'
                        }`}
                        value={p.overridden.clearance ? String(p.clearance) : ''}
                        disabled={busyId === p.id}
                        onChange={(e) =>
                          void run(p.id, () =>
                            onUpdatePosition(p.id, {
                              clearanceOverride:
                                e.target.value === '' ? null : Number(e.target.value),
                            })
                          )
                        }
                      >
                        <option value="">inherit ({p.clearance})</option>
                        {CLEARANCES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>

                    {p.isLeader && (
                      <span className="shrink-0 rounded-full border border-[var(--accent-muted)] px-[7px] py-[2px] font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--accent-primary)]">
                        leader
                      </span>
                    )}

                    <button
                      type="button"
                      className={`${ctl} ${p.isLeader ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]' : ''}`}
                      aria-pressed={p.isLeader}
                      title={p.isLeader ? 'Team leader — click to unset' : 'Make team leader'}
                      disabled={busyId === p.id}
                      onClick={() =>
                        void run(p.id, () => onUpdatePosition(p.id, { isLeader: !p.isLeader }))
                      }
                    >
                      ★
                    </button>

                    {p.agentKey ? (
                      <button
                        type="button"
                        className={ctl}
                        title="Unassign"
                        disabled={busyId === p.id}
                        onClick={() => void run(p.id, () => onUnassign(p.agentKey!))}
                      >
                        {holderName(p.agentKey)} ✕
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={ctl}
                        onClick={() => onAssign(p)}
                        disabled={busyId === p.id}
                      >
                        assign
                      </button>
                    )}

                    <button
                      type="button"
                      className={`${ctl} hover:border-[var(--semantic-error)] hover:text-[var(--semantic-error)]`}
                      aria-label={`Delete position ${p.title}`}
                      disabled={busyId === p.id}
                      onClick={() => void run(p.id, () => onDeletePosition(p.id))}
                    >
                      ✕
                    </button>
                  </div>
                ))}

                {/* A seat is an INSTANCE of a role: pick the job, don't retype its
                    title. Several seats can share one role (3 sales seats = 1 role,
                    3 headcount). The new seat inherits that role's title/clearance. */}
                <div className="flex items-center gap-1.5">
                  <select
                    aria-label="Add a seat for this role"
                    className={`${field} cursor-pointer`}
                    value={newPos[team.id] ?? ''}
                    disabled={busyId === team.id || roles.length === 0}
                    onChange={(e) => setNewPos((p) => ({ ...p, [team.id]: e.target.value }))}
                  >
                    <option value="">
                      {roles.length === 0 ? 'define a role first…' : 'add a seat for…'}
                    </option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} (clr {r.defaultClearance})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={ctl}
                    disabled={busyId === team.id || !(newPos[team.id] ?? '').trim()}
                    onClick={() => addPosition(team.id)}
                  >
                    + add
                  </button>
                </div>

                {/* TEAM memory — shared by everyone on the team, and the scope an
                    agent's `write_memory` most often targets. Without this view
                    an agent could record something the team can never see: the
                    dossier only shows the `position` and `agent` scopes. No
                    `asAgentKey` here, so this is the unfiltered management view. */}
                <MemoryView scope="team" ownerId={team.id} ownerLabel={team.name} />
              </div>
            </div>
          ))}
        </div>

        {/* New team */}
        <div className="flex flex-col gap-2 border-t border-[var(--border-primary)] pt-3">
          <span className={label}>New team</span>
          <div className="flex gap-2">
            <input
              className={field}
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createTeam()}
            />
            <input
              className={field}
              placeholder="Mission (optional)"
              value={newMission}
              onChange={(e) => setNewMission(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createTeam()}
            />
            <button
              type="button"
              className="shrink-0 cursor-pointer rounded border border-[var(--accent-primary)] px-3 py-1.5 font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={busyId === 'new-team' || !newName.trim()}
              onClick={createTeam}
            >
              create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
