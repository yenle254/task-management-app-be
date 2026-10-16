/**
 * Structured JSON logger
 * Emits one JSON object per log line to stdout (info/debug) or stderr (warn/error)
 * No external dependencies. Single shared instance.
 */

const SERVICE_NAME = 'hr-task-api';
const ENV = process.env.NODE_ENV || 'development';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// Default: info in production, debug in development, info in test (so logger tests can capture output)
function getDefaultLevel() {
  if (ENV === 'test') return 'info';
  if (ENV === 'production') return 'info';
  return 'debug';
}

const CONFIGURED_LEVEL = (process.env.LOG_LEVEL || getDefaultLevel()).toLowerCase();

const RESERVED = new Set(['timestamp', 'level', 'service', 'environment', 'message']);

const SENSITIVE_KEY_PATTERN = /^(password|token|authorization|cookie|refresh[_-]?token|otp|access[_-]?token|id[_-]?token)$/i;

function redactValue(value) {
  return '[REDACTED]';
}

function redactMeta(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  if (meta instanceof Error) return meta; // preserve Error identity for summary
  if (Array.isArray(meta)) return meta.map(redactMeta);
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      out[k] = redactValue(v);
    } else if (v && typeof v === 'object') {
      out[k] = redactMeta(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function summarizeError(err) {
  if (!err) return null;
  if (typeof err === 'string') return { message: err };
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      ...(err.code !== undefined ? { code: err.code } : {}),
    };
  }
  if (typeof err === 'object') {
    return {
      name: err.name,
      message: err.message,
    };
  }
  return { value: String(err) };
}

function buildEntry(level, message, meta) {
  const safeMeta = meta ? redactMeta(meta) : {};
  // Reserved fields cannot be overridden. Error instances are summarized safely.
  const filtered = {};
  for (const [k, v] of Object.entries(safeMeta)) {
    if (RESERVED.has(k)) continue;
    if (v instanceof Error) {
      filtered[k] = summarizeError(v);
    } else {
      filtered[k] = v;
    }
  }
  return {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    environment: ENV,
    message: typeof message === 'string' ? message : String(message),
    ...filtered,
  };
}

function safeStringify(entry) {
  try {
    return JSON.stringify(entry);
  } catch (err) {
    // Fallback: build a minimal safe entry
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: SERVICE_NAME,
      environment: ENV,
      message: 'log_serialization_failed',
      originalMessage: String(entry.message),
    });
  }
}

function shouldLog(level) {
  if (CONFIGURED_LEVEL === 'silent') return false;
  const configured = LEVELS[CONFIGURED_LEVEL];
  if (configured === undefined) return true;
  const incoming = LEVELS[level];
  if (incoming === undefined) return true;
  return incoming >= configured;
}

function emit(level, message, meta) {
  if (!shouldLog(level)) return;
  let entry;
  try {
    entry = buildEntry(level, message, meta);
  } catch (err) {
    entry = buildEntry('error', 'log_build_failed', { error: err.message });
  }
  const line = safeStringify(entry) + '\n';
  try {
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  } catch (_) {
    // Never let logging failure crash a request
  }
}

const logger = {
  debug: (message, meta) => emit('debug', message, meta),
  info: (message, meta) => emit('info', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  error: (message, meta) => emit('error', message, meta),
  // Expose internals for testing
  _internals: {
    redactMeta,
    summarizeError,
    buildEntry,
    shouldLog,
    CONFIGURED_LEVEL,
    LEVELS,
  },
};

module.exports = logger;
