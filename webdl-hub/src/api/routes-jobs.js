// src/api/routes-jobs.js — REST voor /api/jobs.
'use strict';

const express = require('express');

function createJobsRouter({ repo, queue, adapters, detect }) {
  const r = express.Router();

  r.post('/', async (req, res, next) => {
    try {
      const { url, adapter: hint, priority = 0, options = {}, maxAttempts = 3, force = false } = req.body || {};
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url ontbreekt' });
      }
      const adapter = detect(url, adapters, { hint });
      if (!adapter) return res.status(400).json({ error: 'geen passende adapter voor deze URL' });
      // URL-dedupe: hergebruik bestaande queued/running/done job tenzij force:true.
      if (!force) {
        const existing = await repo.findRecentJobByUrl(url);
        if (existing) {
          return res.status(200).json({ ...existing, duplicate: true });
        }
      }
      const job = await queue.enqueue({
        url, adapter: adapter.name, priority, options, maxAttempts,
      });
      res.status(201).json(job);
    } catch (e) { next(e); }
  });

  r.get('/', async (req, res, next) => {
    try {
      const { status, limit, offset } = req.query;
      const jobs = await repo.listJobs({
        status,
        limit: limit ? Math.min(500, parseInt(limit, 10)) : 100,
        offset: offset ? parseInt(offset, 10) : 0,
      });
      res.json({ jobs });
    } catch (e) { next(e); }
  });

  r.get('/:id', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const job = await repo.getJob(id);
      if (!job) return res.status(404).json({ error: 'niet gevonden' });
      const [files, logs] = await Promise.all([repo.listFiles(id), repo.listLogs(id, { limit: 100 })]);
      res.json({ job, files, logs });
    } catch (e) { next(e); }
  });

  r.post('/:id/retry', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const j = await repo.failJob(id, null, { retry: true });
      if (!j) return res.status(404).json({ error: 'niet gevonden' });
      res.json(j);
    } catch (e) { next(e); }
  });

  r.post('/:id/cancel', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const j = await queue.cancel(id);
      if (!j) return res.status(404).json({ error: 'niet gevonden of niet cancelbaar' });
      res.json(j);
    } catch (e) { next(e); }
  });

  return r;
}

module.exports = { createJobsRouter };
