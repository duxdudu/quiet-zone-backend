const mongoose = require('mongoose');

const buildingSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  location: { type: String },
  floors: { type: Number, default: 1 },
}, { timestamps: true });

module.exports = mongoose.model('Building', buildingSchema);
