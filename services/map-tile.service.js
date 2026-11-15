const fs = require('node:fs/promises');
const path = require('node:path');

const WEEK = 7 * 24 * 60 * 60 * 1000;
const MAX_TILE_BYTES = 128 * 1024;
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const error = (message, status = 503) => Object.assign(new Error(message), { status });

function tileKey(z, x, y) {
  if (![z, x, y].every(value => /^(0|[1-9]\d*)$/.test(String(value)))) throw error('Invalid tile coordinates', 400);
  const numbers = [z, x, y].map(Number);
  if (numbers[0] > 19 || numbers.slice(1).some(value => value >= 2 ** numbers[0])) throw error('Invalid tile coordinates', 400);
  return numbers.join('-');
}

function createMapTileService({ directory = path.join(__dirname, '../uploads/.map-cache'), fetchTile = global.fetch, now = Date.now, maxEntries = 512 } = {}) {
  const pending = new Map();
  let initialized;
  const files = new Set();
  const initialize = () => initialized ||= fs.mkdir(directory, { recursive: true }).then(async () => {
    for (const file of await fs.readdir(directory)) if (/^\d+-\d+-\d+\.json$/.test(file)) files.add(file);
  }).catch(e => { initialized = undefined; throw e; });
  async function read(file) {
    try { return JSON.parse(await fs.readFile(path.join(directory, file), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT' || e instanceof SyntaxError) return null; throw e; }
  }
  async function reserve(file) {
    if (files.has(file)) return;
    if (files.size >= maxEntries) {
      for (const candidate of files) {
        if (pending.has(candidate.slice(0, -5))) continue;
        const cached = await read(candidate);
        if (!cached || cached.expires <= now()) {
          await fs.rm(path.join(directory, candidate), { force: true });
          files.delete(candidate);
        }
      }
    }
    if (files.size >= maxEntries) throw error('Map cache is busy. Please retry later.');
    files.add(file);
  }
  async function load(key, referer) {
    await initialize();
    const file = `${key}.json`;
    const cached = await read(file);
    if (cached && cached.expires > now()) return cached;
    await reserve(file);
    let saved = false;
    try {
      const headers = { 'User-Agent': 'TaskflowAttendance/1.0 (+https://github.com/yenle254/task-management-app-fe)' };
      // Preserve the real document origin, never forward cookies or authorization.
      if (referer && /^https?:\/\//.test(referer)) headers.Referer = referer;
      if (cached?.etag) headers['If-None-Match'] = cached.etag;
      if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
      const response = await fetchTile(`https://tile.openstreetmap.org/${key.split('-').join('/')}.png`, {
        headers, signal: AbortSignal.timeout(10000), redirect: 'error',
      });
      let body;
      if (response.status === 304 && cached) body = cached.body;
      else {
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) throw error('Map provider is unavailable');
        if (Number(response.headers.get('content-length')) > MAX_TILE_BYTES) throw error('Invalid map tile');
        const chunks = []; let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > MAX_TILE_BYTES) throw error('Invalid map tile');
          chunks.push(Buffer.from(chunk));
        }
        const buffer = Buffer.concat(chunks);
        if (!buffer.subarray(0, 8).equals(PNG)) throw error('Invalid map tile');
        body = buffer.toString('base64');
      }
      const control = response.headers.get('cache-control') || '';
      if (/no-store|private/i.test(control)) throw error('Map provider does not permit caching');
      const maxAge = control.match(/(?:^|,)\s*max-age=(\d+)/i);
      const age = Math.max(0, Number(response.headers.get('age')) || 0) * 1000;
      const expires = Date.parse(response.headers.get('expires'));
      const ttl = maxAge ? Math.max(0, Number(maxAge[1]) * 1000 - age) : Number.isFinite(expires) ? Math.max(0, expires - now()) : WEEK;
      const result = { body, expires: now() + (/no-cache/i.test(control) ? 0 : ttl),
        etag: response.headers.get('etag') || (response.status === 304 ? cached?.etag : undefined),
        lastModified: response.headers.get('last-modified') || (response.status === 304 ? cached?.lastModified : undefined) };
      await fs.writeFile(path.join(directory, `${file}.tmp`), JSON.stringify(result));
      await fs.rename(path.join(directory, `${file}.tmp`), path.join(directory, file));
      saved = true;
      return result;
    } finally {
      if (!saved && !cached) files.delete(file);
    }
  }
  return {
    async getTile(z, x, y, referer) {
      const key = tileKey(z, x, y);
      if (!pending.has(key)) {
        if (pending.size >= 64) throw error('Map service is busy. Please retry later.');
        const operation = load(key, referer).finally(() => pending.delete(key));
        pending.set(key, operation);
      }
      return pending.get(key);
    },
  };
}

module.exports = { createMapTileService, tileKey };
