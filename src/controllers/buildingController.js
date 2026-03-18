const Building = require('../models/Building');
const Room = require('../models/Room');
const NoiseData = require('../models/NoiseData');

async function getBuildings(req, res) {
  try {
    const buildings = await Building.find().lean();

    // Attach latest noise summary per building
    const enriched = await Promise.all(buildings.map(async (b) => {
      const latest = await NoiseData.find({ building_name: b.name })
        .sort({ timestamp: -1 })
        .limit(50)
        .lean();

      const statuses = latest.map(d => d.status);
      const worstStatus = ['critical', 'loud', 'moderate', 'quiet'].find(s => statuses.includes(s)) || 'quiet';
      const avgNoise = latest.length
        ? Math.round(latest.reduce((sum, d) => sum + d.noise_level, 0) / latest.length)
        : 0;

      return { ...b, worstStatus, avgNoise, roomCount: await Room.countDocuments({ building: b._id }) };
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getRoomsByBuilding(req, res) {
  try {
    const building = await Building.findById(req.params.id).lean();
    if (!building) return res.status(404).json({ error: 'Building not found' });

    const rooms = await Room.find({ building: req.params.id }).lean();

    const enriched = await Promise.all(rooms.map(async (room) => {
      const latest = await NoiseData.findOne({
        building_name: building.name,
        room_number: room.room_number,
      }).sort({ timestamp: -1 }).lean();

      return {
        ...room,
        noise_level: latest?.noise_level ?? 0,
        status: latest?.status ?? 'quiet',
        last_updated: latest?.timestamp ?? null,
      };
    }));

    res.json({ building, rooms: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getBuildings, getRoomsByBuilding };
