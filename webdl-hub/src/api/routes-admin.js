// src/api/routes-admin.js — /api/health en /api/adapters.
'use strict';

const express = require('express');
const config = require('../config');
const { fetchSabnzbdStatus } = require('../importers/sabnzbd-watch');

function createAdminRouter({ repo, adapters, logger = null }) {
  const r = express.Router();

  r.get('/health', async (_req, res) => {
    const dbOk = await repo.ping().catch(() => false);
    res.json({ ok: dbOk, db: dbOk ? 'up' : 'down' });
  });

  r.get('/adapters', (_req, res) => {
    res.json({
      adapters: adapters.map((a) => ({ name: a.name, priority: a.priority })),
    });
  });

  r.get('/sabnzbd/status', async (_req, res) => {
    const status = await fetchSabnzbdStatus({
      configPath: config.sabnzbdConfigPath,
      url: config.sabnzbdUrl,
      apiKey: config.sabnzbdApiKey,
      completedDir: config.sabnzbdCompletedDir,
      downloadRoot: config.downloadRoot,
      logger,
    });
    res.json({
      ...status,
      watch: {
        enabled: config.sabnzbdWatchEnabled,
        completedDir: config.sabnzbdCompletedDir,
        pollMs: config.sabnzbdPollMs,
        minFileAgeMs: config.sabnzbdMinFileAgeMs,
      },
    });
  });

  return r;
}

module.exports = { createAdminRouter };
