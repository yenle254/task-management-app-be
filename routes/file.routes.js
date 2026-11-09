const router = require('express').Router();
const { fileLimiter } = require('../middleware/rate-limit.middleware');
const { authenticateFile, serveFile } = require('../middleware/file-access.middleware');

router.use(fileLimiter, (req, res, next) => {
  if (process.env.NODE_ENV === 'development' && process.env.PRIVATE_FILES_ENABLED === 'false' && req.baseUrl === '/uploads') {
    req.publicDevelopmentFiles = true;
    res.setHeader('Cache-Control', 'no-store');
    return next();
  }
  return authenticateFile(req, res, next);
});
router.get('/:filename', serveFile);
module.exports = router;
