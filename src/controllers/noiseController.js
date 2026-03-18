const NoiseData = require('../models/NoiseData');
const Alert = require('../models/Alert');
const {
  classifyNoise,
  parseNoiseLevel,
  shouldAlert,
  buildAlertMessage,
  recordReading,
  findRecommendedRoom,
  REQUIRED_READINGS,
} = require('../services/noiseService');

// Injected by index.js so we can broadcast via WebSocket
let broadcast = () => {};
function setBroadcast(fn) { broadcast = fn; }

// In-memory latest noise per room for fast recommendation lookup
// { "BUILDING|room": { noise_level, status } }
const latestNoiseMap = {};

async function receiveNoise(req, res) {
  try {
    const payload = Array.isArray(req.body) ? req.body : [req.body];
    const results = [];

    for (const entry of payload) {
      const { building_name, room_number, noise_level: rawLevel, timestamp } = entry;
      const db  = parseNoiseLevel(rawLevel);
      const ts  = timestamp ? new Date(timestamp) : new Date();
      const status = classifyNoise(db);

      // Update in-memory latest map
      latestNoiseMap[`${building_name}|${room_number}`] = { noise_level: db, status };

      // Record reading in stable-quiet tracker
      const isStableQuiet = recordReading(building_name, room_number, status);

      await NoiseData.create({ building_name, room_number, noise_level: db, status, timestamp: ts });

      let alert = null;
      if (shouldAlert(db, ts)) {
        const message = buildAlertMessage(building_name, room_number, db, ts);

        // Find the best confirmed-quiet room to recommend
        const recommended = findRecommendedRoom(building_name, room_number, latestNoiseMap);

        // Build recommendation payload
        let recommendation = null;
        if (recommended) {
          const isConfirmed = recommended.quietCount === undefined; // stable-quiet path returns no quietCount
          recommendation = {
            room_number:  recommended.room_number,
            building_name,
            noise_level:  recommended.noise_level ?? 0,
            status:       recommended.status ?? 'quiet',
            confirmed:    recommended.noise_level !== undefined && recommended.status === 'quiet',
            // How many of the last readings were quiet (for UI context)
            stable_readings: REQUIRED_READINGS,
          };
        }

        const alertDoc = await Alert.create({
          building_name,
          room_number,
          noise_level: db,
          message,
          timestamp: ts,
        });

        alert = { ...alertDoc.toObject(), recommendation };
      }

      const update = { building_name, room_number, noise_level: db, status, timestamp: ts, alert };
      broadcast(update);
      results.push(update);
    }

    res.status(201).json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getRoomStatuses(req, res) {
  try {
    const latest = await NoiseData.aggregate([
      { $sort: { timestamp: -1 } },
      { $group: {
        _id: { building_name: '$building_name', room_number: '$room_number' },
        noise_level: { $first: '$noise_level' },
        status:      { $first: '$status' },
        timestamp:   { $first: '$timestamp' },
      }},
      { $project: {
        _id: 0,
        building_name: '$_id.building_name',
        room_number:   '$_id.room_number',
        noise_level: 1,
        status: 1,
        timestamp: 1,
      }},
    ]);
    res.json(latest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getAlerts(req, res) {
  try {
    const { resolved, limit = 50 } = req.query;
    const filter = {};
    if (resolved !== undefined) filter.resolved = resolved === 'true';
    const alerts = await Alert.find(filter).sort({ timestamp: -1 }).limit(Number(limit)).lean();
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { receiveNoise, getRoomStatuses, getAlerts, setBroadcast };
