const express = require('express');
const router = express.Router();
const { getBuildings, getRoomsByBuilding } = require('../controllers/buildingController');
const { receiveNoise, getRoomStatuses, getAlerts } = require('../controllers/noiseController');
const { getStats } = require('../controllers/statsController');

router.get('/buildings', getBuildings);
router.get('/buildings/:id/rooms', getRoomsByBuilding);
router.post('/noise', receiveNoise);
router.get('/rooms/status', getRoomStatuses);
router.get('/alerts', getAlerts);
router.get('/stats', getStats);

module.exports = router;
