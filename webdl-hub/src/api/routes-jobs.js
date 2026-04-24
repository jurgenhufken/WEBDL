// src/api/routes-jobs.js — REST voor /api/jobs.
'use strict';

const express = require('express');
const crypto = require('node:crypto');
const { isSlaveUrl, delegateToSlave } = require('../queue/slave-router');

// Detecteer URLs die uit meerdere items bestaan (playlist/kanaal/shorts-tab).
// Als een URL een playlist-list param heeft of een kanaal/shorts-pagina is,
// moet de hub auto-expanden ipv één enkele job maken.
function isMultiItemUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const pathname = u.pathname.toLowerCase();
    const isYoutubeHost = host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com');
    if (!isYoutubeHost) return false;
    // /playlist?list=... of watch?list=... (playlist param met echte waarde)
    const list = u.searchParams.get('list');
    if (list && !/^RD|^UL|^WL$/.test(list)) {
      // Mix-/autoplay-lijsten (beginnen met RD) en WatchLater (WL) zijn niet
      // stabiel uitbreidbaar — die behandelen we als single-video.
      return true;
    }
    // Kanaal-pagina's en tabs
    if (/^\/@[^/]+\/?(shorts|videos|streams|live)?\/?$/.test(pathname)) return true;
    if (/^\/(channel|c|user)\//.test(pathname)) return true;
    return false;
  } catch { return false; }
}

async function expandAndEnqueue({ repo, queue, adapters, url, priority, options, maxAttempts, force }) {
  const adapter = adapters.find((a) => a.expandPlaylist && a.matches(url));
  if (!adapter || !adapter.expandPlaylist) {
    throw Object.assign(new Error('Geen adapter met playlist-expand voor deze URL'), { httpStatus: 400 });
  }
  const entries = await adapter.expandPlaylist(url);
  if (!entries || entries.length === 0) {
    return { total: 0, queued: 0, duplicates: 0, errors: 0, jobs: [] };
  }

  const groupId = crypto.randomBytes(6).toString('hex');
  let playlistName = url;
  try {
    const u = new URL(url);
    const pathParts = u.pathname.split('/').filter(Boolean);
    if (pathParts[0] && pathParts[0].startsWith('@')) playlistName = pathParts[0];
    else if (pathParts.length >= 2) playlistName = pathParts.slice(0, 2).join('/');
    else if (u.searchParams.get('list')) playlistName = 'Playlist ' + u.searchParams.get('list').slice(0, 12);
    else playlistName = u.hostname.replace('www.', '') + u.pathname;
  } catch {}

  // Titels die nooit zullen downloaden — skip ze vóór ze in de queue gaan
  const SKIP_TITLES = /^\[(Deleted video|Private video|Unavailable video)\]$/i;

  let queued = 0, duplicates = 0, errors = 0, skipped = 0;
  const jobs = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    // Skip verwijderde/private/unavailable videos
    if (SKIP_TITLES.test(String(entry.title || '').trim())) {
      skipped++;
      continue;
    }
    try {
      if (!force) {
        const existing = await repo.findRecentJobByUrl(entry.url);
        if (existing) { duplicates++; continue; }
      }
      const job = await queue.enqueue({
        url: entry.url,
        adapter: adapter.name,
        priority,
        options: {
          ...options,
          expandGroup: groupId,
          expandName: playlistName,
          expandUrl: url,
          expandIndex: i + 1,
          expandTotal: entries.length,
          videoTitle: entry.title || undefined,
        },
        maxAttempts,
      });
      jobs.push({ id: job.id, url: entry.url, title: entry.title });
      queued++;
    } catch (_e) {
      errors++;
    }
  }
  return { total: entries.length, queued, duplicates, skipped, errors, groupId, playlistName, jobs };
}

function createJobsRouter({ repo, queue, adapters, detect }) {
  const r = express.Router();

  // ─── Enqueue single URL ─────────────────────────────────────────────────────
  r.post('/', async (req, res, next) => {
    try {
      const { url, adapter: hint, priority = 0, options = {}, maxAttempts = 3, force = false } = req.body || {};
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url ontbreekt' });
      }

      // Master/slave routing: sommige hosts worden door simple-server
      // afgehandeld. Hub inserteert dan een pending download rij; de
      // simple-server scheduler picks it up via auto-rehydrate.
      const slave = isSlaveUrl(url);
      if (slave && !hint) {
        // Bookkeeping hub-job eerst aanmaken zodat we z'n ID kunnen meegeven.
        const bookJob = await queue.enqueue({
          url,
          adapter: 'slave-delegate',
          priority,
          options: {
            ...options,
            delegated_to: 'simple-server',
            slave_platform: slave.platform,
          },
          maxAttempts: 1,
        });
        // Delegeer aan simple-server met hub_job_id zodat poller het terug
        // kan koppelen.
        const result = await delegateToSlave(repo.pool, {
          url,
          platform: slave.platform,
          metadata: { delegated_from_hub: true, hub_job_id: bookJob.id },
        });
        // Markeer hub-job als 'running' en sla simple_server_download_id op.
        await repo.pool.query(
          `UPDATE ${repo.schema}.jobs
              SET status = 'running',
                  started_at = now(),
                  locked_by = 'slave-' || $1::text,
                  locked_at = now(),
                  options = options || jsonb_build_object(
                    'simple_server_download_id', $1::text,
                    'was_duplicate', $2::boolean
                  )
            WHERE id = $3`,
          [result.downloadId, !!result.duplicate, bookJob.id],
        );
        await repo.appendLog(
          bookJob.id,
          'info',
          `↪️  Gedelegeerd naar simple-server (${slave.platform}, download #${result.downloadId}${result.duplicate ? `, dupe van status=${result.existingStatus}` : ''}); wacht op voltooiing...`,
        );
        const freshJob = await repo.getJob(bookJob.id);
        return res.status(201).json({
          ...freshJob,
          delegated: true,
          slave_platform: slave.platform,
          simple_server_download_id: result.downloadId,
          duplicate: !!result.duplicate,
        });
      }

      // Auto-expand: als URL een playlist/kanaal/shorts-tab is, expanden
      // we 'm automatisch naar losse jobs ipv één enkele queue-entry.
      if (!hint && isMultiItemUrl(url)) {
        try {
          const result = await expandAndEnqueue({
            repo, queue, adapters, url, priority, options, maxAttempts, force,
          });
          return res.status(201).json({ expanded: true, ...result });
        } catch (e) {
          if (e && e.httpStatus === 400) return res.status(400).json({ error: e.message });
          // Bij expand-fout: fallthrough naar single-job behandeling hieronder
          // als fallback, zodat minstens de hoofd-video in de queue komt.
        }
      }

      const adapter = detect(url, adapters, { hint });
      if (!adapter) return res.status(400).json({ error: 'geen passende adapter voor deze URL' });
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

  // ─── Expand playlist/channel → enqueue individual videos ────────────────────
  r.post('/expand', async (req, res, next) => {
    try {
      const { url, priority = 0, options = {}, maxAttempts = 3, force = false } = req.body || {};
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url ontbreekt' });
      }
      const result = await expandAndEnqueue({
        repo, queue, adapters, url, priority, options, maxAttempts, force,
      });
      res.status(201).json(result);
    } catch (e) {
      if (e && e.httpStatus === 400) return res.status(400).json({ error: e.message });
      if (e.message && e.message.includes('not a playlist')) {
        return res.status(400).json({ error: 'Dit is geen playlist of kanaal. Gebruik de gewone download.', detail: e.message });
      }
      next(e);
    }
  });

  // ─── List jobs ──────────────────────────────────────────────────────────────
  r.get('/', async (req, res, next) => {
    try {
      const { status, limit, offset } = req.query;
      const jobs = await repo.listJobs({
        status,
        limit: limit ? Math.min(500, parseInt(limit, 10)) : 200,
        offset: offset ? parseInt(offset, 10) : 0,
      });
      res.json({ jobs });
    } catch (e) { next(e); }
  });

  // ─── Job detail ─────────────────────────────────────────────────────────────
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

  // ─── Bulk actions ──────────────────────────────────────────────────────────
  r.post('/bulk', async (req, res, next) => {
    try {
      const { action, groupId } = req.body || {};
      const schema = repo.schema;
      const groupFilter = groupId
        ? `AND options->>'expandGroup' = '${groupId.replace(/'/g, "''")}'`
        : '';

      let result;
      switch (action) {
        case 'cancel-queued':
          result = await repo.pool.query(
            `UPDATE "${schema}".jobs SET status='cancelled', finished_at=now(), locked_by=NULL, locked_at=NULL
              WHERE status='queued' ${groupFilter} RETURNING id`);
          res.json({ action, affected: result.rows.length, ids: result.rows.map(r => r.id) });
          break;

        case 'retry-failed':
          result = await repo.pool.query(
            `UPDATE "${schema}".jobs SET status='queued', error=NULL, locked_by=NULL, locked_at=NULL, finished_at=NULL,
                    attempts = GREATEST(0, attempts - 1)
              WHERE status='failed' ${groupFilter} RETURNING id`);
          res.json({ action, affected: result.rows.length, ids: result.rows.map(r => r.id) });
          break;

        case 'clear-done':
          result = await repo.pool.query(
            `DELETE FROM "${schema}".jobs WHERE status='done' ${groupFilter} RETURNING id`);
          // Also clean up related files and logs
          if (result.rows.length > 0) {
            const ids = result.rows.map(r => r.id);
            await repo.pool.query(`DELETE FROM "${schema}".files WHERE job_id = ANY($1::int[])`, [ids]);
            await repo.pool.query(`DELETE FROM "${schema}".logs WHERE job_id = ANY($1::int[])`, [ids]);
          }
          res.json({ action, affected: result.rows.length });
          break;

        default:
          return res.status(400).json({ error: `Onbekende actie: ${action}` });
      }
    } catch (e) { next(e); }
  });

  return r;
}

module.exports = { createJobsRouter };
