const mongoose = require('mongoose');

const LeaveSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['sick', 'vacation', 'personal'], required: true },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true },
    numberOfDays: { type: Number, required: true },
    reason: { type: String },
    status: { type: String, enum: ['draft', 'pending_team_lead', 'pending_hr', 'approved', 'rejected', 'cancelled'], default: 'draft', index: true },
    revision: { type: Number, default: 0 },
    currentStep: { type: String, enum: ['team_lead', 'hr', null], default: null },
    teamSnapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
    approverSnapshot: { type: [new mongoose.Schema({
        role: { type: String, enum: ['team_lead', 'hr_manager'] },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        resolvedAt: Date,
        active: Boolean
    }, { _id: false })], default: [] },
    history: { type: [new mongoose.Schema({
        from: String, to: String, action: String,
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        at: Date, reason: String, revision: Number,
        snapshot: { startDay: Date, endDay: Date, days: Number, step: String }
    }, { _id: false })], default: [] },
    // A durable per-leave claim, never expired automatically after a worker crash.
    operation: { type: new mongoose.Schema({ token: String, action: String, at: Date,
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }, { _id: false }), default: null },
    balanceOperationId: String,
    idempotencyKey: String,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    rejectionReason: { type: String }
}, {
    timestamps: true,
    collection: 'leaves'
});

LeaveSchema.index({ userId: 1, status: 1 });
LeaveSchema.index({ userId: 1, startDate: 1 });
LeaveSchema.index({ status: 1, createdAt: -1 });
LeaveSchema.index({ status: 1, startDate: 1, endDate: 1 });
LeaveSchema.index({ status: 1, currentStep: 1, createdAt: -1 });
LeaveSchema.index({ userId: 1, status: 1, revision: 1 });
LeaveSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });


module.exports = mongoose.model('Leave', LeaveSchema);
