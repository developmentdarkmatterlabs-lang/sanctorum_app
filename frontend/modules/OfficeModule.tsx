import { useCallback, useRef, useState, type MouseEvent } from 'react';
import { ActivityLog } from '@/components/data-display';
import { AgentList, AgentProfilePanel } from '@/components/entity';
import { AddAgentForm, FloorForm } from '@/components/forms';
import { OfficeShell, SupervisionStatus } from '@/components/layout';
import {
  EditorPalette,
  EditorToolbar,
  FloorManager,
  OfficeCanvas,
  TopBar,
} from '@/components/office';
import { TeamManager, AssignPositionForm } from '@/components/team';
import { SkillManager } from '@/components/skill';
import { McpManager } from '@/components/mcp';
import { FleetView, RunTree } from '@/components/fleet';
import { RuleManager } from '@/components/rule';
import { RoleManager } from '@/components/role';
import { InboxPanel, AgentTerminal } from '@/components/inbox';
import { SettingsPanel, AgentModelDialog } from '@/components/settings';
import { useAutoZoom } from '@/hooks/SharedModuleHooks/useAutoZoom';
import { useEditor } from '@/hooks/SharedModuleHooks/useEditor';
import { useInbox } from '@/hooks/SharedModuleHooks/useInbox';
import { useRuns } from '@/hooks/SharedModuleHooks/useRuns';
import { useAnnounce } from '@/hooks/SharedModuleHooks/useAnnounce';
import { usePersonalities } from '@/hooks/SharedModuleHooks/usePersonalities';
import { PersonalityManager } from '@/components/personality';
import { useOffice } from '@/hooks/SharedModuleHooks/useOffice';
import { useSprites } from '@/hooks/SharedModuleHooks/useSprites';
import { useTeams } from '@/hooks/SharedModuleHooks/useTeams';
import { useSkills } from '@/hooks/SharedModuleHooks/useSkills';
import { useMcp } from '@/hooks/SharedModuleHooks/useMcp';
import { useRules } from '@/hooks/SharedModuleHooks/useRules';
import { useRoles } from '@/hooks/SharedModuleHooks/useRoles';
import { useWheelZoom } from '@/hooks/SharedModuleHooks/useWheelZoom';
import { useEditorStore } from '@/store/editorStore';
import { useOfficeStore } from '@/store/officeStore';
import type { Position } from '@/lib/office/types';

const HEADING =
  'shrink-0 px-3.5 pb-2 pt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]';

export default function OfficeModule() {
  // `version` bumps as sprites decode, so the face thumbnails repaint.
  const { images, version } = useSprites();
  useAutoZoom();

  const {
    canvasRef,
    width,
    height,
    onCanvasClick,
    selectAgent,
    command,
    setViewRoom,
    setZoom,
    toggleAuto,
    addAgent,
    removeAgent,
    saveAgent,
    createFloor,
    renameFloor,
    reorderFloor,
    deleteFloor,
  } = useOffice({ images });

  const {
    teams,
    createTeam,
    updateTeam,
    deleteTeam,
    createPosition,
    updatePosition,
    deletePosition,
    assign,
    unassign,
  } = useTeams();

  const {
    skills,
    create: createSkill,
    update: updateSkill,
    remove: removeSkill,
    positionSkills,
    assign: assignSkill,
    unassign: unassignSkill,
  } = useSkills();

  const {
    mcpServers,
    create: createMcp,
    update: updateMcp,
    remove: removeMcp,
    positionMcps,
    assign: assignMcp,
    unassign: unassignMcp,
  } = useMcp();

  const {
    rules,
    create: createRule,
    update: updateRule,
    remove: removeRule,
    effectiveFor: effectiveRules,
  } = useRules();

  const {
    personalities,
    create: createPersonality,
    update: updatePersonality,
    remove: removePersonality,
  } = usePersonalities();

  const {
    roles,
    create: createRole,
    update: updateRole,
    remove: removeRole,
  } = useRoles();

  const {
    threads,
    unread,
    openThreadId,
    messages,
    refresh: refreshInbox,
    openAgent,
    openThread,
    closeThread,
    send,
    decide,
    cancel: cancelRun,
    redirect,
    remove: removeThread,
  } = useInbox();

  // Phase 4 — the delegation tree behind mission control.
  const {
    tree: runTree,
    totalCost: treeCost,
    live: treeLive,
    loading: treeLoading,
    openTree,
    cancelTree,
    close: closeTree,
  } = useRuns();

  const [adding, setAdding] = useState(false);
  // Two floor overlays: the manager (list/rename/reorder/delete) and the add form.
  const [managingFloors, setManagingFloors] = useState(false);
  const [addingFloor, setAddingFloor] = useState(false);
  // Team overlays: the manager and the assign-agent dialog (a position or null).
  const [managingTeams, setManagingTeams] = useState(false);
  const [managingSkills, setManagingSkills] = useState(false);
  const [managingMcp, setManagingMcp] = useState(false);
  const [managingRules, setManagingRules] = useState(false);
  const [managingRoles, setManagingRoles] = useState(false);
  const [managingPersonalities, setManagingPersonalities] = useState(false);
  const [fleetOpen, setFleetOpen] = useState(false);
  const [assigningPosition, setAssigningPosition] = useState<Position | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The agent whose model popup is open (by key), or null.
  const [modelDialogKey, setModelDialogKey] = useState<string | null>(null);
  // The agent whose live terminal is open (by key), or null.
  const [terminalKey, setTerminalKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useWheelZoom({ scrollRef, canvasRef, onZoom: setZoom });

  const { handleClick, handleHover, handleLeave } = useEditor();
  const editing = useEditorStore((s) => s.active);

  const agents = useOfficeStore((s) => s.agents);
  const rooms = useOfficeStore((s) => s.rooms);
  const rosterEntries = useOfficeStore((s) => s.rosterEntries);
  const rosterByKey = useOfficeStore((s) => s.rosterByKey);
  const rosterError = useOfficeStore((s) => s.rosterError);
  const taxonomy = useOfficeStore((s) => s.taxonomy);
  const log = useOfficeStore((s) => s.log);
  const selectedKey = useOfficeStore((s) => s.selectedKey);
  const viewRoom = useOfficeStore((s) => s.viewRoom);
  const zoom = useOfficeStore((s) => s.zoom);

  // In edit mode a click paints; otherwise it falls through to play behaviour
  // (select an agent, or send the selected one to a tile).
  const onCanvasClickWithEditor = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      if (handleClick(event, zoom)) return;
      onCanvasClick(event);
    },
    [handleClick, onCanvasClick, zoom]
  );
  const onCanvasHover = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => handleHover(event, zoom),
    [handleHover, zoom]
  );
  const auto = useOfficeStore((s) => s.auto);

  const selectedAgent = agents.find((a) => a.key === selectedKey) ?? null;

  // Agents parked on a decision, for the title bar badge. Derived rather than
  // stored: `status` already carries it, and a second source would be one more
  // thing to keep in step.
  const waitingCount = agents.filter((a) => a.status === 'waiting').length;

  // A chime or a spoken line when an agent replies or finishes. Lives here
  // because this is where the threads it watches already are.
  const nameOf = useCallback(
    (key: string | null) => (key ? (rosterByKey[key]?.name ?? key) : 'An agent'),
    [rosterByKey]
  );
  const announce = useAnnounce(threads, nameOf);

  // Message an agent: open the inbox and their DM thread in one go.
  const openMessage = useCallback(
    (key: string) => {
      setInboxOpen(true);
      void openAgent(key);
    },
    [openAgent]
  );

  // Terminal: open the agent's thread (so its live event stream loads) and show
  // it as a scrolling console.
  const openTerminal = useCallback(
    (key: string) => {
      setTerminalKey(key);
      void openAgent(key);
    },
    [openAgent]
  );

  const terminalAgent = terminalKey ? (rosterByKey[terminalKey] ?? null) : null;
  // The open thread's run state drives the terminal's live controls. The terminal
  // opens the agent's thread, so `openThreadId` is that thread while it's shown.
  const terminalThread = openThreadId ? (threads.find((t) => t.id === openThreadId) ?? null) : null;

  return (
    <OfficeShell
      titleBarStatus={
        <SupervisionStatus
          waiting={waitingCount}
          cost={treeCost}
          live={treeLive}
          onOpenInbox={() => setInboxOpen(true)}
        />
      }
      panel={
        <AgentProfilePanel
          agent={selectedAgent}
          profile={selectedKey ? (rosterByKey[selectedKey] ?? null) : null}
          rooms={rooms}
          teams={teams}
          roles={roles}
          personalities={personalities}
          taxonomy={taxonomy}
          onClose={() => selectedKey && selectAgent(selectedKey)}
          onSave={saveAgent}
          onDelete={(key) => void removeAgent(key)}
          onAssignPosition={assign}
          onUnassignPosition={unassign}
          onOpenModelDialog={() => selectedKey && setModelDialogKey(selectedKey)}
          skillLibrary={skills}
          loadPositionSkills={positionSkills}
          loadEffectiveRules={effectiveRules}
          onAssignSkill={assignSkill}
          onUnassignSkill={unassignSkill}
          mcpLibrary={mcpServers}
          loadPositionMcps={positionMcps}
          onAssignMcp={assignMcp}
          onUnassignMcp={unassignMcp}
        />
      }
      overlay={
        <>
          <AddAgentForm
            open={adding}
            onClose={() => setAdding(false)}
            onSubmit={addAgent}
            rooms={rooms}
            taxonomy={taxonomy}
            roles={roles}
          />
          <FloorManager
            open={managingFloors}
            rooms={rooms}
            onClose={() => setManagingFloors(false)}
            onAdd={() => {
              setManagingFloors(false);
              setAddingFloor(true);
            }}
            onRename={renameFloor}
            onReorder={reorderFloor}
            onDelete={deleteFloor}
          />
          <FloorForm
            open={addingFloor}
            onClose={() => setAddingFloor(false)}
            onSubmit={createFloor}
          />
          <TeamManager
            open={managingTeams}
            teams={teams}
            rooms={rooms}
            roster={rosterEntries}
            roles={roles}
            onClose={() => setManagingTeams(false)}
            onCreateTeam={createTeam}
            onUpdateTeam={updateTeam}
            onDeleteTeam={deleteTeam}
            onCreatePosition={createPosition}
            onUpdatePosition={updatePosition}
            onDeletePosition={deletePosition}
            onAssign={setAssigningPosition}
            onUnassign={unassign}
          />
          <AssignPositionForm
            position={assigningPosition}
            teams={teams}
            roster={rosterEntries}
            onClose={() => setAssigningPosition(null)}
            onAssign={assign}
          />
          <SkillManager
            open={managingSkills}
            skills={skills}
            onClose={() => setManagingSkills(false)}
            onCreate={createSkill}
            onUpdate={updateSkill}
            onDelete={removeSkill}
          />
          <McpManager
            open={managingMcp}
            servers={mcpServers}
            onClose={() => setManagingMcp(false)}
            onCreate={createMcp}
            onUpdate={updateMcp}
            onDelete={removeMcp}
          />
          <RoleManager
            open={managingRoles}
            roles={roles}
            onClose={() => setManagingRoles(false)}
            onCreate={createRole}
            onUpdate={updateRole}
            onDelete={removeRole}
          />
          <RuleManager
            open={managingRules}
            rules={rules}
            teams={teams}
            onClose={() => setManagingRules(false)}
            onCreate={createRule}
            onUpdate={updateRule}
            onDelete={removeRule}
          />
          <FleetView
            open={fleetOpen}
            roster={rosterEntries}
            threads={threads}
            refresh={refreshInbox}
            onClose={() => setFleetOpen(false)}
            onOpenTerminal={(key) => {
              setFleetOpen(false);
              openTerminal(key);
            }}
            onDecide={decide}
            onCancel={cancelRun}
            onRedirect={redirect}
            onOpenTree={(rootRunId) => {
              setFleetOpen(false);
              void openTree(rootRunId);
            }}
          />
          {/* Phase 4 — mission control: the delegation tree of one task. */}
          {runTree.length > 0 && (
            <RunTree
              tree={runTree}
              totalCost={treeCost}
              live={treeLive}
              loading={treeLoading}
              nameFor={(key) => (key ? (rosterByKey[key]?.name ?? key) : 'unassigned')}
              onOpenTerminal={(key) => {
                closeTree();
                openTerminal(key);
              }}
              onCancelTree={() => {
                const root = runTree[0];
                if (root) void cancelTree(root.rootRunId, root.threadId);
              }}
              // Answer a pause on ANY node — including a middle manager's, which
              // no other surface can reach (see RunTree's header comment).
              onDecide={async (threadId, runId, decision) => {
                await decide(threadId, runId, decision);
                // Re-read the tree so the answered node updates immediately
                // rather than waiting for the next poll tick.
                const root = runTree[0];
                if (root) await openTree(root.rootRunId);
              }}
              onClose={closeTree}
            />
          )}
          <InboxPanel
            open={inboxOpen}
            threads={threads}
            openThreadId={openThreadId}
            messages={messages}
            roster={rosterEntries}
            teams={teams}
            onClose={() => {
              setInboxOpen(false);
              closeThread();
            }}
            onOpenThread={openThread}
            onCloseThread={closeThread}
            onSend={send}
            onDeleteThread={removeThread}
            onDecide={decide}
            onCancel={cancelRun}
          />
          <PersonalityManager
            open={managingPersonalities}
            personalities={personalities}
            onClose={() => setManagingPersonalities(false)}
            onCreate={createPersonality}
            onUpdate={updatePersonality}
            onDelete={removePersonality}
          />
          <SettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            announce={announce}
          />
          <AgentModelDialog
            agent={
              modelDialogKey && rosterByKey[modelDialogKey]
                ? {
                    key: modelDialogKey,
                    name: rosterByKey[modelDialogKey].name,
                    model: rosterByKey[modelDialogKey].model,
                    imageModel: rosterByKey[modelDialogKey].imageModel,
                    speechModel: rosterByKey[modelDialogKey].speechModel,
                  }
                : null
            }
            onClose={() => setModelDialogKey(null)}
            onChoose={(key, modelId, field) => saveAgent(key, { [field]: modelId })}
          />
          <AgentTerminal
            agent={terminalAgent ? { key: terminalAgent.key, name: terminalAgent.name } : null}
            messages={messages}
            onClose={() => setTerminalKey(null)}
            pending={
              terminalThread?.pendingRunId
                ? { runId: terminalThread.pendingRunId, step: terminalThread.pendingStep }
                : null
            }
            activeRunId={terminalThread?.activeRunId ?? null}
            onDecide={(runId, decision, edited) =>
              terminalThread ? decide(terminalThread.id, runId, decision, edited) : Promise.resolve()
            }
            onCancel={(runId) =>
              terminalThread ? cancelRun(terminalThread.id, runId) : Promise.resolve()
            }
            onRedirect={(body, runId) =>
              terminalThread ? redirect(terminalThread.id, body, runId) : Promise.resolve()
            }
          />
        </>
      }
      topBar={
        <TopBar
          rooms={rooms}
          viewRoom={viewRoom}
          zoom={zoom}
          auto={auto}
          editing={editing}
          onRoom={setViewRoom}
          onZoom={setZoom}
          onToggleAuto={toggleAuto}
          onManageFloors={() => setManagingFloors(true)}
          onManageTeams={() => setManagingTeams(true)}
          onManageRoles={() => setManagingRoles(true)}
          onManageSkills={() => setManagingSkills(true)}
          onManageMcp={() => setManagingMcp(true)}
          onManageRules={() => setManagingRules(true)}
          onManagePersonalities={() => setManagingPersonalities(true)}
          onOpenFleet={() => setFleetOpen(true)}
          onOpenInbox={() => setInboxOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          unread={unread}
          editorToolbar={<EditorToolbar />}
        />
      }
      palette={<EditorPalette />}
      canvas={
        <OfficeCanvas
          canvasRef={canvasRef}
          scrollRef={scrollRef}
          width={width}
          height={height}
          zoom={zoom}
          editing={editing}
          onClick={onCanvasClickWithEditor}
          onHover={onCanvasHover}
          onLeave={handleLeave}
        />
      }
      sidebar={
        <>
          <div className="flex shrink-0 items-center pr-2.5">
            <h2 className={HEADING}>Agents</h2>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="ml-auto cursor-pointer rounded border border-[var(--border-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
            >
              + add
            </button>
          </div>

          {rosterError && (
            <p
              role="alert"
              className="mx-2.5 mb-2 shrink-0 rounded border border-[var(--semantic-error-muted)] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--semantic-error)]"
            >
              Backend unreachable — start it with `npm run dev` in backend/.
            </p>
          )}

          <div className="min-h-0 shrink overflow-y-auto">
            <AgentList
              agents={agents}
              images={images}
              spriteVersion={version}
              rosterByKey={rosterByKey}
              selectedKey={selectedKey}
              onSelect={selectAgent}
              onCommand={command}
              onMessage={openMessage}
              onTerminal={openTerminal}
            />
          </div>

          <div className="mt-2.5 flex min-h-[140px] flex-1 flex-col border-t border-[var(--border-primary)]">
            <h2 className={HEADING}>Activity</h2>
            <ActivityLog entries={log} />
          </div>

          <p className="shrink-0 border-t border-[var(--border-primary)] px-3.5 py-2.5 font-mono text-[10.5px] leading-[1.6] text-[var(--content-tertiary)]">
            <em className="not-italic text-[var(--content-secondary)]">Select</em> an agent
            card or click a character.{' '}
            <em className="not-italic text-[var(--content-secondary)]">Click a floor tile</em>{' '}
            to send it there.{' '}
            <em className="not-italic text-[var(--content-secondary)]">Desk</em> returns it
            to its seat; it starts working on arrival.
          </p>
        </>
      }
    />
  );
}
