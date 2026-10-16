/**
 * Request-completion logging middleware
 * Logs one structured entry per completed HTTP request with:
 *   requestId, method, route, statusCode, durationMs
 * Uses a single 'finish' or 'close' event to avoid duplicate logs.
 */
const logger = require('../utils/logger.utils');

function normalizeRoute(req) {
  // Prefer Express's matched route pattern (e.g. "/api/tasks/:id")
  if (req.route && req.route.path) {
    const base = req.baseUrl || '';
    return base + req.route.path;
  }
  // Fall back to pathname without query string
  if (req.path) return req.path;
  if (req.url) return req.url.split('?')[0];
  return undefined;
}

function severityForStatus(statusCode) {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
}

const requestLogger = (req, res, next) => {
  const start = process.hrtime.bigint();
  let logged = false;

  const writeLog = (statusCode) => {
    if (logged) return;
    logged = true;
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;
    const route = normalizeRoute(req);
    const level = severityForStatus(statusCode);
    const fn = logger[level] || logger.info;
    fn('HTTP request completed', {
      requestId: req.requestId,
      method: req.method,
      route,
      statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    });
  };

  res.on('finish', () => writeLog(res.statusCode));
  res.on('close', () => writeLog(res.statusCode));

  next();
};

module.exports = requestLogger;
module.exports.normalizeRoute = normalizeRoute;
module.exports.severityForStatus = severityForStatus;
