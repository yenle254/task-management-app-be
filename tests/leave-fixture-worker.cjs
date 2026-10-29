// Test-only HTTP worker; never reads .env and requires an isolated fixture URI.
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/leave_verification$/.test(process.env.MONGO_URL || '')) throw new Error('Fixture URI required');
const mongoose = require('mongoose');
const express = require('express');
const Leave = require('../models/leave.model');
if (process.env.LEAVE_TEST_CRASH === '1') {
    const original = Leave.findOneAndUpdate.bind(Leave);
    Leave.findOneAndUpdate = (filter, update, options) => {
        if (filter['operation.token'] && update.$set?.status === 'approved') process.exit(87);
        return original(filter, update, options);
    };
}
mongoose.connect(process.env.MONGO_URL).then(() => {
    const app = express(); app.use(express.json());
    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.use('/api/leaves', require('../routes/leave.routes'));
    app.use('/api/statistics', require('../routes/statistics.routes'));
    app.listen(Number(process.env.PORT), '127.0.0.1');
}).catch(error => { console.error(error.message); process.exit(1); });
