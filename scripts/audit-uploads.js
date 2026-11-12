// Read-only inventory: no migration is necessary because existing URLs are retained.
const fs = require('fs/promises');
const path = require('path');
const { inspectFile } = require('../utils/file-signature.helper');

async function inventory(tasks, directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = entries.filter(entry => entry.isFile()).map(entry => entry.name);
  const referenced = new Set(tasks.flatMap(task => (task.attachments || []).map(item => item.filename)));
  const invalidSignatures = [];
  for (const filename of files) if (!await inspectFile(path.join(directory, filename), filename)) invalidSignatures.push(filename);
  return { fileCount: files.length, missing: [...referenced].filter(name => !files.includes(name)),
    unreferencedByTasks: files.filter(name => !referenced.has(name)), invalidSignatures };
}

async function main() {
  const directory = path.resolve(__dirname, '../uploads');
  if (process.argv.includes('--disk-only')) {
    const result = await inventory([], directory);
    delete result.missing;
    delete result.unreferencedByTasks;
    console.log(JSON.stringify({ scope: 'disk-only; database references not checked', ...result }, null, 2));
    return;
  }
  require('dotenv').config({ quiet: true });
  // Native driver avoids Mongoose auto-index/auto-create side effects.
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(process.env.MONGO_URL, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const tasks = await client.db().collection('tasks').find({}, { projection: { attachments: 1 } }).toArray();
    console.log(JSON.stringify(await inventory(tasks, directory), null, 2));
  } finally { await client.close(); }
}
if (require.main === module) main().catch(() => { console.error('Upload inventory failed; no data was modified'); process.exitCode = 1; });
module.exports = { inventory };
