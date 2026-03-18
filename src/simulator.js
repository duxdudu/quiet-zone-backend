/**
 * IoT Sensor Simulator — runs embedded inside the server process.
 * Called by index.js on startup via startSimulator(broadcastFn).
 *
 * Each building has a distinct noise personality so statistics look
 * meaningfully different across buildings:
 *
 *   MUHABURA  — mostly quiet study hall (library-like)
 *   KARISIMBI — mixed, moderate-heavy (dorm block)
 *   EISTENIN  — loud/critical prone (lab + common areas)
 *   SABYINYO  — balanced but spikes at night
 *
 * Timings:
 *   Sensor tick    : every 10 seconds
 *   Category switch: every 30 seconds
 */

const TICK_MS   = 10000;
const SWITCH_MS = 30000;

const RANGES = {
  quiet:    [5,   38],
  moderate: [42,  68],
  loud:     [72,  98],
  critical: [102, 138],
};

const CATEGORIES = ['quiet', 'moderate', 'loud', 'critical'];

// Each building has weighted probabilities for each category.
// weights[0]=quiet, [1]=moderate, [2]=loud, [3]=critical
const BUILDING_PROFILES = {
  MUHABURA:  { weights: [60, 25, 10,  5], label: 'Quiet study block' },
  KARISIMBI: { weights: [20, 45, 25, 10], label: 'Mixed dorm block' },
  EISTENIN:  { weights: [10, 20, 40, 30], label: 'Loud lab/common block' },
  SABYINYO:  { weights: [30, 35, 25, 10], label: 'Balanced block' },
};

function weightedCategory(building_name) {
  const profile = BUILDING_PROFILES[building_name];
  if (!profile) return CATEGORIES[Math.floor(Math.random() * 4)];
  const weights = profile.weights;
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return CATEGORIES[i];
  }
  return CATEGORIES[0];
}

function buildAllRooms() {
  const defs = [
    { building_name: 'MUHABURA',  floors: 3 },
    { building_name: 'KARISIMBI', floors: 3 },
    { building_name: 'EISTENIN',  floors: 2 },
    { building_name: 'SABYINYO',  floors: 3 },
  ];
  const rooms = [];
  for (const d of defs) {
    for (let f = 1; f <= d.floors; f++) {
      for (let n = 1; n <= 6; n++) {
        rooms.push({ building_name: d.building_name, room_number: `${f}0${n}` });
      }
    }
  }
  return rooms;
}

function randInRange([min, max]) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * Start the simulator.
 * @param {Function} onReading - called with each sensor reading object
 *   { building_name, room_number, noise_level (number), status, timestamp }
 */
function startSimulator(onReading) {
  const { classifyNoise } = require('./services/noiseService');
  const NoiseData = require('./models/NoiseData');
  const Alert     = require('./models/Alert');
  const {
    parseNoiseLevel, shouldAlert, buildAlertMessage,
    recordReading, findRecommendedRoom,
    REQUIRED_READINGS,
  } = require('./services/noiseService');

  // In-memory latest map for recommendation lookups
  const latestNoiseMap = {};

  const allRooms  = buildAllRooms();
  const roomState = allRooms.map((room) => ({
    ...room,
    category: weightedCategory(room.building_name),
  }));

  // ── Category switch ────────────────────────────────────────────────────────
  function switchCategories() {
    const switchCount = Math.floor(roomState.length * (0.3 + Math.random() * 0.3));
    const indices = [...Array(roomState.length).keys()]
      .sort(() => Math.random() - 0.5)
      .slice(0, switchCount);

    for (const idx of indices) {
      // Each room switches to a new category weighted by its building profile
      roomState[idx].category = weightedCategory(roomState[idx].building_name);
    }

    const counts = { quiet: 0, moderate: 0, loud: 0, critical: 0 };
    roomState.forEach(r => counts[r.category]++);
    console.log(
      `[Simulator] 🔄 ${switchCount} rooms switched — ` +
      `🟢${counts.quiet} 🟡${counts.moderate} 🟠${counts.loud} 🔴${counts.critical}`
    );
  }

  // ── Sensor tick ────────────────────────────────────────────────────────────
  let tick = 0;
  async function emitReadings() {
    tick++;
    for (let i = 0; i < roomState.length; i++) {
      const room   = roomState[i];
      const db     = randInRange(RANGES[room.category]);
      const status = classifyNoise(db);
      const ts     = new Date();
      const key    = `${room.building_name}|${room.room_number}`;

      latestNoiseMap[key] = { noise_level: db, status };
      recordReading(room.building_name, room.room_number, status);

      // Persist to DB
      try {
        await NoiseData.create({
          building_name: room.building_name,
          room_number:   room.room_number,
          noise_level:   db,
          status,
          timestamp:     ts,
        });
      } catch (_) {}

      // Check alert
      let alert = null;
      if (shouldAlert(db, ts)) {
        const message     = buildAlertMessage(room.building_name, room.room_number, db, ts);
        const recommended = findRecommendedRoom(room.building_name, room.room_number, latestNoiseMap);
        let recommendation = null;
        if (recommended) {
          recommendation = {
            room_number:     recommended.room_number,
            building_name:   room.building_name,
            noise_level:     recommended.noise_level ?? 0,
            status:          recommended.status ?? 'quiet',
            confirmed:       recommended.status === 'quiet',
            stable_readings: REQUIRED_READINGS,
          };
        }
        try {
          const alertDoc = await Alert.create({
            building_name: room.building_name,
            room_number:   room.room_number,
            noise_level:   db,
            message,
            timestamp:     ts,
          });
          alert = { ...alertDoc.toObject(), recommendation };
        } catch (_) {}
      }

      // Broadcast to all WS clients
      onReading({ building_name: room.building_name, room_number: room.room_number, noise_level: db, status, timestamp: ts, alert });
    }

    if (tick % 3 === 1) {
      const counts = { quiet: 0, moderate: 0, loud: 0, critical: 0 };
      roomState.forEach(r => counts[r.category]++);
      console.log(
        `[Simulator] Tick ${tick} ${new Date().toLocaleTimeString()} — ` +
        `🟢${counts.quiet} 🟡${counts.moderate} 🟠${counts.loud} 🔴${counts.critical}`
      );
    }
  }

  setInterval(emitReadings, TICK_MS);
  setInterval(switchCategories, SWITCH_MS);

  // Fire first batch immediately so the UI has data on startup
  setTimeout(emitReadings, 1000);

  const initCounts = { quiet: 0, moderate: 0, loud: 0, critical: 0 };
  roomState.forEach(r => initCounts[r.category]++);
  console.log(`[Simulator] Started — ${allRooms.length} rooms, tick every ${TICK_MS / 1000}s, switch every ${SWITCH_MS / 1000}s`);
  console.log(`[Simulator] Initial: 🟢${initCounts.quiet} 🟡${initCounts.moderate} 🟠${initCounts.loud} 🔴${initCounts.critical}`);
}

module.exports = { startSimulator };
