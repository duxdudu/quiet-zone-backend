const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  building_name: { type: String, required: true },
  room_number: { type: String, required: true },
  noise_level: { type: Number, required: true },
  message: { type: String, required: true },
  resolved: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now },
});

alertSchema.index({ timestamp: -1 });

module.exports = mongoose.model('Alert', alertSchema);
