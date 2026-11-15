const express = require('express');
const rateLimit = require('express-rate-limit');
const { createMapTileService } = require('../services/map-tile.service');

function createMapRouter(service = createMapTileService()) {
  const router = express.Router();
  // Public map imagery only. No user data, arbitrary URLs or offline downloads.
  router.use(rateLimit({ windowMs: 60000, limit: 300, standardHeaders: true, legacyHeaders: false,
    message: { success: false, error: 'Too many map requests. Please retry later.' } }));
  router.get('/tiles/:z/:x/:y.png', async (req, res) => {
    try {
      const tile = await service.getTile(req.params.z, req.params.x, req.params.y, req.get('referer'));
      res.set('Cache-Control', `public, max-age=${Math.max(0, Math.floor((tile.expires - Date.now()) / 1000))}`);
      if (tile.etag) res.set('ETag', tile.etag);
      if (tile.lastModified) res.set('Last-Modified', tile.lastModified);
      res.type('png').send(Buffer.from(tile.body, 'base64'));
    } catch (err) {
      res.set('Cache-Control', 'no-store');
      res.status(err.status === 400 ? 400 : 503).json({ success: false,
        error: err.status === 400 ? 'Invalid tile coordinates' : 'Map unavailable. Please retry later.' });
    }
  });
  return router;
}

module.exports = { createMapRouter };
