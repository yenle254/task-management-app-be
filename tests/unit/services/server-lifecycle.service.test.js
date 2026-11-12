const { EventEmitter } = require('node:events');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const { createServerLifecycle } = require('../../../services/server-lifecycle.service');
const { createHealthService } = require('../../../services/health.service');
const { createHealthRouter } = require('../../../routes/health.routes');

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(overrides = {}) {
  const processRef = new EventEmitter(); processRef.exit = jest.fn();
  const server = new EventEmitter();
  server.close = jest.fn(callback => callback()); server.closeAllConnections = jest.fn();
  const deps = { server, io: { close: jest.fn().mockResolvedValue() },
    health: { beginShutdown: jest.fn() }, stopScheduler: jest.fn().mockResolvedValue(),
    stopSockets: jest.fn().mockResolvedValue(), disconnectDatabase: jest.fn().mockResolvedValue(),
    logger: { info: jest.fn(), error: jest.fn() }, timeoutMs: 50, processRef, ...overrides };
  return { ...deps, ...createServerLifecycle(deps) };
}

test('repeated shutdown/signals share one drain and close DB only after all work finishes', async () => {
  const scheduler = deferred(), sockets = deferred();
  const ctx = fixture({ stopScheduler: jest.fn(() => scheduler.promise), stopSockets: jest.fn(() => sockets.promise), timeoutMs: 1000 });
  let finishHttp;
  ctx.server.close.mockImplementation(callback => { finishHttp = callback; });
  const shutdown = ctx.shutdown('SIGTERM');
  expect(ctx.shutdown('SIGINT')).toBe(shutdown);
  ctx.processRef.emit('SIGTERM'); ctx.processRef.emit('SIGINT');
  expect(ctx.health.beginShutdown).toHaveBeenCalledTimes(1);
  expect(ctx.stopScheduler).toHaveBeenCalledTimes(1);
  expect(ctx.stopSockets).toHaveBeenCalledTimes(1);
  expect(ctx.io.close).toHaveBeenCalledTimes(1);
  expect(ctx.disconnectDatabase).not.toHaveBeenCalled();
  scheduler.resolve(); sockets.resolve(); await flush();
  expect(ctx.disconnectDatabase).not.toHaveBeenCalled();
  finishHttp(); expect(await shutdown).toBe(0);
  expect(ctx.disconnectDatabase).toHaveBeenCalledTimes(1);
  expect(ctx.processRef.exit).toHaveBeenCalledWith(0);
  expect(ctx.processRef.listenerCount('SIGTERM')).toBe(0);
});

test.each(['SIGTERM', 'SIGINT'])('%s triggers graceful cleanup', async signal => {
  const ctx = fixture(); ctx.processRef.emit(signal);
  await ctx.shutdown(); expect(ctx.processRef.exit).toHaveBeenCalledWith(0);
});

test('never-listened HTTP server is safe; startup failures retain nonzero exit code', async () => {
  const ctx = fixture();
  ctx.server.close.mockImplementation(callback => callback(Object.assign(Error(), { code: 'ERR_SERVER_NOT_RUNNING' })));
  expect(await ctx.shutdown('database_startup_failed', 1)).toBe(1);
  expect(ctx.disconnectDatabase).toHaveBeenCalledTimes(1);
});

test('cleanup failure still attempts other cleanup and exits nonzero without leaking error details', async () => {
  const ctx = fixture({ stopScheduler: jest.fn(() => { throw Error('mongodb://secret'); }) });
  expect(await ctx.shutdown()).toBe(1);
  expect(ctx.disconnectDatabase).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(ctx.logger.error.mock.calls)).not.toContain('mongodb');
});

test.each(['stopScheduler', 'flushAudit', 'disconnectDatabase'])('deadline bounds hanging %s and destroys tracked sockets', async step => {
  const pending = deferred();
  const ctx = fixture({ [step]: jest.fn(() => pending.promise), timeoutMs: 20 });
  const socket = new EventEmitter(); socket.destroy = jest.fn();
  ctx.server.emit('connection', socket);
  expect(await ctx.shutdown()).toBe(1);
  expect(socket.destroy).toHaveBeenCalledTimes(1);
  expect(ctx.server.closeAllConnections).toHaveBeenCalledTimes(1);
  expect(ctx.processRef.exit).toHaveBeenCalledTimes(1);
  pending.resolve(); await flush();
  expect(ctx.processRef.exit).toHaveBeenCalledTimes(1);
});

test('real HTTP request drains with MongoDB open; readiness in flight becomes 503; Socket.IO closes', async () => {
  const ping = deferred(), finishWork = deferred(), enteredWork = deferred(), enteredPing = deferred();
  const health = createHealthService({ timeoutMs: 1000, connection: { readyState: 1, db: {
    command: () => { enteredPing.resolve(); return ping.promise; },
  } } });
  health.markStarted();
  const app = express(); app.use('/health', createHealthRouter(health));
  app.get('/work', async (_req, res) => { enteredWork.resolve(); await finishWork.promise; res.json({ completed: true }); });
  const server = http.createServer(app);
  const io = new Server(server);
  const ctx = fixture({ server, io, health, timeoutMs: 2000 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  let socket;
  try {
    const connected = new Promise(resolve => io.once('connection', resolve));
    socket = new WebSocket(`${url.replace('http:', 'ws:')}/socket.io/?EIO=4&transport=websocket`);
    socket.on('message', data => { if (data.toString().startsWith('0')) socket.send('40'); });
    await connected;
    expect(io.engine.clientsCount).toBe(1);
    const socketClosed = new Promise(resolve => socket.once('close', resolve));
    const workResponse = fetch(`${url}/work`);
    const probeResponse = fetch(`${url}/health/ready`);
    await Promise.all([enteredWork.promise, enteredPing.promise]);
    const shutdown = ctx.shutdown('SIGTERM');
    expect((await probeResponse).status).toBe(503);
    expect(ctx.disconnectDatabase).not.toHaveBeenCalled();
    finishWork.resolve();
    expect(await (await workResponse).json()).toEqual({ completed: true });
    const code = await shutdown;
    await socketClosed;
    expect(ctx.logger.error.mock.calls).toEqual([]);
    expect(code).toBe(0);
    expect(server.listening).toBe(false);
    expect(io.engine.clientsCount).toBe(0);
    expect(ctx.disconnectDatabase).toHaveBeenCalledTimes(1);
  } finally {
    socket?.terminate();
    ping.resolve({ ok: 1 }); finishWork.resolve();
    await ctx.shutdown();
  }
});
