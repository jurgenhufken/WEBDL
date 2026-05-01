// src/server.js — bootstrap: config → DB → app → worker-pool → listen.
'use strict';

require('dotenv').config();

const config = require('./config');
const { createLogger } = require('./util/logger');
const { createRepo } = require('./db/repo');
const { startWorkerPool } = require('./queue/worker');
const { startSlavePoller } = require('./queue/slave-poller');
const { startSabnzbdWatcher } = require('./importers/sabnzbd-watch');
const { buildApp } = require('./app');

const adapters = [
  require('./adapters/vbulletin'),
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

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, () => {
      server.off('error', reject);
      resolve();
    });
  });
  logger.info('server.listening', { port: config.port });

  const pool = startWorkerPool({
    queue, repo, adapters, logger,
    downloadRoot: config.downloadRoot,
    concurrency: config.workerConcurrency,
  });

  const slavePoller = startSlavePoller({ repo, logger, intervalMs: 5000 });
  const sabnzbdWatcher = config.sabnzbdWatchEnabled
    ? startSabnzbdWatcher({
        repo,
        logger,
        rootDirs: config.sabnzbdCompletedDirs,
        pollMs: config.sabnzbdPollMs,
        minFileAgeMs: config.sabnzbdMinFileAgeMs,
        startupLookbackMs: config.sabnzbdStartupLookbackMs,
        maxFilesPerScan: config.sabnzbdMaxFilesPerScan,
        configPath: config.sabnzbdConfigPath,
        sabnzbdUrl: config.sabnzbdUrl,
        sabnzbdApiKey: config.sabnzbdApiKey,
      })
    : null;
  logger.info('worker.started', { worker: pool.workerId });

  const shutdown = async (sig) => {
    logger.info('server.shutdown', { sig });
    if (sabnzbdWatcher) await sabnzbdWatcher.stop();
    await slavePoller.stop();
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
