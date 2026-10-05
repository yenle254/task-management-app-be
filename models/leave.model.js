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
    collection: 'leaves',
    indexes: [
        { userId: 1, status: 1 },           // getMyLeaves, getPendingLeaves
        { userId: 1, startDate: 1 },       // Year filter for leave balance
        { status: 1, createdAt: -1 }       // Sort pending leaves
    ]
});


module.exports = mongoose.model('Leave', LeaveSchema);