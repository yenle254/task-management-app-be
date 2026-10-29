// Explicit connection only. Defaults to dry-run; never loads .env or recalculates balance.
const mongoose = require('mongoose');
const Leave = require('../models/leave.model');
const { legacyPatch } = require('../services/leave-workflow.service');

async function migrate({ apply = false } = {}) {
    const results = [];
    const cursor = Leave.collection.find({ status: { $in: ['pending', 'approved', 'rejected'] }, revision: { $exists: false } });
    for await (const leave of cursor) {
        const patch = await legacyPatch(leave);
        results.push({ id: String(leave._id), from: leave.status, to: patch.status || leave.status });
        if (apply) await Leave.collection.updateOne({ _id: leave._id, status: leave.status, revision: { $exists: false } }, { $set: patch });
    }
    return { dryRun: !apply, count: results.length, results };
}
if (require.main === module) {
    const uri = process.env.LEAVE_MIGRATION_URI;
    if (!uri) throw new Error('Provide LEAVE_MIGRATION_URI explicitly; business DB migration requires operator rollout');
    mongoose.connect(uri).then(() => migrate({ apply: process.argv.includes('--apply') }))
        .then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => { console.error(error.message); process.exitCode = 1; })
        .finally(() => mongoose.disconnect());
}
module.exports = { migrate };
