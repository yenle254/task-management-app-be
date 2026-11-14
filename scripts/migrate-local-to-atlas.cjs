// One-time operator migration. Target Railway env JSON arrives on stdin, never in logs.
// Run preview first; apply requires the backup directory emitted by preview.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MongoClient, BSON } = require('mongoose').mongo;
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
const collections = ['teams', 'offices', 'tasks', 'leaves', 'attendances', 'conversations', 'messages', 'notifications', 'audit_logs', 'users'];
const excluded = ['refresh_sessions', 'task_write_locks'];
const encode = value => JSON.stringify(BSON.EJSON.serialize(value, { relaxed: false }));
const decode = value => BSON.EJSON.deserialize(JSON.parse(value), { relaxed: false });
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const safeUser = doc => ({ ...doc, resetPassword: {}, pushToken: null, pushTokenPlatform: null, pushTokenUpdatedAt: null });
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
  let source, target;
  try {
    const env = JSON.parse(input.replace(/^\uFEFF/, ''));
    const local = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
    if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(local.MONGO_URL || '')) throw new Error('Source must be local MongoDB');
    if (!env.MONGO_URL?.startsWith('mongodb+srv://')) throw new Error('Target must be Atlas');
    source = new MongoClient(local.MONGO_URL, { serverSelectionTimeoutMS: 10000 });
    target = new MongoClient(env.MONGO_URL, { serverSelectionTimeoutMS: 10000 });
    await Promise.all([source.connect(), target.connect()]);
    const src = source.db(), dst = target.db();
    if (src.databaseName !== 'tma_demo' || dst.databaseName !== 'taskflow_prod') throw new Error('Unexpected database names');
    const mode = process.argv[2] || 'preview';
    let backupDir;
    if (mode === 'preview') {
      backupDir = path.join(root, '.local-backups', 'atlas-' + new Date().toISOString().replace(/[:.]/g, '-'));
      fs.mkdirSync(backupDir, { recursive: true });
    } else if (mode === 'apply') {
      backupDir = path.resolve(process.argv[3] || '');
      const allowed = path.join(root, '.local-backups') + path.sep;
      if (!backupDir.startsWith(allowed) || !fs.existsSync(path.join(backupDir, 'manifest.json'))) throw new Error('Valid preview backup directory required');
    } else throw new Error('Use preview or apply');
    const manifest = mode === 'apply' ? JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'))) : { source: src.databaseName, target: dst.databaseName, excluded, collections: [] };
    const snapshots = new Map();
    // Preflight every collection before any remote data writes.
    for (const name of [...collections, ...excluded]) {
      const live = await src.collection(name).find({}, { promoteValues: false }).sort({ _id: 1 }).toArray();
      const before = await dst.collection(name).find({}, { promoteValues: false }).sort({ _id: 1 }).toArray();
      const sourceText = encode(live), targetText = encode(before);
      if (mode === 'preview') {
        fs.writeFileSync(path.join(backupDir, name + '.source.ejson'), sourceText);
        fs.writeFileSync(path.join(backupDir, name + '.target.ejson'), targetText);
        const sourceIndexes = await src.collection(name).listIndexes().toArray().catch(e => { if (e.code === 26) return []; throw e; });
        const targetIndexes = await dst.collection(name).listIndexes().toArray().catch(e => { if (e.code === 26) return []; throw e; });
        fs.writeFileSync(path.join(backupDir, name + '.indexes.ejson'), encode({ sourceIndexes, targetIndexes }));
        manifest.collections.push({ name, sourceCount: live.length, targetCount: before.length, sourceHash: digest(sourceText), excluded: excluded.includes(name) });
      } else {
        const entry = manifest.collections.find(row => row.name === name);
        const saved = fs.readFileSync(path.join(backupDir, name + '.source.ejson'), 'utf8');
        if (digest(saved) !== entry.sourceHash) throw new Error('Backup checksum mismatch');
        if (!excluded.includes(name) && digest(sourceText) !== entry.sourceHash) throw new Error('Source changed since preview: ' + name);
        snapshots.set(name, decode(saved));
      }
      if (excluded.includes(name)) continue;
      // Production audit records are retained; business destination must be empty.
      if (name !== 'audit_logs' && before.length) throw new Error('Destination business collection is not empty: ' + name);
      const ids = new Set(before.map(doc => String(doc._id)));
      if (live.some(doc => ids.has(String(doc._id)))) throw new Error('ID conflict: ' + name);
    }
    if (mode === 'preview') {
      fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      console.log(JSON.stringify({ mode, backupDir, collections: manifest.collections.map(({ sourceHash, ...rest }) => rest) }));
      return;
    }
    const results = [];
    for (const name of collections) {
      const records = snapshots.get(name).map(doc => name === 'users' ? safeUser(doc) : doc);
      // User accounts are inserted last: the scheduler cannot see partial business data.
      if (records.length) await dst.collection(name).insertMany(records, { ordered: true });
      const ids = records.map(doc => doc._id);
      const restored = await dst.collection(name).find({ _id: { $in: ids } }, { promoteValues: false }).sort({ _id: 1 }).toArray();
      if (restored.length !== records.length) throw new Error('Count mismatch: ' + name);
      // Compare stable fields; reminder/audit work can start once users become visible.
      if (name === 'users') {
        const expected = new Map(records.map(doc => [String(doc._id), doc]));
        for (const actual of restored) {
          const original = expected.get(String(actual._id));
          if (actual.password !== original.password || actual.email !== original.email || actual.role !== original.role) throw new Error('Account verification failed');
        }
      } else if (encode(restored) !== encode(records)) throw new Error('Document verification failed: ' + name);
      results.push({ collection: name, inserted: records.length, verified: restored.length });
      fs.writeFileSync(path.join(backupDir, 'applied.json'), JSON.stringify(results, null, 2));
    }
    console.log(JSON.stringify({ mode, backupDir, results, accountPasswordHashesPreserved: true, resetAndPushTokensCleared: true, excluded }));
  } catch (error) {
    // Never print connection strings, document payloads or duplicate email values.
    const safe = /^(Source |Target |Unexpected |Valid |Use |Backup |Destination |ID conflict|Count mismatch|Account verification|Document verification)/.test(error.message);
    console.error(JSON.stringify({ error: safe ? error.message : error.name, code: error.code, note: 'Inspect backup/applied.json before retry; no automatic rollback or deletion was performed.' }));
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([source?.close(), target?.close()]);
  }
});
