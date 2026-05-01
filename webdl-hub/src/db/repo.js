// src/db/repo.js — dunne data-access-laag. Geen business-logica hier.
'use strict';

const { Pool } = require('pg');
const config = require('../config');

const VALID_SCHEMA = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// Lane classifier: bepaalt concurrency-bucket.
//  - 'process-video': video + ffmpeg merge / zware sessie-adapters,
//    max 1 tegelijk wegens zware CPU (ffmpeg-merge + transcodes)
//  - 'video':         directe video download zonder merge
//  - 'image':         images/attachments (netwerk-bound)
const IMAGE_URL_RE = /\.(jpe?g|png|webp|gif|avif|bmp|tiff?)(\?|$)/i;
const DIRECT_VIDEO_RE = /\.(mp4|webm|mkv|mov|m4v|avi|flv|ts)(\?|$)/i;
const MERGE_VIDEO_HOSTS = [
  'youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv',
  'reddit.com', 'redd.it', 'v.redd.it',
  'streamable.com', 'bitchute.com', 'rumble.com',
];

function isTikTokHost(host) {
  return host === 'tiktok.com' || host.endsWith('.tiktok.com');
}

function isDirectTikTokVideo(pathname) {
  return /^\/@[^/]+\/video\/\d+\/?$/i.test(pathname);
}

function classifyLane(url, adapter) {
  const u = String(url || '').toLowerCase();
  if (adapter === 'slave-delegate') {
    // Slave-delegated hosts are handled by simple-server; in the hub they
    // should be grouped with lightweight media, not shown as video work.
    return 'image';
  }
  if (IMAGE_URL_RE.test(u)) return 'image';
  if (adapter === 'gallerydl' || adapter === 'reddit-dl') {
    // gallery-dl/reddit-dl zijn meestal images; videos in deze flow zijn zeldzaam.
    return 'image';
  }
  if (adapter === 'ofscraper') {
    // ofscraper gebruikt een gedeeld profiel/cache; parallelle runs raken elkaar.
    return 'process-video';
  }
  if (adapter === 'instaloader' || adapter === 'tdl') {
    // Deze adapters downloaden mixed content; default naar video-lane (geen ffmpeg merge).
    return 'video';
  }
  if (DIRECT_VIDEO_RE.test(u)) return 'video';
  // Alleen bekende merge-/sessie-zware hosts blokkeren de zware lane.
  // Andere yt-dlp hosts (zoals directe tube sites) mogen parallel in video.
  if (adapter === 'ytdlp') {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, '');
      if (isTikTokHost(host)) {
        return isDirectTikTokVideo(parsed.pathname) ? 'video' : 'process-video';
      }
      if (MERGE_VIDEO_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
        return 'process-video';
      }
    } catch (_) {}
    return 'video';
  }
  return 'video';
}

function normalizeJobOptionsForUrl(url, options = {}) {
  const normalized = options && typeof options === 'object' && !Array.isArray(options)
    ? { ...options }
    : {};
  const jobUrl = String(url || '').trim();
  const optionUrl = String(normalized.url || '').trim();

  if (optionUrl && jobUrl && optionUrl !== jobUrl) {
    if (!normalized.contextUrl && !normalized.pageUrl) normalized.contextUrl = optionUrl;
    delete normalized.url;
  }

  return normalized;
}

function createRepo({ databaseUrl = config.databaseUrl, schema = config.dbSchema } = {}) {
  if (!VALID_SCHEMA.test(schema)) {
    throw new Error(`Ongeldige schema-naam: "${schema}"`);
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const T = {
    jobs:  `"${schema}".jobs`,
    files: `"${schema}".files`,
    logs:  `"${schema}".logs`,
  };

  const query = (text, params) => pool.query(text, params);
  const close = () => pool.end();

  async function ping() {
    const { rows } = await query('SELECT 1 AS ok');
    return rows[0].ok === 1;
  }

  async function createJob({ url, adapter, priority = 0, options = {}, maxAttempts = 3, lane = null }) {
    const finalLane = lane || classifyLane(url, adapter);
    const finalOptions = normalizeJobOptionsForUrl(url, options);
    const { rows } = await query(
      `INSERT INTO ${T.jobs} (url, adapter, status, priority, options, max_attempts, lane)
       VALUES ($1, $2, 'queued', $3, $4::jsonb, $5, $6)
       RETURNING *`,
      [url, adapter, priority, JSON.stringify(finalOptions), maxAttempts, finalLane],
    );
    return rows[0];
  }

  async function getJob(id) {
    const { rows } = await query(`SELECT * FROM ${T.jobs} WHERE id = $1`, [id]);
    return rows[0] || null;
  }

  async function findRecentJobByUrl(url, { statuses = ['queued', 'running', 'done'] } = {}) {
    const { rows } = await query(
      `SELECT * FROM ${T.jobs}
        WHERE url = $1 AND status = ANY($2::text[])
        ORDER BY id DESC
        LIMIT 1`,
      [url, statuses],
    );
    return rows[0] || null;
  }

  async function listJobs({ status, limit = 100, offset = 0 } = {}) {
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE status = $${params.length}`;
    }
    params.push(limit, offset);
    const { rows } = await query(
      `SELECT * FROM ${T.jobs} ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows;
  }

  async function claimNextJob(workerId, { lane = null } = {}) {
    const laneFilter = lane ? 'AND lane = $2' : '';
    const params = lane ? [workerId, lane] : [workerId];
    const { rows } = await query(
      `UPDATE ${T.jobs}
          SET status     = 'running',
              attempts   = attempts + 1,
              locked_by  = $1,
              locked_at  = now(),
              started_at = COALESCE(started_at, now()),
              finished_at = NULL,
              error = NULL
        WHERE id = (
          SELECT id FROM ${T.jobs}
           WHERE status = 'queued' ${laneFilter}
             AND attempts < max_attempts
             AND adapter <> 'slave-delegate'
           ORDER BY priority DESC, created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING *`,
      params,
    );
    return rows[0] || null;
  }

  async function completeJob(id) {
    const { rows } = await query(
      `UPDATE ${T.jobs}
          SET status = 'done', progress_pct = 100, finished_at = now(),
              locked_by = NULL, locked_at = NULL, error = NULL
        WHERE id = $1
        RETURNING *`,
      [id],
    );
    return rows[0] || null;
  }

  async function failJob(id, errorMsg, { retry = false } = {}) {
    const nextStatus = retry ? 'queued' : 'failed';
    const { rows } = await query(
      `UPDATE ${T.jobs}
          SET status    = $2,
              error     = $3,
              locked_by = NULL,
              locked_at = NULL,
              finished_at = CASE WHEN $2 = 'failed' THEN now() ELSE finished_at END
        WHERE id = $1
        RETURNING *`,
      [id, nextStatus, errorMsg],
    );
    return rows[0] || null;
  }

  async function cancelJob(id) {
    const { rows } = await query(
      `UPDATE ${T.jobs}
          SET status = 'cancelled', finished_at = now(),
              locked_by = NULL, locked_at = NULL
        WHERE id = $1 AND status IN ('queued','running')
        RETURNING *`,
      [id],
    );
    return rows[0] || null;
  }

  async function updateProgress(id, pct) {
    await query(`UPDATE ${T.jobs} SET progress_pct = $2 WHERE id = $1`, [id, pct]);
  }

  async function addFile(jobId, { path: filePath, size = null, mime = null, checksum = null }) {
    const { rows } = await query(
      `INSERT INTO ${T.files} (job_id, path, size, mime, checksum)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [jobId, filePath, size, mime, checksum],
    );
    return rows[0];
  }

  async function listFiles(jobId) {
    const { rows } = await query(
      `SELECT * FROM ${T.files} WHERE job_id = $1 ORDER BY id`,
      [jobId],
    );
    return rows;
  }

  async function appendLog(jobId, level, msg) {
    await query(`INSERT INTO ${T.logs} (job_id, level, msg) VALUES ($1, $2, $3)`, [jobId, level, msg]);
  }

  async function listLogs(jobId, { limit = 200 } = {}) {
    const { rows } = await query(
      `SELECT * FROM ${T.logs} WHERE job_id = $1 ORDER BY ts DESC LIMIT $2`,
      [jobId, limit],
    );
    return rows;
  }

  async function truncateAll() {
    await query(`TRUNCATE ${T.logs}, ${T.files}, ${T.jobs} RESTART IDENTITY CASCADE`);
  }

  async function markGallerySynced(jobId) {
    await query(
      `UPDATE ${T.jobs} SET options = COALESCE(options, '{}'::jsonb) || '{"gallery_synced": true}'::jsonb WHERE id = $1`,
      [jobId],
    );
  }

  return {
    pool, schema, close, ping,
    createJob, getJob, findRecentJobByUrl, listJobs,
    claimNextJob, completeJob, failJob, cancelJob, updateProgress,
    addFile, listFiles, appendLog, listLogs,
    truncateAll, markGallerySynced,
  };
}

module.exports = { createRepo, classifyLane };
