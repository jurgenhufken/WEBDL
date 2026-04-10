require('dotenv').config(); // Load config
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  },
  allowEIO3: true,
});

// Port for V2 (Defaulting to 35730 to avoid clashing with V1 on 35729)
const PORT = process.env.V2_PORT || 35730;

// Basic middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global generic logging
app.use((req, res, next) => {
  console.log(`[V2 INGRESS] ${req.method} ${req.url}`);
  next();
});

// Placeholder for router registry
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    version: '2.0.0-alpha',
    status: 'Running concurrent with V1',
    port: PORT,
  });
});

// Socket.io simple listener
io.on('connection', (socket) => {
  console.log('[V2 Socket] Client connected');
  socket.on('disconnect', () => {
    console.log('[V2 Socket] Client disconnected');
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[V2 GLOBAL ERROR]', err.stack);
  res.status(500).json({
    success: false,
    error: 'Internal V2 Server Error',
    message: err.message
  });
});

server.listen(PORT, () => {
  console.log(`\n===========================================`);
  console.log(`🚀 WEBDL V2 SERVER RUNNING ON PORT ${PORT}`);
  console.log(`🔄 V1 is likely still running on 35729`);
  console.log(`===========================================\n`);
});

module.exports = { app, server, io }; // Export for testability
