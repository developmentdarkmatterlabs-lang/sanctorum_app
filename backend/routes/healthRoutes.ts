import { Router } from 'express';

const router = Router();

router.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'Sanctorum Backend API is running',
    timestamp: new Date().toISOString(),
  });
});

export default router;
