// src/api/routes-admin.js — /api/health en /api/adapters.
'use strict';

const express = require('express');
const config = require('../config');
const { fetchSabnzbdStatus, readSabnzbdConfig, statfsInfo } = require('../importers/sabnzbd-watch');

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
      completedDirs: config.sabnzbdCompletedDirs,
      downloadRoot: config.downloadRoot,
      logger,
    });
    res.json({
      ...status,
      watch: {
        enabled: config.sabnzbdWatchEnabled,
        completedDir: config.sabnzbdCompletedDir,
        completedDirs: config.sabnzbdCompletedDirs,
        pollMs: config.sabnzbdPollMs,
        minFileAgeMs: config.sabnzbdMinFileAgeMs,
      },
    });
  });

  r.get('/storage/status', (_req, res) => {
    const sabConfig = readSabnzbdConfig(config.sabnzbdConfigPath);
    const paths = {
      preferredStorageRoot: config.preferredStorageRoot,
      oldStorageRoot: config.oldStorageRoot,
      newStorageRoot: config.newStorageRoot,
      downloadRoot: config.downloadRoot,
      storageRoots: config.storageRoots,
      sabDownloading: sabConfig.download_dir || null,
      sabCompleted: sabConfig.complete_dir || null,
      sabWatcherCompletedDirs: config.sabnzbdCompletedDirs,
    };
    const unique = Array.from(new Set([
      paths.preferredStorageRoot,
      paths.oldStorageRoot,
      paths.newStorageRoot,
      paths.downloadRoot,
      paths.sabDownloading,
      paths.sabCompleted,
      ...paths.storageRoots,
      ...paths.sabWatcherCompletedDirs,
    ].filter(Boolean)));
    res.json({
      ok: true,
      paths,
      disks: unique.map((p) => statfsInfo(p)),
    });
  });

  return r;
}

module.exports = { createAdminRouter };
