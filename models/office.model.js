/**
 * Office Model
 * Lưu trữ thông tin office/location cho phép check-in
 */
const mongoose = require('mongoose');

const OfficeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    default: 'Main Office'
  },
  address: {
    type: String,
    default: null
  },
  location: {
    lat: {
      type: Number,
      required: true
    },
    lng: {
      type: Number,
      required: true
    }
  },
  // Bán kính cho phép check-in (tính bằng mét)
  radius: {
    type: Number,
    default: 200, // 200m
    min: 10,
    max: 1000
  },
  // Thời gian làm việc mặc định
  workingHours: {
    start: {
      type: String,
      default: '09:00'
    },
    end: {
      type: String,
      default: '18:00'
    }
  },
  // Trạng thái active
  isActive: {
    type: Boolean,
    default: true
  },
  // Chỉ cho phép 1 office active tại 1 thời điểm
}, {
  timestamps: true,
  collection: 'offices'
});

// Index để query nhanh
OfficeSchema.index({ isActive: 1 });

// Pre-save hook: đảm bảo chỉ có 1 office active
OfficeSchema.pre('save', async function(next) {
  if (this.isActive && this.isModified('isActive')) {
    await this.constructor.updateMany(
      { _id: { $ne: this._id }, isActive: true },
      { isActive: false }
    );
  }
  next();
});

module.exports = mongoose.model('Office', OfficeSchema);
