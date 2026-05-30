#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/webdl';
const DB_SCHEMA = process.env.DB_SCHEMA || 'webdl';
const DOWNLOAD_ROOT = process.env.DOWNLOAD_ROOT || '/Volumes/WEBDL Extra/WEBDL/_4KDownloader/hub';
const POLL_MS = Math.max(500, Number(process.env.WEBDL_LIVE_GALLERY_SYNC_MS || 3000));
const MIN_AGE_MS = Math.max(0, Number(process.env.WEBDL_LIVE_GALLERY_MIN_AGE_MS || 1500));
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.m4v', '.avi', '.wmv', '.flv', '.ts', '.m2ts', '.mpg', '.mpeg', '.ogv', '.3gp', '.3g2']);
const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS]);
const AUX_IMAGE_BASENAME_RE = /(^\d{1,3}[-_. ]?thumbnail|(?:^|[-_. ])thumbnail|_thumb(_v\d+)?|_preview|_logo)\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const SITE_SHELL_IMAGE_BASENAME_RE = /^(?:vipergirls|viper)[-_.]\d+\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const FORUM_CHROME_IMAGE_BASENAME_RE = /(?:^|[-_. ])(?:statusicon|reputation|avatar|button|spacer|blank)(?:[-_. ]|$)/i;
const YTDLP_FORMAT_FRAGMENT_RE = /\.f\d+\.(?:mp4|webm|m4a|mkv|mov|m4v|avi|wmv|flv|ts|m2ts|mpg|mpeg|ogv|3gp|3g2)$/i;
const PARTIAL_MEDIA_BASENAME_RE = /(?:^|[._-])(?:temp|partial|part|download)(?:[._-]|$)/i;
const THUMBNAIL_IMAGE_BASENAME_RE = /\.(?:md|th|thumb|thumbnail|preview|small)\.(?:jpe?g|png|gif|webp|bmp|avif)$/i;

function isAuxiliaryImageBasename(name) {
  return AUX_IMAGE_BASENAME_RE.test(name)
    || SITE_SHELL_IMAGE_BASENAME_RE.test(name)
    || FORUM_CHROME_IMAGE_BASENAME_RE.test(name)
    || THUMBNAIL_IMAGE_BASENAME_RE.test(name);
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
let stopping = false;
let running = false;

function platformFromUrl(rawUrl) {
  try {
    const host = new URL(String(rawUrl || '')).hostname.toLowerCase();
    if (host.includes('vipergirls.to') || host.includes('viper.to')) return 'vipergirls';
    if (host === 't.me' || host.endsWith('.t.me') || host === 'telegram.me' || host.endsWith('.telegram.me')) return 'telegram';
    return host.replace(/^www\./, '').split('.')[0] || 'unknown';
  } catch {
    return 'unknown';
  }
}

function normalizeChaturbateTarget(parts = {}) {
  const haystack = [
    parts.platform,
    parts.channel,
    parts.title,
    parts.filename,
    parts.filepath,
    parts.sourceUrl,
    parts.contextUrl,
  ].filter(Boolean).join(' ').toLowerCase().replace(/[_-]+/g, ' ');
  const isCamSource = /\b(chaturbate|cloudbate|archivebate|xhomealone)\b/.test(haystack);
  if (!isCamSource) return null;
  if (/\bjuliana\s+gonebad\b/.test(haystack)) return { platform: 'chaturbate', channel: 'juliana_gonebad' };
  if (/\bbreeding\s+material\b/.test(haystack)) return { platform: 'chaturbate', channel: 'breeding_material' };
  return null;
}

function threadIdFromUrl(rawUrl) {
  const match = String(rawUrl || '').match(/\/threads\/(\d+)/i);
  return match ? match[1] : '';
}

function titleFromThreadUrl(rawUrl) {
  try {
    const last = String(new URL(String(rawUrl || '')).pathname || '').split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(last.replace(/^\d+-/, '').replace(/[-_]+/g, ' ')).trim();
  } catch {
    const match = String(rawUrl || '').match(/\/threads\/\d+-([^/?#]+)/i);
    return match ? match[1].replace(/[-_]+/g, ' ').trim() : '';
  }
}

function comparableTitle(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\.(?:com|net|org)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isImageUrlLike(input) {
  try {
    const url = new URL(String(input || ''));
    return /\.(?:jpe?g|png|webp|gif|bmp|avif)(?:$|[?#])/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isThreadShellImage(item, job, sourceUrl, title, threadTitle) {
  if (!IMAGE_EXTS.has(item.ext)) return false;
  const stem = path.basename(item.name, item.ext);
  if (!new RegExp(`(?:^|[-_. ])${String(job?.id || '')}$`).test(stem)) return false;
  if (sourceUrl && isImageUrlLike(sourceUrl)) return false;
  const wanted = comparableTitle(threadTitle || titleFromThreadUrl(job?.url));
  const got = comparableTitle(title || stem);
  return Boolean(wanted && got && (got === wanted || got.startsWith(wanted)));
}

function readSidecar(filePath) {
  const candidates = [
    `${filePath}.json`,
    path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}.json`),
    path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}.info.json`),
  ];
  for (const candidate of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      data.__sidecar_path = candidate;
      return data;
    } catch {}
  }
  return {};
}

async function collectMedia(dir) {
  let names = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const now = Date.now();
  const out = [];
  for (const name of names) {
    const filePath = path.join(dir, name);
    const ext = path.extname(name).toLowerCase();
    if (!MEDIA_EXTS.has(ext)) continue;
    if (/\.(part|tmp|ytdl)$/i.test(name)) continue;
    if (YTDLP_FORMAT_FRAGMENT_RE.test(name)) continue;
    if (PARTIAL_MEDIA_BASENAME_RE.test(name)) continue;
    if (isAuxiliaryImageBasename(name)) continue;
    try {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile() || stat.size <= 0 || now - stat.mtimeMs < MIN_AGE_MS) continue;
      out.push({ filePath, name, ext, stat });
    } catch {}
  }
  return out;
}

async function existingPaths(paths) {
  if (!paths.length) return new Set();
  const { rows } = await pool.query('SELECT filepath FROM downloads WHERE filepath = ANY($1::text[])', [paths]);
  return new Set(rows.map((row) => row.filepath));
}

async function syncJob(job) {
  const dir = path.join(DOWNLOAD_ROOT, String(job.id));
  const media = await collectMedia(dir);
  if (!media.length) return 0;

  const existing = await existingPaths(media.map((item) => item.filePath));
  let inserted = 0;
  const opts = job.options || {};
  const threadUrl = opts.contextUrl || job.url || '';
  const threadId = threadIdFromUrl(threadUrl);
  const threadTitle = String(opts.title || opts.channel || titleFromThreadUrl(threadUrl) || '').replace(/^thread_\d+$/i, '').trim();
  const platform = opts.platform || platformFromUrl(threadUrl || job.url);
  const jobIsTelegram = job.adapter === 'tdl' || platform === 'telegram';
  const channel = String(threadTitle || opts.channel || platform || 'unknown').toLowerCase();

  for (const item of media) {
    if (existing.has(item.filePath)) continue;
    const side = readSidecar(item.filePath);
    const sidePlatform = String(side.platform || side.extractor_key || '').toLowerCase();
    const isTelegram = jobIsTelegram || sidePlatform === 'telegram';
    // Telegram media sidecars are written immediately after each download.
    // If live sync sees the media first, wait instead of importing it as
    // platform "t" / channel "+invitehash".
    if (isTelegram && !side.__sidecar_path) continue;

    const sourceUrl = side.post_url || side.webpage_url || side.original_url || side.url || threadUrl || job.url;
    const postId = side.token || (sourceUrl ? String(sourceUrl).split('/').filter(Boolean).pop() : '');
    const title = String(side.fulltitle || side.title || side.filename || path.basename(item.name, item.ext) || threadTitle || '').trim();
    if (isThreadShellImage(item, job, sourceUrl, title, threadTitle)) continue;
    const sourceSite = String(side.category || '').toLowerCase() || null;
    let realPlatform = isTelegram ? 'telegram' : platform;
    let realChannel = isTelegram
      ? String(side.channel || side.telegram_chat_title || opts.channel || 'telegram').trim()
      : channel;
    const chaturbateTarget = normalizeChaturbateTarget({
      platform: realPlatform,
      channel: realChannel,
      title,
      filename: item.name,
      filepath: item.filePath,
      sourceUrl,
      contextUrl: threadUrl || job.url,
    });
    if (!isTelegram && chaturbateTarget) {
      realPlatform = chaturbateTarget.platform;
      realChannel = chaturbateTarget.channel;
    }
    const metadata = {
      hub_job_id: String(job.id),
      adapter: job.adapter,
      source_site: realPlatform === 'vipergirls' ? 'vipergirls' : sourceSite,
      source_thread_title: isTelegram ? (side.telegram_chat_title || side.channel || null) : (threadTitle || null),
      source_thread_id: threadId || null,
      source_thread_url: threadUrl || null,
      source_host: sourceSite,
      source_post_url: sourceUrl || null,
      source_post_id: postId || null,
      source_post_title: title || null,
      telegram_message_id: side.telegram_message_id || null,
      telegram_chat_title: side.telegram_chat_title || null,
      telegram_topic_title: side.telegram_topic_title || null,
      telegram_topic_id: side.telegram_topic_id || null,
      source_graph: {
        nodes: [
          { type: 'host', platform: realPlatform },
          { type: 'thread', id: threadId || null, title: isTelegram ? (side.telegram_chat_title || side.channel || '') : threadTitle || '', url: threadUrl || null },
          { type: 'post', id: postId || null, title: title || '', url: sourceUrl || null },
        ],
      },
      live_partial_import: true,
      imported_from_running_job: true,
      webdl_image_quality: IMAGE_EXTS.has(item.ext) ? 'direct_image' : 'not_image',
      indexed_channel: realChannel,
    };

    let result = { rowCount: 0 };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [item.filePath]);
      const existing = await client.query('SELECT id FROM downloads WHERE filepath = $1 LIMIT 1', [item.filePath]);
      if (existing.rows.length === 0) {
        result = await client.query(
          `INSERT INTO downloads
            (url, platform, channel, title, filename, filepath, filesize, format,
             status, progress, metadata, source_url, duration, created_at, updated_at, finished_at, is_thumb_ready)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                  'completed', 100, $9::jsonb, $10, NULL, now(), now(), now(), false)`,
          [
            sourceUrl || threadUrl || job.url,
            realPlatform,
            realChannel,
            title || threadTitle || item.name,
            item.name,
            item.filePath,
            item.stat.size,
            item.ext.slice(1),
            JSON.stringify(metadata),
            sourceUrl || threadUrl || job.url,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    inserted += result.rowCount || 0;
  }
  return inserted;
}

async function tick() {
  if (running || stopping) return;
  running = true;
  try {
    const { rows: jobs } = await pool.query(
      `SELECT id, url, adapter, options
         FROM ${DB_SCHEMA}.jobs
        WHERE status = 'running'
        ORDER BY id DESC`,
    );
    for (const job of jobs) {
      const inserted = await syncJob(job);
      if (inserted > 0) {
        await pool.query(
          `INSERT INTO ${DB_SCHEMA}.job_logs (job_id, level, msg)
           VALUES ($1, 'info', $2)`,
          [job.id, `live gallery sync: ${inserted} nieuw`],
        ).catch(() => {});
        console.log(new Date().toISOString(), `job ${job.id}: ${inserted} nieuw`);
      }
    }
  } catch (err) {
    console.error(new Date().toISOString(), err && err.stack ? err.stack : err);
  } finally {
    running = false;
  }
}

process.on('SIGTERM', async () => {
  stopping = true;
  await pool.end().catch(() => {});
  process.exit(0);
});
process.on('SIGINT', async () => {
  stopping = true;
  await pool.end().catch(() => {});
  process.exit(0);
});

console.log(new Date().toISOString(), `live gallery sync running; poll=${POLL_MS}ms root=${DOWNLOAD_ROOT}`);
tick();
setInterval(tick, POLL_MS);
