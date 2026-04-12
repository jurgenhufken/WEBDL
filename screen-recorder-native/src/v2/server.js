'use strict';
/**
 * WEBDL v2 — Entry Point
 * 
 * Dit bestand doet ALLEEN compositie:
 * 1. Config laden
 * 2. DB verbinden
 * 3. State aanmaken
 * 4. Services starten
 * 5. Routes mounten
 * 6. Luisteren
 * 
 * Geen businesslogica. Geen routes. Geen queries.
 * Max 100 regels.
 */
const express = require('express');
const http = require('http');
const config = require('../config');

const { connectDb } = require('./db/connection');
const initQueries = require('./db/queries');
const createState = require('./state');

async function main() {
  console.log('[v2] Starting WEBDL v2 server...');

  // 1. Database
  const db = await connectDb(config);
  console.log('[v2] DB connected');

  // 2. Queries (factory: geeft prepared statements terug)
  const queries = initQueries(db);
  console.log(`[v2] ${Object.keys(queries).length} queries initialized`);

  // 3. State (alle mutable globals op één plek)
  const state = createState();

  // 4. Express app
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 5. Context — het enige object dat modules ontvangen
  const ctx = { db, queries, state, config, app, services: {} };

  // 6. Services starten
  const { initQueue } = require('./services/download-queue');
  ctx.services.queue = initQueue(ctx);

  const { initDispatcher } = require('./downloaders/dispatcher');
  ctx.services.dispatcher = initDispatcher(ctx);

  const { initThumbGenerator } = require('./services/thumb-generator');
  ctx.services.thumbs = initThumbGenerator(ctx);

  console.log('[v2] Services initialized (queue, dispatcher, thumbs)');

  // 7. Routes mounten (elke module krijgt app + ctx)
  require('./routes/health')(app, ctx);
  require('./routes/media')(app, ctx);
  require('./routes/downloads')(app, ctx);
  require('./routes/admin')(app, ctx);
  require('./routes/pages')(app, ctx);

  // 7. Luisteren op aparte port (naast v1 op 35729)
  const PORT = 35730;
  const server = http.createServer(app);
  server.listen(PORT, () => {
    console.log(`[v2] WEBDL v2 listening on http://localhost:${PORT}`);
    console.log(`[v2] Gallery: http://localhost:${PORT}/gallery`);
  });

  // 8. Graceful shutdown
  const shutdown = (sig) => {
    console.log(`[v2] ${sig} received, shutting down...`);
    state.isShuttingDown = true;
    server.close(() => {
      db.end().then(() => process.exit(0)).catch(() => process.exit(1));
    });
    setTimeout(() => process.exit(1), 5000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[v2] Fatal:', err.message);
  process.exit(1);
});
