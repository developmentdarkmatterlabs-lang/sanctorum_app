import { Router } from 'express';
import {
  assignAgent,
  createPosition,
  createTeam,
  deletePosition,
  deleteTeam,
  effectiveClearance,
  getAllTeams,
  unassignAgent,
  updatePosition,
  updateTeam,
} from '../../database/moduledb/moduleservices/teamService';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    res.json(await getAllTeams());
  } catch (error) {
    console.error('GET /api/teams failed:', error);
    res.status(500).json({ error: 'Failed to load teams' });
  }
});

// ---- teams ----------------------------------------------------------------

router.post('/', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const mission = String(req.body?.mission ?? '').trim();
  const floorId = req.body?.floorId ? String(req.body.floorId) : null;
  // Nested teams: the team this one reports into. Null/absent = top level.
  const parentTeamId = req.body?.parentTeamId ? String(req.body.parentTeamId) : null;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await createTeam(name, mission, floorId, parentTeamId);
    if (!result.ok) {
      if ('notFound' in result) return res.status(404).json({ error: 'Not found' });
      return res.status(409).json({ error: result.error });
    }
    res.status(201).json(result.team);
  } catch (error) {
    console.error('POST /api/teams failed:', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

router.patch('/:id', async (req, res) => {
  const patch: {
    name?: string;
    mission?: string;
    floorId?: string | null;
    parentTeamId?: string | null;
  } = {};
  if (req.body?.name !== undefined) patch.name = String(req.body.name).trim();
  if (req.body?.mission !== undefined) patch.mission = String(req.body.mission).trim();
  if (req.body?.floorId !== undefined) {
    patch.floorId = req.body.floorId === null ? null : String(req.body.floorId);
  }
  // '' and null both mean "top level" — the picker sends '' for its empty option.
  if (req.body?.parentTeamId !== undefined) {
    const raw = req.body.parentTeamId;
    patch.parentTeamId = raw === null || String(raw).trim() === '' ? null : String(raw);
  }
  try {
    // A cycle ("report into my own sub-team") comes back as `error`, which the
    // 409 below surfaces with the service's readable reason.
    const result = await updateTeam(req.params.id, patch);
    if (!result.ok) {
      if ('notFound' in result) return res.status(404).json({ error: 'Team not found' });
      return res.status(409).json({ error: result.error });
    }
    res.json(result.team);
  } catch (error) {
    console.error('PATCH /api/teams/:id failed:', error);
    res.status(500).json({ error: 'Failed to update team' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await deleteTeam(req.params.id);
    if (!result.ok) return res.status(404).json({ error: 'Team not found' });
    res.json({ deleted: true });
  } catch (error) {
    console.error('DELETE /api/teams/:id failed:', error);
    res.status(500).json({ error: 'Failed to delete team' });
  }
});

// ---- positions ------------------------------------------------------------

// A seat is created from a ROLE (it inherits the role's title/clearance). The
// override fields are optional exceptions; omit them to inherit.
router.post('/:id/positions', async (req, res) => {
  const roleId =
    typeof req.body?.roleId === 'string' && req.body.roleId.trim()
      ? req.body.roleId.trim()
      : null;
  const isLeader = req.body?.isLeader === true;
  const titleOverride =
    typeof req.body?.titleOverride === 'string' && req.body.titleOverride.trim()
      ? req.body.titleOverride.trim()
      : null;
  let clearanceOverride: number | null = null;
  if (req.body?.clearanceOverride !== undefined && req.body.clearanceOverride !== null) {
    const c = Number(req.body.clearanceOverride);
    if (!Number.isInteger(c) || c < 0 || c > 8) {
      return res.status(400).json({ error: 'clearance must be a level between 0 and 8' });
    }
    clearanceOverride = c;
  }
  // A seat needs SOMETHING to resolve a title from: a role, or an explicit override.
  if (!roleId && !titleOverride) {
    return res.status(400).json({ error: 'pick a role (or give the seat a title)' });
  }
  try {
    const result = await createPosition(req.params.id, {
      roleId,
      titleOverride,
      clearanceOverride,
      isLeader,
    });
    if (!result.ok) {
      if ('notFound' in result) return res.status(404).json({ error: 'Team not found' });
      return res.status(409).json({ error: result.error });
    }
    res.status(201).json(result.team);
  } catch (error) {
    console.error('POST /api/teams/:id/positions failed:', error);
    res.status(500).json({ error: 'Failed to create position' });
  }
});

// Passing an override null CLEARS it, so the seat goes back to inheriting.
router.patch('/positions/:positionId', async (req, res) => {
  const patch: {
    roleId?: string | null;
    titleOverride?: string | null;
    clearanceOverride?: number | null;
    isLeader?: boolean;
  } = {};
  if (req.body?.roleId !== undefined) {
    patch.roleId =
      typeof req.body.roleId === 'string' && req.body.roleId.trim()
        ? req.body.roleId.trim()
        : null;
  }
  if (req.body?.titleOverride !== undefined) {
    patch.titleOverride =
      typeof req.body.titleOverride === 'string' && req.body.titleOverride.trim()
        ? req.body.titleOverride.trim()
        : null;
  }
  if (req.body?.clearanceOverride !== undefined) {
    if (req.body.clearanceOverride === null) {
      patch.clearanceOverride = null;
    } else {
      const c = Number(req.body.clearanceOverride);
      if (!Number.isInteger(c) || c < 0 || c > 8) {
        return res.status(400).json({ error: 'clearance must be a level between 0 and 8' });
      }
      patch.clearanceOverride = c;
    }
  }
  if (req.body?.isLeader !== undefined) patch.isLeader = req.body.isLeader === true;
  try {
    const result = await updatePosition(req.params.positionId, patch);
    if (!result.ok) {
      if ('notFound' in result) return res.status(404).json({ error: 'Position not found' });
      return res.status(409).json({ error: result.error });
    }
    res.json(result.team);
  } catch (error) {
    console.error('PATCH /api/teams/positions/:positionId failed:', error);
    res.status(500).json({ error: 'Failed to update position' });
  }
});

router.delete('/positions/:positionId', async (req, res) => {
  try {
    const result = await deletePosition(req.params.positionId);
    if (!result.ok) return res.status(404).json({ error: 'Position not found' });
    res.json({ deleted: true, teamId: result.teamId });
  } catch (error) {
    console.error('DELETE /api/teams/positions/:positionId failed:', error);
    res.status(500).json({ error: 'Failed to delete position' });
  }
});

// ---- assignment -----------------------------------------------------------

/** Assign an agent to a position (moves them off any prior seat). */
router.put('/positions/:positionId/agent', async (req, res) => {
  const agentKey = String(req.body?.agentKey ?? '').trim();
  if (!agentKey) return res.status(400).json({ error: 'agentKey is required' });
  try {
    const result = await assignAgent(agentKey, req.params.positionId);
    if (!result.ok) {
      if ('notFound' in result) return res.status(404).json({ error: 'Agent or position not found' });
      return res.status(409).json({ error: result.error });
    }
    res.json({ assigned: true });
  } catch (error) {
    console.error('PUT /api/teams/positions/:positionId/agent failed:', error);
    res.status(500).json({ error: 'Failed to assign agent' });
  }
});

/** Remove an agent from its position (back to the bench). */
router.delete('/agents/:agentKey/position', async (req, res) => {
  try {
    const result = await unassignAgent(req.params.agentKey);
    if (!result.ok) return res.status(404).json({ error: 'Agent not found' });
    res.json({ unassigned: true });
  } catch (error) {
    console.error('DELETE /api/teams/agents/:agentKey/position failed:', error);
    res.status(500).json({ error: 'Failed to unassign agent' });
  }
});

/** An agent's effective clearance (from its position, else its own fallback). */
router.get('/agents/:agentKey/clearance', async (req, res) => {
  try {
    const clearance = await effectiveClearance(req.params.agentKey);
    if (clearance === null) return res.status(404).json({ error: 'Agent not found' });
    res.json({ agentKey: req.params.agentKey, clearance });
  } catch (error) {
    console.error('GET /api/teams/agents/:agentKey/clearance failed:', error);
    res.status(500).json({ error: 'Failed to resolve clearance' });
  }
});

export default router;
