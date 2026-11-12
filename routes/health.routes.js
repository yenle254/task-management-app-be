const { Router } = require('express');

function createHealthRouter(health) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/live', (_req, res) => {
    res.status(200).json({ success: true, data: { status: 'alive' } });
  });
  router.get('/ready', async (_req, res) => {
    try {
      if (await health.isReady()) return res.status(200).json({ success: true, data: { status: 'ready' } });
    } catch (_) { /* A probe failure must never expose driver details. */ }
    return res.status(503).json({ success: false, error: 'Service not ready' });
  });
  return router;
}

module.exports = { createHealthRouter };
