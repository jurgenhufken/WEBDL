// src/api/routes-jobs.js — REST voor /api/jobs.
'use strict';

const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isSlaveUrl, delegateToSlave } = require('../queue/slave-router');
const { classifyLane, defaultJobPriority } = require('../db/repo');

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Detecteer URLs die uit meerdere items bestaan (playlist/kanaal/shorts-tab).
// Als een URL een playlist-list param heeft of een kanaal/shorts-pagina is,
// moet de hub auto-expanden ipv één enkele job maken.
function isMultiItemUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const pathname = u.pathname.toLowerCase();
    const isYoutubeHost = host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com');
    const isXvideosHost = host === 'xvideos.com' || host.endsWith('.xvideos.com');
    const isRedgifsHost = host === 'redgifs.com' || host.endsWith('.redgifs.com');
    if (isXvideosHost) {
      return !/^\/video[./]/i.test(pathname);
    }
    if (isRedgifsHost) {
      if (/^\/users\/[^/]+\/?$/.test(pathname)) return true;
      if (/^\/users\/[^/]+\/collections\/[^/]+\/?$/.test(pathname)) return true;
      if (/^\/niches\/[^/]+\/?$/.test(pathname)) return true;
      if (/^\/(?:gifs\/[^/]+|search(?:\/gifs)?|browse)\/?$/.test(pathname)) return true;
      return false;
    }
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

function canonicalExpandUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    u.hash = '';
    if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') {
      const list = u.searchParams.get('list');
      if (list && !/^RD|^UL|^WL$/i.test(list)) {
        return `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`;
      }
      u.search = '';
      u.hostname = host === 'youtu.be' ? 'www.youtube.com' : u.hostname;
      u.pathname = u.pathname.replace(/\/+$/, '') || '/';
      return u.toString();
    }
    return u.toString();
  } catch {
    return String(url || '').trim();
  }
}

function stableExpandGroupId(url) {
  return crypto.createHash('sha1').update(canonicalExpandUrl(url)).digest('hex').slice(0, 12);
}

async function expandAndEnqueue({ repo, queue, adapters, url, priority, options, maxAttempts, force }) {
  const adapter = adapters.find((a) => a.expandPlaylist && a.matches(url));
  if (!adapter || !adapter.expandPlaylist) {
    throw Object.assign(new Error('Geen adapter met playlist-expand voor deze URL'), { httpStatus: 400 });
  }
  const canonicalUrl = canonicalExpandUrl(url);
  const groupId = options && options.expandGroup ? String(options.expandGroup) : stableExpandGroupId(canonicalUrl);
  if (!force) {
    const existingGroup = await repo.getGroupSummary(groupId)
      || await repo.findGroupSummaryByExpandUrl([canonicalUrl, url].filter(Boolean));
    if (existingGroup && Number(existingGroup.jobs || 0) > 0) {
      return {
        total: Number(existingGroup.total || existingGroup.jobs || 0),
        queued: 0,
        duplicates: Number(existingGroup.jobs || 0),
        skipped: 0,
        paused: Number(existingGroup.paused || 0),
        errors: 0,
        groupId: existingGroup.group_id || groupId,
        playlistName: existingGroup.name || existingGroup.display_name || canonicalUrl,
        existing: true,
        duplicate: true,
        jobs: [],
      };
    }
  }
  const entries = await adapter.expandPlaylist(url, options || {});
  if (!entries || entries.length === 0) {
    return { total: 0, queued: 0, duplicates: 0, errors: 0, jobs: [] };
  }

  let playlistName = url;
  try {
    const u = new URL(canonicalUrl || url);
    const pathParts = u.pathname.split('/').filter(Boolean);
    if (pathParts[0] && pathParts[0].startsWith('@')) playlistName = pathParts[0];
    else if (pathParts.length >= 2) playlistName = pathParts.slice(0, 2).join('/');
    else if (u.searchParams.get('list')) playlistName = 'Playlist ' + u.searchParams.get('list').slice(0, 12);
    else playlistName = u.hostname.replace('www.', '') + u.pathname;
  } catch {}

  // Titels die nooit zullen downloaden — skip ze vóór ze in de queue gaan
  const SKIP_TITLES = /^\[(Deleted video|Private video|Unavailable video)\]$/i;
  const activeLimit = intEnv('WEBDL_EXPAND_ACTIVE_LIMIT', 300);

  let queued = 0, duplicates = 0, errors = 0, skipped = 0, paused = 0;
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
        const existingDownload = await repo.findGalleryDownloadByUrl(entry.url);
        if (existingDownload) { duplicates++; continue; }
      }
      const originalLane = classifyLane(entry.url, adapter.name);
      const shouldPause = activeLimit > 0 && queued >= activeLimit;
      const job = await queue.enqueue({
        url: entry.url,
        adapter: adapter.name,
        priority: Number.isFinite(Number(priority)) ? priority : defaultJobPriority(entry.url, adapter.name),
        options: {
          ...options,
          expandGroup: groupId,
          expandName: playlistName,
          expandUrl: canonicalUrl,
          expandOriginalUrl: url,
          expandIndex: i + 1,
          expandTotal: entries.length,
          ...(shouldPause ? { pauseLane: originalLane, paused_at: new Date().toISOString(), autoPausedByExpandLimit: true } : {}),
          videoTitle: entry.title || undefined,
          thumbnail: entry.thumbnail || undefined,
          channel: entry.channel || options.channel || undefined,
          youtubeChannelId: entry.channelId || undefined,
          youtubeChannelUrl: entry.channelUrl || undefined,
          playlistTitle: entry.playlistTitle || options.playlistTitle || undefined,
        },
        maxAttempts,
        lane: shouldPause ? 'paused' : originalLane,
      });
      jobs.push({ id: job.id, url: entry.url, title: entry.title, thumbnail: entry.thumbnail || undefined });
      if (shouldPause) paused++;
      else queued++;
    } catch (_e) {
      errors++;
    }
  }
  return { total: entries.length, queued, duplicates, skipped, paused, errors, groupId, playlistName, jobs };
}

function hostnameFromUrl(value) {
  try {
    return new URL(String(value || '')).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_) {
    return '';
  }
}

function requestedPriorityFromBody(body) {
  const value = Number(body && body.priority);
  return Number.isFinite(value) ? Math.round(value) : null;
}

function uniqueUrls(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const url = String(value || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

const K2S_AUTH_KEYS = [
  'WEBDL_KEEP2SHARE_AUTH_TOKEN',
  'KEEP2SHARE_AUTH_TOKEN',
  'K2S_AUTH_TOKEN',
  'WEBDL_KEEP2SHARE_ACCESS_TOKEN',
  'KEEP2SHARE_ACCESS_TOKEN',
  'K2S_ACCESS_TOKEN',
  'WEBDL_KEEP2SHARE_USERNAME',
  'KEEP2SHARE_USERNAME',
  'K2S_USERNAME',
  'WEBDL_KEEP2SHARE_COOKIE',
  'KEEP2SHARE_COOKIE',
  'K2S_COOKIE',
  'WEBDL_KEEP2SHARE_X_BC',
  'KEEP2SHARE_X_BC',
  'K2S_X_BC',
  'WEBDL_KEEP2SHARE_XBC',
  'KEEP2SHARE_XBC',
  'K2S_XBC',
];

function envFileHasAnyKey(filePath, keys) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const wanted = new Set(keys.map((k) => k.toUpperCase()));
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!m || !wanted.has(String(m[1]).toUpperCase())) continue;
      const value = String(m[2] || '').trim().replace(/^['"]|['"]$/g, '');
      if (value) return true;
    }
  } catch (_) {}
  return false;
}

function hasKeep2ShareApiAuthConfigured() {
  if (K2S_AUTH_KEYS.some((key) => String(process.env[key] || '').trim())) return true;
  const root = path.resolve(__dirname, '..', '..', '..');
  return envFileHasAnyKey(path.join(root, 'screen-recorder-native', '.env'), K2S_AUTH_KEYS)
    || envFileHasAnyKey(path.join(root, 'webdl-hub', '.env'), K2S_AUTH_KEYS);
}

async function mapWithConcurrency(values, limit, fn) {
  const out = new Array(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(values.length || 1, limit || 1)) }, async () => {
    while (next < values.length) {
      const index = next++;
      out[index] = await fn(values[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function createJobsRouter({ repo, queue, adapters, detect }) {
  const r = express.Router();

  async function enqueueOneUrl({ url, hint = null, options = {}, maxAttempts = 3, force = false, requestedPriority = null }) {
    const slave = isSlaveUrl(url);
    if (slave && !hint) {
      if (slave.platform === 'keep2share' && !hasKeep2ShareApiAuthConfigured()) {
        throw Object.assign(
          new Error('Keep2Share auth ontbreekt. Zet K2S_COOKIE/K2S_X_BC, K2S_ACCESS_TOKEN/WEBDL_KEEP2SHARE_AUTH_TOKEN of K2S_USERNAME/K2S_PASSWORD in screen-recorder-native/.env of webdl-hub/.env voordat K2S wordt gequeued.'),
          { httpStatus: 409 },
        );
      }
      const slavePriority = requestedPriority ?? defaultJobPriority(url, 'slave-delegate');
      if (!force) {
        const existingDownload = await repo.findGalleryDownloadByUrl(url);
        if (existingDownload) {
          return {
            id: existingDownload.id,
            status: existingDownload.status,
            platform: existingDownload.platform,
            title: existingDownload.title || existingDownload.filename || existingDownload.filepath,
            duplicate: true,
            delegated: true,
            slave_platform: slave.platform,
            simple_server_download_id: existingDownload.id,
            existing_source: 'gallery',
          };
        }
      }
      const bookJob = await queue.enqueue({
        url,
        adapter: 'slave-delegate',
        priority: slavePriority,
        options: {
          ...options,
          delegated_to: 'simple-server',
          slave_platform: slave.platform,
        },
        maxAttempts: 1,
      });
      const sourceContext = options.webdl_source_contexts?.[url] || options.sourceContext || null;
      const originalUrl = sourceContext?.url || options.contextUrl || options.pageUrl || '';
      const originalSite = hostnameFromUrl(originalUrl) || sourceContext?.platform || options.platform || '';
      const result = await delegateToSlave(repo.pool, {
        url,
        platform: slave.platform,
        metadata: {
          delegated_from_hub: true,
          hub_job_id: bookJob.id,
          source_context: sourceContext,
          source_site: originalSite || null,
          original_site: originalSite || null,
          original_platform: sourceContext?.platform || options.platform || null,
          original_channel: sourceContext?.channel || options.channel || null,
          original_title: sourceContext?.title || options.title || null,
          original_url: originalUrl || null,
        },
        priority: slavePriority,
      });
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
      return {
        ...freshJob,
        delegated: true,
        slave_platform: slave.platform,
        simple_server_download_id: result.downloadId,
        duplicate: !!result.duplicate,
      };
    }

    const adapter = detect(url, adapters, { hint });
    if (!adapter) {
      throw Object.assign(new Error('geen passende adapter voor deze URL'), { httpStatus: 400 });
    }
    const priority = requestedPriority ?? defaultJobPriority(url, adapter.name);
    if (!force) {
      const existing = await repo.findRecentJobByUrl(url);
      if (existing) return { ...existing, duplicate: true };
      const existingDownload = await repo.findGalleryDownloadByUrl(url);
      if (existingDownload) {
        return {
          id: existingDownload.id,
          status: existingDownload.status,
          platform: existingDownload.platform,
          title: existingDownload.title || existingDownload.filename || existingDownload.filepath,
          duplicate: true,
          existing_source: 'gallery',
        };
      }
    }
    return queue.enqueue({ url, adapter: adapter.name, priority, options, maxAttempts });
  }

  // ─── Enqueue single URL ─────────────────────────────────────────────────────
  r.post('/', async (req, res, next) => {
    try {
      const { url, adapter: hint, options = {}, maxAttempts = 3, force = false } = req.body || {};
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url ontbreekt' });
      }
      const requestedPriority = requestedPriorityFromBody(req.body);
      const isExpandedRequest = !hint && isMultiItemUrl(url);

      // Auto-expand: als URL een playlist/kanaal/shorts-tab is, expanden
      // we 'm automatisch naar losse jobs ipv één enkele queue-entry.
      if (isExpandedRequest) {
        try {
          const result = await expandAndEnqueue({
            repo, queue, adapters, url, priority: requestedPriority, options, maxAttempts, force,
          });
          return res.status(201).json({ expanded: true, ...result });
        } catch (e) {
          if (e && e.httpStatus === 400) return res.status(400).json({ error: e.message });
          // Bij expand-fout: fallthrough naar single-job behandeling hieronder
          // als fallback, zodat minstens de hoofd-video in de queue komt.
        }
      }

      const job = await enqueueOneUrl({
        url, hint, options, maxAttempts, force, requestedPriority,
      });
      res.status(job.duplicate ? 200 : 201).json(job);
    } catch (e) {
      if (e && e.httpStatus) return res.status(e.httpStatus).json({ error: e.message });
      next(e);
    }
  });

  // ─── Batch enqueue ──────────────────────────────────────────────────────────
  r.post('/batch', async (req, res, next) => {
    try {
      const { adapter: hint, options = {}, metadata = {}, maxAttempts = 3, force = false } = req.body || {};
      const urls = uniqueUrls(req.body && req.body.urls);
      if (!urls.length) return res.status(400).json({ error: 'urls ontbreekt' });
      const requestedPriority = requestedPriorityFromBody(req.body);
      const batchOptions = {
        ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
        ...(options && typeof options === 'object' && !Array.isArray(options) ? options : {}),
      };
      const results = await mapWithConcurrency(urls, 8, async (url) => {
        try {
          const job = await enqueueOneUrl({
            url,
            hint,
            options: batchOptions,
            maxAttempts,
            force,
            requestedPriority,
          });
          return { success: true, url, job, duplicate: !!job.duplicate };
        } catch (e) {
          return { success: false, url, error: String(e.message || e) };
        }
      });
      const queued = results.filter((row) => row.success && !row.duplicate).length;
      const duplicates = results.filter((row) => row.success && row.duplicate).length;
      const errors = results.filter((row) => !row.success).length;
      res.status(201).json({
        success: true,
        total: urls.length,
        queued,
        duplicates,
        errors,
        jobs: results.filter((row) => row.success).map((row) => row.job),
        failed: results.filter((row) => !row.success).slice(0, 50),
      });
    } catch (e) { next(e); }
  });

  // ─── Expand playlist/channel → enqueue individual videos ────────────────────
  r.post('/expand', async (req, res, next) => {
    try {
      const { url, options = {}, maxAttempts = 3, force = false } = req.body || {};
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url ontbreekt' });
      }
      const priority = requestedPriorityFromBody(req.body);
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

  r.get('/meta/stats', async (_req, res, next) => {
    try {
      const [stats, lanes, groups, diagnostics] = await Promise.all([
        repo.getJobStats(),
        repo.getLaneStats(),
        repo.listGroups({ limit: 80 }),
        repo.getQueueDiagnostics(),
      ]);
      res.json({ stats, lanes, groups, diagnostics });
    } catch (e) { next(e); }
  });

  r.get('/group/:groupId', async (req, res, next) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 1500;
      const jobs = await repo.listJobsByGroup(req.params.groupId, { limit });
      res.json({ jobs });
    } catch (e) { next(e); }
  });

  // ─── Job detail ─────────────────────────────────────────────────────────────
  r.get('/:id', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ongeldig ID' });
      const job = await repo.getJob(id);
      if (!job) return res.status(404).json({ error: 'niet gevonden' });
      const [files, logs] = await Promise.all([repo.listFiles(id), repo.listLogs(id, { limit: 100 })]);
      res.json({ job, files, logs });
    } catch (e) { next(e); }
  });

  r.post('/:id/retry', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ongeldig ID' });
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

  r.post('/:id/pause', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ongeldig ID' });
      const j = await queue.pause(id);
      if (!j) return res.status(404).json({ error: 'niet gevonden of niet pauzeerbaar' });
      await repo.appendLog(id, 'info', '⏸️ gepauzeerd');
      res.json(j);
    } catch (e) { next(e); }
  });

  r.post('/:id/resume', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ongeldig ID' });
      const j = await queue.resume(id);
      if (!j) return res.status(404).json({ error: 'niet gevonden of niet hervatbaar' });
      await repo.appendLog(id, 'info', '▶ hervat');
      res.json(j);
    } catch (e) { next(e); }
  });

  r.post('/:id/priority', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const priority = Number(req.body && req.body.priority);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ongeldig ID' });
      if (!Number.isFinite(priority)) return res.status(400).json({ error: 'priority ontbreekt' });
      const j = await queue.setPriority(id, Math.round(priority));
      if (!j) return res.status(404).json({ error: 'niet gevonden' });
      await repo.appendLog(id, 'info', `prioriteit gezet op ${Math.round(priority)}`);
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

        case 'pause-queued':
          result = await repo.pool.query(
            `UPDATE "${schema}".jobs
                SET lane='paused',
                    options = options || jsonb_build_object('pauseLane', lane, 'paused_at', now()),
                    locked_by=NULL,
                    locked_at=NULL
              WHERE status='queued' AND lane <> 'paused' ${groupFilter}
              RETURNING id`);
          res.json({ action, affected: result.rows.length, ids: result.rows.map(r => r.id) });
          break;

        case 'resume-paused':
          result = await repo.pool.query(
            `UPDATE "${schema}".jobs
                SET lane = COALESCE(NULLIF(options->>'pauseLane', ''), lane),
                    options = options - 'paused_at' - 'pauseLane'
              WHERE status='queued' AND lane='paused' ${groupFilter}
              RETURNING id`);
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
