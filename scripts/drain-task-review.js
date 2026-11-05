// Explicit URI only. The default invocation is read-only; never uses .env.
const mongoose = require('mongoose');
async function drain({ apply = false, uri = process.env.TASK_REVIEW_MIGRATION_URI } = {}) {
  if (!uri) throw new Error('Set TASK_REVIEW_MIGRATION_URI explicitly');
  await mongoose.connect(uri);
  try {
    const Task = require('../models/task.model');
    const inspect = async () => {
      const tasks = await Task.find({ status: 'in_review' });
      const rows = tasks.map(task => ({ id: String(task._id), title: task.title, from: task.status, to: 'in_progress', round: task.review.currentRound }));
      if (apply) for (const task of tasks) {
        task.review.rounds.push({ round: task.review.currentRound, type: 'cancelled', at: new Date(), reason: 'Maintenance rollback drain' });
        task.$locals.previousStatus = 'in_review';
        task.status = 'in_progress';
        await task.save();
      }
      return { mode: apply ? 'apply' : 'dry-run', tasks: rows,
        compatibility: 'Rollback release MUST retain in_review in both task and statusHistory enums and preserve review fields. Draining status alone does not make old schema validation compatible.' };
    };
    return apply ? await require('../services/task-write-lock.service').withTaskWriteLock(inspect) : await inspect();
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) drain({ apply: process.argv.includes('--apply') }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { drain };
