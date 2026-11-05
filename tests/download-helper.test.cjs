const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const project = path.resolve(__dirname, '../../project');
const frontendRequire = createRequire(path.join(project, 'package.json'));
const babel = frontendRequire('@babel/core');

function harness({ platform = 'android', status = 200, granted = true, failDownload, failSave, failCleanup, sharing = true } = {}) {
  const alerts = [], errors = [], downloads = [], removed = [], saved = [], shares = [], created = [];
  let permissionRequests = 0;
  const fileSystem = {
    cacheDirectory: 'file:///cache/', EncodingType: { Base64: 'base64' },
    async downloadAsync(url, uri) {
      downloads.push({ url, uri });
      if (failDownload) throw new Error('Network connection failed');
      return { uri, status };
    },
    async readAsStringAsync() { return Buffer.from('original file bytes').toString('base64'); },
    async deleteAsync(uri) { removed.push(uri); if (failCleanup) throw new Error('Cleanup unavailable'); },
    StorageAccessFramework: {
      async requestDirectoryPermissionsAsync() { permissionRequests++; return { granted, directoryUri: 'content://selected-folder' }; },
      async createFileAsync(directory, filename, mime) { created.push({ directory, filename, mime }); return 'content://selected-folder/file'; },
      async writeAsStringAsync(uri, content) { if (failSave) throw new Error('Not enough storage'); saved.push({ uri, content }); },
      async deleteAsync(uri) { removed.push(uri); },
    },
  };
  const cache = new Map();
  function load(filename) {
    const absolute = path.resolve(project, filename);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const mod = { exports: {} }; cache.set(absolute, mod);
    const code = babel.transformSync(fs.readFileSync(absolute, 'utf8'), {
      filename: absolute, configFile: false, babelrc: false,
      plugins: [frontendRequire.resolve('@babel/plugin-transform-modules-commonjs')],
    }).code;
    new Function('require', 'module', 'exports', 'console', code)(name => {
      if (name === 'expo-file-system/legacy') return fileSystem;
      if (name === 'expo-sharing') return { isAvailableAsync: async () => sharing, shareAsync: async (...args) => shares.push(args) };
      if (name === 'react-native') return { Platform: { OS: platform }, Alert: { alert: (...args) => alerts.push(args) } };
      if (name.endsWith('api.config')) return { BASE_URL: 'http://localhost:3000/api' };
      return load(path.resolve(path.dirname(absolute), name + '.js'));
    }, mod, mod.exports, { error: (...args) => errors.push(args), log() {} });
    return mod.exports;
  }
  return { ...load('src/utils/downloadHelper.js'), fileSystem, alerts, errors, downloads, removed, saved, shares, created,
    permissionRequests: () => permissionRequests };
}

test('404 from a missing seed file is reported before folder selection, without a red console error or saved error response', async () => {
  const h = harness({ status: 404 });
  assert.equal(await h.downloadFile('/uploads/release-checklist.pdf', 'release-checklist.pdf'), null);
  assert.equal(h.downloads[0].url, 'http://localhost:3000/uploads/release-checklist.pdf');
  assert.match(h.alerts[0][1], /release-checklist\.pdf.*HTTP 404/);
  assert.match(h.alerts[0][1], /attach the original file again/);
  assert.equal(h.permissionRequests(), 0);
  assert.deepEqual(h.created, []); assert.deepEqual(h.saved, []); assert.deepEqual(h.errors, []);
  assert.deepEqual(h.removed, [h.downloads[0].uri]);
});

for (const status of [401, 403, 410, 429, 500, 206]) {
  test(`HTTP ${status} is reported accurately and no invalid download is saved`, async () => {
    const h = harness({ status });
    assert.equal(await h.downloadFile('https://files.example.test/file.pdf', 'file.pdf'), null);
    assert.match(h.alerts[0][1], new RegExp(`HTTP ${status}`));
    assert.equal(h.permissionRequests(), 0); assert.deepEqual(h.saved, []);
    assert.deepEqual(h.removed, [h.downloads[0].uri]);
  });
}

test('Android saves original bytes in the selected folder with the original MIME type and cleans its cache', async () => {
  const h = harness();
  assert.equal(await h.downloadFile('/uploads/report.pdf', 'report.pdf'), 'content://selected-folder/file');
  assert.equal(h.created[0].directory, 'content://selected-folder');
  assert.equal(h.created[0].mime, 'application/pdf');
  assert.equal(Buffer.from(h.saved[0].content, 'base64').toString(), 'original file bytes');
  assert.match(h.alerts[0][1], /selected folder/); assert.doesNotMatch(h.alerts[0][1], /Downloads/);
  assert.deepEqual(h.removed, [h.downloads[0].uri]);
});

test('cancelled folder selection cleans downloaded data without showing an error or success', async () => {
  const h = harness({ granted: false });
  assert.equal(await h.downloadFile('/uploads/report.pdf', 'report.pdf'), null);
  assert.deepEqual(h.alerts, []); assert.deepEqual(h.created, []);
  assert.deepEqual(h.removed, [h.downloads[0].uri]);
});

test('failed destination write removes the incomplete destination and temporary file', async () => {
  const h = harness({ failSave: true });
  assert.equal(await h.downloadFile('/uploads/report.pdf', 'report.pdf'), null);
  assert.match(h.alerts[0][1], /Not enough storage/);
  assert.deepEqual(h.removed, ['content://selected-folder/file', h.downloads[0].uri]);
});

test('network failure cleans partial temporary data and alerts the user once', async () => {
  const h = harness({ failDownload: true });
  assert.equal(await h.downloadFile('/uploads/report.pdf', 'report.pdf'), null);
  assert.equal(h.alerts.length, 1); assert.match(h.alerts[0][1], /Network connection failed/);
  assert.deepEqual(h.removed, [h.downloads[0].uri]);
});

test('cleanup failure cannot turn a completed save into a failed download', async () => {
  const h = harness({ failCleanup: true });
  assert.equal(await h.downloadFile('/uploads/report.pdf', 'report.pdf'), 'content://selected-folder/file');
  assert.equal(h.alerts.length, 1); assert.equal(h.alerts[0][0], 'Successful!');
});

test('Unicode filenames and concurrent downloads have safe, distinct cache paths', async () => {
  const h = harness();
  await Promise.all([h.downloadFile('/uploads/report.pdf', '../Báo cáo.pdf'), h.downloadFile('/uploads/report.pdf', '../Báo cáo.pdf')]);
  assert.notEqual(h.downloads[0].uri, h.downloads[1].uri);
  assert.ok(h.downloads.every(item => !item.uri.includes('../') && !item.uri.includes(' ')));
  assert.equal(h.created[0].filename, 'Báo cáo.pdf');
});

test('iOS preserves share behavior and retains the downloaded file on success', async () => {
  const h = harness({ platform: 'ios' });
  const uri = await h.downloadFile('/uploads/image.png', 'image.png');
  assert.equal(uri, h.downloads[0].uri); assert.equal(h.shares[0][0], uri);
  assert.equal(h.shares[0][1].mimeType, 'image/png');
  assert.deepEqual(h.removed, []); assert.equal(h.permissionRequests(), 0);
});

test('an invalid URL is rejected before accessing storage or opening the folder picker', async () => {
  const h = harness();
  assert.equal(await h.downloadFile('', 'file.pdf'), null);
  assert.deepEqual(h.downloads, []); assert.deepEqual(h.removed, []);
  assert.match(h.alerts[0][1], /valid download URL/);
});
