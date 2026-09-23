import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { StatusPill } from '@/components/ui';
import { MemoryView } from '@/components/team';
import { SkillAssign } from '@/components/skill';
import { McpAssign } from '@/components/mcp';
import { RulesInEffect } from '@/components/rule';
import { useModels } from '@/hooks/SharedModuleHooks/useModels';
import {
  LevelSelect,
  RoleSelect,
  fieldClass,
  labelClass,
  levelText,
} from '@/components/forms/DossierFields';
import type {
  AgentEdit,
  AgentSummary,
  McpServer,
  Personality,
  Role,
  Room,
  RosterEntry,
  Rule,
  Skill,
  Taxonomy,
  Team,
} from '@/lib/office/types';

type AgentProfilePanelProps = {
  agent: AgentSummary | null;
  profile: RosterEntry | null;
  rooms: Room[];
  teams: Team[];
  /** The role library — the Role picker reads these, not the taxonomy. */
  roles: Role[];
  /** Voices to choose from. A property of the AGENT, unlike skills and rules. */
  personalities: Personality[];
  taxonomy: Taxonomy | null;
  onClose: () => void;
  onSave: (key: string, edit: AgentEdit) => Promise<unknown>;
  onDelete?: (key: string) => void;
  /** Reassign the agent to a position, or unassign (positionId null). */
  onAssignPosition: (positionId: string, agentKey: string) => Promise<unknown>;
  onUnassignPosition: (agentKey: string) => Promise<unknown>;
  /** Open the model-picker popup for this agent. */
  onOpenModelDialog: () => void;
  /** The shared skill library, for assigning skills to this agent's seat. */
  skillLibrary: Skill[];
  loadPositionSkills: (positionId: string) => Promise<Skill[]>;
  /** Resolve the standing rules this seat follows (read-only display). */
  loadEffectiveRules: (teamId: string | null, positionId: string | null) => Promise<Rule[]>;
  onAssignSkill: (positionId: string, skillId: string) => Promise<Skill[]>;
  onUnassignSkill: (positionId: string, skillId: string) => Promise<Skill[]>;
  /** The shared MCP server library, for assigning MCPs to this agent's seat. */
  mcpLibrary: McpServer[];
  loadPositionMcps: (positionId: string) => Promise<McpServer[]>;
  onAssignMcp: (positionId: string, mcpServerId: string) => Promise<McpServer[]>;
  onUnassignMcp: (positionId: string, mcpServerId: string) => Promise<McpServer[]>;
};

type Draft = {
  role: string;
  // Clearance is not editable here — it comes from the held position (the seat).
  dataType: number;
  tenure: string;
  focus: string;
  room: number;
  seat: number;
  // A real directory the agent works in (blank = default sandbox), and whether
  // that mount is read-only.
  workspaceDir: string;
  workspaceReadOnly: boolean;
  // Human-in-the-loop: false = runs unattended (no approval pauses).
  supervised: boolean;
  trustedDelegator: boolean;
  personalityId: string;
  webMode: string;
  // USD ceiling for this agent's own delegation subtree. Held as a STRING
  // because it is bound to a text input: '' is a meaningful state (inherit the
  // global ceiling) that a number cannot express without conflating it with 0.
  maxCost: string;
};

const toDraft = (p: RosterEntry): Draft => ({
  role: p.role,
  dataType: p.dataType,
  tenure: p.tenure,
  focus: p.focus,
  room: p.room,
  seat: p.seat,
  workspaceDir: p.workspaceDir ?? '',
  workspaceReadOnly: p.workspaceReadOnly,
  supervised: p.supervised,
  trustedDelegator: p.trustedDelegator,
  personalityId: p.personalityId ?? '',
  webMode: p.webMode ?? '',
  maxCost: p.maxCost === null || p.maxCost === undefined ? '' : String(p.maxCost),
});

/**
 * Slide-in dossier for the selected agent. Rendered over the canvas on the
 * left, mirroring the roster on the right. Fields are editable and committed
 * with the save button.
 */
export default function AgentProfilePanel({
  agent,
  profile,
  rooms,
  teams,
  roles,
  personalities,
  taxonomy,
  onClose,
  onSave,
  onDelete,
  onAssignPosition,
  onUnassignPosition,
  onOpenModelDialog,
  skillLibrary,
  loadPositionSkills,
  loadEffectiveRules,
  onAssignSkill,
  onUnassignSkill,
  mcpLibrary,
  loadPositionMcps,
  onAssignMcp,
  onUnassignMcp,
}: AgentProfilePanelProps) {
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edits are keyed to the record they started from. When a different agent is
  // selected — or a save refreshes the roster — `source` no longer matches and
  // the draft is rebuilt during render, rather than synced in an effect.
  const [edited, setEdited] = useState<{ source: RosterEntry; draft: Draft } | null>(
    null
  );
  const draft = profile
    ? edited?.source === profile
      ? edited.draft
      : toDraft(profile)
    : null;

  const confirming = agent !== null && confirmingKey === agent.key;
  const open = agent !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const dirty = useMemo(() => {
    if (!profile || !draft) return false;
    const original = toDraft(profile);
    return (Object.keys(original) as (keyof Draft)[]).some(
      (k) => original[k] !== draft[k]
    );
  }, [profile, draft]);

  const handleSave = async () => {
    if (!agent || !profile || !draft || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const { room, seat, maxCost, ...rest } = draft;
      // The budget is typed as text so '' can mean "inherit", but the API takes
      // a number or null. Anything blank or non-positive is null — the same
      // reading the server applies, kept in step here so the field clears
      // rather than silently persisting a 0 that would read as "may not spend".
      const parsed = Number(maxCost);
      const budget: number | null =
        maxCost.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      // Only send room/seat when the desk actually moved, so an unrelated edit
      // never trips the reseat validation.
      const moved = room !== profile.room || seat !== profile.seat;
      const edit: AgentEdit = moved
        ? { ...rest, maxCost: budget, room, seat }
        : { ...rest, maxCost: budget };
      await onSave(agent.key, edit);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const patch = <K extends keyof Draft>(field: K, value: Draft[K]) => {
    if (!profile || !draft) return;
    setEdited({ source: profile, draft: { ...draft, [field]: value } });
  };

  // Seats the agent may move to on the drafted floor: any free desk, plus their
  // own current desk (so staying put is an option even on their home floor).
  // Keyed by the desk's stored `seat` index — floors can have gaps, so the array
  // position is not the index the backend expects.
  const seatsOnFloor = draft ? (rooms[draft.room]?.seats ?? []) : [];
  const ownSeat = profile && draft && draft.room === profile.room ? profile.seat : -1;
  const freeSeats = seatsOnFloor
    .filter((s) => !s.occupied || s.seat === ownSeat)
    .map((s) => s.seat);
  // A move is only saveable if the drafted desk is actually free on that floor.
  const seatValid = draft ? freeSeats.includes(draft.seat) : false;

  // Moving to a new floor: default to that floor's first free seat.
  const changeFloor = (room: number) => {
    if (!draft) return;
    const seats = rooms[room]?.seats ?? [];
    const firstFree = seats.find((s) => !s.occupied);
    setEdited({
      source: profile!,
      draft: { ...draft, room, seat: firstFree ? firstFree.seat : draft.seat },
    });
  };

  // Org assignment. The agent's current position (if any) and the vacant
  // positions it can move to, grouped by team. Clearance shown on the dossier
  // comes from this position now, so reassigning changes it.
  // Whether the CHOSEN model can call tools. OpenRouter's `tools` flag is a union
  // across a model's providers, so true is not a guarantee — but false is
  // reliable, and false plus a seat that holds tools is a run that WILL fail with
  // a raw 404 from the provider. Warn on the reliable half.
  const { models } = useModels();
  const chosenModel = profile?.model
    ? models.find((m) => m.id === profile.model) ?? null
    : null;

  const currentPositionId = profile?.positionId ?? null;
  const currentPosition = teams
    .flatMap((t) => t.positions.map((p) => ({ team: t, position: p })))
    .find((tp) => tp.position.id === currentPositionId);
  // The trusted-delegator toggle is only meaningful for a seat that actually
  // holds `delegate` — which needs BOTH rungs of the backend's gate: clearance
  // 6+ (senior enough) and isLeader (actually their manager). Mirrors
  // ToolPolicy's TOOL_LADDER + delegationService's leader check; showing it
  // anywhere else would offer a switch that changes nothing.
  const DELEGATE_MIN_CLEARANCE = 6;
  const isLeaderWithDelegate = Boolean(
    currentPosition?.position.isLeader &&
      currentPosition.position.clearance >= DELEGATE_MIN_CLEARANCE
  );

  const [reassigning, setReassigning] = useState(false);

  const changePosition = async (value: string) => {
    if (!agent) return;
    setReassigning(true);
    setError(null);
    try {
      if (value === '') await onUnassignPosition(agent.key);
      else await onAssignPosition(value, agent.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reassign.');
    } finally {
      setReassigning(false);
    }
  };

  return (
    <aside
      aria-hidden={!open}
      aria-label={agent ? `${agent.name} dossier` : undefined}
      className={`office-panel absolute inset-y-0 left-0 z-10 flex w-[320px] max-w-[85vw] flex-col border-r border-[var(--border-primary)] bg-[var(--surface-secondary)] shadow-[8px_0_32px_rgba(0,0,0,.45)] transition-transform duration-300 ease-out ${
        open ? 'translate-x-0' : 'pointer-events-none -translate-x-full'
      }`}
    >
      {agent && profile && (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-primary)] px-3.5 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
              Dossier
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dossier"
              className="ml-auto cursor-pointer rounded border border-[var(--border-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
            >
              close
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-[var(--surface-tertiary)]">
              <Image
                key={profile.portraitPath}
                src={profile.portraitPath}
                alt={`${agent.name}, full portrait`}
                fill
                sizes="320px"
                className="object-cover object-top"
                priority
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--surface-secondary)] to-transparent" />
            </div>

            <div className="px-3.5 pb-4">
              <div className="-mt-6 flex items-center gap-2">
                <h3 className="font-mono text-lg font-semibold text-[var(--content-primary)]">
                  {agent.name}
                </h3>
                <StatusPill status={agent.status} />
              </div>

              <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--accent-primary)]">
                {profile.title}
              </p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--content-secondary)]">
                {profile.tagline}
              </p>

              {taxonomy && draft ? (
                <div className="mt-4 flex flex-col gap-2.5">
                  {/* TWO different things are called "role" in this app, and
                      conflating them is the single easiest way to misread a
                      dossier:
                        - this field is a descriptive LABEL on the person ("what
                          they are"), stored on Agent.role and read by nothing at
                          run time;
                        - the SEAT's role (shown under Clearance) is the job, and
                          it is what resolves to capability.
                      An agent can be labelled "UI Engineer" while holding a
                      "Story Lead" seat at clearance 6. Say so, rather than
                      leaving two unexplained "Role" rows stacked on each other. */}
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Profession (label only)</span>
                    <RoleSelect
                      roles={roles}
                      value={draft.role}
                      onChange={(v) => patch('role', v)}
                    />
                    <span className="font-mono text-[9.5px] leading-relaxed text-[var(--content-tertiary)]">
                      Descriptive only — capability comes from the seat below, not
                      from this.
                      {currentPosition && draft.role !== currentPosition.position.title ? (
                        <span className="text-[var(--accent-secondary)]">
                          {' '}
                          This agent is labelled &ldquo;{draft.role}&rdquo; but holds the{' '}
                          &ldquo;{currentPosition.position.title}&rdquo; seat.
                        </span>
                      ) : null}
                    </span>
                  </label>

                  {/* Clearance is read-only — it's a property of the held seat,
                      edited on the position in the Team manager, not here. It is
                      usually INHERITED from the seat's role; a seat may override it,
                      which we flag so the source of the number is never a mystery. */}
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>Clearance</span>
                    <p className="rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 font-mono text-[11.5px] text-[var(--content-primary)]">
                      {profile.positionId
                        ? `Level ${profile.clearance} — ${levelText(
                            taxonomy.clearanceLevels,
                            profile.clearance
                          )}`
                        : 'None — unassigned (no seat)'}
                    </p>
                    {currentPosition && (
                      <span className="font-mono text-[9.5px] text-[var(--content-tertiary)]">
                        {currentPosition.position.overridden.clearance ? (
                          <span className="text-[var(--accent-secondary)]">
                            overridden on this seat
                            {currentPosition.position.roleTitle
                              ? ` — role: ${currentPosition.position.roleTitle}`
                              : ''}
                          </span>
                        ) : currentPosition.position.roleTitle ? (
                          <>inherited from role “{currentPosition.position.roleTitle}”</>
                        ) : (
                          'this seat has no role'
                        )}
                      </span>
                    )}
                  </div>

                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Data type</span>
                    <LevelSelect
                      levels={taxonomy.dataTypeLevels}
                      value={draft.dataType}
                      onChange={(v) => patch('dataType', v)}
                    />
                  </label>

                  <div className="flex gap-2">
                    <label className="flex flex-1 flex-col gap-1">
                      <span className={labelClass}>Tenure</span>
                      <input
                        className={fieldClass}
                        value={draft.tenure}
                        onChange={(e) => patch('tenure', e.target.value)}
                      />
                    </label>
                    <label className="flex flex-1 flex-col gap-1">
                      <span className={labelClass}>Focus</span>
                      <input
                        className={fieldClass}
                        value={draft.focus}
                        onChange={(e) => patch('focus', e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="flex gap-2">
                    <label className="flex flex-1 flex-col gap-1">
                      <span className={labelClass}>Floor</span>
                      <select
                        className={fieldClass}
                        value={draft.room}
                        onChange={(e) => changeFloor(Number(e.target.value))}
                      >
                        {rooms.map((r, i) => (
                          <option key={r.id} value={i}>
                            {i + 1}. {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-1 flex-col gap-1">
                      <span className={labelClass}>Seat</span>
                      <select
                        className={fieldClass}
                        value={draft.seat}
                        onChange={(e) => patch('seat', Number(e.target.value))}
                        disabled={freeSeats.length === 0}
                      >
                        {freeSeats.length === 0 && <option value={draft.seat}>floor is full</option>}
                        {freeSeats.map((i) => (
                          <option key={i} value={i}>
                            seat {i}
                            {i === ownSeat ? ' (current)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {/* Team / position. Reassigning here changes the agent's
                      effective clearance, since clearance lives on the seat. */}
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>
                      Team &amp; position
                      {currentPosition
                        ? ` — clearance from ${currentPosition.position.title}`
                        : ' — unassigned (no clearance)'}
                    </span>
                    <select
                      className={fieldClass}
                      value={currentPositionId ?? ''}
                      disabled={reassigning}
                      onChange={(e) => void changePosition(e.target.value)}
                    >
                      <option value="">— bench (no position) —</option>
                      {teams.map((t) => (
                        <optgroup key={t.id} label={t.name}>
                          {t.positions
                            .filter((p) => p.agentKey === null || p.id === currentPositionId)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.title} · clearance {p.clearance}
                                {p.isLeader ? ' ★' : ''}
                                {p.id === currentPositionId ? ' (current)' : ''}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>

                  {/* Per-agent model override — opens a popup picker (same as
                      settings). Null shows "global default". */}
                  <div className="flex flex-col gap-1">
                    <span className={labelClass}>Model</span>
                    <button
                      type="button"
                      onClick={onOpenModelDialog}
                      className={`${fieldClass} flex items-center gap-2 text-left`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {profile.model || 'Global default'}
                      </span>
                      <span className="shrink-0 text-[var(--content-tertiary)]">choose…</span>
                    </button>
                    {/* Every seat grants tools — the ladder starts at clearance 0
                        with read_file, list_dir, search and read_memory — so any
                        SEATED agent on a tool-less model cannot run at all. An
                        unseated agent has no tools, so this stays quiet for it. */}
                    {chosenModel && !chosenModel.tools && currentPosition && (
                      <p
                        role="alert"
                        className="rounded border border-[var(--semantic-error-muted)] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--semantic-error)]"
                      >
                        ⚠ {chosenModel.name} cannot call tools. This agent holds the
                        &ldquo;{currentPosition.position.title}&rdquo; seat at clearance{' '}
                        {currentPosition.position.clearance}, so every run sends tools and
                        will fail. Pick a model with the{' '}
                        <span className="text-[var(--accent-secondary)]">tools</span> badge.
                      </p>
                    )}
                  </div>

                  {/* Workspace override — a real directory the agent works in
                      instead of the default sandbox. Read-only by default so it
                      can look at a real folder/project but never modify it. */}
                  {draft && (
                    <div className="flex flex-col gap-1">
                      <span className={labelClass}>Workspace directory</span>
                      <input
                        type="text"
                        value={draft.workspaceDir}
                        onChange={(e) => patch('workspaceDir', e.target.value)}
                        placeholder="Blank = default sandbox (agent-workspaces)"
                        spellCheck={false}
                        className={fieldClass}
                      />
                      {draft.workspaceDir.trim() && (
                        <>
                          <label className="mt-1 flex cursor-pointer items-center gap-2 font-mono text-[10px] text-[var(--content-secondary)]">
                            <input
                              type="checkbox"
                              checked={draft.workspaceReadOnly}
                              onChange={(e) => patch('workspaceReadOnly', e.target.checked)}
                              className="accent-[var(--accent-primary)]"
                            />
                            Read-only (observe, never modify)
                          </label>
                          {!draft.workspaceReadOnly && (
                            <p className="rounded border border-[var(--semantic-error-muted)] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--semantic-error)]">
                              ⚠ Write access: this agent can create and modify files
                              in <span className="break-all">{draft.workspaceDir.trim()}</span>.
                              Only enable for a folder you intend it to change.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Voice — the agent's, not the seat's: it survives a move. */}
                  {draft && (
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>Personality</span>
                      <select
                        className={fieldClass}
                        value={draft.personalityId}
                        onChange={(e) => patch('personalityId', e.target.value)}
                      >
                        <option value="">None — the model&apos;s own voice</option>
                        {personalities.map((p) => (
                          <option key={p.id} value={p.id} disabled={!p.enabled}>
                            {p.name}
                            {p.summary ? ` — ${p.summary}` : ''}
                            {p.enabled ? '' : ' (disabled)'}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {/* Web access — overrides the global setting for this agent. */}
                  {draft && (
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>Web access</span>
                      <select
                        className={fieldClass}
                        value={draft.webMode}
                        onChange={(e) => patch('webMode', e.target.value)}
                      >
                        <option value="">Use the global setting</option>
                        <option value="fetch">Text only — cheap, no browser</option>
                        <option value="browse">Browser — watchable, needs clearance 5</option>
                        <option value="both">Both — the model chooses</option>
                      </select>
                      {draft.webMode === 'browse' && (
                        <span className="font-mono text-[10px] leading-relaxed text-[var(--content-tertiary)]">
                          Removes the cheap text reader, so every page costs about 10x more.
                        </span>
                      )}
                    </label>
                  )}

                  {/* Supervision toggle — when off, the agent runs unattended. */}
                  {draft && (
                    <div className="flex flex-col gap-1">
                      <span className={labelClass}>Supervision</span>
                      <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] text-[var(--content-secondary)]">
                        <input
                          type="checkbox"
                          checked={draft.supervised}
                          onChange={(e) => patch('supervised', e.target.checked)}
                          className="accent-[var(--accent-primary)]"
                        />
                        Require my approval before each tool
                      </label>
                      {!draft.supervised && (
                        <p className="rounded border border-[var(--semantic-error-muted)] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--semantic-error)]">
                          ⚠ Unsupervised: this agent runs without asking. It stays
                          confined by its clearance and workspace, but won&apos;t pause for
                          approval on writes or commands.
                        </p>
                      )}

                      {/* Trusted delegator — a SEPARATE trust decision from the one
                          above. Shown only for a leader that actually holds the
                          `delegate` tool, since it is meaningless otherwise. */}
                      {isLeaderWithDelegate && (
                        <>
                          <label className="mt-1 flex cursor-pointer items-center gap-2 font-mono text-[11px] text-[var(--content-secondary)]">
                            <input
                              type="checkbox"
                              checked={draft.trustedDelegator}
                              onChange={(e) => patch('trustedDelegator', e.target.checked)}
                              className="accent-[var(--accent-primary)]"
                            />
                            Let this leader delegate without asking
                          </label>
                          <p className="font-mono text-[10px] leading-relaxed text-[var(--content-tertiary)]">
                            {draft.trustedDelegator
                              ? 'Fan-outs run immediately. Budget caps (depth, runs, cost) and the same-team rule still apply, and every report is still bound by its own clearance.'
                              : 'Each delegation waits for your approval. Turn this on for a leader you have watched work.'}
                          </p>

                          {/* This leader's OWN budget. Shown beside the trust
                              toggle on purpose: removing the approval click is
                              exactly when a spending bound starts to matter. */}
                          <label className="mt-2 flex flex-col gap-1">
                            <span className={labelClass}>Budget (USD)</span>
                            <input
                              type="number"
                              min={0}
                              step={0.25}
                              className={fieldClass}
                              placeholder="inherit the global ceiling"
                              value={draft.maxCost}
                              onChange={(e) => patch('maxCost', e.target.value)}
                            />
                          </label>
                          <p className="font-mono text-[10px] leading-relaxed text-[var(--content-tertiary)]">
                            {draft.maxCost.trim() && Number(draft.maxCost) > 0
                              ? `This agent and everything it delegates may spend $${Number(draft.maxCost).toFixed(2)} per task. The global ceiling still applies — whichever is lower binds.`
                              : 'Blank: bound only by the global cost ceiling in Settings. Set a figure to give this leader a tighter budget of its own.'}
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  {/* Standing rules this seat follows (read-only; scoped, not assigned). */}
                  <RulesInEffect
                    teamId={currentPosition?.team.id ?? null}
                    positionId={profile.positionId}
                    load={loadEffectiveRules}
                  />

                  {/* Skills held by this agent's seat — assign from the library. */}
                  <SkillAssign
                    positionId={profile.positionId}
                    clearance={profile.clearance}
                    library={skillLibrary}
                    loadHeld={loadPositionSkills}
                    onAssign={onAssignSkill}
                    onUnassign={onUnassignSkill}
                  />

                  {/* MCP servers held by this agent's seat — assign from the library. */}
                  <McpAssign
                    positionId={profile.positionId}
                    clearance={profile.clearance}
                    library={mcpLibrary}
                    loadHeld={loadPositionMcps}
                    onAssign={onAssignMcp}
                    onUnassign={onUnassignMcp}
                  />

                  {error && (
                    <p
                      role="alert"
                      className="rounded border border-[var(--semantic-error-muted)] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--semantic-error)]"
                    >
                      {error}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!dirty || saving || !seatValid}
                    className="cursor-pointer rounded border border-[var(--accent-primary)] py-1.5 font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
                  >
                    {saving ? 'saving…' : dirty ? 'save changes' : 'saved'}
                  </button>
                </div>
              ) : (
                // Read-only until the vocabularies arrive.
                <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2">
                  {[
                    { label: 'Role', value: profile.role },
                    { label: 'Clearance', value: `Level ${profile.clearance}` },
                    { label: 'Data type', value: `Level ${profile.dataType}` },
                    { label: 'Tenure', value: profile.tenure },
                    { label: 'Location', value: rooms[agent.room]?.name ?? '—' },
                  ].map((t) => (
                    <div
                      key={t.label}
                      className="rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5"
                    >
                      <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--content-tertiary)]">
                        {t.label}
                      </dt>
                      <dd className="font-mono text-[11.5px] text-[var(--content-primary)]">
                        {t.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {taxonomy && (
                <p className="mt-2 font-mono text-[9.5px] leading-relaxed text-[var(--content-tertiary)]">
                  {levelText(taxonomy.clearanceLevels, profile.clearance)} ·{' '}
                  {levelText(taxonomy.dataTypeLevels, profile.dataType)}
                </p>
              )}

              <h4 className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
                Responsibilities
              </h4>
              <ul className="mt-2 flex flex-col gap-1.5">
                {profile.responsibilities.map((item) => (
                  <li
                    key={item}
                    className="flex gap-2 text-[12px] leading-relaxed text-[var(--content-secondary)]"
                  >
                    <span aria-hidden="true" className="text-[var(--accent-primary)]">
                      ▸
                    </span>
                    {item}
                  </li>
                ))}
              </ul>

              {/* Memory. Position memory is what the agent sees through its own
                  clearance (the gate applies); agent memory is its personal layer.
                  Keyed so switching agents remounts with fresh state. */}
              {currentPosition && (
                <div className="mt-4 border-t border-[var(--border-primary)] pt-3">
                  <MemoryView
                    key={`pos-${currentPosition.position.id}`}
                    scope="position"
                    ownerId={currentPosition.position.id}
                    ownerLabel={`${currentPosition.team.name} · ${currentPosition.position.title}`}
                    asAgentKey={agent.key}
                    showClearance
                  />
                </div>
              )}
              <div className="mt-4 border-t border-[var(--border-primary)] pt-3">
                <MemoryView
                  key={`agent-${agent.key}`}
                  scope="agent"
                  ownerId={agent.key}
                  ownerLabel={agent.name}
                  asAgentKey={agent.key}
                />
              </div>

              {onDelete && (
                <div className="mt-5 border-t border-[var(--border-primary)] pt-3">
                  {confirming ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-[var(--content-secondary)]">
                        Remove {agent.name}?
                      </span>
                      <button
                        type="button"
                        onClick={() => onDelete(agent.key)}
                        className="ml-auto cursor-pointer rounded border border-[var(--semantic-error)] px-2 py-1 font-mono text-[10px] text-[var(--semantic-error)] hover:bg-[var(--semantic-error)]/15 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--semantic-error)]"
                      >
                        confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingKey(null)}
                        className="cursor-pointer rounded border border-[var(--border-primary)] px-2 py-1 font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
                      >
                        cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingKey(agent.key)}
                      className="w-full cursor-pointer rounded border border-[var(--border-primary)] py-1.5 font-mono text-[10px] text-[var(--content-secondary)] hover:border-[var(--semantic-error)] hover:text-[var(--semantic-error)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--semantic-error)]"
                    >
                      remove agent
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
