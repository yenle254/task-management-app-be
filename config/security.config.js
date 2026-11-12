const helmet = require('helmet');

const securityHeaders = (env = process.env) => helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'], connectSrc: ["'self'", 'ws:', 'wss:', 'https://res.cloudinary.com'],
    objectSrc: ["'none'"], frameAncestors: ["'none'"],
    upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
  } },
  crossOriginResourcePolicy: { policy: 'same-site' },
  crossOriginEmbedderPolicy: false,
  strictTransportSecurity: env.NODE_ENV === 'production' ? { maxAge: 15552000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'no-referrer' },
  xFrameOptions: { action: 'deny' },
});

const permissionsPolicy = (_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  next();
};
module.exports = { securityHeaders, permissionsPolicy };
