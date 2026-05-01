// server.js — webdl-gallery: lichte gallery + viewer server.
// Leest direct uit de PostgreSQL 'downloads' tabel. Geen afhankelijkheid
// van simple-server of webdl-hub — alleen de gedeelde database.
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const express = require('express');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 35731);
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/webdl';
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,                        // meer ruimte voor meerdere tabs
  idleTimeoutMillis: 30000,       // idle verbindingen na 30s sluiten
  connectionTimeoutMillis: 5000,  // max 5s wachten op verbinding uit pool
  statement_timeout: 10000,       // queries langer dan 10s afbreken
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BASE_DIR = process.env.WEBDL_BASE_DIR || '/Users/jurgen/Downloads/WEBDL';
const RG_BIN = process.env.RG_BIN || (fs.existsSync('/Applications/Codex.app/Contents/Resources/rg') ? '/Applications/Codex.app/Contents/Resources/rg' : 'rg');
const VIDEO_EXTS = ['mp4','webm','mkv','mov','m4v','avi','flv','ts'];
const IMAGE_EXTS = ['jpg','jpeg','png','gif','webp','avif','bmp'];
const MEDIA_EXTS = [...VIDEO_EXTS, ...IMAGE_EXTS];
const AUX_RELPATH_RE = String.raw`(_thumb(_v[0-9]+)?\.(jpe?g|png|webp)$|_logo\.(jpe?g|png|webp)$|\.(json|part|tmp|ytdl)$)`;
const MEDIA_EXT_SQL = MEDIA_EXTS.map(e => `'${e}'`).join(',');
const ACTIVE_STATUSES = ['downloading', 'postprocessing'];
const HIDDEN_GALLERY_STATUSES = ['pending', 'queued', 'downloading', 'postprocessing'];
const KEEP2SHARE_DIR = path.join(BASE_DIR, '_Keep2Share');
const JDOWNLOADER_CFG_DIR = process.env.JDOWNLOADER_CFG_DIR || path.join(process.env.HOME || '/Users/jurgen', 'Library/Application Support/JDownloader 2/cfg');
const KEEP2SHARE_SYNC_MS = Number(process.env.KEEP2SHARE_SYNC_MS || 60000);
const KEEP2SHARE_SYNC_MAX_FILES = Number(process.env.KEEP2SHARE_SYNC_MAX_FILES || 5000);
const KEEP2SHARE_SYNC_MAX_ADDS = Number(process.env.KEEP2SHARE_SYNC_MAX_ADDS || 500);
let keep2shareSyncRunning = false;
const thumbInflight = new Map();

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
  await pool.query('ALTER TABLE tags ADD COLUMN IF NOT EXISTS is_user boolean NOT NULL DEFAULT false');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS item_user_tags (
      download_id bigint NOT NULL,
      tag_id bigint NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (download_id, tag_id)
    )`);
}

function fileExt(filePath, format) {
  return format ? String(format).toLowerCase() : path.extname(filePath || '').replace('.', '').toLowerCase();
}

function mapItem(row) {
  const ext = fileExt(row.filepath, row.format);
  const isVideo = VIDEO_EXTS.includes(ext);
  const filename = row.filename || path.basename(row.filepath || '');
  const durationText = row.duration == null ? null : String(row.duration);
  const durationSeconds = parseDurationSeconds(durationText);
  return {
    ...row,
    id: String(row.id),
    rating_id: row.rating_id || row.id,
    filename,
    ext,
    type: isVideo ? 'video' : 'image',
    duration: durationText,
    duration_seconds: durationSeconds,
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

function thumbPathForMedia(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  return path.join(dir, `${base}_thumb_v3.jpg`);
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
  const job = (async () => {
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
          '-vf', 'scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2:black,setsar=1',
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
  })().finally(() => thumbInflight.delete(filePath));
  thumbInflight.set(filePath, job);
  return job;
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
      if (added >= KEEP2SHARE_SYNC_MAX_ADDS) break;
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
    return path.resolve(BASE_DIR, rows[0].relpath);
  }
  const numericId = parseInt(id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  const { rows } = await pool.query('SELECT filepath FROM downloads WHERE id=$1', [numericId]);
  return rows.length ? rows[0].filepath : null;
}

function buildItemFilters({ req, params, fileExpr, extExpr, ratingExpr }) {
  const platform = req.query.platform ? String(req.query.platform) : null;
  const channel = req.query.channel ? String(req.query.channel) : null;
  const q = req.query.q ? String(req.query.q).trim() : null;
  const minRating = req.query.min_rating != null ? Number(req.query.min_rating) : null;
  const mediaType = req.query.media_type ? String(req.query.media_type) : null;
  const tagId = req.query.tag_id ? parseInt(req.query.tag_id, 10) : null;

  const where = [`${fileExpr} IS NOT NULL`, `${fileExpr} <> ''`];
  if (platform) { params.push(platform); where.push(`d.platform = $${params.length}`); }
  if (channel)  { params.push(channel);  where.push(`d.channel = $${params.length}`); }
  if (q) {
    params.push('%' + q.toLowerCase() + '%');
    where.push(`(LOWER(COALESCE(d.title, d.filename, '')) LIKE $${params.length} OR LOWER(${fileExpr}) LIKE $${params.length})`);
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
    const { rows } = await pool.query(`
      SELECT id::text, status, platform, channel, title, filename, filepath,
             progress, filesize, updated_at, created_at
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
       LIMIT 80`, [ACTIVE_STATUSES]);
    const dbItems = rows.map((r) => ({
      ...r,
      source: 'db',
      title: r.title || r.filename || r.filepath || `download ${r.id}`,
    }));
    res.json({ items: dbItems, count: dbItems.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Items: gepagineerde media ─────────────────────────────────────────────
app.get('/api/items', async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const sort = String(req.query.sort || 'recent'); // recent | random | rating
    const sourceLimit = Math.min(5000, limit + offset + 500);
    const params = [];
    const directWhere = buildItemFilters({
      req, params,
      fileExpr: 'd.filepath',
      extExpr: "COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))",
      ratingExpr: 'd.rating',
    });
    directWhere.push(`NOT EXISTS (
      SELECT 1 FROM download_files mf
       WHERE mf.download_id = d.id
         AND mf.relpath !~* '${AUX_RELPATH_RE}'
         AND lower(regexp_replace(mf.relpath, '^.*\\.', '')) IN (${MEDIA_EXT_SQL})
    )`);
    directWhere.push(`COALESCE(d.status, 'completed') <> ALL(ARRAY[${HIDDEN_GALLERY_STATUSES.map(s => `'${s}'`).join(',')}])`);
    directWhere.push(`lower(COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))) IN (${MEDIA_EXT_SQL})`);
    const fileWhere = buildItemFilters({
      req, params,
      fileExpr: 'df.relpath',
      extExpr: "regexp_replace(df.relpath, '^.*\\.', '')",
      ratingExpr: 'df.rating',
    });
    fileWhere.push(`df.relpath !~* '${AUX_RELPATH_RE}'`);
    fileWhere.push(`COALESCE(d.status, 'completed') <> ALL(ARRAY[${HIDDEN_GALLERY_STATUSES.map(s => `'${s}'`).join(',')}])`);
    fileWhere.push(`lower(regexp_replace(df.relpath, '^.*\\.', '')) IN (${MEDIA_EXT_SQL})`);

    const directOrder = sort === 'random'
      ? 'RANDOM()'
      : sort === 'rating'
        ? 'd.rating DESC NULLS LAST, d.id DESC'
        : 'COALESCE(d.finished_at, d.updated_at, d.created_at) DESC NULLS LAST, d.id DESC';
    const fileOrder = sort === 'random'
      ? 'RANDOM()'
      : sort === 'rating'
        ? 'df.rating DESC NULLS LAST, df.id DESC'
        : 'COALESCE(to_timestamp(NULLIF(df.mtime_ms,0) / 1000.0)::timestamp, df.updated_at, d.finished_at, d.updated_at, d.created_at) DESC NULLS LAST, df.id DESC';
    const orderBy = sort === 'random'
      ? 'RANDOM()'
      : sort === 'rating'
        ? 'rating DESC NULLS LAST, source_order DESC'
        : 'sort_ts DESC NULLS LAST, source_order DESC';

    params.push(sourceLimit);
    const sourceLimitParam = params.length;
    const sql = `
      WITH direct_items AS (
          SELECT 'download' AS item_kind,
                 d.id::text AS id, d.id AS rating_id,
                 d.url, d.source_url, d.platform, d.channel, d.title, d.filename,
                 d.filepath, d.filesize, d.format, d.duration, d.rating, d.is_thumb_ready,
                 d.finished_at, d.created_at,
                 COALESCE(d.finished_at, d.updated_at, d.created_at) AS sort_ts,
                 d.id::bigint AS source_order
           FROM downloads d
           WHERE ${directWhere.join(' AND ')}
           ORDER BY ${directOrder}
           LIMIT $${sourceLimitParam}
      ),
      file_items AS (
          SELECT 'file' AS item_kind,
                 'file-' || df.id::text AS id, d.id AS rating_id,
                 d.url, d.source_url, d.platform, d.channel, d.title,
                 regexp_replace(df.relpath, '^.*/', '') AS filename,
                 df.relpath AS filepath, df.filesize,
                 regexp_replace(df.relpath, '^.*\\.', '') AS format,
                 d.duration, df.rating, COALESCE(df.is_thumb_ready, d.is_thumb_ready) AS is_thumb_ready,
                 d.finished_at, d.created_at,
                 COALESCE(to_timestamp(NULLIF(df.mtime_ms,0) / 1000.0)::timestamp, df.updated_at, d.finished_at, d.updated_at, d.created_at) AS sort_ts,
                 (1000000000000 + df.id)::bigint AS source_order
            FROM download_files df
           JOIN downloads d ON d.id = df.download_id
           WHERE ${fileWhere.join(' AND ')}
           ORDER BY ${fileOrder}
           LIMIT $${sourceLimitParam}
      )
      SELECT *
        FROM (
          SELECT * FROM direct_items
          UNION ALL
          SELECT * FROM file_items
        ) media_items
      ORDER BY ${orderBy}
      LIMIT $${sourceLimitParam}`;
    const { rows } = await pool.query(sql, params);

    const items = rows.filter(hasNonEmptyMedia).slice(offset, offset + limit).map(mapItem);
    res.json({ items, limit, offset, count: items.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Items sinds timestamp X (voor auto-refresh polling) ──────────────────
// We filteren op COALESCE(finished_at, created_at) > since omdat nieuwe
// completions vaak oude IDs hebben (pending rows die laat afgerond worden).
app.get('/api/items-since', async (req, res) => {
  try {
    const since = req.query.since ? String(req.query.since) : null;
    const params = [];
    const directWhere = buildItemFilters({
      req, params,
      fileExpr: 'd.filepath',
      extExpr: "COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))",
      ratingExpr: 'd.rating',
    });
    directWhere.push(`NOT EXISTS (
      SELECT 1 FROM download_files mf
       WHERE mf.download_id = d.id
         AND mf.relpath !~* '${AUX_RELPATH_RE}'
         AND lower(regexp_replace(mf.relpath, '^.*\\.', '')) IN (${MEDIA_EXTS.map(e=>`'${e}'`).join(',')})
    )`);
    directWhere.push(`COALESCE(d.status, 'completed') <> ALL(ARRAY[${HIDDEN_GALLERY_STATUSES.map(s => `'${s}'`).join(',')}])`);
    directWhere.push(`lower(COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))) IN (${MEDIA_EXT_SQL})`);
    const fileWhere = buildItemFilters({
      req, params,
      fileExpr: 'df.relpath',
      extExpr: "regexp_replace(df.relpath, '^.*\\.', '')",
      ratingExpr: 'df.rating',
    });
    fileWhere.push(`df.relpath !~* '${AUX_RELPATH_RE}'`);
    fileWhere.push(`COALESCE(d.status, 'completed') <> ALL(ARRAY[${HIDDEN_GALLERY_STATUSES.map(s => `'${s}'`).join(',')}])`);
    fileWhere.push(`lower(regexp_replace(df.relpath, '^.*\\.', '')) IN (${MEDIA_EXTS.map(e=>`'${e}'`).join(',')})`);
    if (since) {
      params.push(since);
      directWhere.push(`COALESCE(d.finished_at, d.updated_at, d.created_at) > $${params.length}::timestamp`);
      fileWhere.push(`COALESCE(to_timestamp(NULLIF(df.mtime_ms,0) / 1000.0)::timestamp, df.updated_at, d.finished_at, d.updated_at, d.created_at) > $${params.length}::timestamp`);
    }

    const sql = `
      SELECT *
        FROM (
          SELECT 'download' AS item_kind,
                 d.id::text AS id, d.id AS rating_id,
                 d.url, d.source_url, d.platform, d.channel, d.title, d.filename,
                 d.filepath, d.filesize, d.format, d.duration, d.rating, d.is_thumb_ready,
                 d.finished_at, d.created_at,
                 COALESCE(d.finished_at, d.updated_at, d.created_at) AS sort_ts
            FROM downloads d
           WHERE ${directWhere.join(' AND ')}
          UNION ALL
          SELECT 'file' AS item_kind,
                 'file-' || df.id::text AS id, d.id AS rating_id,
                 d.url, d.source_url, d.platform, d.channel, d.title,
                 regexp_replace(df.relpath, '^.*/', '') AS filename,
                 df.relpath AS filepath, df.filesize,
                 regexp_replace(df.relpath, '^.*\\.', '') AS format,
                 d.duration, df.rating, COALESCE(df.is_thumb_ready, d.is_thumb_ready) AS is_thumb_ready,
                 d.finished_at, d.created_at,
                 COALESCE(to_timestamp(NULLIF(df.mtime_ms,0) / 1000.0)::timestamp, df.updated_at, d.finished_at, d.updated_at, d.created_at) AS sort_ts
            FROM download_files df
            JOIN downloads d ON d.id = df.download_id
           WHERE ${fileWhere.join(' AND ')}
        ) media_items
      ORDER BY sort_ts DESC, id DESC
      LIMIT 200`;
    const { rows } = await pool.query(sql, params);
    const items = rows.filter(hasNonEmptyMedia).map(mapItem);
    res.json({ items, since, count: items.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Platforms lijst ───────────────────────────────────────────────────────
app.get('/api/platforms', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT platform, COUNT(*) AS count
      FROM (
        SELECT d.platform
          FROM downloads d
         WHERE d.filepath IS NOT NULL AND d.filepath <> ''
           AND lower(COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))) IN (${MEDIA_EXT_SQL})
           AND NOT EXISTS (
             SELECT 1 FROM download_files mf
              WHERE mf.download_id = d.id
                AND mf.relpath !~* '${AUX_RELPATH_RE}'
                AND lower(regexp_replace(mf.relpath, '^.*\\.', '')) IN (${MEDIA_EXTS.map(e=>`'${e}'`).join(',')})
           )
        UNION ALL
        SELECT d.platform
          FROM download_files df
          JOIN downloads d ON d.id = df.download_id
         WHERE df.relpath !~* '${AUX_RELPATH_RE}'
           AND lower(regexp_replace(df.relpath, '^.*\\.', '')) IN (${MEDIA_EXTS.map(e=>`'${e}'`).join(',')})
      ) media_items
      GROUP BY platform
      ORDER BY count DESC`);
    res.json({ platforms: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Channels lijst (per platform) ─────────────────────────────────────────
app.get('/api/channels', async (req, res) => {
  try {
    const platform = req.query.platform ? String(req.query.platform) : null;
    const params = [];
    const platformClause = platform ? `AND d.platform = $1` : '';
    if (platform) params.push(platform);
    const { rows } = await pool.query(`
      SELECT channel, platform, COUNT(*) AS count
      FROM (
        SELECT d.channel, d.platform
          FROM downloads d
         WHERE d.filepath IS NOT NULL AND d.filepath <> ''
           AND lower(COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))) IN (${MEDIA_EXT_SQL})
           ${platformClause}
           AND NOT EXISTS (
             SELECT 1 FROM download_files mf
              WHERE mf.download_id = d.id
                AND mf.relpath !~* '${AUX_RELPATH_RE}'
                AND lower(regexp_replace(mf.relpath, '^.*\\.', '')) IN (${MEDIA_EXTS.map(e=>`'${e}'`).join(',')})
           )
        UNION ALL
        SELECT d.channel, d.platform
          FROM download_files df
          JOIN downloads d ON d.id = df.download_id
         WHERE 1=1
           ${platformClause}
           AND df.relpath !~* '${AUX_RELPATH_RE}'
           AND lower(regexp_replace(df.relpath, '^.*\\.', '')) IN (${MEDIA_EXTS.map(e=>`'${e}'`).join(',')})
      ) media_items
      GROUP BY channel, platform
      ORDER BY count DESC
      LIMIT 500`, params);
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
    const id = fileMatch ? Number(fileMatch[1]) : parseInt(rawId, 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'id vereist' });
    let rating = null;
    if (req.body.rating !== null && req.body.rating !== '') {
      const r = Number(req.body.rating);
      if (!Number.isFinite(r)) return res.status(400).json({ error: 'rating ongeldig' });
      rating = Math.max(0, Math.min(5, Math.round(r * 2) / 2));
    }
    const result = fileMatch
      ? await pool.query('UPDATE download_files SET rating=$1, updated_at=now() WHERE id=$2', [rating, id])
      : await pool.query('UPDATE downloads SET rating=$1, updated_at=now() WHERE id=$2', [rating, id]);
    if (!result.rowCount) return res.status(404).json({ error: 'niet gevonden' });
    res.json({ success: true, id: fileMatch ? `file-${id}` : id, rating });
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
    res.setHeader('Cache-Control', 'public, max-age=3600');
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
    // Probeer meerdere thumb-varianten
    const candidates = [
      path.join(dir, `${base}_thumb_v3.jpg`),
      path.join(dir, `${base}_thumb.jpg`),
      path.join(dir, `${base}.webp`),
      ...(isVideo ? [] : [fp]), // fallback naar origineel alleen voor images
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(c);
      }
    }
    if (isVideo && fs.existsSync(fp)) {
      const generated = await generateVideoThumb(fp);
      if (generated && fs.existsSync(generated)) {
        if (/^\d+$/.test(String(req.params.id))) {
          pool.query('UPDATE downloads SET is_thumb_ready = true WHERE id = $1', [Number(req.params.id)]).catch(() => {});
        } else if (String(req.params.id).startsWith('file-')) {
          pool.query('UPDATE download_files SET is_thumb_ready = true WHERE id = $1', [Number(String(req.params.id).slice(5))]).catch(() => {});
        }
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(generated);
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
      SELECT t.id, t.name, COUNT(iut.download_id)::int AS uses
        FROM tags t
        LEFT JOIN item_user_tags iut ON iut.tag_id = t.id
       WHERE t.is_user = true
       GROUP BY t.id, t.name
       ORDER BY t.name ASC`);
    res.json({ tags: rows.filter((r) => !isJunkTagName(r.name)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tags', async (req, res) => {
  try {
    const name = cleanTagName(req.body.name);
    if (!name || name.length < 2) return res.status(400).json({ error: 'name vereist' });
    const { rows } = await pool.query(
      'INSERT INTO tags (name, is_user) VALUES ($1, true) ON CONFLICT (name) DO UPDATE SET is_user=true RETURNING id, name',
      [name]);
    res.json({ tag: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/tags/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query('DELETE FROM item_user_tags WHERE tag_id=$1', [id]);
    await pool.query('UPDATE tags SET is_user=false WHERE id=$1', [id]);
    await pool.query(`
      DELETE FROM tags t
       WHERE t.id=$1
         AND NOT EXISTS (SELECT 1 FROM download_tags dt WHERE dt.tag=t.name)`,
      [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Tags op een item
app.get('/api/items/:id/tags', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      'SELECT t.id, t.name FROM tags t JOIN item_user_tags iut ON iut.tag_id=t.id WHERE iut.download_id=$1 ORDER BY t.name',
      [id]);
    res.json({ tags: rows.filter((r) => !isJunkTagName(r.name)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/items/:id/tags', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id, 10);
    const tagId = parseInt(req.body.tag_id, 10);
    if (!Number.isFinite(tagId)) return res.status(400).json({ error: 'tag_id vereist' });
    const tag = await pool.query('UPDATE tags SET is_user=true WHERE id=$1 RETURNING id', [tagId]);
    if (!tag.rows[0]) return res.status(404).json({ error: 'tag niet gevonden' });
    await pool.query(
      'INSERT INTO item_user_tags (download_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [itemId, tagId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/items/:id/tags/:tagId', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id, 10);
    const tagId = parseInt(req.params.tagId, 10);
    await pool.query('DELETE FROM item_user_tags WHERE download_id=$1 AND tag_id=$2', [itemId, tagId]);
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

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`webdl-gallery listening on http://localhost:${PORT}`);
      syncKeep2ShareFiles('startup').catch((e) => console.warn('[keep2share-sync] failed:', e.message));
      setInterval(() => {
        syncKeep2ShareFiles('timer').catch((e) => console.warn('[keep2share-sync] failed:', e.message));
      }, KEEP2SHARE_SYNC_MS).unref();
    });
  })
  .catch((e) => {
    console.error('webdl-gallery schema init failed:', e);
    process.exit(1);
  });
