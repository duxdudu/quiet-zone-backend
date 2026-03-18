/**
 * Classify noise level in dB to a status string
 */
function classifyNoise(db) {
  if (db <= 40) return 'quiet';
  if (db <= 70) return 'moderate';
  if (db <= 100) return 'loud';
  return 'critical';
}

/**
 * Parse noise_level from sensor payload — accepts "120dB" or 120
 */
function parseNoiseLevel(raw) {
  if (typeof raw === 'number') return raw;
  return parseFloat(String(raw).replace(/[^0-9.]/g, ''));
}

/**
 * Determine if an alert should fire based on noise level and time
 */
function shouldAlert(db, timestamp) {
  const hour = new Date(timestamp).getHours();
  const isAfter10PM = hour >= 22 || hour < 6;
  return isAfter10PM ? db > 70 : db > 100;
}

/**
 * Build alert message
 */
function buildAlertMessage(building, room, db, timestamp) {
  const hour = new Date(timestamp).getHours();
  const isAfter10PM = hour >= 22 || hour < 6;
  const reason = isAfter10PM ? 'after 10 PM quiet hours' : 'critical noise level';
  return `Room ${room} in ${building} reached ${db}dB — ${reason}`;
}

// ── Stable-quiet tracker ─────────────────────────────────────────────────────
// Keeps the last N readings per room key ("BUILDING|room_number").
// A room is only recommended when ALL last REQUIRED_READINGS are quiet —
// meaning the sensor confirmed it quiet 5 times in a row (~10 min at 2 min/tick).

const REQUIRED_READINGS = 5;
const recentReadings = {}; // { "BUILDING|101": ['quiet','quiet','loud', ...] }

/**
 * Record a new reading for a room and return whether it is stably quiet.
 */
function recordReading(building_name, room_number, status) {
  const key = `${building_name}|${room_number}`;
  if (!recentReadings[key]) recentReadings[key] = [];
  const history = recentReadings[key];
  history.push(status);
  // Keep only the last REQUIRED_READINGS entries
  if (history.length > REQUIRED_READINGS) history.shift();
  return history.length === REQUIRED_READINGS && history.every(s => s === 'quiet');
}

/**
 * Given a building, return the room that has been stably quiet the longest.
 * Falls back to the room with the lowest single latest noise if none are stable.
 * Returns null if no data for the building at all.
 *
 * @param {string} building_name
 * @param {string} excludeRoom - room that triggered the alert (don't recommend it)
 * @param {object} latestNoiseMap - { "BUILDING|room": { noise_level, status } }
 */
function findRecommendedRoom(building_name, excludeRoom, latestNoiseMap) {
  // Collect all rooms in this building that have readings
  const buildingKeys = Object.keys(recentReadings).filter(k => k.startsWith(`${building_name}|`));
  if (!buildingKeys.length) return null;

  // First preference: stably quiet rooms (all 5 readings quiet)
  const stableQuiet = buildingKeys.filter(k => {
    const room_number = k.split('|')[1];
    if (room_number === excludeRoom) return false;
    const history = recentReadings[k];
    return history.length === REQUIRED_READINGS && history.every(s => s === 'quiet');
  });

  if (stableQuiet.length) {
    // Among stable-quiet rooms, pick the one with the lowest current noise
    return stableQuiet
      .map(k => ({ room_number: k.split('|')[1], ...latestNoiseMap[k] }))
      .sort((a, b) => (a.noise_level ?? 999) - (b.noise_level ?? 999))[0];
  }

  // Fallback: room with most quiet readings in history (not the alerting room)
  const candidates = buildingKeys
    .filter(k => k.split('|')[1] !== excludeRoom)
    .map(k => {
      const history = recentReadings[k];
      const quietCount = history.filter(s => s === 'quiet').length;
      return { key: k, room_number: k.split('|')[1], quietCount, ...latestNoiseMap[k] };
    })
    .sort((a, b) => b.quietCount - a.quietCount || (a.noise_level ?? 999) - (b.noise_level ?? 999));

  return candidates[0] ?? null;
}

module.exports = {
  classifyNoise,
  parseNoiseLevel,
  shouldAlert,
  buildAlertMessage,
  recordReading,
  findRecommendedRoom,
  REQUIRED_READINGS,
};
