const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../../../models/user.model');
const Team = require('../../../models/team.model');
const Task = require('../../../models/task.model');
const RefreshSession = require('../../../models/refresh-session.model');
const AuditLog = require('../../../models/audit-log.model');
const Notification = require('../../../models/notification.model');
const auditService = require('../../../services/audit.service');

let mongoServer = null;
let usingExternalUri = false;

/**
 * Resolve a local mongod binary if installed on Windows/Linux to avoid unnecessary
 * binary downloads during local runs, while falling back to automatic download in CI.
 */
function resolveLocalSystemBinary() {
  if (process.env.MONGOMS_SYSTEM_BINARY) {
    return fs.existsSync(process.env.MONGOMS_SYSTEM_BINARY)
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : null;
  }
  if (process.platform === 'win32') {
    const candidates = [
      ['C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe', '8.0.0'],
      ['C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe', '7.0.14'],
      ['C:\\Program Files\\MongoDB\\Server\\6.0\\bin\\mongod.exe', '6.0.29'],
    ];
    for (const [candidate, version] of candidates) {
      if (fs.existsSync(candidate)) return { systemBinary: candidate, version };
    }
  }
  return null;
}

/**
 * Connect to an isolated MongoDB instance (either TEST_MONGO_URL container or MongoMemoryServer)
 * and initialize all model indexes.
 */
async function connectTestDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  let uri;
  if (process.env.TEST_MONGO_URL && process.env.TEST_MONGO_URL.trim()) {
    usingExternalUri = true;
    const baseUri = process.env.TEST_MONGO_URL.trim();
    const dbName = `test_int_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const parsed = new URL(baseUri);
    parsed.pathname = `/${dbName}`;
    uri = parsed.toString();
  } else {
    usingExternalUri = false;
    const localBinary = resolveLocalSystemBinary();
    const binaryOpts = localBinary || { version: process.env.MONGOMS_VERSION || '7.0.14' };

    mongoServer = await MongoMemoryServer.create({
      binary: binaryOpts,
    });
    uri = mongoServer.getUri('hr_task_integration_test');
  }

  process.env.MONGO_URL = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });

  await Promise.all([
    User.init(),
    Team.init(),
    Task.init(),
    RefreshSession.init(),
    AuditLog.init(),
    Notification.init(),
  ]);

  return { uri, connection: mongoose.connection };
}

/**
 * Flush pending async audit writes and clear all documents across collections
 * while preserving indexes.
 */
async function clearTestDB() {
  await auditService.flush();
  if (mongoose.connection.readyState !== 1) return;

  const collections = [
    'users',
    'teams',
    'tasks',
    'refresh_sessions',
    'audit_logs',
    'notifications',
    'task_write_locks',
  ];

  await Promise.all(
    collections.map(async (name) => {
      try {
        await mongoose.connection.collection(name).deleteMany({});
      } catch (_) {
        // Collection may not exist yet
      }
    })
  );
}

/**
 * Flush pending audit writes, drop the temporary test database, disconnect Mongoose,
 * and stop MongoMemoryServer if one was started.
 */
async function disconnectTestDB() {
  await auditService.flush();
  if (mongoose.connection.readyState !== 0) {
    try {
      await mongoose.connection.dropDatabase();
    } catch (_) {
      // Ignore drop errors on shutdown
    }
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
  usingExternalUri = false;
}

module.exports = {
  connectTestDB,
  clearTestDB,
  disconnectTestDB,
  resolveLocalSystemBinary,
};
