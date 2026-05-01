// src/importers/sabnzbd-watch.js — importeer SABNZBD completed media naar hub + gallery.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi', '.flv', '.ts', '.wmv']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);
const SKIP_BASENAME_RE = /(_thumb(_v\d+)?|_preview|_logo)\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const SKIP_PATH_SEGMENT_RE = /^(?:_UNPACK_|_FAILED_|_ADMIN_|__ADMIN__|incomplete)/i;
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'SABnzbd', 'sabnzbd.ini');

function isMediaPath(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (!VIDEO_EXTS.has(ext) && !IMAGE_EXTS.has(ext)) return false;
  const base = path.basename(filePath || '');
  if (!base || base.startsWith('.')) return false;
  if (SKIP_BASENAME_RE.test(base)) return false;
  if (String(filePath || '').split(path.sep).some((part) => SKIP_PATH_SEGMENT_RE.test(part))) return false;
  if (/\.(part|tmp|crdownload|!qb)$/i.test(base)) return false;
  return true;
}

function parseIniValue(raw) {
  return String(raw || '').trim().replace(/^["']|["']$/g, '');
}

function readSabnzbdConfig(configPath = '') {
  const filePath = configPath || DEFAULT_CONFIG_PATH;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const out = {};
    let section = '';
    for (const line of raw.split(/\r?\n/)) {
      const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
      if (sectionMatch) {
        section = sectionMatch[1].toLowerCase();
        continue;
      }
      if (section && section !== 'misc') continue;
      const m = line.match(/^\s*([a-z_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1].toLowerCase();
      if (['host', 'port', 'https_port', 'api_key', 'complete_dir', 'download_dir'].includes(key)) {
        out[key] = parseIniValue(m[2]);
      }
    }
    return out;
  } catch (_) {
    return {};
  }
}

function buildSabnzbdUrl(config, explicitUrl = '') {
  if (explicitUrl) return explicitUrl.replace(/\/+$/, '');
  const host = config.host || '127.0.0.1';
  const httpsPort = String(config.https_port || '').trim();
  const port = httpsPort || config.port || '8080';
  const scheme = httpsPort ? 'https' : 'http';
  return `${scheme}://${host}:${port}`;
}

async function fetchSabnzbdJson({ mode, configPath = '', url = '', apiKey = '', extra = {}, timeoutMs = 5000 } = {}) {
  const cfg = readSabnzbdConfig(configPath);
  const key = apiKey || cfg.api_key || '';
  if (!key) {
    throw Object.assign(new Error('SABNZBD API key ontbreekt'), { code: 'NO_API_KEY' });
  }
  const base = buildSabnzbdUrl(cfg, url);
  const endpoint = new URL('/api', base);
  endpoint.searchParams.set('mode', mode);
  endpoint.searchParams.set('output', 'json');
  endpoint.searchParams.set('apikey', key);
  for (const [k, v] of Object.entries(extra || {})) {
    if (v !== undefined && v !== null && v !== '') endpoint.searchParams.set(k, String(v));
  }
  const res = await fetch(endpoint, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`SABNZBD ${mode}: HTTP ${res.status}`);
  return { base, data: await res.json() };
}

async function fetchSabnzbdHistory({ configPath = '', url = '', apiKey = '', logger = null } = {}) {
  try {
    const { data } = await fetchSabnzbdJson({
      mode: 'history',
      configPath,
      url,
      apiKey,
      extra: { limit: 500 },
    });
    return Array.isArray(data?.history?.slots) ? data.history.slots : [];
  } catch (e) {
    if (e && e.code === 'NO_API_KEY') return [];
    if (logger) logger.warn('sabnzbd.history.error', { err: String(e.message || e) });
    return [];
  }
}

function statfsInfo(dir) {
  try {
    const stat = fs.statfsSync(dir);
    const blockSize = Number(stat.bsize || stat.frsize || 0);
    const total = Number(stat.blocks || 0) * blockSize;
    const free = Number(stat.bavail || stat.bfree || 0) * blockSize;
    return { path: dir, total, free, used: total > 0 ? total - free : 0 };
  } catch (e) {
    return { path: dir, error: String(e.message || e) };
  }
}

function normalizeRootDirs({ rootDir = '', rootDirs = [] } = {}) {
  const values = Array.isArray(rootDirs) ? rootDirs : [rootDirs];
  if (rootDir) values.unshift(rootDir);
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const resolved = path.resolve(value);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

async function fetchSabnzbdStatus({ configPath = '', url = '', apiKey = '', completedDir = '', completedDirs = [], downloadRoot = '', logger = null } = {}) {
  const startedAt = Date.now();
  try {
    const sabConfig = readSabnzbdConfig(configPath);
    const [{ base, data: queueData }, { data: historyData }] = await Promise.all([
      fetchSabnzbdJson({ mode: 'queue', configPath, url, apiKey }),
      fetchSabnzbdJson({ mode: 'history', configPath, url, apiKey, extra: { limit: 20 } }),
    ]);
    const queue = queueData.queue || {};
    const slots = Array.isArray(queue.slots) ? queue.slots : [];
    const history = historyData.history || {};
    const historySlots = Array.isArray(history.slots) ? history.slots : [];
    return {
      ok: true,
      baseUrl: base,
      ms: Date.now() - startedAt,
      queue: {
        status: queue.status || '',
        paused: Boolean(queue.paused),
        noOfSlots: Number(queue.noofslots || slots.length || 0),
        speed: queue.speed || '',
        speedLimit: queue.speedlimit_abs || queue.speedlimit || '',
        size: queue.size || '',
        sizeLeft: queue.sizeleft || '',
        timeLeft: queue.timeleft || '',
        slots: slots.slice(0, 12).map((slot) => ({
          nzoId: slot.nzo_id || '',
          name: slot.filename || slot.name || '',
          status: slot.status || '',
          percentage: Number.parseFloat(slot.percentage || '0') || 0,
          size: slot.size || '',
          sizeLeft: slot.sizeleft || '',
          timeLeft: slot.timeleft || '',
        })),
      },
      history: {
        noOfSlots: Number(history.noofslots || historySlots.length || 0),
        slots: historySlots.slice(0, 8).map((slot) => ({
          nzoId: slot.nzo_id || '',
          name: slot.name || slot.nzb_name || '',
          status: slot.status || '',
          category: slot.category || '',
          completed: slot.completed || null,
        })),
      },
      disks: {
        completed: normalizeRootDirs({ rootDir: completedDir, rootDirs: completedDirs }).map((dir) => statfsInfo(dir)),
        sabDownloading: sabConfig.download_dir ? statfsInfo(sabConfig.download_dir) : null,
        sabCompleted: sabConfig.complete_dir ? statfsInfo(sabConfig.complete_dir) : null,
        downloadRoot: downloadRoot ? statfsInfo(downloadRoot) : null,
      },
    };
  } catch (e) {
    if (logger) logger.warn('sabnzbd.status.error', { err: String(e.message || e) });
    return { ok: false, error: String(e.message || e), ms: Date.now() - startedAt };
  }
}

function normalizeForMatch(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findHistoryForFile(filePath, history = []) {
  const parent = path.basename(path.dirname(filePath));
  const fileBase = path.basename(filePath, path.extname(filePath));
  const parentNorm = normalizeForMatch(parent);
  const fileNorm = normalizeForMatch(fileBase);
  let best = null;
  let bestScore = 0;
  for (const slot of history) {
    const name = slot.name || slot.nzb_name || slot.nzb || '';
    const storage = slot.storage || '';
    const norm = normalizeForMatch(name);
    let score = 0;
    if (storage && filePath.startsWith(path.resolve(storage))) score += 10;
    if (norm && parentNorm && norm === parentNorm) score += 8;
    if (norm && fileNorm && (norm.includes(fileNorm) || fileNorm.includes(norm))) score += 5;
    if (score > bestScore) {
      best = slot;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function walkMediaFiles(rootDir, { maxDepth = 8 } = {}) {
  const out = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      if (!entry || !entry.name || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile() && isMediaPath(fullPath)) {
        out.push(fullPath);
      }
    }
  }
  walk(rootDir, 0);
  return out;
}

function deriveMetadata(filePath, rootDir, historyItem = null) {
  const ext = path.extname(filePath).toLowerCase();
  const folder = path.basename(path.dirname(filePath));
  const name = historyItem?.name || historyItem?.nzb_name || folder;
  const category = String(historyItem?.category || '').trim();
  const title = path.basename(filePath, ext).replace(/[._-]+/g, ' ').trim() || name || 'sabnzbd import';
  const channel = category || folder || 'SABNZBD';
  const type = IMAGE_EXTS.has(ext) ? 'image' : 'video';
  return {
    url: `file://${filePath}`,
    platform: 'sabnzbd',
    channel,
    title,
    filename: path.basename(filePath),
    format: ext.replace('.', ''),
    type,
    lane: type === 'image' ? 'image' : 'video',
    metadata: {
      webdl_kind: type === 'image' ? 'imported_image' : 'imported_video',
      imported: true,
      importer: 'sabnzbd-watch',
      root_dir: rootDir,
      source_filepath: filePath,
      sabnzbd: historyItem ? {
        name: historyItem.name || null,
        nzb_name: historyItem.nzb_name || null,
        category: historyItem.category || null,
        status: historyItem.status || null,
        completed: historyItem.completed || null,
        nzo_id: historyItem.nzo_id || null,
      } : null,
    },
  };
}

async function importSabnzbdFile({ repo, filePath, rootDir, history = [], minFileAgeMs = 15_000, logger = null }) {
  const schema = repo.schema || 'webdl';
  const jobsTable = `"${schema}".jobs`;
  const filesTable = `"${schema}".files`;
  const absPath = path.resolve(filePath);
  if (!isMediaPath(absPath)) return { imported: false, reason: 'not_media', filePath: absPath };
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch (_) {
    return { imported: false, reason: 'missing', filePath: absPath };
  }
  if (!stat.isFile() || stat.size <= 0) return { imported: false, reason: 'empty', filePath: absPath };
  if (Date.now() - Number(stat.mtimeMs || 0) < minFileAgeMs) {
    return { imported: false, reason: 'too_new', filePath: absPath };
  }

  const alreadyFile = await repo.pool.query(`SELECT id FROM ${filesTable} WHERE path = $1 LIMIT 1`, [absPath]);
  const alreadyGallery = await repo.pool.query('SELECT id FROM public.downloads WHERE filepath = $1 LIMIT 1', [absPath]);
  if (alreadyFile.rows.length && alreadyGallery.rows.length) {
    return { imported: false, reason: 'exists', filePath: absPath };
  }

  const historyItem = findHistoryForFile(absPath, history);
  const meta = deriveMetadata(absPath, rootDir, historyItem);
  const now = new Date().toISOString();

  const client = await repo.pool.connect();
  try {
    await client.query('BEGIN');
    let jobId = null;
    const existingJob = await client.query(
      `SELECT j.id
         FROM ${filesTable} f
         JOIN ${jobsTable} j ON j.id = f.job_id
        WHERE f.path = $1
        LIMIT 1`,
      [absPath],
    );
    if (existingJob.rows[0]?.id) {
      jobId = existingJob.rows[0].id;
    } else {
      const job = await client.query(
        `INSERT INTO ${jobsTable}
          (url, adapter, status, priority, options, progress_pct, attempts, max_attempts,
           lane, created_at, started_at, finished_at)
         VALUES ($1, 'sabnzbd-import', 'done', 0, $2::jsonb, 100, 1, 1,
                 $3, $4::timestamptz, $4::timestamptz, $4::timestamptz)
         RETURNING id`,
        [meta.url, JSON.stringify(meta.metadata), meta.lane, now],
      );
      jobId = job.rows[0].id;
    }

    await client.query(
      `INSERT INTO ${filesTable} (job_id, path, size, mime)
       SELECT $1, $2, $3, $4
       WHERE NOT EXISTS (SELECT 1 FROM ${filesTable} WHERE path = $2)`,
      [jobId, absPath, stat.size, meta.type === 'image' ? `image/${meta.format}` : `video/${meta.format}`],
    );

    const gallery = await client.query(
      `INSERT INTO public.downloads
        (url, platform, channel, title, filename, filepath, filesize, format,
         status, progress, metadata, source_url, created_at, updated_at, finished_at, is_thumb_ready)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8,
              'completed', 100, $9::jsonb, $1,
              $10::timestamptz, $10::timestamptz, $10::timestamptz, $11
       WHERE NOT EXISTS (SELECT 1 FROM public.downloads WHERE filepath = $6)
       RETURNING id`,
      [
        meta.url,
        meta.platform,
        meta.channel,
        meta.title,
        meta.filename,
        absPath,
        stat.size,
        meta.format,
        JSON.stringify({ ...meta.metadata, hub_job_id: jobId }),
        now,
        meta.type === 'image',
      ],
    );
    await client.query('COMMIT');
    if (gallery.rowCount && logger) {
      logger.info('sabnzbd.imported', { job: jobId, file: meta.filename, channel: meta.channel, type: meta.type });
    }
    return { imported: gallery.rowCount > 0, reason: gallery.rowCount ? 'inserted' : 'hub_only', jobId, filePath: absPath };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (logger) logger.warn('sabnzbd.import.error', { file: absPath, err: String(e.message || e) });
    return { imported: false, reason: 'error', error: String(e.message || e), filePath: absPath };
  } finally {
    client.release();
  }
}

async function scanSabnzbdCompleted({ repo, rootDir, configPath = '', sabnzbdUrl = '', sabnzbdApiKey = '', minFileAgeMs = 15_000, logger = null, shouldStop = null } = {}) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return { success: false, rootDir, error: 'completed dir missing', imported: 0, skipped: 0, errors: 0 };
  }
  const history = await fetchSabnzbdHistory({ configPath, url: sabnzbdUrl, apiKey: sabnzbdApiKey, logger });
  const files = walkMediaFiles(rootDir);
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const details = [];
  for (const filePath of files) {
    if (shouldStop && shouldStop()) break;
    let result;
    try {
      result = await importSabnzbdFile({ repo, filePath, rootDir, history, minFileAgeMs, logger });
    } catch (e) {
      result = { imported: false, reason: 'error', error: String(e.message || e), filePath };
      if (logger) logger.warn('sabnzbd.import.unhandled_error', { file: filePath, err: result.error });
    }
    if (result.imported) imported++;
    else if (result.reason === 'error') errors++;
    else skipped++;
    if (result.imported || result.reason === 'error') details.push(result);
  }
  return { success: true, rootDir, files: files.length, imported, skipped, errors, details: details.slice(0, 50) };
}

function startSabnzbdWatcher({ repo, logger, rootDir, rootDirs = [], pollMs = 30_000, minFileAgeMs = 15_000, configPath = '', sabnzbdUrl = '', sabnzbdApiKey = '' } = {}) {
  const roots = normalizeRootDirs({ rootDir, rootDirs });
  let stopped = false;
  let inProgress = false;
  let timer = null;
  let startupTimer = null;
  let currentTick = null;

  async function tick(reason) {
    if (stopped || inProgress) return;
    inProgress = true;
    currentTick = (async () => {
      for (const currentRoot of roots) {
        if (stopped) break;
        let result;
        try {
          result = await scanSabnzbdCompleted({
            repo,
            rootDir: currentRoot,
            configPath,
            sabnzbdUrl,
            sabnzbdApiKey,
            minFileAgeMs,
            logger,
            shouldStop: () => stopped,
          });
        } catch (e) {
          if (logger) logger.warn('sabnzbd.scan.error', { reason, rootDir: currentRoot, err: String(e.message || e) });
          continue;
        }
        if (!result.success) {
          if (logger) logger.warn('sabnzbd.scan.skipped', { reason: result.error, rootDir: currentRoot });
        } else if (result.imported || reason === 'startup') {
          if (logger) logger.info('sabnzbd.scan.done', { reason, rootDir: currentRoot, files: result.files, imported: result.imported, skipped: result.skipped, errors: result.errors });
        }
      }
    })();
    try {
      await currentTick;
    } finally {
      inProgress = false;
      currentTick = null;
    }
  }

  if (logger) logger.info('sabnzbd.watch.started', { rootDirs: roots, pollMs, minFileAgeMs });
  timer = setInterval(() => tick('poll'), pollMs);
  startupTimer = setTimeout(() => tick('startup'), 1500);

  return {
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      if (startupTimer) clearTimeout(startupTimer);
      timer = null;
      startupTimer = null;
      if (currentTick) await currentTick;
    },
    scanNow: () => tick('manual'),
  };
}

module.exports = {
  isMediaPath,
  readSabnzbdConfig,
  buildSabnzbdUrl,
  fetchSabnzbdStatus,
  findHistoryForFile,
  normalizeRootDirs,
  statfsInfo,
  scanSabnzbdCompleted,
  startSabnzbdWatcher,
};
