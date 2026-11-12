const { isIP } = require('node:net');
const { MongoClient } = require('mongoose').mongo;
const { validateTokenConfig } = require('../services/token.service');
const { createCorsPolicy } = require('./cors.config');

const fail = message => { throw new Error(message); };
const present = value => typeof value === 'string' && value.trim().length > 0;
const placeholder = value => /^(your[_-]|replace[_-]|change[-_]?me|<)/i.test(String(value || '').trim());

function integer(value, name, max) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > max) {
    fail(`${name} must be an integer between 1 and ${max}`);
  }
  return Number(value);
}

function parseTrustProxy(value = 'false') {
  if (value === 'false' || value === '0') return false;
  // Hop counts require a fixed proxy topology with no shorter/direct ingress path.
  if (/^\d+$/.test(value)) return integer(value, 'TRUST_PROXY hop count', 255);
  const entries = String(value).split(',').map(entry => entry.trim());
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split('/');
    const version = isIP(address);
    if (!version || extra !== undefined || (prefix !== undefined &&
      (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (version === 4 ? 32 : 128)))) {
      fail('TRUST_PROXY must be false, a positive hop count, or explicit IP/CIDR entries; true and /0 are forbidden');
    }
  }
  return entries;
}

function validateRuntimeConfig(env = process.env, nodeVersion = process.versions.node) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) fail('NODE_ENV must be development, test or production');
  const production = nodeEnv === 'production';
  const [major, minor, patch] = nodeVersion.split('.').map(Number);
  if (production && major !== 24) fail('Production requires Node.js 24 LTS (see .nvmrc)');
  const supportedNode22 = major === 22 && (minor > 13 || (minor === 13 && patch >= 1));
  if (major !== 24 && !supportedNode22) fail('Development/test requires Node.js 22.13.1+ (22.x) or 24 LTS');
  const port = integer(env.PORT ?? (production ? '' : '3000'), 'PORT', 65535);
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  const healthcheckTimeoutMs = integer(env.HEALTHCHECK_TIMEOUT_MS ?? '1000', 'HEALTHCHECK_TIMEOUT_MS', 5000);
  const shutdownTimeoutMs = integer(env.SHUTDOWN_TIMEOUT_MS ?? '15000', 'SHUTDOWN_TIMEOUT_MS', 120000);

  if (!present(env.MONGO_URL)) fail('MONGO_URL is required');
  try {
    // The driver parses URI/options without connecting or resolving DNS.
    new MongoClient(env.MONGO_URL);
  } catch (_) {
    fail('MONGO_URL must be a valid mongodb:// or mongodb+srv:// connection string');
  }
  if (!present(env.JWT_SECRET)) fail('JWT_SECRET is required and cannot be whitespace');
  validateTokenConfig(env);
  const cors = createCorsPolicy({ ...env, NODE_ENV: nodeEnv });

  for (const name of ['PRIVATE_FILES_ENABLED', 'REFRESH_ENABLED', 'ACCEPT_LEGACY_TOKENS', 'CLOUDINARY_ENABLED']) {
    if (env[name] !== undefined && !['true', 'false'].includes(env[name])) fail(`${name} must be true or false`);
  }
  if (present(env.LOG_LEVEL) && !['debug', 'info', 'warn', 'error', 'silent'].includes(env.LOG_LEVEL)) {
    fail('LOG_LEVEL must be debug, info, warn, error or silent');
  }
  if (env.EMAIL_PORT !== undefined && env.EMAIL_PORT !== '') integer(env.EMAIL_PORT, 'EMAIL_PORT', 65535);

  if (production) {
    if (!present(env.ALLOWED_ORIGINS)) fail('ALLOWED_ORIGINS is required in production; CLIENT_URL is development-only');
    if (env.PRIVATE_FILES_ENABLED === 'false') fail('PRIVATE_FILES_ENABLED cannot be false in production');
    if (env.ACCEPT_LEGACY_TOKENS === undefined) fail('Set ACCEPT_LEGACY_TOKENS=false for a new production deployment');
    if (env.ACCEPT_LEGACY_TOKENS === 'true') {
      const cutoff = Date.parse(env.LEGACY_TOKEN_ISSUED_BEFORE);
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(env.LEGACY_TOKEN_ISSUED_BEFORE || '') ||
        !Number.isFinite(cutoff) || cutoff > Date.now() ||
        new Date(cutoff).toISOString().replace('.000Z', 'Z') !== env.LEGACY_TOKEN_ISSUED_BEFORE.replace('.000Z', 'Z')) {
        fail('LEGACY_TOKEN_ISSUED_BEFORE must be an explicit UTC timestamp in the past when legacy tokens are enabled');
      }
    }
    if (placeholder(env.JWT_SECRET)) fail('JWT_SECRET must not be an example placeholder');
    if (/your_db_name|<[^>]+>|your[_-](?:user|password|cluster)/i.test(env.MONGO_URL)) fail('MONGO_URL must not contain example placeholders');
    if (env.CLOUDINARY_ENABLED === 'false') fail('Cloudinary storage is required in production');
    for (const name of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
      if (!present(env[name]) || placeholder(env[name])) fail(`${name} is required in production and must not be a placeholder`);
    }
    // These integrations remain optional, but partial/example credentials fail early.
    if (['EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASS'].some(name => present(env[name]))) {
      for (const name of ['EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASS']) {
        if (!present(env[name]) || placeholder(env[name])) fail(`${name} is required when production email is configured`);
      }
    }
    for (const name of ['EXPO_ACCESS_TOKEN', 'GEMINI_API_KEY']) {
      if (present(env[name]) && placeholder(env[name])) fail(`${name} must not be an example placeholder`);
    }
  }
  if (present(env.AI_PROVIDER) && !['auto', 'gemini', 'ollama', 'local_only'].includes(env.AI_PROVIDER)) {
    fail('AI_PROVIDER must be auto, gemini, ollama or local_only');
  }
  if (env.AI_PROVIDER === 'gemini' && !present(env.GEMINI_API_KEY)) fail('GEMINI_API_KEY is required for AI_PROVIDER=gemini');
  if (present(env.OLLAMA_BASE_URL)) {
    let url;
    try { url = new URL(env.OLLAMA_BASE_URL); } catch (_) { fail('OLLAMA_BASE_URL must be an HTTP(S) URL'); }
    if (!['http:', 'https:'].includes(url.protocol)) fail('OLLAMA_BASE_URL must be an HTTP(S) URL');
  }
  if (env.OLLAMA_TIMEOUT_MS !== undefined && env.OLLAMA_TIMEOUT_MS !== '') integer(env.OLLAMA_TIMEOUT_MS, 'OLLAMA_TIMEOUT_MS', 120000);
  if (production && env.AI_PROVIDER === 'ollama' && !present(env.OLLAMA_BASE_URL)) fail('OLLAMA_BASE_URL is required for production AI_PROVIDER=ollama');

  return { nodeEnv, port, host: '0.0.0.0', trustProxy, cors, healthcheckTimeoutMs, shutdownTimeoutMs };
}

function loadRuntimeConfig() {
  require('dotenv').config({ quiet: true });
  const config = validateRuntimeConfig();
  process.env.NODE_ENV = config.nodeEnv;
  return config;
}

module.exports = { validateRuntimeConfig, loadRuntimeConfig, parseTrustProxy };
