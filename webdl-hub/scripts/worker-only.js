'use strict';

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const config = require('../src/config');
const { createLogger } = require('../src/util/logger');
const { createRepo } = require('../src/db/repo');
const { createQueue } = require('../src/queue/queue');
const { startWorkerPool } = require('../src/queue/worker');

const adapters = [
  require('../src/adapters/vbulletin'),
  require('../src/adapters/tdl'),
  require('../src/adapters/ofscraper'),
  require('../src/adapters/instaloader'),
  require('../src/adapters/reddit'),
  require('../src/adapters/redgifs'),
  require('../src/adapters/gallerydl'),
  require('../src/adapters/ytdlp'),
];

async function main() {
  const logger = createLogger({ level: process.env.LOG_LEVEL || config.logLevel });
  const repo = createRepo();
  const queue = createQueue({ repo });
  const pool = startWorkerPool({
    queue,
    repo,
    adapters,
    logger,
    downloadRoot: config.downloadRoot,
    concurrency: config.workerConcurrency,
  });
  logger.info('worker_only.started', { worker: pool.workerId });

  const shutdown = async (sig) => {
    logger.info('worker_only.shutdown', { sig });
    await pool.stop();
    await repo.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
