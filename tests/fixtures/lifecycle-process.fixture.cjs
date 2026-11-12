// Isolated transport/signal fixture: no application credentials or database I/O.
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const { createHealthService } = require('../../services/health.service');
const { createHealthRouter } = require('../../routes/health.routes');
const { createServerLifecycle } = require('../../services/server-lifecycle.service');
const connection = { readyState: 1, db: { command: async () => ({ ok: 1 }) } };
const health = createHealthService({ connection });
const app = express(); app.use('/health', createHealthRouter(health));
const server = http.createServer(app);
const io = new Server(server);
createServerLifecycle({ server, io, health, timeoutMs: 1000,
  stopScheduler: async () => {}, stopSockets: async () => {},
  disconnectDatabase: () => new Promise(resolve => process.send({ event: 'database-closed' }, resolve)),
  logger: { info() {}, error() {} },
});
// Windows does not deliver POSIX SIGTERM gracefully via child.kill(). Exercise
// the exact registered handler through IPC there; Unix tests send an OS signal.
process.on('message', message => { if (['SIGINT', 'SIGTERM'].includes(message.signal)) process.emit(message.signal); });
server.listen(0, '127.0.0.1', () => {
  health.markStarted();
  process.send({ event: 'listening', port: server.address().port });
});
