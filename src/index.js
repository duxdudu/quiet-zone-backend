require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { WebSocketServer } = require('ws');

const routes = require('./routes');
const { setBroadcast } = require('./controllers/noiseController');
const { startSimulator } = require('./simulator');

const app = express();
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`WS client connected. Total: ${clients.size}`);

  // Respond to client ping messages to keep connection alive
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    } catch {}
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`WS client disconnected. Total: ${clients.size}`);
  });

  ws.on('error', () => {
    clients.delete(ws);
  });
});

// Server-side heartbeat — terminate truly dead connections every 30s
setInterval(() => {
  for (const ws of clients) {
    if (ws.readyState !== ws.OPEN) {
      clients.delete(ws);
      ws.terminate();
    }
  }
}, 30000);

// Broadcast function — shared by both the REST controller and the simulator
const broadcastFn = (data) => {
  const msg = JSON.stringify({ type: 'noise_update', data });
  for (const client of clients) {
    if (client.readyState === 1) client.send(msg);
  }
};

setBroadcast(broadcastFn);

app.use(cors());
app.use(express.json());
app.use('/api', routes);

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/campus_noise';

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
})
  .then(() => {
    console.log('MongoDB connected');
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      // Start IoT simulator automatically — broadcasts directly via WS
      startSimulator(broadcastFn);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
