const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const express = require('express');
const { createMapTileService } = require('../../../services/map-tile.service');
const { createMapRouter } = require('../../../routes/map.routes');

const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const response = (headers = {}) => new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'max-age=60', etag: '"tile1"', ...headers } });
let directory, fetchTile, time, service;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taskflow-tile-test-'));
  fetchTile = jest.fn(async () => response()); time = Date.now();
  service = createMapTileService({ directory, fetchTile, now: () => time, maxEntries: 2 });
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

test.each([['20', '1', '1'], ['2', '4', '1'], ['2', '-1', '1'], ['2', '../x', '1'], ['01', '1', '1']])('rejects invalid coordinates %s/%s/%s before network access', async (...parts) => {
  await expect(service.getTile(...parts)).rejects.toMatchObject({ status: 400 });
  expect(fetchTile).not.toHaveBeenCalled();
});

test('deduplicates concurrent requests and reuses disk cache across service restarts', async () => {
  const [a, b] = await Promise.all([service.getTile(2, 1, 1, 'https://app.example/'), service.getTile(2, 1, 1)]);
  expect(a).toEqual(b); expect(fetchTile).toHaveBeenCalledTimes(1);
  expect(fetchTile.mock.calls[0][0]).toBe('https://tile.openstreetmap.org/2/1/1.png');
  expect(fetchTile.mock.calls[0][1].headers).toEqual({ 'User-Agent': expect.stringContaining('TaskflowAttendance'), Referer: 'https://app.example/' });
  const restarted = createMapTileService({ directory, fetchTile, now: () => time });
  expect(await restarted.getTile(2, 1, 1)).toEqual(a);
  expect(fetchTile).toHaveBeenCalledTimes(1);
});

test('revalidates expired tiles conditionally and retains bytes for 304', async () => {
  const original = await service.getTile(2, 1, 1);
  time += 61000;
  fetchTile.mockResolvedValueOnce(new Response(null, { status: 304, headers: { 'cache-control': 'max-age=120' } }));
  const renewed = await service.getTile(2, 1, 1);
  expect(fetchTile.mock.calls[1][1].headers['If-None-Match']).toBe('"tile1"');
  expect(renewed.body).toBe(original.body); expect(renewed.expires).toBe(time + 120000);
});

test('cache stays bounded, retains fresh tiles, and reclaims expired entries', async () => {
  await service.getTile(2, 1, 1); await service.getTile(2, 2, 1);
  await expect(service.getTile(2, 3, 1)).rejects.toMatchObject({ status: 503 });
  expect(fetchTile).toHaveBeenCalledTimes(2);
  time += 61000; await service.getTile(2, 3, 1);
  expect((await fs.readdir(directory)).length).toBeLessThanOrEqual(2);
});

test('provider errors are not cached or retried automatically', async () => {
  fetchTile.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
  await expect(service.getTile(2, 1, 1)).rejects.toThrow('unavailable');
  expect(await fs.readdir(directory)).toEqual([]);
  await service.getTile(2, 1, 1); expect(fetchTile).toHaveBeenCalledTimes(2);
});

test('rejects oversized and non-PNG payloads', async () => {
  fetchTile.mockResolvedValueOnce(new Response('bad', { headers: { 'content-type': 'image/png' } }));
  await expect(service.getTile(2, 1, 1)).rejects.toThrow('Invalid map tile');
  fetchTile.mockResolvedValueOnce(new Response(Buffer.alloc(128 * 1024 + 1), { headers: { 'content-type': 'image/png' } }));
  await expect(service.getTile(2, 1, 1)).rejects.toThrow('Invalid map tile');
});

test('public route serves PNG with cache headers, honors conditional GET and hides upstream errors', async () => {
  const app = express(); app.use('/api/maps', createMapRouter(service));
  const first = await request(app).get('/api/maps/tiles/2/1/1.png');
  expect(first.status).toBe(200); expect(first.headers['content-type']).toContain('image/png');
  expect(first.headers['cache-control']).toMatch(/^public, max-age=/);
  expect((await request(app).get('/api/maps/tiles/2/1/1.png').set('If-None-Match', '"tile1"')).status).toBe(304);
  expect((await request(app).get('/api/maps/tiles/2/4/1.png')).status).toBe(400);
  fetchTile.mockRejectedValueOnce(new Error('private internal error'));
  const failure = await request(app).get('/api/maps/tiles/2/2/1.png');
  expect(failure.status).toBe(503); expect(failure.text).not.toContain('private internal');
});
