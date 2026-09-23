import { Router } from 'express';
import {
  getSettings,
  updateSettings,
  type SettingsPatch,
} from '../../database/moduledb/moduleservices/settingsService';
import { listModels } from '../../database/moduledb/moduleservices/modelsService';

const router = Router();

/** Current app settings (theme/font/defaultModel). */
router.get('/', async (_req, res) => {
  try {
    res.json(await getSettings());
  } catch (error) {
    console.error('GET /api/settings failed:', error);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

/** Patch a subset of settings (e.g. { defaultModel } or a provider key). Provider
 *  keys are accepted raw here ('' clears one); the response masks them. */
router.patch('/', async (req, res) => {
  const patch: SettingsPatch = {};
  if (typeof req.body?.theme === 'string') patch.theme = req.body.theme;
  if (Number.isInteger(req.body?.fontSize)) patch.fontSize = req.body.fontSize;
  if (typeof req.body?.fontFamily === 'string') patch.fontFamily = req.body.fontFamily;
  if (typeof req.body?.defaultModel === 'string') patch.defaultModel = req.body.defaultModel.trim();
  // The global image model for `generate_image`. Separate from defaultModel:
  // that one reasons and must call tools, this one draws and usually cannot.
  if (typeof req.body?.imageModel === 'string') patch.imageModel = req.body.imageModel.trim();
  if (typeof req.body?.speechModel === 'string') patch.speechModel = req.body.speechModel.trim();
  if (typeof req.body?.webMode === 'string') patch.webMode = req.body.webMode.trim();
  if (typeof req.body?.openrouterKey === 'string') patch.openrouterKey = req.body.openrouterKey;
  if (typeof req.body?.serperKey === 'string') patch.serperKey = req.body.serperKey;
  if (typeof req.body?.replicateKey === 'string') patch.replicateKey = req.body.replicateKey;
  // Phase 4 — delegation limits. Accepted as any finite number; the service
  // clamps them (depth 1-10, runs/cost >= 0) so a bad value can't persist.
  if (Number.isFinite(req.body?.maxDelegationDepth)) {
    patch.maxDelegationDepth = req.body.maxDelegationDepth;
  }
  if (Number.isFinite(req.body?.maxRunsPerTree)) patch.maxRunsPerTree = req.body.maxRunsPerTree;
  if (Number.isFinite(req.body?.maxCostPerTree)) patch.maxCostPerTree = req.body.maxCostPerTree;
  try {
    res.json(await updateSettings(patch));
  } catch (error) {
    console.error('PATCH /api/settings failed:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/** Live OpenRouter model catalogue (cached). `?refresh=1` bypasses the cache. */
router.get('/models', async (req, res) => {
  try {
    res.json(await listModels(req.query.refresh === '1'));
  } catch (error) {
    console.error('GET /api/settings/models failed:', error);
    res.status(502).json({ error: 'Could not reach OpenRouter to list models' });
  }
});

export default router;
