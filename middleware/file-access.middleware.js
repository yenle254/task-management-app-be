const path = require('path');
const fs = require('fs/promises');
const { protect } = require('./auth.middleware');
const { inspectFile } = require('../utils/file-signature.helper');
const uploadsDir = path.resolve(__dirname, '../uploads');
const { resolveFileAccess, validFilename } = require('../services/file-access.service');
const { isCloudinaryEnabled, getCloudinarySignedUrl } = require('../config/cloudinary.config');

function authenticateFile(req, res, next) {
  // Query credentials are intentionally scoped to file routes only.
  if (!req.headers.authorization && typeof req.query.access_token === 'string') {
    req.headers.authorization = `Bearer ${req.query.access_token}`;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return protect(req, res, next);
}


async function serveFile(req, res, next) {
  try {
    const filename = req.params.filename;
    if (!validFilename(filename)) return res.status(404).json({ success: false, error: 'File not found' });
    const access = req.publicDevelopmentFiles ? { name: filename } : await resolveFileAccess(filename, req.user);
    if (!access) return res.status(404).json({ success: false, error: 'File not found' });
    const fullPath = path.join(uploadsDir, filename);
    try {
      // Reject symlinks as well as path traversal, even when created outside this API.
      const stat = await fs.lstat(fullPath);
      if (!stat.isFile() || stat.isSymbolicLink()) return res.status(404).json({ success: false, error: 'File not found' });
      const mime = await inspectFile(fullPath, filename) || 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // Authorized previews may live on a separate web origin.
      return res.download(fullPath, access.name, error => {
        if (error && !res.headersSent) {
          if (error.code === 'ENOENT') res.status(404).json({ success: false, error: 'File not found' });
          else next(error);
        }
      });
    } catch (localError) {
      if (localError.code === 'ENOENT' && isCloudinaryEnabled()) {
        const signedUrl = getCloudinarySignedUrl(filename);
        return res.redirect(302, signedUrl);
      }
      throw localError;
    }
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ success: false, error: 'File not found' });
    next(error);
  }
}
module.exports = { authenticateFile, resolveFileAccess, serveFile, validFilename };
