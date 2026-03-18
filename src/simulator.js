/**
 * IoT Sensor Simulator — runs embedded inside the server process.
 * Called by index.js on startup via startSimulator(broadcastFn).
 *
 * Timings (good for demo):
 *   - Sensor tick  : every 10 seconds  (visible live updates)
 *   - Category switch: every 30 seconds (rooms visibly change status)
 */

const TICK_MS   = 10000;  // sensor reading every 10s
const SWITCH_MS = 30000;  // category switch every 30s

const RANGES = {
  quiet:    [5,   38],
  moderate: [42,  68],
  loud:     [72,  98],
  critical: [102, 138],
};

const CATEGORIES = ['quiet', 'moderate', 'loud', 'critical'];

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
  const roomState = allRooms.map((room, i) => ({
    ...room,
    category: CATEGORIES[i % CATEGORIES.length],
  }));

  // ── Category switch ────────────────────────────────────────────────────────
  function switchCategories() {
    const switchCount = Math.floor(roomState.length * (0.3 + Math.random() * 0.3));
    const indices = [...Array(roomState.length).keys()]
      .sort(() => Math.random() - 0.5)
      .slice(0, switchCount);

    for (const idx of indices) {
      const prev = roomState[idx].category;
      const opts = CATEGORIES.filter(c => c !== prev);
      roomState[idx].category = opts[Math.floor(Math.random() * opts.length)];
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
