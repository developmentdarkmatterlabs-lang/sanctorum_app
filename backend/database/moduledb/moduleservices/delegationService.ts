import { prisma } from '../../db';
import { effectivePosition } from './positionResolve';
import { checkBudget, trace } from './runTreeService';

// Phase 4 — WHO may delegate to WHOM, and the dispatch of a delegated child run.
//
// The rule: a leader may delegate DOWNWARD THROUGH THE ORG TREE — to its own
// team's non-leader seats, and to the LEADER of a team that reports into its
// own. Never upward, never sideways, never more than one level at a time.
//
// SECURITY — why LATERAL cross-team delegation is still refused outright:
//
//   A Marketing Lead sits at clearance 6 and its grant has no `run_command`.
//   Engineering's Test Runner sits at clearance 5 and its grant DOES. If the
//   Marketing Lead could delegate into that seat, it would obtain shell
//   execution it was never granted — and NO gate would fire, because each run is
//   individually within its own seat's grant. The escalation lives in the EDGE,
//   not in either run.
//
//   Nesting opens exactly ONE new kind of edge — parent team -> sub-team leader —
//   and keeps every other one closed. That edge is legitimate hierarchy (a CMO
//   commissioning a department that can do things the CMO cannot), and because
//   the graph stays a strict downward TREE, it cannot be used to reach sideways
//   into an unrelated team. Acyclic + downward is the property doing the work.
//
// This is also why the roster we put in the leader's prompt is a HINT, never the
// gate: every delegate call re-derives the legal targets here, server-side.

/** One seat a run may delegate to. */
export type DelegateTarget = {
  positionId: string;
  title: string;
  clearance: number;
  agentKey: string;
  agentName: string;
  /** Set when this target is the LEADER of a sub-team rather than one of my own
   *  seats — the team they lead. The prompt roster uses it so a department head
   *  reads as "leads the Writing team", not as another individual report. */
  viaTeam: string | null;
};

/**
 * The seats `agentKey` may delegate to:
 *
 *   1. occupied, non-leader seats on its OWN team (its direct reports), and
 *   2. the occupied LEADER seat of each team whose parent is its own team
 *      (a department head reporting into it).
 *
 * Returns [] when the caller doesn't hold a leader seat — clearance alone never
 * confers authority over other people.
 *
 * DOWNWARD-ONLY, ONE LEVEL. Deliberately absent: the caller's own parent-team
 * leader (upward), sibling teams' leaders (sideways), and anything deeper than
 * one level. Those edges are never RETURNED rather than being returned and then
 * rejected — the delegation graph stays a strict tree, which is what keeps the
 * escalation path acyclic. `delegate()` re-derives this list on every call, so a
 * seat id the model invents or copies is refused.
 *
 * NOTE on clearance across the boundary (a deliberate decision): a parent leader
 * MAY direct a sub-team leader that holds tools the parent lacks — a CMO who
 * cannot run a shell can still commission work from a team that can. Capability
 * is still gated per RUN (each child executes at its own seat's clearance); what
 * nesting opens is who may ASK. Confining that to a downward tree is what stops
 * it becoming lateral clearance laundering.
 */
export async function delegateTargets(agentKey: string): Promise<DelegateTarget[]> {
  if (!agentKey) return [];

  const caller = await prisma.agent.findUnique({
    where: { key: agentKey },
    include: { position: true },
  });
  if (!caller?.position?.isLeader) return [];

  const targets: DelegateTarget[] = [];

  // (1) My own team's reports.
  const seats = await prisma.position.findMany({
    where: { teamId: caller.position.teamId, isLeader: false },
    include: { role: true, agent: true },
    orderBy: { order: 'asc' },
  });
  for (const seat of seats) {
    if (!seat.agent || seat.agent.key === agentKey) continue;
    // Resolve through the ONE resolver so the title/clearance shown to the
    // leader are the same ones the child's grant will be built from.
    const eff = effectivePosition(seat, seat.role);
    targets.push({
      positionId: seat.id,
      title: eff.title,
      clearance: eff.clearance,
      agentKey: seat.agent.key,
      agentName: seat.agent.name,
      viaTeam: null,
    });
  }

  // (2) The leaders of teams that report into mine — one level down only. Note
  // `parentTeamId: caller.position.teamId`: this walks DOWN the tree, never up.
  const subTeams = await prisma.team.findMany({
    where: { parentTeamId: caller.position.teamId },
    include: {
      positions: {
        where: { isLeader: true },
        include: { role: true, agent: true },
      },
    },
    orderBy: { name: 'asc' },
  });
  for (const team of subTeams) {
    for (const seat of team.positions) {
      if (!seat.agent || seat.agent.key === agentKey) continue;
      const eff = effectivePosition(seat, seat.role);
      targets.push({
        positionId: seat.id,
        title: eff.title,
        clearance: eff.clearance,
        agentKey: seat.agent.key,
        agentName: seat.agent.name,
        viaTeam: team.name,
      });
    }
  }

  return targets;
}

export type DelegateResult =
  | { ok: true; childRunId: string; agentName: string; remaining: number }
  | { ok: false; reason: string };

/**
 * Spawns a child run for one subordinate.
 *
 * The child's capability grant is computed from the SUBORDINATE'S seat by the
 * normal buildRunSpec path — clearance is never inherited from the delegating
 * leader. A lead with `run_command` delegating "run the tests" to a clearance-2
 * intern produces a refusal inside that child run, not execution.
 *
 * A refusal here is a normal return value, not an exception: it becomes the
 * delegate tool's result string, which the leader reads and adapts to.
 */
export async function delegate(input: {
  parentRunId: string;
  callerAgentKey: string;
  targetPositionId: string;
  task: string;
}): Promise<DelegateResult> {
  trace(input.parentRunId, 'DELEGATE-req', `to=${input.targetPositionId} task="${input.task.slice(0, 50)}…"`);
  const targets = await delegateTargets(input.callerAgentKey);
  if (targets.length === 0) {
    return {
      ok: false,
      reason:
        'you have no reports to delegate to — you either do not lead a team or ' +
        'its other seats are vacant. Do this work yourself.',
    };
  }

  const target = targets.find((t) => t.positionId === input.targetPositionId);
  if (!target) {
    const roster = targets.map((t) => `${t.positionId} (${t.title})`).join(', ');
    return {
      ok: false,
      reason: `'${input.targetPositionId}' is not one of your reports. You may delegate only to: ${roster}.`,
    };
  }

  const budget = await checkBudget(input.parentRunId);
  if (!budget.ok) {
    trace(input.parentRunId, 'DELEGATE-refused', budget.reason);
    return { ok: false, reason: budget.reason };
  }

  const parent = await prisma.run.findUnique({ where: { id: input.parentRunId } });
  if (!parent) return { ok: false, reason: 'the delegating run is unknown.' };
  if (parent.status === 'cancelled') {
    return { ok: false, reason: 'this task was cancelled; no further work may be started.' };
  }

  // Imported lazily: inboxService imports this module for the prompt roster, so
  // a top-level import would be circular.
  const { sendMessage } = await import('./inboxService');

  const sent = await sendMessage(parent.threadId, input.task, {
    asAgentKey: target.agentKey,
    parentRunId: input.parentRunId,
  });
  if (!sent.ok || !sent.runId) {
    return { ok: false, reason: 'could not start the delegated run.' };
  }

  // Surface the fan-out in the LEADER's lane, so its terminal reads as a
  // delegation rather than a silent gap while the reports work.
  await prisma.message.create({
    data: {
      threadId: parent.threadId,
      sender: 'system',
      agentKey: parent.agentKey,
      body: `⇩ delegated to ${target.agentName} (${target.title}): ${input.task}`,
    },
  });

  trace(input.parentRunId, 'DELEGATE-spawned', `child=${sent.runId.slice(0, 8)} agent=${target.agentKey} remaining=${budget.remaining}`);
  return {
    ok: true,
    childRunId: sent.runId,
    agentName: target.agentName,
    remaining: budget.remaining,
  };
}
