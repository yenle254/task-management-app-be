const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, required: true },
    clockIn: { type: Date, required: true },
    clockOut: { type: Date },
    location: {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true }
    },
    status: { type: String, enum: ['present', 'late', 'absent'], required: true },
    workHours: { type: Number },
    autoClockOut: { type: Boolean, default: false }
}, { timestamps: true, collection: 'attendances' });


module.exports = mongoose.model('Attendance', AttendanceSchema);