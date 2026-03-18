require('dotenv').config();
const mongoose = require('mongoose');
const Building = require('./models/Building');
const Room = require('./models/Room');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/campus_noise';

// Buildings match simulator sensor building_names exactly
const buildings = [
  { name: 'MUHABURA',  location: 'North Block, CST Campus', floors: 3 },
  { name: 'KARISIMBI', location: 'East Block, CST Campus',  floors: 3 },
  { name: 'EISTENIN',  location: 'West Block, CST Campus',  floors: 2 },
  { name: 'SABYINYO',  location: 'South Block, CST Campus', floors: 3 },
];

// Deterministic room types so the UI always shows meaningful labels
const ROOM_TYPE_MAP = {
  '101': 'study_hall',
  '102': 'dorm',
  '103': 'lab',
  '104': 'common',
  '105': 'dorm',
  '106': 'study_hall',
  '201': 'dorm',
  '202': 'study_hall',
  '203': 'lab',
  '204': 'dorm',
  '205': 'common',
  '206': 'dorm',
  '301': 'common',
  '302': 'dorm',
  '303': 'study_hall',
  '304': 'lab',
  '305': 'dorm',
  '306': 'common',
};

async function seed() {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB');

  await Building.deleteMany({});
  await Room.deleteMany({});
  console.log('Cleared existing data');

  for (const bData of buildings) {
    const building = await Building.create(bData);
    console.log(`\nCreated building: ${building.name} (${bData.location})`);

    const rooms = [];
    for (let floor = 1; floor <= bData.floors; floor++) {
      for (let num = 1; num <= 6; num++) {
        const room_number = `${floor}0${num}`;
        rooms.push({
          building: building._id,
          room_number,
          floor,
          type: ROOM_TYPE_MAP[room_number] || 'dorm',
        });
      }
    }
    await Room.insertMany(rooms);
    console.log(`  ✓ ${rooms.length} rooms created`);
  }

  console.log('\nSeed complete. Run the simulator to start generating live data.');
  process.exit(0);
}

seed().catch((err) => { console.error(err); process.exit(1); });
