// src/api/routes-admin.js — /api/health en /api/adapters.
'use strict';

const express = require('express');

function createAdminRouter({ repo, adapters }) {
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

  return r;
}

module.exports = { createAdminRouter };
