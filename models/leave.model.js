const mongoose = require('mongoose');

const LeaveSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['sick', 'vacation', 'personal'], required: true },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true },
    numberOfDays: { type: Number, required: true },
    reason: { type: String },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
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


module.exports = mongoose.model('Leave', LeaveSchema);
