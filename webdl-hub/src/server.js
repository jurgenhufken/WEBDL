// src/server.js — bootstrap: config → DB → app → worker-pool → listen.
'use strict';

require('dotenv').config();

const config = require('./config');
const { createLogger } = require('./util/logger');
const { createRepo } = require('./db/repo');
const { startWorkerPool } = require('./queue/worker');
const { buildApp } = require('./app');

const adapters = [
  require('./adapters/tdl'),
  require('./adapters/ofscraper'),
  require('./adapters/instaloader'),
  require('./adapters/gallerydl'),
  require('./adapters/ytdlp'),
];

async function main() {
  const logger = createLogger({ level: config.logLevel });
  const repo = createRepo();
  const { server, queue } = buildApp({ repo, adapters, logger });

  const pool = startWorkerPool({
    queue, repo, adapters, logger,
    downloadRoot: config.downloadRoot,
    concurrency: config.workerConcurrency,
  });

  await new Promise((r) => server.listen(config.port, r));
  logger.info('server.listening', { port: config.port, worker: pool.workerId });

  const shutdown = async (sig) => {
    logger.info('server.shutdown', { sig });
    await pool.stop();
    server.close();
    await repo.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('fatal:', err);
    process.exit(1);
  });
}

module.exports = { main };
