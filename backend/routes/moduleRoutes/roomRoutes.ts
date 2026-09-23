import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { DATA_ROOT } from '../../paths';
import {
  addSeat,
  createRoom,
  deleteRoom,
  deleteSeat,
  eraseTile,
  getAllRooms,
  isValidCoord,
  isValidRotation,
  moveSeat,
  renameSeat,
  paintTile,
  placeProp,
  removeProp,
  renameRoom,
  reorderRoom,
  roomExists,
  setBlocked,
  validatePropPlacement,
} from '../../database/moduledb/moduleservices/roomService';
import { prisma } from '../../database/db';
import { readImageSize } from '../../utils/imageSize';

const router = Router();

const UPLOAD_ROOT = path.join(DATA_ROOT, 'uploads');
const MAX_BG_BYTES = 12 * 1024 * 1024;
const bgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BG_BYTES, files: 1 },
});

router.get('/', async (_req, res) => {
  try {
    res.json(await getAllRooms());
  } catch (error) {
    console.error('GET /api/rooms failed:', error);
    res.status(500).json({ error: 'Failed to load rooms' });
  }
});

// ---- tiles (cosmetic) -----------------------------------------------------

router.put('/:id/tiles', async (req, res) => {
  const { id } = req.params;
  const kind = String(req.body?.kind ?? '').trim();
  const { x, y } = req.body ?? {};
  const rotation = req.body?.rotation ?? 0;

  if (!kind) return res.status(400).json({ error: 'kind is required' });
  if (!isValidCoord(x) || !isValidCoord(y)) {
    return res.status(400).json({ error: 'x and y must be integers within the grid' });
  }
  if (!isValidRotation(rotation)) {
    return res.status(400).json({ error: 'rotation must be 0, 90, 180, or 270' });
  }

  try {
    if (!(await roomExists(id))) return res.status(404).json({ error: 'Room not found' });
    res.status(200).json(await paintTile(id, { kind, x, y, rotation }));
  } catch (error) {
    console.error('PUT /api/rooms/:id/tiles failed:', error);
    res.status(500).json({ error: 'Failed to paint tile' });
  }
});

router.delete('/:id/tiles/:x/:y', async (req, res) => {
  const { id } = req.params;
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  if (!isValidCoord(x) || !isValidCoord(y)) {
    return res.status(400).json({ error: 'x and y must be integers within the grid' });
  }
  try {
    if (!(await roomExists(id))) return res.status(404).json({ error: 'Room not found' });
    await eraseTile(id, x, y);
    res.json({ x, y, erased: true });
  } catch (error) {
    console.error('DELETE /api/rooms/:id/tiles failed:', error);
    res.status(500).json({ error: 'Failed to erase tile' });
  }
});

// ---- collision paint (the block brush) ------------------------------------

/** Block a grid cell — solid to agents, no art. Refused only if it strands a
 *  desk or blocks the portal (free tiles may be cut off while shaping walls). */
router.put('/:id/block/:x/:y', async (req, res) => {
  const { id } = req.params;
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  if (!isValidCoord(x) || !isValidCoord(y)) {
    return res.status(400).json({ error: 'x and y must be integers within the grid' });
  }
  try {
    const result = await setBlocked(id, x, y, true);
    if (!result.ok) {
      if ('notFound' in result) return res.status(404).json({ error: 'Room not found' });
      return res.status(409).json({ error: result.error, strandedSeats: result.strandedSeats });
    }
    res.json({ x, y, blocked: true });
  } catch (error) {
    console.error('PUT /api/rooms/:id/block failed:', error);
    res.status(500).json({ error: 'Failed to block cell' });
  }
});

/** Unblock a grid cell (make it walkable). Never strands anything. */
router.delete('/:id/block/:x/:y', async (req, res) => {
  const { id } = req.params;
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  if (!isValidCoord(x) || !isValidCoord(y)) {
    return res.status(400).json({ error: 'x and y must be integers within the grid' });
  }
  try {
    const result = await setBlocked(id, x, y, false);
    if (!result.ok) {
      if ('notFound' in result) return res.status(404).json({ error: 'Room not found' });
      return res.status(409).json({ error: result.error });
    }
    res.json({ x, y, blocked: false });
  } catch (error) {
    console.error('DELETE /api/rooms/:id/block failed:', error);
    res.status(500).json({ error: 'Failed to unblock cell' });
  }
});

// ---- reachability ---------------------------------------------------------

/** Dry-run: would a blocking prop at (x, y) strand anything? Used for the
 *  editor's live hover feedback. Does not write. */
router.post('/:id/validate', async (req, res) => {
  const { id } = req.params;
  const { x, y } = req.body ?? {};
  const blocking = req.body?.blocking !== false; // default true

  if (!isValidCoord(x) || !isValidCoord(y)) {
    return res.status(400).json({ error: 'x and y must be integers within the grid' });
  }
  try {
    if (!(await roomExists(id))) return res.status(404).json({ error: 'Room not found' });
    res.json(await validatePropPlacement(id, x, y, blocking));
  } catch (error) {
    console.error('POST /api/rooms/:id/validate failed:', error);
    res.status(500).json({ error: 'Failed to validate' });
  }
});

// ---- props ----------------------------------------------------------------

router.put('/:id/props', async (req, res) => {
  const { id } = req.params;
  const kind = String(req.body?.kind ?? '').trim();
  const { x, y } = req.body ?? {};
  const rotation = req.body?.rotation ?? 0;
  const blocking = req.body?.blocking !== false; // default true

  if (!kind) return res.status(400).json({ error: 'kind is required' });
  if (!isValidCoord(x) || !isValidCoord(y)) {
    return res.status(400).json({ error: 'x and y must be integers within the grid' });
  }
  if (!isValidRotation(rotation)) {
    return res.status(400).json({ error: 'rotation must be 0, 90, 180, or 270' });
  }

  try {
    if (!(await roomExists(id))) return res.status(404).json({ error: 'Room not found' });

    // The one hard rule: a blocking prop may not strand any tile or seat.
    if (blocking) {
      const check = await validatePropPlacement(id, x, y, true);
      if (!check.ok) {
        return res.status(409).json({
          error: 'That would cut off part of the floor',
          stranded: check.stranded,
          strandedSeats: check.strandedSeats,
        });
      }
    }

    res.status(200).json(await placeProp(id, { kind, x, y, rotation, blocking }));
  } catch (error) {
    console.error('PUT /api/rooms/:id/props failed:', error);
    res.status(500).json({ error: 'Failed to place prop' });
  }
});

router.delete('/:id/props/:x/:y', async (req, res) => {
  const { id } = req.params;
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  if (!isValidCoord(x) || !isValidCoord(y)) {
    return res.status(400).json({ error: 'x and y must be integers within the grid' });
  }
  try {
    if (!(await roomExists(id))) return res.status(404).json({ error: 'Room not found' });
    await removeProp(id, x, y);
    res.json({ x, y, removed: true });
  } catch (error) {
    console.error('DELETE /api/rooms/:id/props failed:', error);
    res.status(500).json({ error: 'Failed to remove prop' });
  }
});

// ---- seats ----------------------------------------------------------------

/** Add a desk at (x, y). Validates walkability + reachability. */
router.post('/:id/seats', async (req, res) => {
  const { id } = req.params;
  const { x, y } = req.body ?? {};
  if (!isValidCoord(x) || !isValidCoord(y)) {
    return res.status(400).json({ error: 'x and y must be integers within the grid' });
  }
  try {
    const room = await prisma.room.findUnique({ where: { id }, select: { order: true } });
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const result = await addSeat(id, room.order, x, y);
    if (result.error) return res.status(409).json({ error: result.error });
    res.status(201).json(result.seat);
  } catch (error) {
    console.error('POST /api/rooms/:id/seats failed:', error);
    res.status(500).json({ error: 'Failed to add seat' });
  }
});

/** Move a desk to a new tile. */
router.patch('/seats/:seatId', async (req, res) => {
  const { seatId } = req.params;
  const { x, y } = req.body ?? {};
  if (!isValidCoord(x) || !isValidCoord(y)) {
    return res.status(400).json({ error: 'x and y must be integers within the grid' });
  }
  try {
    const result = await moveSeat(seatId, x, y);
    if (result.notFound) return res.status(404).json({ error: 'Seat not found' });
    if (result.error) return res.status(409).json({ error: result.error });
    res.json(result.seat);
  } catch (error) {
    console.error('PATCH /api/rooms/seats/:seatId failed:', error);
    res.status(500).json({ error: 'Failed to move seat' });
  }
});

/** Rename a desk (its human label). Empty clears it. */
router.patch('/seats/:seatId/name', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  try {
    const result = await renameSeat(req.params.seatId, name);
    if (result.notFound) return res.status(404).json({ error: 'Seat not found' });
    res.json(result.seat);
  } catch (error) {
    console.error('PATCH /api/rooms/seats/:seatId/name failed:', error);
    res.status(500).json({ error: 'Failed to rename seat' });
  }
});

/** Delete a desk. Refused if occupied. */
router.delete('/seats/:seatId', async (req, res) => {
  try {
    const result = await deleteSeat(req.params.seatId);
    if (result.notFound) return res.status(404).json({ error: 'Seat not found' });
    if (result.error) return res.status(409).json({ error: result.error });
    res.json({ deleted: true });
  } catch (error) {
    console.error('DELETE /api/rooms/seats/:seatId failed:', error);
    res.status(500).json({ error: 'Failed to delete seat' });
  }
});

// ---- floors ---------------------------------------------------------------

/** Create a floor: name + uploaded background. Starts fully walkable. */
router.post('/', bgUpload.single('background'), async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const file = req.file;

  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!file) return res.status(400).json({ error: 'a background image is required' });

  const size = readImageSize(file.buffer);
  if (!size) {
    return res.status(400).json({ error: 'background must be a PNG or JPEG image' });
  }

  const ext = size.kind === 'jpeg' ? 'jpg' : 'png';
  const filename = `floor_${randomUUID().slice(0, 8)}.${ext}`;

  try {
    await fs.mkdir(path.join(UPLOAD_ROOT, 'backgrounds'), { recursive: true });
    await fs.writeFile(path.join(UPLOAD_ROOT, 'backgrounds', filename), file.buffer);
    const room = await createRoom(name, `/api/uploads/backgrounds/${filename}`);
    res.status(201).json(room);
  } catch (error) {
    await fs
      .rm(path.join(UPLOAD_ROOT, 'backgrounds', filename), { force: true })
      .catch(() => undefined);
    console.error('POST /api/rooms failed:', error);
    res.status(500).json({ error: 'Failed to create floor' });
  }
});

/** Rename a floor. */
router.patch('/:id/name', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const room = await renameRoom(req.params.id, name);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(room);
  } catch (error) {
    console.error('PATCH /api/rooms/:id/name failed:', error);
    res.status(500).json({ error: 'Failed to rename floor' });
  }
});

/** Move a floor to a new position in the building. */
router.patch('/:id/order', async (req, res) => {
  const order = Number(req.body?.order);
  if (!Number.isInteger(order) || order < 0) {
    return res.status(400).json({ error: 'order must be a non-negative integer' });
  }
  try {
    const result = await reorderRoom(req.params.id, order);
    if (result.notFound) return res.status(404).json({ error: 'Room not found' });
    res.json({ reordered: true });
  } catch (error) {
    console.error('PATCH /api/rooms/:id/order failed:', error);
    res.status(500).json({ error: 'Failed to reorder floor' });
  }
});

/** Delete a floor. Refused if any agent lives there. */
router.delete('/:id', async (req, res) => {
  try {
    const result = await deleteRoom(req.params.id);
    if (result.notFound) return res.status(404).json({ error: 'Room not found' });
    if (result.error) return res.status(409).json({ error: result.error });
    res.json({ deleted: true });
  } catch (error) {
    console.error('DELETE /api/rooms/:id failed:', error);
    res.status(500).json({ error: 'Failed to delete floor' });
  }
});

export default router;
