// server.js — webdl-gallery: lichte gallery + viewer server.
// Leest direct uit de PostgreSQL 'downloads' tabel. Geen afhankelijkheid
// van simple-server of webdl-hub — alleen de gedeelde database.
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const express = require('express');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 35731);
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/webdl';
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_BIN || 'ffprobe';

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 8,                         // begrens gallery-load; voorkomt query-stapeling bij meerdere tabs
  idleTimeoutMillis: 30000,       // idle verbindingen na 30s sluiten
  connectionTimeoutMillis: 5000,  // max 5s wachten op verbinding uit pool
  statement_timeout: 30000,       // startup/indexchecks mogen niet afkappen onder IO-load
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store');
  },
}));

const BASE_DIR = process.env.WEBDL_BASE_DIR || '/Users/jurgen/Downloads/WEBDL';

function uniqueExistingDirs(paths) {
  const out = [];
  const seen = new Set();
  for (const raw of paths) {
    const p = String(raw || '').trim();
    if (!p) continue;
    const resolved = path.resolve(p);
    let real = resolved;
    try { real = fs.realpathSync(resolved); } catch (_) {}
    const key = real;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

function discoverVolumeMediaRoots() {
  try {
    return fs.readdirSync('/Volumes', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join('/Volumes', entry.name, 'WEBDL'))
      .filter((root) => {
        try { return fs.statSync(root).isDirectory(); } catch (_) { return false; }
      });
  } catch (_) {
    return [];
  }
}

function parseConfiguredMediaRoots() {
  const raw = [
    process.env.WEBDL_MEDIA_ROOTS,
    process.env.WEBDL_EXTRA_MEDIA_ROOTS,
    process.env.WEBDL_ALLOWED_MEDIA_ROOTS,
  ].filter(Boolean).join(';');
  return raw.split(/[;\n]/).map((p) => p.trim()).filter(Boolean);
}

const MEDIA_ROOTS = uniqueExistingDirs([
  BASE_DIR,
  ...parseConfiguredMediaRoots(),
  ...discoverVolumeMediaRoots(),
]);

function resolveRelativeMediaPath(relPath) {
  for (const root of MEDIA_ROOTS) {
    const candidate = path.resolve(root, relPath);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(BASE_DIR, relPath);
}

function relativeToMediaRoot(filePath) {
  const abs = path.resolve(filePath);
  for (const root of MEDIA_ROOTS) {
    const rel = path.relative(root, abs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  }
  return path.relative(BASE_DIR, abs);
}

const RG_BIN = process.env.RG_BIN || (fs.existsSync('/Applications/Codex.app/Contents/Resources/rg') ? '/Applications/Codex.app/Contents/Resources/rg' : 'rg');
const VIDEO_EXTS = ['mp4','webm','mkv','mov','m4v','avi','wmv','flv','ts','m2ts','mpg','mpeg','ogv','3gp','3g2'];
const IMAGE_EXTS = ['jpg','jpeg','png','gif','webp','avif','bmp'];
const ARCHIVE_EXTS = ['rar','zip','7z','tar','gz','tgz','bz2','xz','cbz','cbr'];
const MEDIA_EXTS = [...VIDEO_EXTS, ...IMAGE_EXTS];
const DOWNLOAD_EXTS = [...MEDIA_EXTS, ...ARCHIVE_EXTS];
const BROWSER_NATIVE_VIDEO_EXTS = new Set(['.mp4', '.webm', '.ogv']);
const THUMB_WIDTH = Math.max(160, Number(process.env.WEBDL_GALLERY_THUMB_WIDTH || 480));
const THUMB_HEIGHT = Math.max(90, Number(process.env.WEBDL_GALLERY_THUMB_HEIGHT || 270));
const THUMB_CONCURRENCY = Math.max(1, Number(process.env.WEBDL_GALLERY_THUMB_CONCURRENCY || 1));
const THUMB_WARM_INTERVAL_MS = Math.max(500, Number(process.env.WEBDL_GALLERY_THUMB_WARM_INTERVAL_MS || 5000));
const THUMB_WARM_BATCH = Math.max(1, Number(process.env.WEBDL_GALLERY_THUMB_WARM_BATCH || 20));
const THUMB_WARM_ENABLED = !/^(0|false|no|off)$/i.test(process.env.WEBDL_GALLERY_THUMB_WARM_ENABLED || '1');
const AUX_RELPATH_RE = String.raw`((^|[\\/])\d{1,3}[-_. ]?thumbnail\.(jpe?g|png|webp|gif|bmp|avif)$|(^|[-_. ])(thumb|thumbnail)\.(jpe?g|png|webp|gif|bmp|avif)$|(^|[-_. ])sample\.(mp4|webm|mkv|mov|m4v|avi|wmv|flv|ts|m2ts|mpg|mpeg|ogv|3gp|3g2)$|_thumb(_v[0-9]+)?\.(jpe?g|png|webp)$|_preview\.(jpe?g|png|webp|gif|bmp|avif)$|\.(json|part|tmp|ytdl)$)`;
const TEMP_RELPATH_RE = String.raw`(^|[\\/])(_UNPACK_|_FAILED_|_ADMIN_|__ADMIN__|incomplete)([^\\/]*)([\\/]|$)`;
const AUX_RELPATH_PATTERN = new RegExp(AUX_RELPATH_RE, 'i');
const TEMP_RELPATH_PATTERN = new RegExp(TEMP_RELPATH_RE, 'i');
const DOWNLOAD_EXT_SQL = DOWNLOAD_EXTS.map(e => `'${e}'`).join(',');
const MEDIA_EXT_SQL = MEDIA_EXTS.map(e => `'${e}'`).join(',');
const IMAGE_EXT_SQL = IMAGE_EXTS.map(e => `'${e}'`).join(',');
const VIDEO_EXT_SQL = VIDEO_EXTS.map(e => `'${e}'`).join(',');
const ACTIVE_DB_STATUSES = ['downloading', 'postprocessing'];
const HIDDEN_GALLERY_STATUSES = ['pending', 'queued', 'downloading', 'postprocessing', 'superseded'];
const HIDDEN_FILE_PARENT_STATUSES = ['pending', 'queued', 'downloading', 'postprocessing', 'cancelled'];
const KEEP2SHARE_DIR = path.join(BASE_DIR, '_Keep2Share');
const JDOWNLOADER_CFG_DIR = process.env.JDOWNLOADER_CFG_DIR || path.join(process.env.HOME || '/Users/jurgen', 'Library/Application Support/JDownloader 2/cfg');
const KEEP2SHARE_SYNC_MS = Number(process.env.KEEP2SHARE_SYNC_MS || 60000);
const KEEP2SHARE_SYNC_MAX_FILES = Number(process.env.KEEP2SHARE_SYNC_MAX_FILES || 5000);
const KEEP2SHARE_SYNC_MAX_ADDS = process.env.KEEP2SHARE_SYNC_MAX_ADDS
  ? Number(process.env.KEEP2SHARE_SYNC_MAX_ADDS)
  : Number.POSITIVE_INFINITY;
const DEBUG_GALLERY_QUERY = /^(1|true|yes|on)$/i.test(process.env.DEBUG_GALLERY_QUERY || '');
const SHOW_SCREENSHOTS_IN_GALLERY = /^(1|true|yes|on)$/i.test(process.env.WEBDL_GALLERY_SHOW_SCREENSHOTS || '');
let keep2shareSyncRunning = false;
const thumbInflight = new Map();
const activeThumbPaths = new Map();
const videoStreamProbeCache = new Map();
let activeThumbJobs = 0;
const thumbQueue = [];
let screenshotSourceColumnsEnsured = false;

function runLimitedThumbJob(fn) {
  return new Promise((resolve, reject) => {
    thumbQueue.push({ fn, resolve, reject });
    drainThumbQueue();
  });
}

function drainThumbQueue() {
  while (activeThumbJobs < THUMB_CONCURRENCY && thumbQueue.length) {
    const job = thumbQueue.shift();
    activeThumbJobs += 1;
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        activeThumbJobs -= 1;
        drainThumbQueue();
      });
  }
}

function collectPartFiles(root, limit = 40) {
  return new Promise((resolve) => {
    const paths = [];
    let buffer = '';
    let settled = false;
    const child = spawn(RG_BIN, ['--files', root], { stdio: ['ignore', 'pipe', 'ignore'] });
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch (_) {}
      resolve(paths);
    };
    const timer = setTimeout(done, 8000);
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (/\.part$/i.test(line)) paths.push(line);
        if (paths.length >= limit) return done();
      }
    });
    child.on('error', done);
    child.on('close', () => {
      if (buffer && /\.part$/i.test(buffer)) paths.push(buffer);
      done();
    });
  });
}

async function ensureSchema() {
  await pool.query('ALTER TABLE download_files ADD COLUMN IF NOT EXISTS rating double precision');
  await ensureScreenshotSourceColumns();
  await pool.query('ALTER TABLE tags ADD COLUMN IF NOT EXISTS is_user boolean NOT NULL DEFAULT false');
  await pool.query('ALTER TABLE tags ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false');
  await pool.query('ALTER TABLE tags ADD COLUMN IF NOT EXISTS user_use_count integer NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE tags ADD COLUMN IF NOT EXISTS last_used_at timestamptz');
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_download_files_gallery_recent
      ON download_files (mtime_ms DESC NULLS LAST, updated_at DESC NULLS LAST, id DESC)
      WHERE relpath IS NOT NULL
        AND relpath <> ''
        AND (filesize IS NULL OR filesize > 0)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS item_user_tags (
      download_id bigint NOT NULL,
      tag_id bigint NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (download_id, tag_id)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS screenshot_user_tags (
      screenshot_id bigint NOT NULL REFERENCES screenshots(id) ON DELETE CASCADE,
      tag_id bigint NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (screenshot_id, tag_id)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tag_recipes (
      id bigserial PRIMARY KEY,
      name text NOT NULL UNIQUE,
      description text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tag_recipe_tags (
      recipe_id bigint NOT NULL REFERENCES tag_recipes(id) ON DELETE CASCADE,
      tag_id integer NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      position integer NOT NULL DEFAULT 0,
      PRIMARY KEY (recipe_id, tag_id)
    )`);
}

async function ensureScreenshotSourceColumns() {
  if (screenshotSourceColumnsEnsured) return;
  await pool.query('ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS source_item_id text');
  await pool.query('ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS source_media_url text');
  await pool.query('ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS source_time_seconds double precision');
  screenshotSourceColumnsEnsured = true;
}

function safeFilenameSegment(value, fallback = 'media') {
  const clean = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w .()[\]-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return clean || fallback;
}

async function ensureSearchIndexes() {
  const statements = [
    'CREATE EXTENSION IF NOT EXISTS pg_trgm',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_downloads_filename_trgm ON downloads USING gin (filename gin_trgm_ops)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_downloads_filepath_trgm ON downloads USING gin (filepath gin_trgm_ops)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_downloads_metadata_trgm ON downloads USING gin (metadata gin_trgm_ops)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_downloads_thumb_ready_recent ON downloads (finished_at DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC) WHERE is_thumb_ready = true',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_downloads_thumb_pending_recent ON downloads (finished_at DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC) WHERE is_thumb_ready = false',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_download_files_relpath_trgm ON download_files USING gin (relpath gin_trgm_ops)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_download_files_thumb_ready_recent ON download_files (mtime_ms DESC NULLS LAST, updated_at DESC NULLS LAST, id DESC) WHERE is_thumb_ready = true',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_download_files_created_oldest ON download_files (created_at ASC NULLS LAST, id ASC) WHERE relpath IS NOT NULL AND relpath <> \'\' AND (filesize IS NULL OR filesize > 0)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_screenshots_title_trgm ON screenshots USING gin (title gin_trgm_ops)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_screenshots_filename_trgm ON screenshots USING gin (filename gin_trgm_ops)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_screenshots_filepath_trgm ON screenshots USING gin (filepath gin_trgm_ops)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_screenshots_thumb_ready_recent ON screenshots (created_at DESC NULLS LAST, updated_at DESC NULLS LAST, id DESC) WHERE is_thumb_ready = true',
  ];
  const client = await pool.connect();
  try {
    await client.query('SET statement_timeout = 0');
    for (const sql of statements) {
      await client.query(sql);
    }
  } finally {
    client.release();
  }
}

function addSearchFilter(where, params, q, columns) {
  params.push('%' + q + '%');
  const param = `$${params.length}`;
  where.push(`(${columns.map((col) => `${col} ILIKE ${param}`).join(' OR ')})`);
}

function sourceSiteSql(alias = 'd') {
  const metadata = `${alias}.metadata`;
  return `NULLIF(COALESCE(
    substring(COALESCE(${metadata}, '') from '"source_site"\\s*:\\s*"([^"]+)"'),
    substring(COALESCE(${metadata}, '') from '"original_site"\\s*:\\s*"([^"]+)"'),
    substring(COALESCE(${metadata}, '') from '"source_context"\\s*:\\s*\\{[^}]*"platform"\\s*:\\s*"([^"]+)"'),
    substring(COALESCE(${metadata}, '') from '"origin_thread"\\s*:\\s*\\{[^}]*"platform"\\s*:\\s*"([^"]+)"')
  ), '')`;
}

function platformGroupSql(alias = 'd') {
  return `CASE
    WHEN LOWER(COALESCE(${alias}.platform, '')) IN ('t', 'telegram') THEN 'telegram'
    WHEN LOWER(COALESCE(${alias}.platform, '')) IN ('k2s', 'k2scc', 'k2s.cc', 'k2s.io', 'keep2share.cc') THEN 'keep2share'
    ELSE COALESCE(NULLIF(${alias}.platform, ''), 'unknown')
  END`;
}

function channelGroupSql(alias = 'd') {
  const sourceSite = sourceSiteSql(alias);
  return `CASE
    WHEN LOWER(COALESCE(${alias}.platform, '')) IN ('sabnzbd', 'keep2share', 'k2s', 'k2scc', 'k2s.cc', 'k2s.io', 'keep2share.cc') AND ${sourceSite} IS NOT NULL
      THEN 'site:' || ${sourceSite}
    ELSE ${alias}.channel
  END`;
}

function archiveExtractedModelTitleSql(downloadAlias = 'd', fileAlias = 'df') {
  const rel = `${fileAlias}.relpath`;
  const archiveStem = `regexp_replace(COALESCE(${downloadAlias}.filename, ''), '\\.[^.]+$', '')`;
  const firstDir = `substring(${rel} from '/archive_extracted/[^/]+/([^/]+)/')`;
  return `CASE
    WHEN ${rel} ~ '/archive_extracted/' THEN
      COALESCE(
        NULLIF(CASE
          WHEN LOWER(COALESCE(${firstDir}, '')) ~ '^(new folder|untitled|leaks?|images?|photos?|pictures?|pics?|videos?|movies?|gif|gifs|set|full|originals?)'
            THEN ''
          ELSE COALESCE(${firstDir}, '')
        END, ''),
        NULLIF(${archiveStem}, '')
      )
    ELSE NULL
  END`;
}

function fileChannelSql(downloadAlias = 'd', fileAlias = 'df') {
  return `COALESCE(NULLIF(${archiveExtractedModelTitleSql(downloadAlias, fileAlias)}, ''), ${channelGroupSql(downloadAlias)})`;
}

function inferArchiveExt(row) {
  const haystack = [
    row && row.format,
    row && row.filename,
    row && row.filepath,
    row && row.url,
    row && row.source_url,
    row && row.metadata,
  ].map((v) => String(v || '').toLowerCase()).join(' ');
  const extMatch = haystack.match(/(?:^|[/?#&=._ -])(rar|zip|7z|tar|gz|tgz|bz2|xz|cbz|cbr)(?:$|[?#&._ -])/i);
  if (extMatch) return extMatch[1].toLowerCase();
  if (haystack.includes('application%2fx-rar') || haystack.includes('application/x-rar') || haystack.includes('x-rar-compressed')) return 'rar';
  if (haystack.includes('application%2fzip') || haystack.includes('application/zip')) return 'zip';
  if (haystack.includes('application%2fx-7z') || haystack.includes('application/x-7z')) return '7z';
  return '';
}

function fileExt(filePath, format, row = null) {
  const explicit = String(format || '').trim().toLowerCase();
  if (explicit) return explicit;
  const fromPath = path.extname(filePath || '').replace('.', '').toLowerCase();
  return fromPath || inferArchiveExt(row);
}

function platformFromUrl(url) {
  const value = String(url || '').toLowerCase();
  if (value.includes('tiktok.com')) return 'tiktok';
  if (value.includes('youtube.com') || value.includes('youtu.be')) return 'youtube';
  if (value.includes('t.me') || value.includes('telegram.me')) return 'telegram';
  if (value.includes('instagram.com')) return 'instagram';
  if (value.includes('reddit.com') || value.includes('redd.it')) return 'reddit';
  if (value.includes('vipergirls.to') || value.includes('viper.to')) return 'vipergirls';
  if (value.includes('footfetishforum.com') || value.includes('flc.nyc3.digitaloceanspaces.com')) return 'footfetishforum';
  if (value.includes('redgifs.com') || value.includes('gifdeliverynetwork.com')) return 'redgifs';
  if (value.includes('x.com') || value.includes('twitter.com')) return 'twitter';
  if (value.includes('keep2share') || value.includes('k2s.cc')) return 'keep2share';
  return '';
}

function thumbnailFromHubJob(row) {
  const opts = row && row.options ? row.options : {};
  const direct = String(opts.thumbnail || opts.thumbnail_url || opts.thumb_url || '').trim();
  if (/^https?:\/\//i.test(direct)) return direct;
  const rawUrl = String(opts.url || row.url || '').trim();
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const videoId = host === 'youtu.be'
      ? u.pathname.split('/').filter(Boolean)[0]
      : u.searchParams.get('v');
    if ((host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) && videoId) {
      return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
    }
  } catch (_) {}
  return '';
}

function workLaneFromHubLane(lane) {
  switch (String(lane || '')) {
    case 'image':
    case 'gallery':
      return 'Fast';
    case 'video':
      return 'Middle';
    case 'process-video':
      return 'Heavy';
    default:
      return lane || 'Hub';
  }
}

function normalizeSourceSiteLabel(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^www\./, '');
  if (!raw) return '';
  if (raw === 't' || raw === 'telegram' || raw === 't.me' || raw === 'telegram.me' || raw.endsWith('.t.me') || raw.endsWith('.telegram.me')) return 'telegram';
  if (raw === 'vipergirls.to' || raw === 'viper.to' || raw.endsWith('.vipergirls.to') || raw.endsWith('.viper.to')) return 'vipergirls';
  if (raw === 'footfetishforum' || raw === 'footfetishforum.com' || raw.endsWith('.footfetishforum.com')) return 'footfetishforum';
  if (raw === 'youtube.com' || raw === 'youtu.be' || raw.endsWith('.youtube.com')) return 'youtube';
  if (raw === 'twitter.com' || raw === 'x.com' || raw.endsWith('.twitter.com') || raw.endsWith('.x.com')) return 'twitter';
  if (raw === 'reddit.com' || raw === 'redd.it' || raw.endsWith('.reddit.com')) return 'reddit';
  if (raw === 'keep2share.cc' || raw === 'k2s.cc' || raw === 'k2s.io' || raw.endsWith('.keep2share.cc') || raw.endsWith('.k2s.cc') || raw.endsWith('.k2s.io')) return 'keep2share';
  return raw;
}

function sourceSiteFromMetadata(metadata, sourceUrl) {
  try {
    const parsed = metadata && typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    if (parsed && typeof parsed === 'object') {
      let contextHost = '';
      try {
        contextHost = parsed.source_context?.url
          ? new URL(String(parsed.source_context.url)).hostname.replace(/^www\./i, '').toLowerCase()
          : '';
      } catch (_) {}
      let originHost = '';
      try {
        originHost = parsed.origin_thread?.url
          ? new URL(String(parsed.origin_thread.url)).hostname.replace(/^www\./i, '').toLowerCase()
          : '';
      } catch (_) {}
      const fromMetadata = normalizeSourceSiteLabel(
        parsed.source_site
        || parsed.original_site
        || (Array.isArray(parsed.source_sites) ? parsed.source_sites[0] : '')
        || contextHost
        || parsed.source_context?.platform
        || parsed.origin_thread?.platform
        || originHost
        || ''
      );
      if (fromMetadata) return fromMetadata;
    }
  } catch (_) {}
  try {
    if (sourceUrl) return normalizeSourceSiteLabel(new URL(String(sourceUrl)).hostname);
  } catch (_) {}
  return '';
}

const CONTENT_SITE_PATTERNS = [
  { label: 'Omegle', re: /\bomeg(?:le|a|e)\b/i },
  { label: 'Chatroulette', re: /\bchatroulette\b/i },
  { label: 'Skype', re: /\bskype\b/i },
  { label: 'Videochat', re: /\bvideo\s*chat\b|\bvideochat\b/i },
  { label: 'Webcam', re: /\bweb\s*cam\b|\bwebcam\b/i },
];

function sourceGraphSummary(parsedMetadata) {
  const graph = parsedMetadata && parsedMetadata.source_graph && typeof parsedMetadata.source_graph === 'object'
    ? parsedMetadata.source_graph
    : null;
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const thread = nodes.find((n) => n && n.type === 'thread') || null;
  const post = nodes.find((n) => n && n.type === 'post') || null;
  const host = nodes.find((n) => n && n.type === 'host') || null;
  const originThread = parsedMetadata?.origin_thread && typeof parsedMetadata.origin_thread === 'object'
    ? parsedMetadata.origin_thread
    : null;
  const postNum = parsedMetadata?.source_post_num || parsedMetadata?.post_num || post?.num || '';
  const postId = parsedMetadata?.source_post_id || parsedMetadata?.post_id || post?.id || '';
  const postTitle = parsedMetadata?.source_post_title || parsedMetadata?.post_title || (post && post.title) || '';
  return {
    source_thread_title: parsedMetadata?.source_thread_title || parsedMetadata?.thread_title || (thread && thread.title) || originThread?.title ? String(parsedMetadata?.source_thread_title || parsedMetadata?.thread_title || (thread && thread.title) || originThread.title) : '',
    source_thread_url: parsedMetadata?.source_thread_url || (thread && thread.url) || originThread?.url ? String(parsedMetadata?.source_thread_url || (thread && thread.url) || originThread.url) : '',
    source_post_title: postTitle ? String(postTitle) : '',
    source_post_num: postNum ? String(postNum) : '',
    source_post_id: postId ? String(postId) : '',
    source_post_url: parsedMetadata?.source_post_url || (post && post.url) ? String(parsedMetadata?.source_post_url || post.url) : '',
    source_host: host && host.platform ? normalizeSourceSiteLabel(host.platform) : originThread?.platform ? normalizeSourceSiteLabel(originThread.platform) : '',
  };
}

function sourceModelTitleFromText(value) {
  let title = String(value || '').trim();
  if (!title) return '';
  title = title
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const stripPatterns = [
    /(?:[._ -])p(?:[._ -])?\d{1,5}[a-z]?$/i,
    /(?:[._ -])(?:img|image|pic|photo)(?:[._ -])?\d{1,5}[a-z]?$/i,
    /(?:[._ -])\d{1,5}[a-z]?$/i,
  ];
  for (const re of stripPatterns) {
    const stripped = title.replace(re, '').trim();
    if (stripped && stripped !== title) return stripped;
  }
  return title;
}

function sourceModelKeyFromTitle(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/^-+|-+$/g, '');
}

function cleanArchiveModelSegment(value) {
  return String(value || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function archiveExtractedInfoForRow(row) {
  const rel = String(row?.filepath || '').replace(/\\/g, '/');
  const marker = '/archive_extracted/';
  const pos = rel.indexOf(marker);
  if (pos < 0) return null;
  const parts = rel.slice(pos + marker.length).split('/').filter(Boolean);
  if (!parts.length) return null;
  const extractDir = parts[0] || '';
  const firstFolder = parts.length > 2 ? cleanArchiveModelSegment(parts[1]) : '';
  const archiveStem = cleanArchiveModelSegment(extractDir.replace(/_\d+$/, '') || row?.filename || '');
  const genericFolder = /^(new folder|untitled|leaks?|images?|photos?|pictures?|pics?|videos?|movies?|gif|gifs|set|full|originals?)(?:\s*\(\d+\))?$/i;
  const modelTitle = firstFolder && !genericFolder.test(firstFolder)
    ? firstFolder
    : archiveStem;
  return {
    archive_stem: archiveStem,
    extract_dir: extractDir,
    model_title: modelTitle || archiveStem || '',
  };
}

function usefulModelTitleFromFilename(filename) {
  const stem = sourceModelTitleFromText(filename || '');
  if (!stem) return '';
  const compact = stem.replace(/[\s._-]+/g, '');
  if (!compact || compact.length < 3) return '';
  if (/^(img|image|pic|photo|video|movie|clip|scene|another|untitled|newfolder)\d*$/i.test(compact)) return '';
  if (/^(img|dsc|dscn|vid|mov|wa|pxl)[\s._-]?\d{3,}/i.test(stem)) return '';
  if (/^\d+[-_][a-f0-9-]{10,}$/i.test(stem)) return '';
  if (/^[a-f0-9-]{12,}$/i.test(stem) && /\d/.test(stem)) return '';
  if (/^[A-Za-z0-9_-]{5,14}$/.test(stem) && /[A-Za-z]/.test(stem) && /\d/.test(stem)) return '';
  return stem;
}

function isOpaqueMediaToken(value) {
  const text = String(value || '').trim();
  if (!text || /\s/.test(text)) return false;
  if (/^\d{12,}(?:_\d+)?$/i.test(text)) return true;
  return /^[A-Za-z0-9_-]{10,}$/.test(text) && /[A-Za-z]/.test(text) && /\d/.test(text);
}

function isVipergirlsMediaTokenTitle(value, row) {
  const text = String(value || '').trim();
  if (!text || /\s/.test(text)) return false;
  if (!/^[A-Za-z0-9_-]{5,24}$/.test(text) || !/[A-Za-z]/.test(text) || !/\d/.test(text)) return false;
  const haystack = [
    row && row.url,
    row && row.source_url,
    row && row.filepath,
    row && row.filename,
    row && row.metadata,
  ].map((v) => String(v || '').toLowerCase()).join(' ');
  return /\b(?:imx\.to|imgbox\.com|vipr\.im|imagebam\.com|pixhost\.to|imagetwist\.com|imgspice\.com|imagevenue\.com)\b/i.test(haystack);
}

function titleFromVipergirlsThreadUrl(value) {
  try {
    const u = new URL(String(value || ''));
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== 'vipergirls.to' && host !== 'viper.to') return '';
    const m = u.pathname.match(/\/threads\/\d+-([^/?#]+)/i);
    if (!m || !m[1]) return '';
    return decodeURIComponent(m[1]).replace(/[-_]+/g, ' ').trim();
  } catch (_) {
    return '';
  }
}

function sourceModelTitleForRow(row, graphSummary, sourceSite, filename) {
  const archiveInfo = archiveExtractedInfoForRow(row);
  if (archiveInfo && archiveInfo.model_title) return archiveInfo.model_title;
  const site = String(sourceSite || row?.platform || '').toLowerCase();
  const rowTitle = String(row?.title || '').trim();
  const threadTitle = String(graphSummary?.source_thread_title || '').trim();
  if (row?.item_kind === 'file' && (site === 'vipergirls' || site.includes('viper'))) {
    const fileModel = usefulModelTitleFromFilename(filename || row?.filename || row?.filepath || '');
    if (!rowTitle || !threadTitle || rowTitle === threadTitle || /icloud leaks/i.test(rowTitle)) return fileModel || '';
  }
  if (row?.item_kind === 'screenshot' && /^screenshot\b/i.test(rowTitle)) return '';
  const postTitle = sourceModelTitleFromText(graphSummary?.source_post_title || '');
  if (postTitle && !isOpaqueMediaToken(postTitle)) return postTitle;
  if (site === 'twitter' || site === 'x' || site.includes('twitter')) return '';
  const fallback = sourceModelTitleFromText(row?.title || filename || '');
  return isOpaqueMediaToken(fallback) || isVipergirlsMediaTokenTitle(fallback, row) ? '' : fallback;
}

function contentSitesFromRow(row, parsedMetadata) {
  const graph = parsedMetadata && parsedMetadata.source_graph && typeof parsedMetadata.source_graph === 'object'
    ? parsedMetadata.source_graph
    : null;
  const graphText = graph
    ? JSON.stringify((Array.isArray(graph.nodes) ? graph.nodes : []).map((n) => ({
      title: n && n.title,
      url: n && n.url,
      platform: n && n.platform,
    })))
    : '';
  const haystack = [
    row.title,
    row.filename,
    row.channel,
    row.url,
    row.source_url,
    row.filepath,
    graphText,
  ].map((v) => String(v || '')).join(' ');
  return CONTENT_SITE_PATTERNS
    .filter((entry) => entry.re.test(haystack))
    .map((entry) => entry.label);
}

function galleryTypeForExt(ext) {
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (ARCHIVE_EXTS.includes(ext)) return 'archive';
  return 'download';
}

function mapItem(row) {
  const ext = fileExt(row.filepath, row.format, row);
  const filename = row.filename || path.basename(row.filepath || '');
  const durationText = row.duration == null ? null : String(row.duration);
  const durationSeconds = parseDurationSeconds(durationText);
  const sourceSite = sourceSiteFromMetadata(row.metadata, row.source_url);
  let parsedMetadata = null;
  try { parsedMetadata = row.metadata && typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata; } catch (_) { parsedMetadata = null; }
  const sourceSites = Array.isArray(parsedMetadata?.source_sites) ? parsedMetadata.source_sites.slice() : [];
  if (sourceSite && !sourceSites.some((s) => String(s || '').toLowerCase() === sourceSite.toLowerCase())) sourceSites.unshift(sourceSite);
  const graphSummary = sourceGraphSummary(parsedMetadata);
  const sourceUrl = graphSummary.source_post_url || row.source_url || row.url || '';
  const sourceModelTitle = sourceModelTitleForRow(row, graphSummary, sourceSite, filename);
  const sourceModelKey = sourceModelKeyFromTitle(sourceModelTitle);
  const threadTitle = graphSummary.source_thread_title
    || parsedMetadata?.origin_thread?.title
    || parsedMetadata?.source_context?.title
    || titleFromVipergirlsThreadUrl(row.source_url || row.url);
  const rowTitle = String(row.title || '').trim();
  const displayTitle = graphSummary.source_post_title
    && (String(sourceSite || '').toLowerCase() === 'twitter' || isOpaqueMediaToken(rowTitle))
    ? graphSummary.source_post_title
    : row.item_kind === 'file' && archiveExtractedInfoForRow(row)?.model_title
      ? archiveExtractedInfoForRow(row).model_title
    : row.item_kind === 'file' && sourceModelTitle && sourceModelTitle !== threadTitle
      ? sourceModelTitle
    : String(row.platform || '').toLowerCase() === 'vipergirls' && threadTitle && (isOpaqueMediaToken(rowTitle) || isVipergirlsMediaTokenTitle(rowTitle, row) || /^[0-9_]+$/.test(rowTitle) || isKnownGalleryJunkRow(row))
      ? threadTitle
      : row.title;
  return {
    ...row,
    source_url: sourceUrl,
    id: String(row.id),
    rating_id: row.rating_id || row.id,
    title: displayTitle,
    filename,
    ext,
    type: galleryTypeForExt(ext),
    duration: durationText,
    duration_seconds: durationSeconds,
    source_site: sourceSite || null,
    source_sites: sourceSites,
    source_thread_title: graphSummary.source_thread_title || null,
    source_thread_url: graphSummary.source_thread_url || null,
    source_post_title: graphSummary.source_post_title || null,
    source_post_num: graphSummary.source_post_num || null,
    source_post_id: graphSummary.source_post_id || null,
    source_post_url: graphSummary.source_post_url || null,
    source_model_title: sourceModelTitle || null,
    source_model_key: sourceModelKey || null,
    source_host: graphSummary.source_host || null,
    content_sites: contentSitesFromRow(row, parsedMetadata),
  };
}

function cleanTagName(value) {
  return String(value || '')
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function cleanRecipeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function cleanRecipeDescription(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 300);
}

function parseMetadataObject(value) {
  try {
    if (!value) return null;
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch (_) {
    return null;
  }
}

function isJunkTagName(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!name) return true;
  if (/\s+#/.test(name) || name.includes('. #')) return true;
  if (/^[0-9]+$/.test(name)) return true;
  if (/\.(jpe?g|png|gif|webp|mp4|mov|mkv|webm)$/i.test(name)) return true;
  if (/(^|[-_])(jpe?g|png|gif|webp|mp4|mov|mkv|webm)$/i.test(name)) return true;
  if (/^[a-f0-9]{6,}$/i.test(name) && /\d/.test(name)) return true;
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(name)) return true;
  if (/^[-_][a-z0-9_-]{6,}$/i.test(name)) return true;
  if (/^\d{4}-\d{2}-\d{2}/.test(name)) return true;
  return false;
}

function hasNonEmptyMedia(row) {
  const size = row.filesize == null ? null : Number(row.filesize);
  return !Number.isFinite(size) || size > 0;
}

const KNOWN_BAD_IMAGE_HASHES = new Set([
  // Imagetwist hotlink placeholder: "Hotlinking is disabled. Use forum/html code..."
  '95e05a93e49bf6684bb61d893653b12a',
]);

function isKnownGalleryJunkRow(row) {
  const text = [
    row && row.title,
    row && row.filename,
    row && row.filepath,
    row && row.url,
    row && row.source_url,
  ].map((v) => String(v || '').toLowerCase()).join(' ');
  if (/(^|[\/_.-])(?:user-online|user-offline|statusicon|reputation(?:_pos)?|spacer|blank|button)(?:[\/_.-]|$)/i.test(text)) return true;
  if (/(^|[\/_.-])(?:imagebam_light|imagebam_dark|imagebam_logo|logo-imagebam)(?:[\/_.-]|$)/i.test(text)) return true;
  if (/\bthumbs\d*\.imagebam\.com\b/i.test(text)) return true;
  if (/\bimagebam\.com\b/i.test(text) && /\/[^\/\s?#]+_t\.(?:jpe?g|png|gif|webp)(?:$|[\s?#])/i.test(text)) return true;
  return false;
}

function parsedRowMetadata(row) {
  try {
    const meta = row && row.metadata;
    if (!meta) return null;
    return typeof meta === 'string' ? JSON.parse(meta) : meta;
  } catch (_) {
    return null;
  }
}

function rowReferencesImxThumbnail(row) {
  const meta = parsedRowMetadata(row);
  const values = [
    row && row.url,
    row && row.source_url,
    meta && meta.webdl_input_url,
    meta && meta.webdl_media_url,
    meta && meta.webdl_direct_hint,
    meta && meta.url,
    meta && meta.source_url,
    meta && meta.final_url,
    meta && meta.resolved_url,
    meta && meta.external_metadata && meta.external_metadata.source_url,
    meta && meta.external_metadata && meta.external_metadata.url,
    meta && meta.external_metadata && meta.external_metadata.final_url,
    meta && meta.external_metadata && meta.external_metadata.resolved_url,
    meta && meta.webdl_external_metadata && meta.webdl_external_metadata.source_url,
    meta && meta.webdl_external_metadata && meta.webdl_external_metadata.url,
    meta && meta.webdl_external_metadata && meta.webdl_external_metadata.final_url,
    meta && meta.webdl_external_metadata && meta.webdl_external_metadata.resolved_url,
  ];
  try {
    if (/https?:\/\/(?:[^/]+\.)?image\.imx\.to\/u\/t\//i.test(JSON.stringify(meta || {}))) return true;
  } catch (_) {}
  return values.some((value) => /https?:\/\/(?:[^/]+\.)?image\.imx\.to\/u\/t\//i.test(String(value || '')));
}

function rowReferencesViprLowQualityImage(row) {
  const meta = parsedRowMetadata(row);
  const values = [
    row && row.url,
    row && row.source_url,
    meta && meta.webdl_input_url,
    meta && meta.webdl_media_url,
    meta && meta.webdl_direct_hint,
    meta && meta.url,
    meta && meta.source_url,
    meta && meta.final_url,
    meta && meta.resolved_url,
  ];
  try {
    if (/https?:\/\/(?:[^/]+\.)?vipr\.im\/i\/[^/]+\/[^/?#]+\.jpe?g\/\d{1,3}\.jpe?g/i.test(JSON.stringify(meta || {}))) return true;
  } catch (_) {}
  return values.some((value) => /https?:\/\/(?:[^/]+\.)?vipr\.im\/i\/[^/]+\/[^/?#]+\.jpe?g\/\d{1,3}\.jpe?g/i.test(String(value || '')));
}

function mediaFileLooksLikeHotlinkPlaceholder(filePath, row) {
  try {
    const ext = fileExt(filePath, row && row.format, row);
    if (!IMAGE_EXTS.includes(ext)) return false;
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size <= 0 || st.size > 32 * 1024) return false;
    const hash = crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
    return KNOWN_BAD_IMAGE_HASHES.has(hash);
  } catch (_) {
    return false;
  }
}

function isAuxMediaPath(value) {
  return AUX_RELPATH_PATTERN.test(String(value || ''));
}

function isTempMediaPath(value) {
  return TEMP_RELPATH_PATTERN.test(String(value || ''));
}

function isGalleryMediaCandidate(row, { requireThumbReady = false } = {}) {
  const ext = fileExt(row.filepath, row.format, row);
  if (!DOWNLOAD_EXTS.includes(ext)) return false;
  if (isKnownGalleryJunkRow(row)) return false;
  if (isTempMediaPath(row.filepath) || isAuxMediaPath(row.filepath)) return false;
  if (ARCHIVE_EXTS.includes(ext)) return false;
  if (requireThumbReady && row.is_thumb_ready !== true && !IMAGE_EXTS.includes(ext)) return false;
  return true;
}

function mediaPathForRow(row) {
  const raw = String(row && row.filepath || '').trim();
  if (!raw) return '';
  return path.isAbsolute(raw) ? raw : resolveRelativeMediaPath(raw);
}

function videoProbeCacheKey(filePath) {
  try {
    const st = fs.statSync(filePath);
    return `${filePath}|${st.size}|${st.mtimeMs}`;
  } catch (_) {
    return `${filePath}|missing`;
  }
}

function rememberVideoProbe(key, value) {
  videoStreamProbeCache.set(key, value);
  if (videoStreamProbeCache.size > 5000) {
    const firstKey = videoStreamProbeCache.keys().next().value;
    if (firstKey) videoStreamProbeCache.delete(firstKey);
  }
}

function hasVideoStream(filePath) {
  if (!filePath || !isVideoFile(filePath)) return Promise.resolve(true);
  const cacheKey = videoProbeCacheKey(filePath);
  if (videoStreamProbeCache.has(cacheKey)) return Promise.resolve(videoStreamProbeCache.get(cacheKey));
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    const finish = (value, cache = true) => {
      if (settled) return;
      settled = true;
      if (cache) rememberVideoProbe(cacheKey, value);
      resolve(value);
    };
    const proc = spawn(FFPROBE_BIN, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      finish(true, false);
    }, 3500);
    proc.stdout.on('data', (buf) => { stdout += String(buf || ''); });
    proc.on('error', () => {
      clearTimeout(timer);
      finish(true, false);
    });
    proc.on('close', () => {
      clearTimeout(timer);
      finish(/\bvideo\b/i.test(stdout));
    });
  });
}

async function rowHasPlayableMedia(row) {
  if (!hasNonEmptyMedia(row)) return false;
  const ext = fileExt(row.filepath, row.format);
  const fp = mediaPathForRow(row);
  if (!fp) return false;
  if (!fs.existsSync(fp)) return false;
  if (isKnownGalleryJunkRow(row) || mediaFileLooksLikeHotlinkPlaceholder(fp, row)) return false;
  if (rowReferencesImxThumbnail(row)) return false;
  if (rowReferencesViprLowQualityImage(row)) return false;
  if (!VIDEO_EXTS.includes(ext)) return true;
  if (row.is_thumb_ready === true) return true;
  return hasVideoStream(fp);
}

async function filterPlayableMediaRows(rows, maxNeeded = rows.length) {
  const out = [];
  const batchSize = 12;
  for (let i = 0; i < rows.length && out.length < maxNeeded; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const keep = await Promise.all(batch.map((row) => rowHasPlayableMedia(row)));
    for (let j = 0; j < batch.length; j += 1) {
      if (keep[j]) out.push(batch[j]);
      if (out.length >= maxNeeded) break;
    }
  }
  return out;
}

function galleryDedupeKey(row) {
  if (String(row.item_kind || '') === 'download') {
    const ext = fileExt(row.filepath, row.format);
    const isVideo = VIDEO_EXTS.includes(ext);
    const exactUrlKey = canonicalGallerySourceUrl(row.url);
    if (exactUrlKey) return `url:${exactUrlKey}`;

    const fileKey = String(row.filepath || '').trim();
    if (fileKey) return `file:${fileKey.toLowerCase()}`;

    if (isVideo) {
      const titleKey = String(row.title || row.filename || '')
        .trim()
        .toLowerCase()
        .replace(/^rt\s+@[a-z0-9_]+:\s*/i, '')
        .replace(/\s+/g, ' ');
      const durationKey = parseDurationSeconds(row.duration) || '';
      const sizeKey = row.filesize == null ? '' : String(row.filesize);
      if (titleKey && (durationKey || sizeKey)) return `video:${titleKey}|${durationKey}|${sizeKey}`;
    }

    const sourceKey = canonicalGallerySourceUrl(row.source_url || row.url);
    if (sourceKey) return `source:${sourceKey}`;
  }

  const fileKey = String(row.filepath || '').trim();
  if (fileKey) return `file:${fileKey.toLowerCase()}`;

  return `${row.item_kind}:${row.id}`;
}

function canonicalGallerySourceUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return '';
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    u.hostname = host;
    u.hash = '';
    if ((host === 'youtube.com' || host.endsWith('.youtube.com')) && u.searchParams.get('v')) {
      return `youtube:${u.searchParams.get('v')}`;
    }
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id) return `youtube:${id}`;
    }
    for (const key of Array.from(u.searchParams.keys())) {
      if (/^(utm_|fbclid$|gclid$|dclid$|yclid$|mc_|promo$|ref$|src$|source$)/i.test(key)) {
        u.searchParams.delete(key);
      }
    }
    const params = Array.from(u.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    for (const [key, val] of params) u.searchParams.append(key, val);
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString().toLowerCase();
  } catch (_) {
    return raw.toLowerCase();
  }
}

function dedupeGalleryRows(rows) {
  const out = [];
  const indexByKey = new Map();
  for (const row of rows) {
    const key = galleryDedupeKey(row);
    const existingIdx = indexByKey.get(key);
    if (existingIdx == null) {
      indexByKey.set(key, out.length);
      out.push(row);
      continue;
    }
    const existing = out[existingIdx];
    const rowHasRating = row.rating != null;
    const existingHasRating = existing && existing.rating != null;
    if (rowHasRating && !existingHasRating) out[existingIdx] = row;
  }
  return out;
}

function parseDurationSeconds(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.max(0, Math.round(Number(text)));
  const parts = text.split(':').map((p) => Number(p));
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const seconds = parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
  return Math.max(0, Math.round(seconds));
}

function isVideoFile(filePath) {
  return VIDEO_EXTS.includes(path.extname(filePath || '').replace('.', '').toLowerCase());
}

function wantsTranscodedPlayback(req, filePath) {
  if (!isVideoFile(filePath)) return false;
  const ext = path.extname(filePath || '').toLowerCase();
  if (req.query.transcode === '1') return true;
  return req.query.play === '1' && !BROWSER_NATIVE_VIDEO_EXTS.has(ext);
}

function streamTranscodedVideo(req, res, filePath) {
  res.status(200);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Accept-Ranges', 'none');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'HEAD') return res.end();

  const ffmpeg = spawn(FFMPEG_BIN, [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', filePath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  ffmpeg.stderr.on('data', (chunk) => {
    if (stderr.length < 4000) stderr += String(chunk || '');
  });
  ffmpeg.stdout.pipe(res);
  const stop = () => {
    if (!ffmpeg.killed) {
      try { ffmpeg.kill('SIGKILL'); } catch (_) {}
    }
  };
  req.on('close', stop);
  res.on('close', stop);
  ffmpeg.on('error', (err) => {
    if (!res.headersSent) res.status(500).send(err.message);
  });
  ffmpeg.on('close', (code) => {
    if (code && code !== 255) {
      console.warn(`transcode playback failed (${code}) ${filePath}: ${stderr.trim()}`);
    }
  });
}

function isImageFile(filePath) {
  return IMAGE_EXTS.includes(path.extname(filePath || '').replace('.', '').toLowerCase());
}

function thumbPathForMedia(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  return path.join(dir, `${base}_thumb_v3.jpg`);
}

async function generateImageThumb(filePath) {
  return null;
}

async function generateVideoThumb(filePath) {
  if (!isVideoFile(filePath)) return null;
  const outPath = thumbPathForMedia(filePath);
  if (fs.existsSync(outPath)) {
    try {
      if (fs.statSync(outPath).size > 8000) return outPath;
    } catch (_) {}
  }
  if (thumbInflight.has(filePath)) return thumbInflight.get(filePath);
  const job = runLimitedThumbJob(async () => {
    for (const seek of ['10', '2', '0.5', '0']) {
      const ok = await new Promise((resolve) => {
        const args = [
          '-y',
          '-hide_banner',
          '-loglevel', 'error',
          '-ss', seek,
          '-i', filePath,
          '-frames:v', '1',
          '-an',
          '-vf', `scale=${THUMB_WIDTH}:${THUMB_HEIGHT}:force_original_aspect_ratio=decrease,pad=${THUMB_WIDTH}:${THUMB_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`,
          '-q:v', '3',
          outPath,
        ];
        const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'ignore'] });
        proc.on('close', () => {
          try {
            if (fs.existsSync(outPath) && fs.statSync(outPath).size > 8000) return resolve(true);
            fs.rmSync(outPath, { force: true });
          } catch (_) {}
          resolve(false);
        });
        proc.on('error', () => resolve(false));
      });
      if (ok) return outPath;
    }
    return null;
  }).finally(() => thumbInflight.delete(filePath));
  thumbInflight.set(filePath, job);
  return job;
}

async function findSiblingImageFallback(filePath) {
  const dir = path.dirname(filePath || '');
  let entries = [];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  const images = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    if (!isImageFile(entry.name)) continue;
    if (/_thumb(_v[0-9]+)?\.(jpe?g|png|webp)$/i.test(entry.name) || /_logo\.(jpe?g|png|webp)$/i.test(entry.name)) continue;
    const candidate = path.join(dir, entry.name);
    let stat = null;
    try { stat = await fs.promises.stat(candidate); } catch (_) { continue; }
    if (!stat.size) continue;
    images.push({
      file: candidate,
      isScreenshot: /^screenshot_.*\.(jpe?g|png|webp)$/i.test(entry.name),
      mtimeMs: stat.mtimeMs,
    });
  }
  images.sort((a, b) => {
    if (a.isScreenshot !== b.isScreenshot) return a.isScreenshot ? -1 : 1;
    return b.mtimeMs - a.mtimeMs;
  });
  return images[0]?.file || null;
}

function findSiblingImageFallbackSync(filePath) {
  const dir = path.dirname(filePath || '');
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return null; }
  const images = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    if (!isImageFile(entry.name)) continue;
    if (/_thumb(_v[0-9]+)?\.(jpe?g|png|webp)$/i.test(entry.name) || /_logo\.(jpe?g|png|webp)$/i.test(entry.name)) continue;
    const candidate = path.join(dir, entry.name);
    let stat = null;
    try { stat = fs.statSync(candidate); } catch (_) { continue; }
    if (!stat.size) continue;
    images.push({
      file: candidate,
      isScreenshot: /^screenshot_.*\.(jpe?g|png|webp)$/i.test(entry.name),
      mtimeMs: stat.mtimeMs,
    });
  }
  images.sort((a, b) => {
    if (a.isScreenshot !== b.isScreenshot) return a.isScreenshot ? -1 : 1;
    return b.mtimeMs - a.mtimeMs;
  });
  return images[0]?.file || null;
}

function parseRecordingFile(filePath, stat) {
  const rel = relativeToMediaRoot(filePath);
  const parts = rel.split(path.sep).filter(Boolean);
  const platform = parts[0] || platformFromUrl(filePath) || 'recording';
  const channel = parts[1] || '';
  const title = parts[2] || path.basename(filePath, path.extname(filePath));
  const id = `recording-${crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 20)}`;
  const thumbPath = findSiblingImageFallbackSync(filePath);
  if (thumbPath) activeThumbPaths.set(id, thumbPath);
  return {
    id,
    source: 'recording',
    status: 'recording',
    platform,
    channel,
    title,
    filename: path.basename(filePath),
    filepath: filePath,
    progress: 50,
    filesize: stat.size,
    updated_at: new Date(stat.mtimeMs).toISOString(),
    created_at: new Date(stat.birthtimeMs || stat.mtimeMs).toISOString(),
    type: 'video',
    thumb_url: thumbPath ? `/active-thumb/${encodeURIComponent(id)}` : '',
  };
}

async function listRecentRawRecordings(limit = 20) {
  const roots = MEDIA_ROOTS.map((root) => path.join(root, 'tiktok')).filter((root, index, arr) => {
    if (arr.indexOf(root) !== index) return false;
    try { return fs.statSync(root).isDirectory(); } catch (_) { return false; }
  });
  const cutoff = Date.now() - 8 * 60 * 1000;
  const files = [];
  await Promise.all(roots.map((root) => new Promise((resolve) => {
    let buffer = '';
    let settled = false;
    const child = spawn(RG_BIN, ['--files', root], { stdio: ['ignore', 'pipe', 'ignore'] });
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch (_) {}
      resolve();
    };
    const timer = setTimeout(done, 5000);
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!/_raw\.mp4$/i.test(line)) continue;
        let stat = null;
        try { stat = fs.statSync(line); } catch (_) { continue; }
        if (!stat.size || stat.mtimeMs < cutoff) continue;
        files.push({ file: line, stat });
      }
    });
    child.on('error', done);
    child.on('close', () => {
      if (buffer && /_raw\.mp4$/i.test(buffer)) {
        try {
          const stat = fs.statSync(buffer);
          if (stat.size && stat.mtimeMs >= cutoff) files.push({ file: buffer, stat });
        } catch (_) {}
      }
      done();
    });
  })));
  files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  const recent = files.slice(0, limit);
  if (!recent.length) return [];
  const lookupPaths = [];
  for (const f of recent) {
    lookupPaths.push(f.file);
    lookupPaths.push(f.file.replace(/_raw\.mp4$/i, '.mp4'));
  }
  const { rows } = await pool.query('SELECT filepath FROM downloads WHERE filepath = ANY($1::text[])', [lookupPaths]);
  const known = new Set(rows.map((r) => r.filepath));
  return recent.filter((f) => {
    if (known.has(f.file)) return false;
    const finalFile = f.file.replace(/_raw\.mp4$/i, '.mp4');
    if (finalFile !== f.file && known.has(finalFile)) return false;
    if (finalFile !== f.file && fs.existsSync(finalFile)) return false;
    return true;
  }).map((f) => parseRecordingFile(f.file, f.stat));
}

function markThumbReady(idRaw) {
  const id = String(idRaw || '');
  if (/^\d+$/.test(id)) {
    pool.query('UPDATE downloads SET is_thumb_ready = true WHERE id = $1', [Number(id)]).catch(() => {});
  } else if (id.startsWith('file-')) {
    pool.query('UPDATE download_files SET is_thumb_ready = true WHERE id = $1', [Number(id.slice(5))]).catch(() => {});
  } else if (id.startsWith('s-')) {
    pool.query('UPDATE screenshots SET is_thumb_ready = true WHERE id = $1', [Number(id.slice(2))]).catch(() => {});
  }
}

function resolveStoredMediaPath(filePath) {
  const value = String(filePath || '');
  if (!value) return '';
  if (path.isAbsolute(value)) return value;
  const resolved = resolveRelativeMediaPath(value);
  if (fs.existsSync(resolved)) return resolved;
  const userPathMatch = value.match(/(?:^|\/)(Users\/.+)$/);
  if (userPathMatch) {
    const absoluteUserPath = path.join('/', userPathMatch[1]);
    if (fs.existsSync(absoluteUserPath)) return absoluteUserPath;
  }
  return resolved;
}

async function warmThumbForItem(item) {
  const id = String(item.id || '');
  const fp = resolveStoredMediaPath(item.filepath);
  if (!id || !fp || !fs.existsSync(fp)) return false;
  if (isImageFile(fp)) {
    markThumbReady(id);
    return true;
  }
  const existing = thumbPathForMedia(fp);
  try {
    if (fs.existsSync(existing) && fs.statSync(existing).size > 1000) {
      markThumbReady(id);
      return true;
    }
  } catch (_) {}
  const generated = isVideoFile(fp) ? await generateVideoThumb(fp) : null;
  if (generated && fs.existsSync(generated)) {
    markThumbReady(id);
    return true;
  }
  return false;
}

let thumbWarmRunning = false;
async function warmThumbBacklog(reason = 'timer') {
  if (thumbWarmRunning) return;
  thumbWarmRunning = true;
  let warmed = 0;
  try {
    const { rows } = await pool.query(`
      SELECT id, filepath
        FROM downloads d
       WHERE d.is_thumb_ready = false
         AND d.filepath IS NOT NULL
         AND d.filepath <> ''
         AND d.status <> ALL($1::text[])
         AND d.filepath !~* $2
         AND lower(COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))) IN (${VIDEO_EXT_SQL})
       ORDER BY d.finished_at DESC NULLS LAST, d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST, d.id DESC
       LIMIT $3`,
      [HIDDEN_GALLERY_STATUSES, TEMP_RELPATH_RE, THUMB_WARM_BATCH],
    );
    await Promise.all(rows.map(async (row) => {
      if (await warmThumbForItem(row)) warmed += 1;
    }));
    if (warmed) console.log(`[thumb-warm] ${warmed} thumb(s) klaar (${reason})`);
  } catch (e) {
    console.warn('[thumb-warm] failed:', e.message);
  } finally {
    thumbWarmRunning = false;
  }
}

async function scanJDownloaderKeep2ShareParts(limit = 40) {
  const root = KEEP2SHARE_DIR;
  const out = [];
  try {
    const paths = await collectPartFiles(root, limit);
    for (const p of paths) {
      let st = null;
      try { st = fs.statSync(p); } catch (_) {}
      const rel = path.relative(root, p);
      const parts = rel.split(path.sep).filter(Boolean);
      const channel = parts.length > 1 ? parts[0] : 'JDownloader';
      const filename = path.basename(p).replace(/\.part$/i, '');
      out.push({
        id: `jd-${out.length + 1}`,
        source: 'jdownloader',
        status: 'downloading',
        platform: 'keep2share',
        channel,
        title: filename,
        filename,
        filepath: p,
        filesize: st ? st.size : 0,
        updated_at: st ? new Date(st.mtimeMs).toISOString() : null,
      });
    }
  } catch (_) {}
  out.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  return out;
}

async function listKeep2ShareMediaFiles() {
  const files = [];
  let channels = [];
  try { channels = await fs.promises.readdir(KEEP2SHARE_DIR, { withFileTypes: true }); } catch (_) { return files; }
  for (const channelEntry of channels) {
    if (!channelEntry.isDirectory() || files.length >= KEEP2SHARE_SYNC_MAX_FILES) continue;
    const channel = channelEntry.name;
    const channelDir = path.join(KEEP2SHARE_DIR, channel);
    let entries = [];
    try { entries = await fs.promises.readdir(channelDir, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.') || files.length >= KEEP2SHARE_SYNC_MAX_FILES) continue;
      const ext = path.extname(entry.name).replace('.', '').toLowerCase();
      if (!VIDEO_EXTS.includes(ext)) continue;
      if (/_thumb(_v[0-9]+)?\.(jpe?g|png|webp)$/i.test(entry.name) || /\.(part|tmp|ytdl)$/i.test(entry.name)) continue;
      const filepath = path.join(channelDir, entry.name);
      let stat = null;
      try { stat = await fs.promises.stat(filepath); } catch (_) { continue; }
      files.push({ channel, filename: entry.name, filepath, ext, filesize: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

function readJDownloaderKeep2ShareFiles() {
  return new Promise((resolve) => {
    const code = String.raw`
import json, os, re, sys, zipfile

base_dir, cfg_dir, max_files = sys.argv[1], sys.argv[2], int(sys.argv[3])
video_exts = {'.mp4', '.webm', '.mkv', '.mov', '.m4v', '.avi', '.flv', '.ts'}

def norm_path(p):
    if not p:
        return p
    try:
        rp = os.path.realpath(p)
        base_rp = os.path.realpath(base_dir)
        if rp == base_rp or rp.startswith(base_rp + os.sep):
            return os.path.join(base_dir, os.path.relpath(rp, base_rp))
    except Exception:
        pass
    return p

try:
    zips = [
        os.path.join(cfg_dir, name)
        for name in os.listdir(cfg_dir)
        if re.match(r'^downloadList\d+\.zip$', name)
    ]
except Exception:
    zips = []

if not zips:
    print('[]')
    raise SystemExit

latest = max(zips, key=lambda p: os.path.getmtime(p))
out = []

with zipfile.ZipFile(latest) as zf:
    names = zf.namelist()
    packages = {}
    for name in names:
        if '_' in name:
            continue
        try:
            data = json.loads(zf.read(name).decode('utf-8', 'replace'))
        except Exception:
            continue
        packages[name] = data

    for name in names:
        if '_' not in name:
            continue
        package_id = name.split('_', 1)[0]
        package = packages.get(package_id) or {}
        try:
            link = json.loads(zf.read(name).decode('utf-8', 'replace'))
        except Exception:
            continue
        host = (link.get('host') or '').lower()
        url = link.get('url') or ''
        if 'k2s' not in host and 'keep2share' not in host and 'k2s.cc' not in url and 'keep2share' not in url:
            continue
        if (link.get('finalLinkState') or '').upper() not in ('FINISHED', 'FINISHED_MIRROR'):
            continue
        props = link.get('properties') or {}
        filename = props.get('FINAL_FILENAME') or link.get('name')
        folder = package.get('downloadFolder')
        if not filename or not folder:
            continue
        ext = os.path.splitext(filename)[1].lower()
        if ext not in video_exts:
            continue
        filepath = norm_path(os.path.join(folder, filename))
        if not os.path.exists(filepath) or filepath.lower().endswith(('.part', '.tmp', '.ytdl')):
            continue
        try:
            stat = os.stat(filepath)
        except Exception:
            continue
        out.append({
            'channel': package.get('name') or os.path.basename(folder) or 'Keep2Share',
            'filename': filename,
            'filepath': filepath,
            'ext': ext[1:],
            'filesize': stat.st_size,
            'mtimeMs': stat.st_mtime * 1000.0,
            'url': url,
            'source_url': url or 'https://keep2share.cc',
            'jdownloaderList': os.path.basename(latest),
        })
        if len(out) >= max_files:
            break

out.sort(key=lambda x: x.get('mtimeMs') or 0, reverse=True)
print(json.dumps(out))
`;
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn('python3', ['-c', code, BASE_DIR, JDOWNLOADER_CFG_DIR, String(KEEP2SHARE_SYNC_MAX_FILES)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const done = (items) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch (_) {}
      resolve(items);
    };
    const timer = setTimeout(() => done([]), 8000);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', () => done([]));
    child.on('close', () => {
      try {
        const parsed = JSON.parse(stdout || '[]');
        done(Array.isArray(parsed) ? parsed : []);
      } catch (e) {
        if (stderr) console.warn('[keep2share-sync] JDownloader read failed:', stderr.trim().slice(0, 500));
        done([]);
      }
    });
  });
}

async function listKeep2ShareSyncFiles() {
  const byPath = new Map();
  for (const file of await listKeep2ShareMediaFiles()) byPath.set(file.filepath, file);
  const jdFiles = await readJDownloaderKeep2ShareFiles();
  for (const file of jdFiles) {
    const existing = byPath.get(file.filepath) || {};
    byPath.set(file.filepath, { ...existing, ...file });
  }
  return [...byPath.values()].sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
}

async function syncKeep2ShareFiles(reason = 'timer') {
  if (keep2shareSyncRunning) return { added: 0, skipped: 0, running: true };
  keep2shareSyncRunning = true;
  let added = 0;
  let skipped = 0;
  try {
    const files = await listKeep2ShareSyncFiles();
    for (const file of files) {
      if (Number.isFinite(KEEP2SHARE_SYNC_MAX_ADDS) && added >= KEEP2SHARE_SYNC_MAX_ADDS) break;
      const title = path.basename(file.filename, path.extname(file.filename));
      const { rowCount } = await pool.query(`
        INSERT INTO downloads
          (url, status, platform, channel, title, filename, filepath, filesize, format, source_url, created_at, updated_at, finished_at)
        SELECT $1, 'completed', 'keep2share', $2, $3, $4, $5, $6, $7, $9,
               to_timestamp($8 / 1000.0), to_timestamp($8 / 1000.0), to_timestamp($8 / 1000.0)
        WHERE NOT EXISTS (SELECT 1 FROM downloads WHERE filepath = $5)
      `, [
        file.url || `https://keep2share.cc/${encodeURIComponent(file.channel)}/${encodeURIComponent(file.filename)}`,
        file.channel,
        title,
        file.filename,
        file.filepath,
        file.filesize,
        file.ext,
        file.mtimeMs,
        file.source_url || file.url || 'https://keep2share.cc',
      ]);
      if (rowCount) added += 1;
      else {
        skipped += 1;
        if (file.url) {
          await pool.query(`
            UPDATE downloads
               SET url = $1,
                   source_url = CASE
                     WHEN source_url IS NULL OR source_url = '' OR source_url = 'https://keep2share.cc' THEN $1
                     ELSE source_url
                   END
             WHERE filepath = $2
               AND platform = 'keep2share'
               AND (url IS NULL OR url = '' OR url NOT LIKE 'https://k2s.cc/file/%')
          `, [file.url, file.filepath]);
        }
      }
    }
    if (added) console.log(`[keep2share-sync] ${added} nieuwe items (${reason})`);
    return { added, skipped, scanned: files.length };
  } finally {
    keep2shareSyncRunning = false;
  }
}

async function resolveMediaPath(idRaw) {
  const id = String(idRaw || '');
  const fileMatch = id.match(/^file-(\d+)$/);
  if (fileMatch) {
    const { rows } = await pool.query('SELECT relpath FROM download_files WHERE id=$1', [fileMatch[1]]);
    if (!rows.length || !rows[0].relpath) return null;
    const rel = rows[0].relpath;
    if (path.isAbsolute(rel)) return rel;
    const resolved = resolveRelativeMediaPath(rel);
    if (fs.existsSync(resolved)) return resolved;
    const userPathMatch = String(rel).match(/(?:^|\/)(Users\/.+)$/);
    if (userPathMatch) {
      const absoluteUserPath = path.join('/', userPathMatch[1]);
      if (fs.existsSync(absoluteUserPath)) return absoluteUserPath;
    }
    return resolved;
  }
  const screenshotMatch = id.match(/^s-(\d+)$/);
  if (screenshotMatch) {
    const { rows } = await pool.query('SELECT filepath FROM screenshots WHERE id=$1', [screenshotMatch[1]]);
    return rows.length ? rows[0].filepath : null;
  }
  const numericId = parseInt(id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  const { rows } = await pool.query('SELECT filepath FROM downloads WHERE id=$1', [numericId]);
  return rows.length ? rows[0].filepath : null;
}

async function resolveMediaContext(idRaw) {
  const id = String(idRaw || '');
  const fileMatch = id.match(/^file-(\d+)$/);
  if (fileMatch) {
    const { rows } = await pool.query(`
      SELECT 'file-' || df.id::text AS id,
             d.url, d.source_url, d.platform, ${fileChannelSql('d', 'df')} AS channel, d.title,
             regexp_replace(df.relpath, '^.*/', '') AS filename,
             df.relpath AS filepath
        FROM download_files df
        JOIN downloads d ON d.id = df.download_id
       WHERE df.id = $1
       LIMIT 1`, [fileMatch[1]]);
    return rows[0] || null;
  }
  const screenshotMatch = id.match(/^s-(\d+)$/);
  if (screenshotMatch) {
    const { rows } = await pool.query(`
      SELECT 's-' || id::text AS id,
             url, url AS source_url, platform, channel, title, filename, filepath
        FROM screenshots
       WHERE id = $1
       LIMIT 1`, [screenshotMatch[1]]);
    return rows[0] || null;
  }
  const numericId = parseInt(id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  const { rows } = await pool.query(`
    SELECT id::text AS id,
           url, source_url, platform, channel, title, filename, filepath
      FROM downloads
     WHERE id = $1
     LIMIT 1`, [numericId]);
  return rows[0] || null;
}

function splitMultiFilter(value) {
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((entry) => String(entry || '').split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildItemFilters({ req, params, fileExpr, extExpr, ratingExpr, includeChannel = true, channelExpr = 'd.channel' }) {
  const platformValues = splitMultiFilter(req.query.platform);
  const channelValues = splitMultiFilter(req.query.channel);
  const q = req.query.q ? String(req.query.q).trim() : null;
  const minRating = req.query.min_rating != null ? Number(req.query.min_rating) : null;
  const mediaType = req.query.media_type ? String(req.query.media_type) : null;
  const tagId = req.query.tag_id ? parseInt(req.query.tag_id, 10) : null;
  const hasSourceScope = Boolean(req.query.source_thread_url || req.query.source_thread_title || req.query.source_post_url || req.query.source_model_key || req.query.source_model_title);
  const sourceThreadUrl = req.query.source_thread_url ? String(req.query.source_thread_url).trim() : '';
  const sourceThreadTitle = req.query.source_thread_title ? String(req.query.source_thread_title).trim() : '';
  const sourcePostUrl = req.query.source_post_url ? String(req.query.source_post_url).trim() : '';
  const sourceModelKey = req.query.source_model_key ? String(req.query.source_model_key).trim().toLowerCase() : '';
  const sourceModelTitle = req.query.source_model_title ? String(req.query.source_model_title).trim() : '';

  const where = [`${fileExpr} IS NOT NULL`, `${fileExpr} <> ''`];
  if (platformValues.length) { params.push(platformValues); where.push(`${platformGroupSql('d')} = ANY($${params.length}::text[])`); }
  if (includeChannel && channelValues.length) {
    const siteChannels = channelValues.filter((value) => String(value).startsWith('site:'));
    const plainChannels = channelValues.filter((value) => !String(value).startsWith('site:'));
    if (plainChannels.length) {
      params.push(plainChannels);
      where.push(`${channelExpr} = ANY($${params.length}::text[])`);
    }
    for (const channel of siteChannels) {
      params.push('%' + String(channel).slice(5).toLowerCase() + '%');
      where.push(`LOWER(COALESCE(d.metadata, '')) LIKE $${params.length}`);
    }
  }
  if (q) {
    addSearchFilter(where, params, q, ['d.title', 'd.filename', 'd.channel', 'd.platform', 'd.source_url', 'd.url', fileExpr]);
  }
  if (sourceThreadUrl) {
    params.push(sourceThreadUrl);
    where.push(`(d.source_url = $${params.length} OR d.url = $${params.length})`);
  }
  if (sourceThreadTitle) {
    params.push('%' + sourceThreadTitle.toLowerCase() + '%');
    where.push(`LOWER(COALESCE(d.metadata, '') || ' ' || COALESCE(d.title, '') || ' ' || COALESCE(d.channel, '')) LIKE $${params.length}`);
  }
  if (sourcePostUrl) {
    params.push(sourcePostUrl);
    where.push(`(d.source_url = $${params.length} OR d.url = $${params.length})`);
  }
  if (sourceModelKey || sourceModelTitle) {
    const modelNeedles = [sourceModelKey, sourceModelTitle].filter(Boolean);
    const modelClauses = [];
    for (const needle of modelNeedles) {
      params.push('%' + String(needle).toLowerCase() + '%');
      modelClauses.push(`LOWER(COALESCE(d.metadata, '') || ' ' || COALESCE(d.title, '') || ' ' || COALESCE(d.filename, '') || ' ' || COALESCE(${fileExpr}, '')) LIKE $${params.length}`);
    }
    if (modelClauses.length) where.push(`(${modelClauses.join(' OR ')})`);
  }
  if (Number.isFinite(minRating)) { params.push(minRating); where.push(`${ratingExpr} >= $${params.length}`); }
  if (mediaType === 'video') { where.push(`lower(${extExpr}) IN (${VIDEO_EXTS.map(e=>`'${e}'`).join(',')})`); }
  if (mediaType === 'image') { where.push(`lower(${extExpr}) IN (${IMAGE_EXTS.map(e=>`'${e}'`).join(',')})`); }
  if (Number.isFinite(tagId)) {
    params.push(tagId);
    where.push(`d.id IN (
      SELECT iut.download_id
        FROM item_user_tags iut
       WHERE iut.tag_id = $${params.length}
      UNION
      SELECT dt.download_id
        FROM download_tags dt
        JOIN tags t ON t.name = dt.tag
       WHERE t.id = $${params.length}
    )`);
  }
  return where;
}

const DIRECT_DOWNLOAD_HINT_SQL = `(
  lower(COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))) IN (${MEDIA_EXT_SQL})
)`;

function wantsThumbReadyOnly(req) {
  return /^(1|true|yes|on)$/i.test(String(req.query.thumb_ready || req.query.thumbs_ready || ''));
}

function buildScreenshotFilters({ req, params, includeChannel = true }) {
  const platformValues = splitMultiFilter(req.query.platform);
  const channelValues = splitMultiFilter(req.query.channel);
  const q = req.query.q ? String(req.query.q).trim() : null;
  const minRating = req.query.min_rating != null ? Number(req.query.min_rating) : null;
  const mediaType = req.query.media_type ? String(req.query.media_type) : null;
  const tagId = req.query.tag_id ? parseInt(req.query.tag_id, 10) : null;
  const hasSourceScope = Boolean(req.query.source_thread_url || req.query.source_thread_title || req.query.source_post_url || req.query.source_model_key || req.query.source_model_title);

  const where = [`s.filepath IS NOT NULL`, `s.filepath <> ''`];
  if (hasSourceScope) where.push('false');
  if (platformValues.length) {
    params.push(platformValues);
    where.push(`COALESCE(NULLIF(s.platform, ''), 'unknown') = ANY($${params.length}::text[])`);
  }
  if (includeChannel && channelValues.length) {
    const siteChannels = channelValues.filter((value) => String(value).startsWith('site:'));
    const plainChannels = channelValues.filter((value) => !String(value).startsWith('site:'));
    if (plainChannels.length) {
      params.push(plainChannels);
      where.push(`s.channel = ANY($${params.length}::text[])`);
    }
    for (const channel of siteChannels) {
      params.push('%' + String(channel).slice(5).toLowerCase() + '%');
      where.push(`LOWER(COALESCE(s.filepath, '') || ' ' || COALESCE(s.url, '')) LIKE $${params.length}`);
    }
  }
  if (q) {
    addSearchFilter(where, params, q, ['s.title', 's.filename', 's.channel', 's.platform', 's.filepath']);
  }
  if (Number.isFinite(minRating)) { params.push(minRating); where.push(`s.rating >= $${params.length}`); }
  if (mediaType === 'video') where.push('false');
  if (Number.isFinite(tagId)) {
    params.push(tagId);
    where.push(`s.id IN (
      SELECT sut.screenshot_id
        FROM screenshot_user_tags sut
       WHERE sut.tag_id = $${params.length}
    )`);
  }
  return where;
}

// Voorkom dat de browser API-responses cached of samenvoegt tussen tabs
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// ─── Health ────────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT 1 AS ok');
    res.json({ ok: rows[0].ok === 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/active-items', async (_req, res) => {
  try {
    const [{ rows }, hub, hubCounts, recordings] = await Promise.all([
      pool.query(`
      SELECT id::text, status, platform, channel, title, filename, filepath,
             progress, filesize, is_thumb_ready, updated_at, created_at
        FROM downloads
       WHERE status = ANY($1)
         AND url NOT LIKE 'recording:%'
       ORDER BY
         CASE status
           WHEN 'downloading' THEN 0
           WHEN 'postprocessing' THEN 1
           ELSE 9
         END,
         COALESCE(updated_at, created_at) DESC,
         id DESC
       LIMIT 80`, [ACTIVE_DB_STATUSES]),
      pool.query(`
        SELECT id::text, status, adapter, lane, url, progress_pct AS progress,
               options, locked_at AS updated_at, created_at
          FROM webdl.jobs
         WHERE status = 'running'
           AND COALESCE(lane, '') <> 'paused'
         ORDER BY
           CASE status
             WHEN 'running' THEN 0
             WHEN 'queued' THEN 1
             ELSE 9
           END,
           locked_at DESC NULLS LAST,
           created_at DESC NULLS LAST,
           id DESC
         LIMIT 40`),
      pool.query(`
        SELECT status, lane,
               COALESCE(options->>'platform', platform_guess, adapter, 'hub') AS platform,
               COUNT(*)::int AS count
          FROM (
            SELECT status, lane, adapter, options,
                   CASE
                     WHEN url LIKE '%youtube.com%' OR url LIKE '%youtu.be%' THEN 'youtube'
                     WHEN url LIKE '%tiktok.com%' THEN 'tiktok'
                     WHEN url LIKE '%vipergirls.to%' OR url LIKE '%viper.to%' THEN 'vipergirls'
                     WHEN url LIKE '%footfetishforum.com%' OR url LIKE '%flc.nyc3.digitaloceanspaces.com%' THEN 'footfetishforum'
                     WHEN url LIKE '%redgifs.com%' OR url LIKE '%gifdeliverynetwork.com%' THEN 'redgifs'
                     WHEN url LIKE '%x.com%' OR url LIKE '%twitter.com%' THEN 'twitter'
                     WHEN url LIKE '%xvideos.com%' THEN 'xvideos'
                     WHEN url LIKE '%onlyfans.com%' THEN 'onlyfans'
                     WHEN url LIKE '%keep2share%' OR url LIKE '%k2s.cc%' THEN 'keep2share'
                     ELSE NULL
                   END AS platform_guess
              FROM webdl.jobs
             WHERE status IN ('queued', 'running')
               AND COALESCE(lane, '') <> 'paused'
          ) q
         GROUP BY status, lane, COALESCE(options->>'platform', platform_guess, adapter, 'hub')
         ORDER BY status, lane, count DESC`),
      listRecentRawRecordings(20),
    ]);
    const dbItems = rows.map((r) => ({
      ...r,
      source: 'db',
      title: r.title || r.filename || r.filepath || `download ${r.id}`,
      thumb_url: r.is_thumb_ready ? `/thumb/${encodeURIComponent(String(r.id))}?v=1` : '',
    }));
    const hubItems = hub.rows.map((r) => ({
      id: `hub-${r.id}`,
      source: 'hub',
      status: r.status,
      lane: r.lane || '',
      work_lane: workLaneFromHubLane(r.lane),
      platform: r.options?.platform || platformFromUrl(r.options?.url || r.url) || r.adapter || 'hub',
      channel: r.options?.channel || r.options?.expandName || '',
      title: r.options?.title || r.options?.videoTitle || r.url || `hub job ${r.id}`,
      filename: '',
      filepath: '',
      progress: Math.round(Number(r.progress) || 0),
      filesize: null,
      thumb_url: thumbnailFromHubJob(r),
      updated_at: r.updated_at,
      created_at: r.created_at,
    }));
    const summary = {
      hub: hubCounts.rows.map((r) => ({ ...r, work_lane: workLaneFromHubLane(r.lane) })),
      hub_total: hubCounts.rows.reduce((sum, r) => sum + Number(r.count || 0), 0),
      hub_queued: hubCounts.rows.filter((r) => r.status === 'queued').reduce((sum, r) => sum + Number(r.count || 0), 0),
      hub_running: hubCounts.rows.filter((r) => r.status === 'running').reduce((sum, r) => sum + Number(r.count || 0), 0),
      recordings: recordings.length,
      db_active: dbItems.length,
    };
    const items = [...recordings, ...hubItems, ...dbItems].slice(0, 100);
    res.json({ items, count: items.length, summary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Items: gepagineerde media ─────────────────────────────────────────────
app.get('/api/items', async (req, res) => {
  const startedAt = Date.now();
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const sort = String(req.query.sort || 'recent').toLowerCase(); // recent | oldest | channel | channel_desc | random | rating | rating_asc
    const cursorTs = req.query.cursor_ts ? String(req.query.cursor_ts) : '';
    const cursorOrder = req.query.cursor_order != null ? Number(req.query.cursor_order) : NaN;
    const useCursor = sort === 'recent' && cursorTs && Number.isFinite(cursorOrder);
    const platformFilter = req.query.platform ? String(req.query.platform).toLowerCase() : '';
    const directOnlyPlatform = platformFilter === 'sabnzbd';
    const hasSearchQuery = Boolean(req.query.q && String(req.query.q).trim());
    const thumbReadyOnly = wantsThumbReadyOnly(req);
    const hasItemScopeFilter = Boolean(
      req.query.platform
      || req.query.channel
      || req.query.media_type
      || req.query.min_rating
      || req.query.tag_id
      || req.query.source_thread_url
      || req.query.source_thread_title
      || req.query.source_post_url
      || req.query.source_model_key
      || req.query.source_model_title
    );
    const hasOnlyMediaTypeFilter = Boolean(req.query.media_type)
      && !req.query.platform
      && !req.query.channel
      && !req.query.min_rating
      && !req.query.tag_id
      && !req.query.source_thread_url
      && !req.query.source_thread_title
      && !req.query.source_post_url
      && !req.query.source_model_key
      && !req.query.source_model_title;
    // Elke bron moet ruimer dan offset+limit leveren: infinite scroll mag niet
    // vroeg stoppen, en oude importmappen kunnen dubbele records bevatten die
    // later in deze query worden weggefilterd.
    const overfetch = hasSearchQuery ? 2 : (hasOnlyMediaTypeFilter ? 8 : (hasItemScopeFilter ? 30 : 3));
    const sourceLimit = useCursor ? limit * overfetch : offset + (limit * overfetch);
    const params = [];
    function addRecentCursor(where, sortExpr, orderExpr) {
      params.push(cursorTs);
      const tsParam = params.length;
      params.push(cursorOrder);
      const orderParam = params.length;
      const cursorTsExpr = `($${tsParam}::timestamptz AT TIME ZONE current_setting('TimeZone'))`;
      where.push(`(${sortExpr} < ${cursorTsExpr} OR (${sortExpr} = ${cursorTsExpr} AND ${orderExpr} < $${orderParam}::bigint))`);
    }
    const directWhere = buildItemFilters({
      req, params,
      fileExpr: 'd.filepath',
      extExpr: "COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))",
      ratingExpr: 'd.rating',
    });
    directWhere.push(`d.status <> ALL(ARRAY[${HIDDEN_GALLERY_STATUSES.map(s => `'${s}'`).join(',')}])`);
    directWhere.push(`d.filepath !~* '${TEMP_RELPATH_RE}'`);
    directWhere.push(`(d.filesize IS NULL OR d.filesize > 0)`);
    directWhere.push(DIRECT_DOWNLOAD_HINT_SQL);
    const fastRecentDirectOnly = sort === 'recent' && !hasSearchQuery && !hasItemScopeFilter;
    if (thumbReadyOnly || fastRecentDirectOnly) {
      directWhere.push(`(d.is_thumb_ready = true OR lower(COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))) IN (${IMAGE_EXT_SQL}))`);
    }
    if (useCursor) {
      addRecentCursor(directWhere, 'COALESCE(d.finished_at, d.updated_at, d.created_at)', 'd.id::bigint');
    }
    if (fastRecentDirectOnly) {
      const fastParams = [];
      const fastScreenshotWhere = SHOW_SCREENSHOTS_IN_GALLERY ? [
        `s.filepath IS NOT NULL`,
        `s.filepath <> ''`,
        `(s.filesize IS NULL OR s.filesize > 0)`,
        `COALESCE(s.is_thumb_ready, false) = true`,
      ] : ['false'];
      const fastWhere = buildItemFilters({
        req, params: fastParams,
        fileExpr: 'd.filepath',
        extExpr: "COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))",
        ratingExpr: 'd.rating',
      });
      fastWhere.push(`d.status <> ALL(ARRAY[${HIDDEN_GALLERY_STATUSES.map(s => `'${s}'`).join(',')}])`);
      fastWhere.push(`(d.filesize IS NULL OR d.filesize > 0)`);
      if (useCursor) {
        fastParams.push(cursorTs);
        const cursorTsParam = fastParams.length;
        fastParams.push(cursorOrder);
        const cursorOrderParam = fastParams.length;
        const cursorTsExpr = `($${cursorTsParam}::timestamptz AT TIME ZONE current_setting('TimeZone'))`;
        fastWhere.push(`(COALESCE(d.finished_at, d.updated_at, d.created_at) < ${cursorTsExpr} OR (COALESCE(d.finished_at, d.updated_at, d.created_at) = ${cursorTsExpr} AND d.id::bigint < $${cursorOrderParam}::bigint))`);
        fastScreenshotWhere.push(`(COALESCE(s.created_at, s.updated_at) < ${cursorTsExpr} OR (COALESCE(s.created_at, s.updated_at) = ${cursorTsExpr} AND (2000000000000 + s.id)::bigint < $${cursorOrderParam}::bigint))`);
      }
      const fastSourceLimit = useCursor
        ? Math.max(limit * 10, 80)
        : Math.max(offset + (limit * 10), 80);
      fastParams.push(fastSourceLimit);
      const fastLimitParam = fastParams.length;
      const { rows } = await pool.query(`
        SELECT *
          FROM (
            SELECT 'download' AS item_kind,
                   d.id::text AS id, d.id AS rating_id,
                   d.url, d.source_url, d.platform, d.channel, d.title, d.filename,
                   d.filepath, d.filesize, d.format, d.duration, d.rating,
                   (d.is_thumb_ready = true OR lower(COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))) IN (${IMAGE_EXT_SQL})) AS is_thumb_ready,
                   d.metadata,
                   d.finished_at, d.created_at,
                   COALESCE(d.finished_at, d.updated_at, d.created_at) AS sort_ts,
                   d.id::bigint AS source_order
              FROM downloads d
             WHERE ${fastWhere.join(' AND ')}
            UNION ALL
            SELECT 'screenshot' AS item_kind,
                   's-' || s.id::text AS id, NULL::bigint AS rating_id,
                   s.url, s.url AS source_url, s.platform, s.channel, s.title, s.filename,
                   s.filepath, s.filesize, 'jpg' AS format, NULL::text AS duration, s.rating,
                   s.is_thumb_ready,
                   NULL::text AS metadata,
                   s.created_at AS finished_at, s.created_at,
                   COALESCE(s.created_at, s.updated_at) AS sort_ts,
                   (2000000000000 + s.id)::bigint AS source_order
              FROM screenshots s
             WHERE ${fastScreenshotWhere.join(' AND ')}
          ) fast_items
         ORDER BY sort_ts DESC NULLS LAST, source_order DESC
         LIMIT $${fastLimitParam}`,
        fastParams,
      );
      const pageRows = await filterPlayableMediaRows(
        dedupeGalleryRows(rows).filter((row) => isGalleryMediaCandidate(row, { requireThumbReady: true })),
        useCursor ? limit : offset + limit,
      );
      const items = (useCursor ? pageRows.slice(0, limit) : pageRows.slice(offset, offset + limit)).map(mapItem);
      const last = items[items.length - 1] || null;
      const nextCursor = last && items.length === limit
        ? { sort_ts: last.sort_ts, source_order: last.source_order }
        : null;
      return res.json({ items, limit, offset, count: items.length, next_cursor: nextCursor, fast_thumb_ready: true, fast_recent_direct: true });
    }
    if (!directOnlyPlatform) {
      directWhere.push(`NOT EXISTS (
        SELECT 1 FROM download_files mf
         WHERE mf.download_id = d.id
           AND mf.relpath !~* '${AUX_RELPATH_RE}'
           AND lower(regexp_replace(mf.relpath, '^.*\\.', '')) IN (${MEDIA_EXT_SQL})
      )`);
    }
    const fileChannelExpr = fileChannelSql('d', 'df');
    const fileWhere = directOnlyPlatform ? ['false'] : buildItemFilters({
      req, params,
      fileExpr: 'df.relpath',
      extExpr: "regexp_replace(df.relpath, '^.*\\.', '')",
      ratingExpr: 'df.rating',
      channelExpr: fileChannelExpr,
    });
    if (!directOnlyPlatform) {
      fileWhere.push(`df.relpath !~* '${AUX_RELPATH_RE}'`);
      fileWhere.push(`df.relpath !~* '${TEMP_RELPATH_RE}'`);
      fileWhere.push(`d.filepath !~* '${TEMP_RELPATH_RE}'`);
      fileWhere.push(`d.status <> ALL(ARRAY[${HIDDEN_FILE_PARENT_STATUSES.map(s => `'${s}'`).join(',')}])`);
      fileWhere.push(`(df.filesize IS NULL OR df.filesize > 0)`);
      fileWhere.push(`lower(regexp_replace(df.relpath, '^.*\\.', '')) IN (${MEDIA_EXT_SQL})`);
      if (thumbReadyOnly) fileWhere.push(`(df.is_thumb_ready = true OR d.is_thumb_ready = true OR lower(regexp_replace(df.relpath, '^.*\\.', '')) IN (${IMAGE_EXT_SQL}))`);
    }
    if (useCursor && !directOnlyPlatform) {
      addRecentCursor(
        fileWhere,
        'COALESCE(to_timestamp(NULLIF(df.mtime_ms,0) / 1000.0)::timestamp, df.updated_at, d.finished_at, d.updated_at, d.created_at)',
        '(1000000000000 + df.id)::bigint',
      );
    }
    const screenshotWhere = directOnlyPlatform || !SHOW_SCREENSHOTS_IN_GALLERY ? ['false'] : buildScreenshotFilters({ req, params });
    screenshotWhere.push(`(s.filesize IS NULL OR s.filesize > 0)`);
    if (thumbReadyOnly) screenshotWhere.push(`COALESCE(s.is_thumb_ready, false) = true`);
    if (useCursor) {
      addRecentCursor(screenshotWhere, 'COALESCE(s.created_at, s.updated_at)', '(2000000000000 + s.id)::bigint');
    }
    const directDbSortExpr = 'COALESCE(d.created_at, d.finished_at, d.updated_at)';
    const fileDbSortExpr = `COALESCE(
      CASE
        WHEN NULLIF(df.created_at, '') ~ '^\\d{4}-\\d{2}-\\d{2}'
        THEN (NULLIF(df.created_at, '')::timestamptz AT TIME ZONE current_setting('TimeZone'))
      END,
      d.created_at,
      df.updated_at,
      d.finished_at,
      d.updated_at
    )`;
    const screenshotDbSortExpr = 'COALESCE(s.created_at, s.updated_at)';
    const directSortTsExpr = sort === 'oldest'
      ? directDbSortExpr
      : 'COALESCE(d.finished_at, d.updated_at, d.created_at)';
    const fileSortTsExpr = sort === 'oldest'
      ? fileDbSortExpr
      : 'COALESCE(to_timestamp(NULLIF(df.mtime_ms,0) / 1000.0)::timestamp, df.updated_at, d.finished_at, d.updated_at, d.created_at)';
    const screenshotSortTsExpr = screenshotDbSortExpr;

    const directOrder = sort === 'random'
      ? 'RANDOM()'
      : sort === 'rating'
        ? 'd.rating DESC NULLS LAST, d.id DESC'
      : sort === 'rating_asc'
        ? 'd.rating ASC NULLS LAST, d.id ASC'
      : sort === 'channel'
        ? 'LOWER(NULLIF(d.channel, \'\')) ASC NULLS LAST, d.finished_at DESC NULLS LAST, d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST, d.id DESC'
      : sort === 'channel_desc'
        ? 'LOWER(NULLIF(d.channel, \'\')) DESC NULLS LAST, d.finished_at DESC NULLS LAST, d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST, d.id DESC'
      : sort === 'oldest'
        ? 'd.id ASC'
        : 'd.finished_at DESC NULLS LAST, d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST, d.id DESC';
    const fileOrder = sort === 'random'
      ? 'RANDOM()'
      : sort === 'rating'
        ? 'df.rating DESC NULLS LAST, df.id DESC'
      : sort === 'rating_asc'
        ? 'df.rating ASC NULLS LAST, df.id ASC'
      : sort === 'channel'
        ? `LOWER(NULLIF(${fileChannelExpr}, '')) ASC NULLS LAST, df.mtime_ms DESC NULLS LAST, df.updated_at DESC NULLS LAST, d.finished_at DESC NULLS LAST, d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST, df.id DESC`
      : sort === 'channel_desc'
        ? `LOWER(NULLIF(${fileChannelExpr}, '')) DESC NULLS LAST, df.mtime_ms DESC NULLS LAST, df.updated_at DESC NULLS LAST, d.finished_at DESC NULLS LAST, d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST, df.id DESC`
      : sort === 'oldest'
        ? 'd.id ASC, df.id ASC'
        : 'df.mtime_ms DESC NULLS LAST, df.updated_at DESC NULLS LAST, d.finished_at DESC NULLS LAST, d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST, df.id DESC';
    const screenshotOrder = sort === 'random'
      ? 'RANDOM()'
      : sort === 'rating'
        ? 's.rating DESC NULLS LAST, s.id DESC'
      : sort === 'rating_asc'
        ? 's.rating ASC NULLS LAST, s.id ASC'
      : sort === 'channel'
        ? 'LOWER(NULLIF(s.channel, \'\')) ASC NULLS LAST, s.created_at DESC NULLS LAST, s.updated_at DESC NULLS LAST, s.id DESC'
      : sort === 'channel_desc'
        ? 'LOWER(NULLIF(s.channel, \'\')) DESC NULLS LAST, s.created_at DESC NULLS LAST, s.updated_at DESC NULLS LAST, s.id DESC'
      : sort === 'oldest'
        ? 's.created_at ASC NULLS LAST, s.id ASC'
        : 's.created_at DESC NULLS LAST, s.updated_at DESC NULLS LAST, s.id DESC';
    const orderBy = sort === 'random'
      ? 'RANDOM()'
      : sort === 'rating'
        ? 'rating DESC NULLS LAST, source_order DESC'
      : sort === 'rating_asc'
        ? 'rating ASC NULLS LAST, source_order ASC'
      : sort === 'channel'
        ? 'LOWER(NULLIF(channel, \'\')) ASC NULLS LAST, sort_ts DESC NULLS LAST, source_order DESC'
      : sort === 'channel_desc'
        ? 'LOWER(NULLIF(channel, \'\')) DESC NULLS LAST, sort_ts DESC NULLS LAST, source_order DESC'
      : sort === 'oldest'
        ? 'gallery_order ASC, source_order ASC'
        : 'sort_ts DESC NULLS LAST, source_order DESC';

    params.push(sourceLimit);
    const sourceLimitParam = params.length;
    const sql = `
      WITH direct_items AS MATERIALIZED (
          SELECT 'download' AS item_kind,
                 d.id::text AS id, d.id AS rating_id,
                 d.url, d.source_url, d.platform, d.channel, d.title, d.filename,
                 d.filepath, d.filesize, d.format, d.duration, d.rating,
                 (d.is_thumb_ready = true OR lower(COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))) IN (${IMAGE_EXT_SQL})) AS is_thumb_ready,
                 d.metadata,
                 d.finished_at, d.created_at,
                 ${directSortTsExpr} AS sort_ts,
                 d.id::bigint AS gallery_order,
                 d.id::bigint AS source_order
           FROM downloads d
           WHERE ${directWhere.join(' AND ')}
           ORDER BY ${directOrder}
           LIMIT $${sourceLimitParam}
      ),
      file_items AS MATERIALIZED (
          SELECT 'file' AS item_kind,
                 'file-' || df.id::text AS id, d.id AS rating_id,
                 d.url, d.source_url, d.platform, ${fileChannelExpr} AS channel, d.title,
                 regexp_replace(df.relpath, '^.*/', '') AS filename,
                 df.relpath AS filepath, df.filesize,
                 regexp_replace(df.relpath, '^.*\\.', '') AS format,
                 d.duration, df.rating,
                 (df.is_thumb_ready = true OR d.is_thumb_ready = true OR lower(regexp_replace(df.relpath, '^.*\\.', '')) IN (${IMAGE_EXT_SQL})) AS is_thumb_ready,
                 d.metadata,
                 d.finished_at, d.created_at,
                 ${fileSortTsExpr} AS sort_ts,
                 d.id::bigint AS gallery_order,
                 (1000000000000 + df.id)::bigint AS source_order
            FROM download_files df
           JOIN downloads d ON d.id = df.download_id
           WHERE ${fileWhere.join(' AND ')}
           ORDER BY ${fileOrder}
           LIMIT $${sourceLimitParam}
      ),
      screenshot_items AS MATERIALIZED (
          SELECT 'screenshot' AS item_kind,
                 's-' || s.id::text AS id, NULL::bigint AS rating_id,
                 s.url, s.url AS source_url, s.platform, s.channel, s.title, s.filename,
                 s.filepath, s.filesize, 'jpg' AS format, NULL::text AS duration,
                 s.rating, s.is_thumb_ready, NULL::text AS metadata,
                 s.created_at AS finished_at, s.created_at,
                 ${screenshotSortTsExpr} AS sort_ts,
                 (2000000000000 + s.id)::bigint AS gallery_order,
                 (2000000000000 + s.id)::bigint AS source_order
            FROM screenshots s
           WHERE ${screenshotWhere.join(' AND ')}
           ORDER BY ${screenshotOrder}
           LIMIT $${sourceLimitParam}
      )
      SELECT *
        FROM (
          SELECT * FROM direct_items
          UNION ALL
          SELECT * FROM file_items
          UNION ALL
          SELECT * FROM screenshot_items
        ) media_items
      ORDER BY ${orderBy}
      LIMIT $${sourceLimitParam}`;
    const { rows } = await pool.query(sql, params);

    const pageTarget = useCursor ? limit : offset + limit;
    const pageRows = await filterPlayableMediaRows(
      dedupeGalleryRows(rows).filter((row) => isGalleryMediaCandidate(row, { requireThumbReady: thumbReadyOnly })),
      pageTarget,
    );
    const items = (useCursor ? pageRows.slice(0, limit) : pageRows.slice(offset, offset + limit)).map(mapItem);
    const last = items[items.length - 1] || null;
    const moreRecentRowsLikely = sort === 'recent' && (items.length === limit || rows.length >= sourceLimit);
    const nextCursor = last && moreRecentRowsLikely
      ? { sort_ts: last.sort_ts, source_order: last.source_order }
      : null;
    if (DEBUG_GALLERY_QUERY) {
      console.log(JSON.stringify({
        t: new Date().toISOString(),
        route: '/api/items',
        query: req.query,
        useCursor,
        rows: rows.length,
        items: items.length,
        first: items[0] ? { id: items[0].id, platform: items[0].platform, channel: items[0].channel, sort_ts: items[0].sort_ts, source_order: items[0].source_order } : null,
        last: last ? { id: last.id, platform: last.platform, channel: last.channel, sort_ts: last.sort_ts, source_order: last.source_order } : null,
        ms: Date.now() - startedAt,
      }));
    }
    res.json({ items, limit, offset, count: items.length, next_cursor: nextCursor });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Legacy endpoint: Live gebruikt nu /api/items met dezelfde filters ─────
app.get('/api/items-since', async (req, res) => {
  try {
    const since = req.query.since ? String(req.query.since) : null;
    // Deprecated: de gallery gebruikt bewust dezelfde /api/items-query voor Live,
    // zodat init, filter en refresh exact dezelfde dataset volgen. Deze endpoint
    // gaf door andere timestamplogica valse "nieuwe" items en kon timeouten.
    res.json({ items: [], since, count: 0, deprecated: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Platforms lijst ───────────────────────────────────────────────────────
app.get('/api/platforms', async (req, res) => {
  try {
    const scoped = Boolean(req.query.platform || req.query.channel || req.query.q || req.query.min_rating || req.query.media_type || req.query.tag_id || req.query.source_thread_url || req.query.source_thread_title || req.query.source_post_url || req.query.source_model_key || req.query.source_model_title);
    if (!scoped) {
      const params = [];
      const where = buildItemFilters({
        req, params,
        fileExpr: 'd.filepath',
        extExpr: "COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))",
        ratingExpr: 'd.rating',
        includeChannel: false,
      });
      where.push(`d.status <> ALL(ARRAY[${HIDDEN_GALLERY_STATUSES.map(s => `'${s}'`).join(',')}])`);
      where.push(`(d.filesize IS NULL OR d.filesize > 0)`);
      where.push(DIRECT_DOWNLOAD_HINT_SQL);
      const { rows } = await pool.query(`
        SELECT platform,
               COUNT(*)::bigint AS count,
               COUNT(*) FILTER (WHERE ext IN (${IMAGE_EXT_SQL}))::bigint AS image_count,
               COUNT(*) FILTER (WHERE ext IN (${VIDEO_EXT_SQL}))::bigint AS video_count
          FROM (
            SELECT ${platformGroupSql('d')} AS platform,
                   lower(COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))) AS ext
              FROM downloads d
             WHERE ${where.join(' AND ')}
          ) platform_items
         GROUP BY platform
         ORDER BY COUNT(*) DESC`, params);
      return res.json({ platforms: rows });
    }

    const params = [];
    const directWhere = buildItemFilters({
      req, params,
      fileExpr: 'd.filepath',
      extExpr: "COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))",
      ratingExpr: 'd.rating',
      includeChannel: false,
    });
    directWhere.push(`d.status <> ALL(ARRAY[${HIDDEN_GALLERY_STATUSES.map(s => `'${s}'`).join(',')}])`);
    directWhere.push(`d.filepath !~* '${TEMP_RELPATH_RE}'`);
    directWhere.push(`(d.filesize IS NULL OR d.filesize > 0)`);
    directWhere.push(DIRECT_DOWNLOAD_HINT_SQL);
    directWhere.push(`NOT EXISTS (
      SELECT 1 FROM download_files mf
       WHERE mf.download_id = d.id
         AND mf.relpath !~* '${AUX_RELPATH_RE}'
       AND lower(regexp_replace(mf.relpath, '^.*\\.', '')) IN (${MEDIA_EXT_SQL})
    )`);

    const fileWhere = buildItemFilters({
      req, params,
      fileExpr: 'df.relpath',
      extExpr: "regexp_replace(df.relpath, '^.*\\.', '')",
      ratingExpr: 'df.rating',
      includeChannel: false,
    });
    fileWhere.push(`df.relpath !~* '${AUX_RELPATH_RE}'`);
    fileWhere.push(`df.relpath !~* '${TEMP_RELPATH_RE}'`);
    fileWhere.push(`d.filepath !~* '${TEMP_RELPATH_RE}'`);
    fileWhere.push(`d.status <> ALL(ARRAY[${HIDDEN_FILE_PARENT_STATUSES.map(s => `'${s}'`).join(',')}])`);
    fileWhere.push(`(df.filesize IS NULL OR df.filesize > 0)`);
    fileWhere.push(`lower(regexp_replace(df.relpath, '^.*\\.', '')) IN (${MEDIA_EXT_SQL})`);

    const screenshotWhere = SHOW_SCREENSHOTS_IN_GALLERY ? buildScreenshotFilters({ req, params, includeChannel: false }) : ['false'];
    screenshotWhere.push(`(s.filesize IS NULL OR s.filesize > 0)`);

    const { rows } = await pool.query(`
      WITH platform_items AS (
        SELECT ${platformGroupSql('d')} AS platform,
               lower(COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))) AS ext,
               lower(d.filepath) AS media_key
          FROM downloads d
         WHERE ${directWhere.join(' AND ')}
        UNION ALL
        SELECT ${platformGroupSql('d')} AS platform,
               lower(regexp_replace(df.relpath, '^.*\\.', '')) AS ext,
               lower(df.relpath) AS media_key
          FROM download_files df
          JOIN downloads d ON d.id = df.download_id
         WHERE ${fileWhere.join(' AND ')}
        UNION ALL
        SELECT COALESCE(NULLIF(s.platform, ''), 'unknown') AS platform,
               'jpg' AS ext,
               lower(s.filepath) AS media_key
          FROM screenshots s
         WHERE ${screenshotWhere.join(' AND ')}
      )
      SELECT platform,
             COUNT(DISTINCT media_key)::bigint AS count,
             COUNT(DISTINCT media_key) FILTER (WHERE ext IN (${IMAGE_EXT_SQL}))::bigint AS image_count,
             COUNT(DISTINCT media_key) FILTER (WHERE ext IN (${VIDEO_EXT_SQL}))::bigint AS video_count
        FROM platform_items
       GROUP BY platform
       ORDER BY COUNT(*) DESC`, params);
    res.json({ platforms: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Channels lijst (per platform) ─────────────────────────────────────────
app.get('/api/channels', async (req, res) => {
  try {
    const sort = String(req.query.sort || 'recent');
    const channelSort = String(req.query.channel_sort || req.query.channelSort || sort || 'count').toLowerCase();
    const orderBy = sort === 'random' || channelSort === 'random'
      ? 'RANDOM()'
      : channelSort === 'name'
        ? 'LOWER(channel) ASC NULLS LAST, platform ASC, count DESC'
      : channelSort === 'count'
        ? 'count DESC, latest_ts DESC NULLS LAST, LOWER(channel) ASC NULLS LAST'
      : channelSort === 'rating' || sort === 'rating'
        ? 'max_rating DESC NULLS LAST, latest_ts DESC NULLS LAST, count DESC'
        : 'latest_ts DESC NULLS LAST, count DESC';
    const scoped = Boolean(req.query.platform || req.query.channel || req.query.q || req.query.min_rating || req.query.media_type || req.query.tag_id || req.query.source_thread_url || req.query.source_thread_title || req.query.source_post_url || req.query.source_model_key || req.query.source_model_title);
    if (!scoped) {
      const params = [];
      const where = buildItemFilters({
        req, params,
        fileExpr: 'd.filepath',
        extExpr: "COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))",
        ratingExpr: 'd.rating',
        includeChannel: false,
      });
      where.push(`d.status <> ALL(ARRAY[${HIDDEN_GALLERY_STATUSES.map(s => `'${s}'`).join(',')}])`);
      where.push(`(d.filesize IS NULL OR d.filesize > 0)`);
      where.push(DIRECT_DOWNLOAD_HINT_SQL);
      const { rows } = await pool.query(`
        SELECT *
          FROM (
            SELECT ${channelGroupSql('d')} AS channel,
                   ${platformGroupSql('d')} AS platform,
                   COUNT(*) AS count,
                   COUNT(*) FILTER (WHERE lower(COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))) IN (${IMAGE_EXT_SQL}))::bigint AS image_count,
                   COUNT(*) FILTER (WHERE lower(COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))) IN (${VIDEO_EXT_SQL}))::bigint AS video_count,
                   MAX(COALESCE(d.finished_at, d.updated_at, d.created_at)) AS latest_ts,
                   MAX(d.rating) AS max_rating
              FROM downloads d
             WHERE ${where.join(' AND ')}
             GROUP BY ${channelGroupSql('d')}, ${platformGroupSql('d')}
          ) channel_items
         ORDER BY ${orderBy}
         LIMIT 3000`, params);
      return res.json({ channels: rows });
    }

    const params = [];
    const directWhere = buildItemFilters({
      req, params,
      fileExpr: 'd.filepath',
      extExpr: "COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))",
      ratingExpr: 'd.rating',
      includeChannel: false,
    });
    directWhere.push(`d.status <> ALL(ARRAY[${HIDDEN_GALLERY_STATUSES.map(s => `'${s}'`).join(',')}])`);
    directWhere.push(`d.filepath !~* '${TEMP_RELPATH_RE}'`);
    directWhere.push(`(d.filesize IS NULL OR d.filesize > 0)`);
    directWhere.push(DIRECT_DOWNLOAD_HINT_SQL);
    directWhere.push(`NOT EXISTS (
      SELECT 1 FROM download_files mf
       WHERE mf.download_id = d.id
         AND mf.relpath !~* '${AUX_RELPATH_RE}'
       AND lower(regexp_replace(mf.relpath, '^.*\\.', '')) IN (${MEDIA_EXT_SQL})
    )`);
    const directChannelExpr = channelGroupSql('d');
    const directPlatformExpr = platformGroupSql('d');
    const scopedFileChannelExpr = fileChannelSql('d', 'df');

    const fileWhere = buildItemFilters({
      req, params,
      fileExpr: 'df.relpath',
      extExpr: "regexp_replace(df.relpath, '^.*\\.', '')",
      ratingExpr: 'df.rating',
      channelExpr: scopedFileChannelExpr,
    });
    fileWhere.push(`df.relpath !~* '${AUX_RELPATH_RE}'`);
    fileWhere.push(`df.relpath !~* '${TEMP_RELPATH_RE}'`);
    fileWhere.push(`d.filepath !~* '${TEMP_RELPATH_RE}'`);
    fileWhere.push(`d.status <> ALL(ARRAY[${HIDDEN_FILE_PARENT_STATUSES.map(s => `'${s}'`).join(',')}])`);
    fileWhere.push(`(df.filesize IS NULL OR df.filesize > 0)`);
    fileWhere.push(`lower(regexp_replace(df.relpath, '^.*\\.', '')) IN (${MEDIA_EXT_SQL})`);

    const screenshotWhere = SHOW_SCREENSHOTS_IN_GALLERY ? buildScreenshotFilters({ req, params, includeChannel: false }) : ['false'];
    screenshotWhere.push(`(s.filesize IS NULL OR s.filesize > 0)`);

    const { rows } = await pool.query(`
      SELECT *
        FROM (
          SELECT channel,
                 platform,
                 COUNT(DISTINCT media_key) AS count,
                 COUNT(DISTINCT media_key) FILTER (WHERE ext IN (${IMAGE_EXT_SQL}))::bigint AS image_count,
                 COUNT(DISTINCT media_key) FILTER (WHERE ext IN (${VIDEO_EXT_SQL}))::bigint AS video_count,
                 MAX(sort_ts) AS latest_ts,
                 MAX(rating) AS max_rating
            FROM (
              SELECT ${directChannelExpr} AS channel,
                     ${directPlatformExpr} AS platform,
                     lower(COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))) AS ext,
                     lower(d.filepath) AS media_key,
                     COALESCE(d.finished_at, d.updated_at, d.created_at) AS sort_ts,
                     d.rating
                FROM downloads d
               WHERE ${directWhere.join(' AND ')}
              UNION ALL
              SELECT ${scopedFileChannelExpr} AS channel,
                     ${platformGroupSql('d')} AS platform,
                     lower(regexp_replace(df.relpath, '^.*\\.', '')) AS ext,
                     lower(df.relpath) AS media_key,
                     COALESCE(to_timestamp(NULLIF(df.mtime_ms,0) / 1000.0)::timestamp, df.updated_at, d.finished_at, d.updated_at, d.created_at) AS sort_ts,
                     df.rating
                FROM download_files df
                JOIN downloads d ON d.id = df.download_id
               WHERE ${fileWhere.join(' AND ')}
              UNION ALL
              SELECT s.channel,
                     COALESCE(NULLIF(s.platform, ''), 'unknown') AS platform,
                     'jpg' AS ext,
                     lower(s.filepath) AS media_key,
                     COALESCE(s.created_at, s.updated_at) AS sort_ts,
                     s.rating
                FROM screenshots s
               WHERE ${screenshotWhere.join(' AND ')}
            ) all_channel_items
           GROUP BY channel, platform
        ) channel_items
       ORDER BY ${orderBy}
       LIMIT 3000`, params);
    res.json({ channels: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Rating bijwerken ──────────────────────────────────────────────────────
app.post('/api/rating', async (req, res) => {
  try {
    const rawId = String(req.body.id || '');
    const fileMatch = rawId.match(/^file-(\d+)$/);
    const screenshotMatch = rawId.match(/^s-(\d+)$/);
    const id = fileMatch ? Number(fileMatch[1]) : screenshotMatch ? Number(screenshotMatch[1]) : parseInt(rawId, 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'id vereist' });
    let rating = null;
    if (req.body.rating !== null && req.body.rating !== '') {
      const r = Number(req.body.rating);
      if (!Number.isFinite(r)) return res.status(400).json({ error: 'rating ongeldig' });
      rating = Math.max(0, Math.min(5, Math.round(r * 2) / 2));
    }
    const result = fileMatch
      ? await pool.query('UPDATE download_files SET rating=$1, updated_at=now() WHERE id=$2', [rating, id])
      : screenshotMatch
        ? await pool.query('UPDATE screenshots SET rating=$1, updated_at=now() WHERE id=$2', [rating, id])
        : await pool.query('UPDATE downloads SET rating=$1, updated_at=now() WHERE id=$2', [rating, id]);
    if (!result.rowCount) return res.status(404).json({ error: 'niet gevonden' });
    res.json({ success: true, id: fileMatch ? `file-${id}` : screenshotMatch ? `s-${id}` : id, rating });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/viewer-screenshot', express.raw({ type: 'image/*', limit: '35mb' }), async (req, res) => {
  try {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const itemId = String(req.query.item_id || '').trim();
    const contentType = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
    if (!itemId) return res.status(400).json({ error: 'item_id ontbreekt' });
    if (!body.length) return res.status(400).json({ error: 'lege screenshot' });
    const ext = contentType === 'image/png' ? '.png' : '.jpg';
    if (ext === '.jpg' && contentType && contentType !== 'image/jpeg') {
      return res.status(415).json({ error: 'alleen image/jpeg of image/png screenshots' });
    }
    await ensureScreenshotSourceColumns();

    const [context, sourcePath] = await Promise.all([
      resolveMediaContext(itemId),
      resolveMediaPath(itemId),
    ]);
    if (!context) return res.status(404).json({ error: 'media niet gevonden' });

    const sourceDir = sourcePath ? path.dirname(sourcePath) : '';
    const sourceBase = safeFilenameSegment(
      path.basename(String(sourcePath || context.filename || context.title || 'media'), path.extname(String(sourcePath || context.filename || ''))),
      'media',
    );
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const timeSeconds = Number(req.query.time_seconds);
    const timeSuffix = Number.isFinite(timeSeconds) && timeSeconds >= 0
      ? `_t${String(Math.floor(timeSeconds)).padStart(5, '0')}`
      : '';
    const dir = sourceDir
      ? path.join(sourceDir, 'screenshots')
      : path.join(BASE_DIR, 'screenshots', safeFilenameSegment(context.platform || 'media'));
    await fs.promises.mkdir(dir, { recursive: true });

    let filePath = path.join(dir, `screenshot_${sourceBase}${timeSuffix}_${stamp}${ext}`);
    for (let i = 1; fs.existsSync(filePath) && i < 1000; i += 1) {
      filePath = path.join(dir, `screenshot_${sourceBase}${timeSuffix}_${stamp}_${i}${ext}`);
    }
    await fs.promises.writeFile(filePath, body, { flag: 'wx' });
    const stat = await fs.promises.stat(filePath);

    const titleBase = String(req.query.title || context.title || context.filename || sourceBase || 'media').trim();
    const timeLabel = Number.isFinite(timeSeconds) && timeSeconds >= 0
      ? ` @ ${Math.floor(timeSeconds / 60)}:${String(Math.floor(timeSeconds % 60)).padStart(2, '0')}`
      : '';
    const title = safeFilenameSegment(`Screenshot${timeLabel} - ${titleBase}`, `Screenshot${timeLabel}`);
    const sourceUrl = String(context.source_url || context.url || `/media/${itemId}`).trim();
    const now = new Date();
    const result = await pool.query(`
      INSERT INTO screenshots
        (url, platform, channel, title, filename, filepath, filesize,
         created_at, updated_at, ts_ms, is_thumb_ready,
         source_item_id, source_media_url, source_time_seconds)
      VALUES ($1, $2, $3, $4, $5, $6, $7,
              $8, $8, $9, true,
              $10, $11, $12)
      RETURNING id, url, platform, channel, title, filename, filepath, filesize, created_at`,
      [
        sourceUrl || `/media/${itemId}`,
        context.platform || 'screenshot',
        context.channel || '',
        title,
        path.basename(filePath),
        filePath,
        stat.size,
        now,
        Math.round(now.getTime()),
        itemId,
        sourceUrl || `/media/${itemId}`,
        Number.isFinite(timeSeconds) ? timeSeconds : null,
      ],
    );
    const inserted = result.rows[0];
    const screenshotItem = mapItem({
      item_kind: 'screenshot',
      id: `s-${inserted.id}`,
      rating_id: null,
      url: inserted.url,
      source_url: inserted.url,
      platform: inserted.platform,
      channel: inserted.channel,
      title: inserted.title,
      filename: inserted.filename,
      filepath: inserted.filepath,
      filesize: inserted.filesize,
      format: ext.replace(/^\./, ''),
      duration: null,
      rating: null,
      is_thumb_ready: true,
      metadata: null,
      finished_at: inserted.created_at,
      created_at: inserted.created_at,
      sort_ts: inserted.created_at,
      source_order: 2000000000000 + Number(inserted.id),
    });
    res.status(201).json({ success: true, screenshot: screenshotItem });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── File stream: serveert bestanden van disk ──────────────────────────────
app.get('/media/:id', async (req, res) => {
  try {
    const fp = await resolveMediaPath(req.params.id);
    if (!fp) return res.status(404).send('not found');
    if (!fs.existsSync(fp)) return res.status(404).send('file missing');
    if (wantsTranscodedPlayback(req, fp)) {
      return streamTranscodedVideo(req, res, fp);
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(fp);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.get('/active-thumb/:id', async (req, res) => {
  try {
    const fp = activeThumbPaths.get(String(req.params.id || ''));
    if (!fp || !fs.existsSync(fp)) return res.status(404).send('not found');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.sendFile(fp);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// ─── Thumbnail stream: _thumb.jpg of fallback naar origineel ───────────────
app.get('/thumb/:id', async (req, res) => {
  try {
    const fp = await resolveMediaPath(req.params.id);
    if (!fp) return res.status(404).send('not found');
    const dir = path.dirname(fp);
    const base = path.basename(fp, path.extname(fp));
    const isVideo = isVideoFile(fp);
    if (!isVideo && isImageFile(fp)) {
      markThumbReady(req.params.id);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.sendFile(fp);
    }
    // Probeer meerdere thumb-varianten
    const candidates = [
      path.join(dir, `${base}_thumb_v3.jpg`),
      path.join(dir, `${base}_thumb.jpg`),
      path.join(dir, `${base}.webp`),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(c);
      }
    }
    if (isVideo) {
      let canGenerate = false;
      try {
        canGenerate = fs.existsSync(fp) && fs.statSync(fp).size > 0;
      } catch (_) {}
      if (canGenerate) {
        const generated = await generateVideoThumb(fp);
        if (generated && fs.existsSync(generated)) {
          markThumbReady(req.params.id);
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.sendFile(generated);
        }
      }
      const fallbackImage = await findSiblingImageFallback(fp);
      if (fallbackImage && fs.existsSync(fallbackImage)) {
        markThumbReady(req.params.id);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(fallbackImage);
      }
    }
    res.status(404).send('no thumb');
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// ─── Tags CRUD ─────────────────────────────────────────────────────────────
app.get('/api/tags', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT t.id, t.name, t.is_favorite,
             COALESCE(t.user_use_count, 0)::int AS user_use_count,
             t.last_used_at,
             (COALESCE(download_counts.cnt, 0) + COALESCE(screenshot_counts.cnt, 0))::int AS applied_count,
             COALESCE(t.user_use_count, 0)::int AS uses
        FROM tags t
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS cnt
            FROM (
              SELECT iut.download_id
                FROM item_user_tags iut
               WHERE iut.tag_id = t.id
              UNION
              SELECT dt.download_id
                FROM download_tags dt
               WHERE dt.tag = t.name
            ) tagged_downloads
        ) download_counts ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(DISTINCT sut.screenshot_id)::int AS cnt
            FROM screenshot_user_tags sut
           WHERE sut.tag_id = t.id
        ) screenshot_counts ON true
       WHERE t.is_user = true
       ORDER BY t.is_favorite DESC,
                COALESCE(t.user_use_count, 0) DESC,
                t.last_used_at DESC NULLS LAST,
                t.name ASC`);
    res.json({ tags: rows.filter((r) => !isJunkTagName(r.name)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tags', async (req, res) => {
  try {
    const name = cleanTagName(req.body.name);
    if (!name || name.length < 2) return res.status(400).json({ error: 'name vereist' });
    const { rows } = await pool.query(
      `INSERT INTO tags (name, is_user)
       VALUES ($1, true)
       ON CONFLICT (name) DO UPDATE SET is_user=true
       RETURNING id, name, is_favorite, user_use_count, last_used_at`,
      [name]);
    res.json({ tag: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/tags/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const favorite = Boolean(req.body && req.body.is_favorite);
    const { rows } = await pool.query(
      `UPDATE tags
          SET is_user=true,
              is_favorite=$2
        WHERE id=$1
        RETURNING id, name, is_favorite, user_use_count, last_used_at`,
      [id, favorite]);
    if (!rows[0]) return res.status(404).json({ error: 'tag niet gevonden' });
    res.json({ tag: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/tags/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query('DELETE FROM item_user_tags WHERE tag_id=$1', [id]);
    await pool.query('DELETE FROM screenshot_user_tags WHERE tag_id=$1', [id]);
    await pool.query('UPDATE tags SET is_user=false WHERE id=$1', [id]);
    await pool.query(`
      DELETE FROM tags t
       WHERE t.id=$1
         AND NOT EXISTS (SELECT 1 FROM download_tags dt WHERE dt.tag=t.name)`,
      [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function recipeRows(clientOrPool = pool, id = null) {
  const params = [];
  const where = [];
  if (id != null) {
    params.push(id);
    where.push(`r.id=$${params.length}`);
  }
  const { rows } = await clientOrPool.query(`
    SELECT r.id,
           r.name,
           r.description,
           r.created_at,
           r.updated_at,
           r.last_used_at,
           COALESCE(
             json_agg(
               json_build_object('id', t.id, 'name', t.name)
               ORDER BY rt.position, t.name
             ) FILTER (WHERE t.id IS NOT NULL),
             '[]'::json
           ) AS tags
      FROM tag_recipes r
      LEFT JOIN tag_recipe_tags rt ON rt.recipe_id = r.id
      LEFT JOIN tags t ON t.id = rt.tag_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     GROUP BY r.id
     ORDER BY r.last_used_at DESC NULLS LAST, r.updated_at DESC, r.name ASC`, params);
  return rows.map((row) => ({
    ...row,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag) => tag && !isJunkTagName(tag.name)) : [],
  }));
}

async function tagIdsFromRecipeBody(client, body) {
  const ids = [];
  const seen = new Set();
  const rawIds = Array.isArray(body && body.tag_ids) ? body.tag_ids : [];
  for (const raw of rawIds) {
    const id = parseInt(raw, 10);
    if (Number.isFinite(id) && id > 0 && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  const rawNames = Array.isArray(body && body.tag_names) ? body.tag_names : [];
  for (const raw of rawNames) {
    const name = cleanTagName(raw);
    if (!name || isJunkTagName(name)) continue;
    const { rows } = await client.query(
      `INSERT INTO tags (name, is_user)
       VALUES ($1, true)
       ON CONFLICT (name) DO UPDATE SET is_user=true
       RETURNING id`,
      [name]);
    const id = Number(rows[0]?.id);
    if (Number.isFinite(id) && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

async function replaceRecipeTags(client, recipeId, tagIds) {
  await client.query('DELETE FROM tag_recipe_tags WHERE recipe_id=$1', [recipeId]);
  for (let i = 0; i < tagIds.length; i += 1) {
    await client.query(
      `INSERT INTO tag_recipe_tags (recipe_id, tag_id, position)
       SELECT $1, t.id, $3
         FROM tags t
        WHERE t.id=$2 AND t.is_user=true
       ON CONFLICT (recipe_id, tag_id) DO UPDATE SET position=EXCLUDED.position`,
      [recipeId, tagIds[i], i]);
  }
}

app.get('/api/tag-recipes', async (_req, res) => {
  try {
    res.json({ recipes: await recipeRows(pool) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tag-recipes', async (req, res) => {
  const client = await pool.connect();
  try {
    const name = cleanRecipeName(req.body && req.body.name);
    if (!name || name.length < 2) return res.status(400).json({ error: 'naam vereist' });
    const description = cleanRecipeDescription(req.body && req.body.description);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO tag_recipes (name, description)
       VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET description=EXCLUDED.description, updated_at=now()
       RETURNING id`,
      [name, description]);
    const recipeId = Number(rows[0].id);
    const tagIds = await tagIdsFromRecipeBody(client, req.body || {});
    await replaceRecipeTags(client, recipeId, tagIds);
    await client.query('COMMIT');
    const [recipe] = await recipeRows(pool, recipeId);
    res.json({ recipe });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.patch('/api/tag-recipes/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id vereist' });
    const name = cleanRecipeName(req.body && req.body.name);
    const description = cleanRecipeDescription(req.body && req.body.description);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE tag_recipes
          SET name = COALESCE(NULLIF($2, ''), name),
              description = $3,
              updated_at = now()
        WHERE id=$1
        RETURNING id`,
      [id, name, description]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'recept niet gevonden' });
    }
    const tagIds = await tagIdsFromRecipeBody(client, req.body || {});
    await replaceRecipeTags(client, id, tagIds);
    await client.query('COMMIT');
    const [recipe] = await recipeRows(pool, id);
    res.json({ recipe });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.delete('/api/tag-recipes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query('DELETE FROM tag_recipes WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function graphSignalsForRow(row) {
  const metadata = parseMetadataObject(row.metadata);
  const graph = sourceGraphSummary(metadata);
  const sourceSite = sourceSiteFromMetadata(row.metadata, row.source_url);
  const sourceModelTitle = sourceModelTitleForRow(row, graph, sourceSite, row.filename || '');
  const sourceModelKey = sourceModelKeyFromTitle(sourceModelTitle);
  const signals = {
    source_site: sourceSite || '',
    source_host: graph.source_host || '',
    source_thread_url: graph.source_thread_url || '',
    source_thread_title: graph.source_thread_title || '',
    source_post_url: graph.source_post_url || '',
    source_model_key: sourceModelKey || '',
    platform: normalizeSourceSiteLabel(row.platform || ''),
    channel: row.channel && row.channel !== 'unknown' ? String(row.channel) : '',
  };
  return signals;
}

function scoreGraphTagCandidate(candidate, signals) {
  const haystack = [
    candidate.platform,
    candidate.channel,
    candidate.source_url,
    candidate.url,
    candidate.metadata,
  ].map((v) => String(v || '').toLowerCase()).join(' ');
  let score = 0;
  if (signals.source_thread_url && haystack.includes(signals.source_thread_url.toLowerCase())) score += 50;
  if (signals.source_post_url && haystack.includes(signals.source_post_url.toLowerCase())) score += 35;
  if (signals.channel && String(candidate.channel || '') === signals.channel) score += 20;
  if (signals.source_site && haystack.includes(signals.source_site.toLowerCase())) score += 14;
  if (signals.source_host && haystack.includes(signals.source_host.toLowerCase())) score += 10;
  if (signals.platform && normalizeSourceSiteLabel(candidate.platform || '') === signals.platform) score += 6;
  if (signals.source_model_key) {
    const candidateModelKey = sourceModelKeyFromTitle(candidate.title || candidate.filename || '');
    if (candidateModelKey && candidateModelKey === signals.source_model_key) score += 8;
  }
  return score;
}

app.get('/api/items/:id/tag-suggestions', async (req, res) => {
  try {
    if (String(req.params.id || '').startsWith('s-')) return res.json({ suggestions: [], signals: {} });
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.json({ suggestions: [], signals: {} });
    const current = await pool.query(
      'SELECT id, platform, channel, url, source_url, title, filename, metadata FROM downloads WHERE id=$1',
      [id]);
    if (!current.rows[0]) return res.json({ suggestions: [], signals: {} });
    const signals = graphSignalsForRow(current.rows[0]);
    const params = [id];
    const clauses = [];
    if (signals.source_thread_url) {
      params.push(signals.source_thread_url, '%' + signals.source_thread_url + '%');
      clauses.push(`(d.source_url=$${params.length - 1} OR d.metadata ILIKE $${params.length})`);
    }
    if (signals.source_post_url) {
      params.push(signals.source_post_url, '%' + signals.source_post_url + '%');
      clauses.push(`(d.source_url=$${params.length - 1} OR d.metadata ILIKE $${params.length})`);
    }
    if (signals.channel) {
      params.push(signals.channel);
      clauses.push(`d.channel=$${params.length}`);
    }
    if (!clauses.length) return res.json({ suggestions: [], signals });
    const { rows } = await pool.query(`
      SELECT d.id, d.platform, d.channel, d.url, d.source_url, d.title, d.filename, d.metadata,
             t.id AS tag_id, t.name AS tag_name
        FROM downloads d
        JOIN item_user_tags iut ON iut.download_id = d.id
        JOIN tags t ON t.id = iut.tag_id
       WHERE d.id <> $1
         AND (${clauses.join(' OR ')})
       ORDER BY d.id DESC
       LIMIT 3000`, params);
    const byTag = new Map();
    for (const row of rows) {
      if (isJunkTagName(row.tag_name)) continue;
      const score = scoreGraphTagCandidate(row, signals);
      if (score <= 0) continue;
      const key = Number(row.tag_id);
      const entry = byTag.get(key) || { id: key, name: row.tag_name, score: 0, uses: 0 };
      entry.score += score;
      entry.uses += 1;
      byTag.set(key, entry);
    }
    const suggestions = Array.from(byTag.values())
      .sort((a, b) => b.score - a.score || b.uses - a.uses || String(a.name).localeCompare(String(b.name)))
      .slice(0, 24);
    res.json({ suggestions, signals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/items/:id/tag-recipes/:recipeId', async (req, res) => {
  try {
    const rawId = String(req.params.id || '');
    const screenshotMatch = rawId.match(/^s-(\d+)$/);
    const itemId = screenshotMatch ? parseInt(screenshotMatch[1], 10) : parseInt(rawId, 10);
    const recipeId = parseInt(req.params.recipeId, 10);
    if (!Number.isFinite(itemId) || !Number.isFinite(recipeId)) return res.status(400).json({ error: 'id vereist' });
    if (screenshotMatch) {
      const { rows } = await pool.query(`
        WITH recipe_tags AS (
          SELECT tag_id FROM tag_recipe_tags WHERE recipe_id=$2
        ), inserted AS (
          INSERT INTO screenshot_user_tags (screenshot_id, tag_id)
          SELECT $1, tag_id FROM recipe_tags
          ON CONFLICT DO NOTHING
          RETURNING tag_id
        ), bumped AS (
          UPDATE tags t
             SET is_user=true,
                 user_use_count = COALESCE(user_use_count, 0) + 1,
                 last_used_at = now()
            FROM recipe_tags rt
           WHERE t.id=rt.tag_id
           RETURNING t.id
        )
        UPDATE tag_recipes
           SET last_used_at=now(), updated_at=now()
         WHERE id=$2
         RETURNING id`,
        [itemId, recipeId]);
      if (!rows[0]) return res.status(404).json({ error: 'recept niet gevonden' });
      return res.json({ success: true });
    }
    const { rows } = await pool.query(`
      WITH recipe_tags AS (
        SELECT tag_id FROM tag_recipe_tags WHERE recipe_id=$2
      ), inserted AS (
        INSERT INTO item_user_tags (download_id, tag_id)
        SELECT $1, tag_id FROM recipe_tags
        ON CONFLICT DO NOTHING
        RETURNING tag_id
      ), bumped AS (
        UPDATE tags t
           SET is_user=true,
               user_use_count = COALESCE(user_use_count, 0) + 1,
               last_used_at = now()
          FROM recipe_tags rt
         WHERE t.id=rt.tag_id
         RETURNING t.id
      )
      UPDATE tag_recipes
         SET last_used_at=now(), updated_at=now()
       WHERE id=$2
       RETURNING id`,
      [itemId, recipeId]);
    if (!rows[0]) return res.status(404).json({ error: 'recept niet gevonden' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Tags op een item
app.get('/api/items/:id/tags', async (req, res) => {
  try {
    const rawId = String(req.params.id || '');
    const screenshotMatch = rawId.match(/^s-(\d+)$/);
    const id = screenshotMatch ? parseInt(screenshotMatch[1], 10) : parseInt(rawId, 10);
    if (!Number.isFinite(id)) return res.json({ tags: [] });
    if (screenshotMatch) {
      const { rows } = await pool.query(
        'SELECT t.id, t.name FROM tags t JOIN screenshot_user_tags sut ON sut.tag_id=t.id WHERE sut.screenshot_id=$1 ORDER BY t.name',
        [id]);
      return res.json({ tags: rows.filter((r) => !isJunkTagName(r.name)) });
    }
    const { rows } = await pool.query(`
      SELECT DISTINCT t.id, t.name
        FROM tags t
        LEFT JOIN item_user_tags iut ON iut.tag_id=t.id AND iut.download_id=$1
        LEFT JOIN download_tags dt ON dt.tag=t.name AND dt.download_id=$1
       WHERE iut.download_id IS NOT NULL OR dt.download_id IS NOT NULL
       ORDER BY t.name`,
      [id]);
    res.json({ tags: rows.filter((r) => !isJunkTagName(r.name)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/items/:id/tags', async (req, res) => {
  try {
    const rawId = String(req.params.id || '');
    const screenshotMatch = rawId.match(/^s-(\d+)$/);
    const itemId = screenshotMatch ? parseInt(screenshotMatch[1], 10) : parseInt(rawId, 10);
    const tagId = parseInt(req.body.tag_id, 10);
    if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id vereist' });
    if (!Number.isFinite(tagId)) return res.status(400).json({ error: 'tag_id vereist' });
    const tag = await pool.query(`
      UPDATE tags
         SET is_user=true,
             user_use_count = COALESCE(user_use_count, 0) + 1,
             last_used_at = now()
       WHERE id=$1
       RETURNING id`, [tagId]);
    if (!tag.rows[0]) return res.status(404).json({ error: 'tag niet gevonden' });
    if (screenshotMatch) {
      await pool.query(
        'INSERT INTO screenshot_user_tags (screenshot_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [itemId, tagId]);
    } else {
      await pool.query(
        'INSERT INTO item_user_tags (download_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [itemId, tagId]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/items/:id/tags/:tagId', async (req, res) => {
  try {
    const rawId = String(req.params.id || '');
    const screenshotMatch = rawId.match(/^s-(\d+)$/);
    const itemId = screenshotMatch ? parseInt(screenshotMatch[1], 10) : parseInt(rawId, 10);
    const tagId = parseInt(req.params.tagId, 10);
    if (!Number.isFinite(itemId) || !Number.isFinite(tagId)) return res.status(400).json({ error: 'id vereist' });
    if (screenshotMatch) {
      await pool.query('DELETE FROM screenshot_user_tags WHERE screenshot_id=$1 AND tag_id=$2', [itemId, tagId]);
    } else {
      await pool.query('DELETE FROM item_user_tags WHERE download_id=$1 AND tag_id=$2', [itemId, tagId]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Finder: open bestand in macOS Finder ──────────────────────────────────
app.post('/api/finder', async (req, res) => {
  try {
    const id = String(req.body.id || '');
    if (!id) return res.status(400).json({ error: 'id vereist' });
    const fp = await resolveMediaPath(id);
    if (!fp) return res.status(404).json({ error: 'niet gevonden' });
    require('node:child_process').execFile('open', ['-R', fp], { timeout: 5000 }, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const server = app.listen(PORT, () => {
  console.log(`webdl-gallery listening on http://localhost:${PORT}`);
  setTimeout(() => {
    ensureSchema()
      .then(() => ensureSearchIndexes())
      .catch((e) => console.warn('[schema-init] failed:', e.message));
  }, 30000).unref();
  setTimeout(() => {
    if (THUMB_WARM_ENABLED) {
      warmThumbBacklog('startup').catch((e) => console.warn('[thumb-warm] failed:', e.message));
    }
  }, 3000).unref();
  setTimeout(() => {
    syncKeep2ShareFiles('startup').catch((e) => console.warn('[keep2share-sync] failed:', e.message));
  }, 60000).unref();
  setInterval(() => {
    syncKeep2ShareFiles('timer').catch((e) => console.warn('[keep2share-sync] failed:', e.message));
  }, KEEP2SHARE_SYNC_MS).unref();
  if (THUMB_WARM_ENABLED) {
    setInterval(() => {
      warmThumbBacklog('timer').catch((e) => console.warn('[thumb-warm] failed:', e.message));
    }, THUMB_WARM_INTERVAL_MS).unref();
  }
});
global.__webdlGalleryServer = server;
