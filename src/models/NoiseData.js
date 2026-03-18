const mongoose = require('mongoose');

const noiseDataSchema = new mongoose.Schema({
  building_name: { type: String, required: true },
  room_number: { type: String, required: true },
  noise_level: { type: Number, required: true }, // stored as number (dB)
  status: { type: String, enum: ['quiet', 'moderate', 'loud', 'critical'], required: true },
  timestamp: { type: Date, default: Date.now },
});

noiseDataSchema.index({ building_name: 1, room_number: 1, timestamp: -1 });

module.exports = mongoose.model('NoiseData', noiseDataSchema);
