const express = require('express');
const request = require('supertest');
const { createHealthService } = require('../../../services/health.service');
const { createHealthRouter } = require('../../../routes/health.routes');
const sanitizeErrors = require('../../../middleware/sanitize-server-error.middleware');

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixture(timeoutMs = 30) {
  const connection = { readyState: 1, db: { command: jest.fn().mockResolvedValue({ ok: 1 }) } };
  const health = createHealthService({ connection, timeoutMs });
  const app = express();
  app.use('/health', createHealthRouter(health));
  app.use(sanitizeErrors);
  app.use((_req, res) => res.sendStatus(401));
  return { connection, health, app };
}

test('liveness is public, uncached and independent of DB/startup/shutdown', async () => {
  const { app, health, connection } = fixture();
  connection.readyState = 0;
  for (const stopping of [false, true]) {
    if (stopping) health.beginShutdown();
    const response = await request(app).get('/health/live').set('Origin', 'https://probe.example');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { status: 'alive' } });
    expect(response.headers['cache-control']).toBe('no-store');
  }
  expect(connection.db.command).not.toHaveBeenCalled();
});

test('readiness is 503 before startup and returns 200 only after a successful DB ping', async () => {
  const { app, health, connection } = fixture();
  expect((await request(app).get('/health/ready')).status).toBe(503);
  expect(connection.db.command).not.toHaveBeenCalled();
  health.markStarted();
  const response = await request(app).get('/health/ready');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ success: true, data: { status: 'ready' } });
  expect(connection.db.command).toHaveBeenCalledWith({ ping: 1 }, expect.objectContaining({ maxTimeMS: 30, signal: expect.any(AbortSignal) }));
});

test.each([0, 2, 3, 99])('readiness skips ping and returns 503 when Mongoose readyState=%s', async readyState => {
  const { app, health, connection } = fixture();
  health.markStarted(); connection.readyState = readyState;
  const response = await request(app).get('/health/ready');
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ success: false, error: 'Service not ready' });
  expect(connection.db.command).not.toHaveBeenCalled();
});

test('driver errors are redacted; readiness recovers after DB reconnects', async () => {
  const { app, health, connection } = fixture();
  health.markStarted();
  connection.db.command.mockRejectedValueOnce(Error('mongodb://private:secret@internal-host'));
  const response = await request(app).get('/health/ready');
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ success: false, error: 'Service not ready' });
  connection.readyState = 0;
  expect(await health.isReady()).toBe(false);
  connection.readyState = 1;
  expect(await health.isReady()).toBe(true);
});

test('failed command response, missing DB and unexpected probe exceptions stay unavailable', async () => {
  const { app, health, connection } = fixture();
  health.markStarted(); connection.db.command.mockResolvedValue({ ok: 0 });
  expect(await health.isReady()).toBe(false);
  connection.db = undefined;
  expect(await health.isReady()).toBe(false);
  jest.spyOn(health, 'isReady').mockRejectedValue(Error('secret'));
  expect((await request(app).get('/health/ready')).body).toEqual({ success: false, error: 'Service not ready' });
});

test('hung ping returns 503 within budget, aborts and does not accumulate concurrent probes', async () => {
  const { app, health, connection } = fixture(30);
  const ping = deferred(); health.markStarted(); connection.db.command.mockReturnValue(ping.promise);
  const responses = await Promise.all(Array.from({ length: 8 }, () => request(app).get('/health/ready')));
  expect(responses.every(response => response.status === 503)).toBe(true);
  expect(connection.db.command).toHaveBeenCalledTimes(1);
  expect(connection.db.command.mock.calls[0][1].signal.aborted).toBe(true);
  expect(await health.isReady()).toBe(false);
  expect(connection.db.command).toHaveBeenCalledTimes(1);
  ping.resolve({ ok: 1 });
  await new Promise(resolve => setImmediate(resolve));
  connection.db.command.mockResolvedValue({ ok: 1 });
  expect(await health.isReady()).toBe(true);
});

test('shutdown during ping immediately fails readiness and a late ping/startup cannot restore it', async () => {
  const { health, connection } = fixture(1000);
  const ping = deferred(); health.markStarted(); connection.db.command.mockReturnValue(ping.promise);
  const result = health.isReady();
  await Promise.resolve();
  health.beginShutdown(); health.markStarted();
  expect(await result).toBe(false);
  ping.resolve({ ok: 1 });
  expect(await health.isReady()).toBe(false);
});

test('disconnect while ping is in flight prevents a stale success', async () => {
  const { health, connection } = fixture();
  const ping = deferred(); health.markStarted(); connection.db.command.mockReturnValue(ping.promise);
  const result = health.isReady(); await Promise.resolve();
  connection.readyState = 0; ping.resolve({ ok: 1 });
  expect(await result).toBe(false);
});
