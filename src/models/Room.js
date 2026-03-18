const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  building: { type: mongoose.Schema.Types.ObjectId, ref: 'Building', required: true },
  room_number: { type: String, required: true },
  floor: { type: Number, default: 1 },
  type: { type: String, enum: ['dorm', 'study_hall', 'lab', 'common'], default: 'dorm' },
}, { timestamps: true });

roomSchema.index({ building: 1, room_number: 1 }, { unique: true });

module.exports = mongoose.model('Room', roomSchema);
