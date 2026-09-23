import { prisma } from '../../db';
import { isWebMode } from '../../../runtime/ToolPolicy';
import { effectiveClearanceOf } from './positionResolve';
import {
  DEFAULT_ROW_ORDER,
  parseRowOrder,
  type DirectionName,
} from '../../../utils/rowOrder';

/** Shape sent to the frontend. JSON columns are parsed out. */
export type AgentDTO = {
  id: string;
  key: string;
  name: string;
  room: number;
  seat: number;
  /** Stable handle for the desk; the frontend still derives the tile from
   *  room/seat, but keeps this for the editor phases. */
  seatId: string | null;
  /** The team position this agent holds, or null if unassigned (on the bench). */
  positionId: string | null;
  /** Per-agent LLM model override (OpenRouter id), or null = use global default. */
  model: string | null;
  /** Per-agent IMAGE model for `generate_image`, or null = use global default. */
  imageModel: string | null;
  /** Per-agent SPEECH model for `generate_speech`, or null = use global default. */
  speechModel: string | null;
  /** The voice this agent wears, or null. A property of the AGENT, not the seat. */
  personalityId: string | null;
  /** 'fetch' | 'browse' | 'both', or null = the global default. */
  webMode: string | null;
  /** USD ceiling for this agent's own delegation subtree (itself + everything it
   *  delegates), or null = inherit the global ceiling. Enforced in
   *  runTreeService.checkBudget alongside the tree's own cap; the lower binds. */
  maxCost: number | null;
  /** A real directory this agent works in instead of the default sandbox, or null.
   *  The "connect to a real folder" override. */
  workspaceDir: string | null;
  /** When mounted on a real folder: true (default) = read-only (observe, never
   *  mutate); false = the agent may write there (a deliberate trust decision). */
  workspaceReadOnly: boolean;
  /** Human-in-the-loop: true (default) = pauses for approval before each tool;
   *  false = runs unattended (still confined by clearance + workspace). */
  supervised: boolean;
  /** Phase 4 — leader may fan out without approving each delegation. */
  trustedDelegator: boolean;
  spritePath: string;
  portraitPath: string;
  title: string;
  tagline: string;
  role: string;
  /** Effective clearance: the held position's clearance, or 0 when unassigned
   *  (no standing access). Clearance is the seat's, not the character's — this is
   *  the value the UI shows read-only and everything gates on. */
  clearance: number;
  /** Data sensitivity ladder level. */
  dataType: number;
  tenure: string;
  focus: string;
  rowOrder: DirectionName[];
  responsibilities: string[];
};

type AgentRow = Awaited<ReturnType<typeof findAllRows>>[number];

const findAllRows = () =>
  prisma.agent.findMany({
    include: {
      responsibilities: { orderBy: { order: 'asc' } },
      // Role is needed to resolve an inherited clearance (Phase 3.9).
      position: { select: { clearanceOverride: true, role: true } },
    },
    orderBy: [{ room: 'asc' }, { seat: 'asc' }],
  });

const toDTO = (row: AgentRow): AgentDTO => ({
  id: row.id,
  key: row.key,
  name: row.name,
  room: row.room,
  seat: row.seat,
  seatId: row.seatId,
  positionId: row.positionId,
  model: row.model,
  imageModel: row.imageModel,
  speechModel: row.speechModel,
  personalityId: row.personalityId,
  webMode: row.webMode,
  maxCost: row.maxCost,
  workspaceDir: row.workspaceDir,
  workspaceReadOnly: row.workspaceReadOnly,
  supervised: row.supervised,
  trustedDelegator: row.trustedDelegator,
  spritePath: row.spritePath,
  portraitPath: row.portraitPath,
  title: row.title,
  tagline: row.tagline,
  role: row.role,
  // Clearance is a property of the held SEAT, not the character: resolved from the
  // seat's override or its role (Phase 3.9), or 0 (no standing access) when
  // unassigned. The legacy agent.clearance column is vestigial — never read here.
  clearance: row.position ? effectiveClearanceOf(row.position, row.position.role) : 0,
  dataType: row.dataType,
  tenure: row.tenure,
  focus: row.focus,
  // A malformed column falls back to the standard order rather than leaving
  // the agent unrenderable.
  rowOrder: parseRowOrder(row.rowOrder) ?? DEFAULT_ROW_ORDER,
  responsibilities: row.responsibilities.map((r) => r.text),
});

export async function getAllAgents(): Promise<AgentDTO[]> {
  return (await findAllRows()).map(toDTO);
}

export async function getAgentByKey(key: string): Promise<AgentDTO | null> {
  const row = await prisma.agent.findUnique({
    where: { key },
    include: {
      responsibilities: { orderBy: { order: 'asc' } },
      // Role is needed to resolve an inherited clearance (Phase 3.9).
      position: { select: { clearanceOverride: true, role: true } },
    },
  });
  return row ? toDTO(row) : null;
}

export type CreateAgentInput = {
  key: string;
  name: string;
  room: number;
  seat: number;
  spritePath: string;
  portraitPath: string;
  title: string;
  tagline: string;
  role: string;
  clearance: number;
  dataType: number;
  tenure: string;
  focus: string;
  rowOrder: DirectionName[];
  responsibilities: string[];
};

export async function createAgent(input: CreateAgentInput): Promise<AgentDTO> {
  const { rowOrder, responsibilities, ...rest } = input;
  // Link to the seat row for this desk. It exists for every seeded floor; a
  // floor added in a later phase seeds its seats up front, so this stays valid.
  const seatRow = await prisma.seat.findUnique({
    where: { room_seat: { room: input.room, seat: input.seat } },
  });
  const row = await prisma.agent.create({
    data: {
      ...rest,
      seatId: seatRow?.id ?? null,
      rowOrder: JSON.stringify(rowOrder),
      responsibilities: {
        create: responsibilities.map((text, order) => ({ text, order })),
      },
    },
    include: {
      responsibilities: { orderBy: { order: 'asc' } },
      // Role is needed to resolve an inherited clearance (Phase 3.9).
      position: { select: { clearanceOverride: true, role: true } },
    },
  });
  return toDTO(row);
}

/** Every field the dossier can edit. All optional: callers send a subset.
 *  `room`/`seat` reseat the agent — pass both together to move them. */
export type UpdateAgentInput = {
  name?: string;
  title?: string;
  tagline?: string;
  role?: string;
  // Clearance is NOT here: it's a property of the Position (the seat), edited on
  // the position, never on the agent. See effectiveClearance / toDTO.
  dataType?: number;
  tenure?: string;
  focus?: string;
  rowOrder?: DirectionName[];
  responsibilities?: string[];
  room?: number;
  seat?: number;
  /** Per-agent model override; '' or null clears it (use the global default). */
  model?: string | null;
  /** Per-agent image model; '' or null clears it (use the global default). */
  imageModel?: string | null;
  /** Per-agent speech model; '' or null clears it (use the global default). */
  speechModel?: string | null;
  /** The voice to wear; '' or null clears it. */
  personalityId?: string | null;
  /** Web tools offered; '' or null clears it (use the global default). */
  webMode?: string | null;
  /** USD ceiling for this agent's own subtree; null or 0 clears it (inherit). */
  maxCost?: number | null;
  /** A real directory to work in; '' or null clears it (back to the sandbox). */
  workspaceDir?: string | null;
  /** Read-only mount toggle for a real-folder workspace (default true). */
  workspaceReadOnly?: boolean;
  /** Human-in-the-loop toggle: false = the agent runs unattended. */
  supervised?: boolean;
  trustedDelegator?: boolean;
};

/** A reseat was refused because the target desk is already taken. */
export type UpdateAgentResult =
  | { ok: true; agent: AgentDTO }
  | { ok: false; notFound: true }
  | { ok: false; error: string };

export async function updateAgent(
  key: string,
  input: UpdateAgentInput
): Promise<UpdateAgentResult> {
  const exists = await prisma.agent.findUnique({ where: { key } });
  if (!exists) return { ok: false, notFound: true };

  const {
    rowOrder,
    responsibilities,
    room,
    seat,
    model,
    imageModel,
    speechModel,
    personalityId,
    webMode,
    maxCost,
    workspaceDir,
    ...rest
  } = input;
  // An empty model string clears the override (fall back to the global default).
  const modelUpdate =
    model === undefined ? {} : { model: model && model.trim() ? model.trim() : null };
  const imageModelUpdate =
    imageModel === undefined
      ? {}
      : { imageModel: imageModel && imageModel.trim() ? imageModel.trim() : null };
  const speechModelUpdate =
    speechModel === undefined
      ? {}
      : { speechModel: speechModel && speechModel.trim() ? speechModel.trim() : null };
  // Only the three known values persist; anything else clears the override.
  const webModeUpdate =
    webMode === undefined
      ? {}
      : { webMode: isWebMode(webMode) ? webMode : null };
  const personalityUpdate =
    personalityId === undefined
      ? {}
      : {
          personalityId:
            personalityId && personalityId.trim() ? personalityId.trim() : null,
        };
  // A cleared or non-positive budget means INHERIT, not "may spend nothing" —
  // the same reading maxRuns/maxCost give 0, and the only safe one: a stray 0
  // here would otherwise silently forbid an agent from delegating at all.
  const maxCostUpdate =
    maxCost === undefined
      ? {}
      : {
          maxCost:
            maxCost === null || !Number.isFinite(Number(maxCost)) || Number(maxCost) <= 0
              ? null
              : Number(maxCost),
        };
  // An empty workspaceDir clears the mount (back to the default sandbox).
  const workspaceUpdate =
    workspaceDir === undefined
      ? {}
      : { workspaceDir: workspaceDir && workspaceDir.trim() ? workspaceDir.trim() : null };

  // A reseat needs both coordinates. Validate the target and re-link seatId to
  // the destination desk, mirroring createAgent. Occupancy is derived from
  // agent.room/seat, so we only reject if another agent already sits there.
  const reseating = room !== undefined && seat !== undefined;
  let seatLink: { seatId?: string | null } = {};
  if (reseating) {
    const targetRoom = await prisma.room.findUnique({ where: { order: room } });
    if (!targetRoom) return { ok: false, error: 'that floor does not exist' };

    const occupant = await prisma.agent.findFirst({
      where: { room, seat, key: { not: key } },
      select: { name: true },
    });
    if (occupant) {
      return { ok: false, error: `seat ${seat} on that floor is taken by ${occupant.name}` };
    }

    const seatRow = await prisma.seat.findUnique({
      where: { room_seat: { room, seat } },
    });
    seatLink = { seatId: seatRow?.id ?? null };
  }

  const row = await prisma.agent.update({
    where: { key },
    data: {
      ...rest,
      ...modelUpdate,
      ...imageModelUpdate,
      ...speechModelUpdate,
      ...personalityUpdate,
      ...webModeUpdate,
      ...maxCostUpdate,
      ...workspaceUpdate,
      ...(reseating ? { room, seat, ...seatLink } : {}),
      ...(rowOrder ? { rowOrder: JSON.stringify(rowOrder) } : {}),
      // Responsibilities are replaced wholesale — they have no stable ids.
      ...(responsibilities
        ? {
            responsibilities: {
              deleteMany: {},
              create: responsibilities.map((text, order) => ({ text, order })),
            },
          }
        : {}),
    },
    include: {
      responsibilities: { orderBy: { order: 'asc' } },
      // Role is needed to resolve an inherited clearance (Phase 3.9).
      position: { select: { clearanceOverride: true, role: true } },
    },
  });
  return { ok: true, agent: toDTO(row) };
}

export async function deleteAgentByKey(key: string): Promise<AgentDTO | null> {
  const existing = await getAgentByKey(key);
  if (!existing) return null;
  // Responsibilities cascade via the schema relation.
  await prisma.agent.delete({ where: { key } });
  return existing;
}

/** Seats already occupied in a room, so callers can pick a free one. */
export async function takenSeats(room: number): Promise<number[]> {
  const rows = await prisma.agent.findMany({
    where: { room },
    select: { seat: true },
  });
  return rows.map((r) => r.seat);
}
