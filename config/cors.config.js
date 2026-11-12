const parseOrigins = raw => String(raw || '').split(',').map(value => value.trim()).filter(Boolean);

function createCorsPolicy(env = process.env) {
  // The explicit allowlist takes precedence over the legacy development alias.
  const origins = [...new Set(parseOrigins(env.ALLOWED_ORIGINS || env.CLIENT_URL))];
  const production = env.NODE_ENV === 'production';
  if (production && (!origins.length || origins.includes('*'))) {
    throw new Error('Production requires explicit ALLOWED_ORIGINS; wildcard origins are forbidden');
  }
  for (const origin of origins) {
    if (origin === '*' && !production) continue;
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('Invalid CORS origin configuration'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error('CORS entries must be exact http(s) origins without paths');
    }
  }
  const isAllowed = origin => !origin || origins.includes(origin) || (!production && origins.includes('*'));
  const origin = (value, callback) => {
    if (isAllowed(value)) return callback(null, true);
    const error = new Error('Origin not allowed by CORS');
    error.statusCode = 403;
    return callback(error);
  };
  return {
    httpCorsOptions: { origin, credentials: false, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'], maxAge: 600 },
    socketCorsOptions: { origin, credentials: false, methods: ['GET', 'POST'] },
    // CORS alone does not gate WebSocket transports.
    allowSocketRequest: (req, callback) => callback(null, isAllowed(req.headers.origin)),
  };
}

module.exports = { createCorsPolicy };
