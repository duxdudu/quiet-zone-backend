const NoiseData = require('../models/NoiseData');

async function getStats(req, res) {
  try {
    const days = parseInt(req.query.days) || 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Average noise per room (ranked)
    const roomAverages = await NoiseData.aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $group: {
        _id: { building_name: '$building_name', room_number: '$room_number' },
        avgNoise: { $avg: '$noise_level' },
        count: { $sum: 1 },
      }},
      { $project: {
        _id: 0,
        building_name: '$_id.building_name',
        room_number: '$_id.room_number',
        avgNoise: { $round: ['$avgNoise', 1] },
        count: 1,
      }},
      { $sort: { avgNoise: 1 } },
    ]);

    // Average noise per building
    const buildingAverages = await NoiseData.aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $group: {
        _id: '$building_name',
        avgNoise: { $avg: '$noise_level' },
        count: { $sum: 1 },
      }},
      { $project: {
        _id: 0,
        building_name: '$_id',
        avgNoise: { $round: ['$avgNoise', 1] },
        count: 1,
      }},
      { $sort: { avgNoise: 1 } },
    ]);

    // Noise trend — daily average over the period
    const dailyTrend = await NoiseData.aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          status: '$status',
        },
        count: { $sum: 1 },
        avgNoise: { $avg: '$noise_level' },
      }},
      { $group: {
        _id: '$_id.date',
        avgNoise: { $avg: '$avgNoise' },
        quiet:    { $sum: { $cond: [{ $eq: ['$_id.status', 'quiet']    }, '$count', 0] } },
        moderate: { $sum: { $cond: [{ $eq: ['$_id.status', 'moderate'] }, '$count', 0] } },
        loud:     { $sum: { $cond: [{ $eq: ['$_id.status', 'loud']     }, '$count', 0] } },
        critical: { $sum: { $cond: [{ $eq: ['$_id.status', 'critical'] }, '$count', 0] } },
      }},
      { $project: {
        _id: 0, date: '$_id',
        avgNoise: { $round: ['$avgNoise', 1] },
        quiet: 1, moderate: 1, loud: 1, critical: 1,
      }},
      { $sort: { date: 1 } },
    ]);

    // Status distribution totals
    const distribution = await NoiseData.aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { _id: 0, status: '$_id', count: 1 } },
    ]);

    // Hourly averages per building — what hour of day is each building quietest?
    // Groups by building + hour-of-day (0–23), averages noise across all days in range.
    const hourlyByBuilding = await NoiseData.aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $group: {
        _id: {
          building_name: '$building_name',
          hour: { $hour: '$timestamp' },
        },
        avgNoise: { $avg: '$noise_level' },
        count: { $sum: 1 },
      }},
      { $project: {
        _id: 0,
        building_name: '$_id.building_name',
        hour: '$_id.hour',
        avgNoise: { $round: ['$avgNoise', 1] },
        count: 1,
      }},
      { $sort: { building_name: 1, hour: 1 } },
    ]);

    res.json({
      quietestRooms: roomAverages.slice(0, 5),
      loudestRooms:  roomAverages.slice(-5).reverse(),
      buildingAverages,
      dailyTrend,
      distribution,
      hourlyByBuilding,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getStats };
