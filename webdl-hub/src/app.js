// src/app.js — bouwt de Express-app + WS-server, zonder te luisteren.
// Handig voor tests (kies eigen poort/repo/adapters).
'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');

const { createQueue } = require('./queue/queue');
const { detect } = require('./router/detect');
const { createJobsRouter } = require('./api/routes-jobs');
const { createAdminRouter } = require('./api/routes-admin');
const { createFilesRouter } = require('./api/routes-files');
const { createLegacyRouter } = require('./api/routes-legacy');
const { attachWs } = require('./api/ws');

function buildApp({ repo, adapters, logger }) {
  const queue = createQueue({ repo });

  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use('/api/jobs', createJobsRouter({ repo, queue, adapters, detect }));
  app.use('/api/files', createFilesRouter({ repo }));
  app.use('/api/downloads', createLegacyRouter({ repo }));
  app.use('/api', createAdminRouter({ repo, adapters, logger }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use((err, _req, res, _next) => {
    logger.error('api.error', { err: String(err.message || err) });
    res.status(500).json({ error: String(err.message || err) });
  });

  const server = http.createServer(app);
  const { wss } = attachWs({ server, queue, logger });

  return { app, server, wss, queue };
}

module.exports = { buildApp };
