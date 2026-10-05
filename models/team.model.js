const mongoose = require('mongoose');

const TeamSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: '' },
    leaderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    memberIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, {
    timestamps: true,
    collection: 'teams',
    indexes: [
        { name: 1 },  // Ensure unique team names
        { leaderId: 1 }
    ]
});

module.exports = mongoose.model('Team', TeamSchema);
