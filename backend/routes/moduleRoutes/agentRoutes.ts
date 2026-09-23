import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { DATA_ROOT } from '../../paths';
import {
  createAgent,
  deleteAgentByKey,
  getAllAgents,
  takenSeats,
  updateAgent,
  type UpdateAgentInput,
} from '../../database/moduledb/moduleservices/agentService';
import { readPngSize, SPRITE_SHEET } from '../../utils/imageSize';
import { DIRECTIONS, parseRowOrder } from '../../utils/rowOrder';
import {
  CLEARANCE_LEVELS,
  DATA_TYPE_LEVELS,
  DEFAULT_CLEARANCE,
  DEFAULT_DATA_TYPE,
  DEFAULT_ROLE,
  DEFAULT_TENURE,
  isClearance,
  isDataType,
  ROLE_GROUPS,
} from '../../utils/taxonomy';
import { roleExists } from '../../database/moduledb/moduleservices/roleService';

const router = Router();

const UPLOAD_ROOT = path.join(DATA_ROOT, 'uploads');
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const ROW_ORDER_ERROR =
  `rowOrder must list all four directions exactly once ` +
  `(${DIRECTIONS.join(', ')}), one per spritesheet row, top row first`;

// Files are held in memory so a sheet with wrong dimensions is rejected before
// anything touches disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 2 },
});

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** The vocabularies the UI populates its dropdowns from. */
router.get('/taxonomy', (_req, res) => {
  res.json({
    roleGroups: ROLE_GROUPS,
    clearanceLevels: CLEARANCE_LEVELS,
    dataTypeLevels: DATA_TYPE_LEVELS,
    defaults: {
      role: DEFAULT_ROLE,
      clearance: DEFAULT_CLEARANCE,
      dataType: DEFAULT_DATA_TYPE,
      tenure: DEFAULT_TENURE,
    },
  });
});

router.get('/', async (_req, res) => {
  try {
    res.json(await getAllAgents());
  } catch (error) {
    console.error('GET /api/agents failed:', error);
    res.status(500).json({ error: 'Failed to load agents' });
  }
});

/** Seats already occupied, so the UI can offer only free ones. */
router.get('/seats/:room', async (req, res) => {
  const room = Number(req.params.room);
  if (!Number.isInteger(room) || room < 0) {
    return res.status(400).json({ error: 'room must be a non-negative integer' });
  }
  try {
    res.json({ room, taken: await takenSeats(room) });
  } catch (error) {
    console.error('GET /api/agents/seats failed:', error);
    res.status(500).json({ error: 'Failed to load seats' });
  }
});

router.post(
  '/',
  upload.fields([
    { name: 'sprite', maxCount: 1 },
    { name: 'portrait', maxCount: 1 },
  ]),
  async (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const sprite = files?.sprite?.[0];
    const portrait = files?.portrait?.[0];

    const name = String(req.body.name ?? '').trim();
    const room = Number(req.body.room);
    const seat = Number(req.body.seat);
    const title = String(req.body.title ?? '').trim();
    const tagline = String(req.body.tagline ?? '').trim();
    const tenure = String(req.body.tenure ?? '').trim();
    const focus = String(req.body.focus ?? '').trim();

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!Number.isInteger(room) || room < 0) {
      return res.status(400).json({ error: 'room must be a non-negative integer' });
    }
    if (!Number.isInteger(seat) || seat < 0) {
      return res.status(400).json({ error: 'seat must be a non-negative integer' });
    }
    if (!sprite) return res.status(400).json({ error: 'sprite sheet is required' });
    if (!portrait) return res.status(400).json({ error: 'portrait is required' });

    const role = String(req.body.role ?? '');
    if (!(await roleExists(role))) {
      return res.status(400).json({ error: `role "${role}" is not in the role library` });
    }

    const clearance = Number(req.body.clearance);
    if (!isClearance(clearance)) {
      return res.status(400).json({ error: 'clearance must be a level between 0 and 8' });
    }

    const dataType = Number(req.body.dataType);
    if (!isDataType(dataType)) {
      return res.status(400).json({ error: 'dataType must be a level between 1 and 14' });
    }

    // A sheet with the wrong cell size renders garbage rather than failing, so
    // the dimensions are enforced here instead of surfacing as visual noise.
    const spriteSize = readPngSize(sprite.buffer);
    if (!spriteSize) {
      return res.status(400).json({ error: 'sprite sheet must be a PNG' });
    }
    if (
      spriteSize.width !== SPRITE_SHEET.width ||
      spriteSize.height !== SPRITE_SHEET.height
    ) {
      return res.status(400).json({
        error:
          `sprite sheet must be exactly ${SPRITE_SHEET.width}x${SPRITE_SHEET.height} ` +
          `(4 columns x 4 rows of ${SPRITE_SHEET.cell}px cells). ` +
          `Received ${spriteSize.width}x${spriteSize.height}.`,
      });
    }

    // Row order is required: guessing it renders an agent that walks the wrong
    // way, which fails silently rather than erroring.
    const rowOrder = parseRowOrder(req.body.rowOrder);
    if (!rowOrder) {
      return res.status(400).json({ error: ROW_ORDER_ERROR });
    }

    let responsibilities: string[] = [];
    try {
      const parsed = JSON.parse(String(req.body.responsibilities ?? '[]'));
      if (Array.isArray(parsed)) {
        responsibilities = parsed
          .filter((r): r is string => typeof r === 'string')
          .map((r) => r.trim())
          .filter(Boolean);
      }
    } catch {
      return res.status(400).json({ error: 'responsibilities must be a JSON array' });
    }

    const key = `${slugify(name) || 'agent'}_${randomUUID().slice(0, 8)}`;
    const spriteFile = `${key}.png`;
    const portraitExt = portrait.mimetype === 'image/jpeg' ? 'jpg' : 'png';
    const portraitFile = `${key}.${portraitExt}`;

    try {
      await fs.mkdir(path.join(UPLOAD_ROOT, 'sprites'), { recursive: true });
      await fs.mkdir(path.join(UPLOAD_ROOT, 'portraits'), { recursive: true });
      await fs.writeFile(path.join(UPLOAD_ROOT, 'sprites', spriteFile), sprite.buffer);
      await fs.writeFile(
        path.join(UPLOAD_ROOT, 'portraits', portraitFile),
        portrait.buffer
      );

      const agent = await createAgent({
        key,
        name,
        room,
        seat,
        // Served by the /api/uploads static mount in index.ts.
        spritePath: `/api/uploads/sprites/${spriteFile}`,
        portraitPath: `/api/uploads/portraits/${portraitFile}`,
        title: title || 'Unassigned',
        tagline: tagline || 'No dossier on file.',
        role,
        clearance,
        dataType,
        tenure: tenure || DEFAULT_TENURE,
        focus,
        rowOrder,
        responsibilities,
      });

      res.status(201).json(agent);
    } catch (error) {
      // Roll the images back so a failed insert leaves no orphans on disk.
      await fs
        .rm(path.join(UPLOAD_ROOT, 'sprites', spriteFile), { force: true })
        .catch(() => undefined);
      await fs
        .rm(path.join(UPLOAD_ROOT, 'portraits', portraitFile), { force: true })
        .catch(() => undefined);

      if (
        error &&
        typeof error === 'object' &&
        (error as { code?: string }).code === 'P2002'
      ) {
        return res.status(409).json({ error: `Seat ${seat} in that room is taken` });
      }
      console.error('POST /api/agents failed:', error);
      res.status(500).json({ error: 'Failed to create agent' });
    }
  }
);

/**
 * Edit a dossier. Accepts any subset of the editable fields, so the same route
 * serves the dossier panel's dropdowns and the row-order picker.
 */
router.patch('/:key', async (req, res) => {
  const body = req.body ?? {};
  const update: UpdateAgentInput = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return res.status(400).json({ error: 'name cannot be empty' });
    update.name = name;
  }
  if (body.title !== undefined) update.title = String(body.title).trim();
  if (body.tagline !== undefined) update.tagline = String(body.tagline).trim();
  if (body.tenure !== undefined) update.tenure = String(body.tenure).trim();
  if (body.focus !== undefined) update.focus = String(body.focus).trim();

  if (body.role !== undefined) {
    // Checked against the Role TABLE, not the seeded taxonomy — the dossier
    // offers whatever the Roles tab contains, so the validator must agree with it.
    if (!(await roleExists(body.role))) {
      return res.status(400).json({ error: `role "${body.role}" is not in the role library` });
    }
    update.role = String(body.role).trim();
  }

  // Clearance is a property of the seat (Position), not the character — it is
  // edited on the position, not here. Any `clearance` in the body is ignored so
  // the dossier can't set a value that gating would then override.

  if (body.dataType !== undefined) {
    const dataType = Number(body.dataType);
    if (!isDataType(dataType)) {
      return res.status(400).json({ error: 'dataType must be a level between 1 and 14' });
    }
    update.dataType = dataType;
  }

  if (body.rowOrder !== undefined) {
    const rowOrder = parseRowOrder(body.rowOrder);
    if (!rowOrder) return res.status(400).json({ error: ROW_ORDER_ERROR });
    update.rowOrder = rowOrder;
  }

  if (body.responsibilities !== undefined) {
    if (!Array.isArray(body.responsibilities)) {
      return res.status(400).json({ error: 'responsibilities must be an array' });
    }
    update.responsibilities = body.responsibilities
      .filter((r: unknown): r is string => typeof r === 'string')
      .map((r: string) => r.trim())
      .filter(Boolean);
  }

  // Per-agent model override. A string (possibly empty, which clears it) is
  // accepted; anything else is ignored.
  if (body.model !== undefined && (typeof body.model === 'string' || body.model === null)) {
    update.model = body.model;
  }

  // Per-agent IMAGE model override, same rules. A SEPARATE field from `model`
  // above: that one is what the agent reasons with and must support tool
  // calling, this one is what `generate_image` draws with.
  if (
    body.imageModel !== undefined &&
    (typeof body.imageModel === 'string' || body.imageModel === null)
  ) {
    update.imageModel = body.imageModel;
  }

  // Per-agent SPEECH model override, same rules again. A third cascade, for the
  // same reason: a model that talks is rarely one that reasons or draws.
  if (
    body.speechModel !== undefined &&
    (typeof body.speechModel === 'string' || body.speechModel === null)
  ) {
    update.speechModel = body.speechModel;
  }

  // The voice this agent wears; '' or null clears it.
  if (
    body.personalityId !== undefined &&
    (typeof body.personalityId === 'string' || body.personalityId === null)
  ) {
    update.personalityId = body.personalityId;
  }

  // Which web tools to offer; '' or null clears it (inherit the global).
  if (
    body.webMode !== undefined &&
    (typeof body.webMode === 'string' || body.webMode === null)
  ) {
    update.webMode = body.webMode;
  }

  // Per-agent cost ceiling for this agent's own delegation subtree. null or a
  // non-positive number clears it (inherit the global ceiling) — normalised in
  // agentService so the rule lives in one place. A string is accepted because
  // a number input posts one; anything unparseable falls through to null there.
  if (
    body.maxCost !== undefined &&
    (typeof body.maxCost === 'number' || typeof body.maxCost === 'string' || body.maxCost === null)
  ) {
    update.maxCost = body.maxCost === null ? null : Number(body.maxCost);
  }

  // Workspace override: a real directory to work in ('' clears it) and the
  // read-only toggle. Read-only stays the safe default; turning it off lets the
  // agent WRITE into a real folder — a deliberate choice made in the dossier.
  if (
    body.workspaceDir !== undefined &&
    (typeof body.workspaceDir === 'string' || body.workspaceDir === null)
  ) {
    update.workspaceDir = body.workspaceDir;
  }
  if (typeof body.workspaceReadOnly === 'boolean') {
    update.workspaceReadOnly = body.workspaceReadOnly;
  }
  if (typeof body.trustedDelegator === 'boolean') {
    update.trustedDelegator = body.trustedDelegator;
  }
  if (typeof body.supervised === 'boolean') {
    update.supervised = body.supervised;
  }

  // A reseat moves the agent to a new floor/desk. Both coordinates travel
  // together; one without the other is ambiguous, so it is rejected.
  if (body.room !== undefined || body.seat !== undefined) {
    const room = Number(body.room);
    const seat = Number(body.seat);
    if (!Number.isInteger(room) || room < 0 || !Number.isInteger(seat) || seat < 0) {
      return res.status(400).json({ error: 'room and seat must both be non-negative integers' });
    }
    update.room = room;
    update.seat = seat;
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'no editable fields supplied' });
  }

  try {
    const result = await updateAgent(req.params.key, update);
    if (!result.ok) {
      if ('notFound' in result) return res.status(404).json({ error: 'Agent not found' });
      return res.status(409).json({ error: result.error });
    }
    res.json(result.agent);
  } catch (error) {
    console.error('PATCH /api/agents/:key failed:', error);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

router.delete('/:key', async (req, res) => {
  try {
    const removed = await deleteAgentByKey(req.params.key);
    if (!removed) return res.status(404).json({ error: 'Agent not found' });

    // Only uploaded media lives under /api/uploads; seeded agents point into
    // the frontend's static assets and must not be touched.
    for (const p of [removed.spritePath, removed.portraitPath]) {
      if (!p.startsWith('/api/uploads/')) continue;
      const rel = p.replace('/api/uploads/', '');
      const abs = path.join(UPLOAD_ROOT, rel);
      // Guard against traversal via a crafted stored path.
      if (!abs.startsWith(UPLOAD_ROOT)) continue;
      await fs.rm(abs, { force: true }).catch(() => undefined);
    }

    res.json({ key: removed.key, deleted: true });
  } catch (error) {
    console.error('DELETE /api/agents failed:', error);
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

export default router;
