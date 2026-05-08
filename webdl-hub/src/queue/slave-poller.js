// src/queue/slave-poller.js
// Achtergrond-poller die slave-delegated downloads volgt en hun status
// terugkoppelt naar de bijbehorende hub-job. Bij voltooiing:
//  1. importeert file(s) uit public.downloads naar webdl.files
//  2. genereert thumbnail via hub pipeline (als die nog ontbreekt)
//  3. markeert hub-job als 'done'
'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const FFMPEG = process.env.WEBDL_FFMPEG || '/opt/homebrew/bin/ffmpeg';
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi', '.wmv', '.flv', '.ts', '.m2ts', '.mpg', '.mpeg', '.ogv', '.3gp', '.3g2']);
const MEDIA_EXTS = new Set([...VIDEO_EXTS, '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);
const SKIP_BASENAME_RE = /(_thumb(_v\d+)?|_preview|_logo)\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const MEDIA_ROOTS = [
  process.env.WEBDL_BASE_DIR,
  process.env.WEBDL_MEDIA_ROOTS,
  process.env.WEBDL_EXTRA_MEDIA_ROOTS,
  process.env.WEBDL_ALLOWED_MEDIA_ROOTS,
  '/Users/jurgen/Downloads/WEBDL',
  '/Volumes/HDD - One Touch/WEBDL',
  '/Volumes/WEBDL Extra/WEBDL',
].filter(Boolean).flatMap((p) => String(p).split(/[;\n]/).map((v) => v.trim()).filter(Boolean));

function isMediaPath(filePath) {
  const base = path.basename(filePath || '');
  if (SKIP_BASENAME_RE.test(base)) return false;
  return MEDIA_EXTS.has(path.extname(base).toLowerCase());
}

function relativeToMediaRoot(filePath) {
  const abs = path.resolve(filePath);
  for (const root of MEDIA_ROOTS) {
    const rel = path.relative(root, abs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  }
  return abs;
}

function resolveSlaveRelPath(relPath, basePath) {
  const raw = String(relPath || '').trim();
  if (!raw) return '';
  if (path.isAbsolute(raw) && fsSync.existsSync(raw)) return raw;
  const bases = [];
  try {
    const st = fsSync.statSync(basePath);
    bases.push(st.isDirectory() ? basePath : path.dirname(basePath));
  } catch (_) {
    if (basePath) bases.push(path.dirname(basePath));
  }
  bases.push(...MEDIA_ROOTS);
  for (const base of bases) {
    const candidate = path.resolve(base, raw);
    if (fsSync.existsSync(candidate)) return candidate;
  }
  return path.resolve(MEDIA_ROOTS[0] || process.cwd(), raw);
}

async function collectMediaFilesFromDir(dir, limit = 2000) {
  const out = [];
  const stack = [dir];
  while (stack.length && out.length < limit) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && isMediaPath(full)) {
        out.push(full);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

async function inspectSlaveFile(filePath) {
  let st;
  try {
    st = await fs.stat(filePath);
  } catch (_) {
    return { ok: false, size: null, reason: 'slave bestand bestaat niet op disk' };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!MEDIA_EXTS.has(ext)) return { ok: true, size: st.size, reason: '' };

  let head = '';
  try {
    const fh = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(Math.min(4096, Math.max(0, st.size)));
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      head = buf.subarray(0, bytesRead).toString('utf8').toLowerCase();
    } finally {
      await fh.close();
    }
  } catch (_) {}

  if (/<html\b|<!doctype html|<head\b|<body\b|login|cloudflare|keep2share|k2s\.cc/.test(head)) {
    return { ok: false, size: st.size, reason: 'slave kreeg HTML/login-pagina terug in plaats van media' };
  }
  return { ok: true, size: st.size, reason: '' };
}

function generateThumbnail(videoPath) {
  return new Promise((resolve) => {
    const ext = path.extname(videoPath).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) return resolve(null);
    const dir = path.dirname(videoPath);
    const base = path.basename(videoPath, path.extname(videoPath));
    const thumbPath = path.join(dir, `${base}_thumb.jpg`);
    if (fsSync.existsSync(thumbPath)) return resolve(thumbPath);
    execFile(
      FFMPEG,
      ['-y', '-i', videoPath, '-ss', '00:00:02', '-vframes', '1', '-vf', 'scale=320:-1', '-q:v', '6', thumbPath],
      { timeout: 30_000 },
      (err) => resolve(err || !fsSync.existsSync(thumbPath) ? null : thumbPath),
    );
  });
}

async function collectSlaveMediaFiles(repo, row) {
  const files = [];
  const seen = new Set();
  const add = (filePath) => {
    const fp = String(filePath || '').trim();
    if (!fp || !isMediaPath(fp) || seen.has(fp)) return;
    seen.add(fp);
    files.push(fp);
  };

  const indexed = await repo.pool.query(
    `SELECT relpath FROM download_files WHERE download_id = $1 AND relpath IS NOT NULL AND relpath <> '' ORDER BY id`,
    [row.id],
  );
  for (const f of indexed.rows) {
    add(resolveSlaveRelPath(f.relpath, row.filepath));
  }
  if (files.length) return files;

  let st;
  try {
    st = await fs.stat(row.filepath);
  } catch (_) {
    return [];
  }
  if (st.isDirectory()) {
    for (const filePath of await collectMediaFilesFromDir(row.filepath)) add(filePath);
  } else {
    add(row.filepath);
  }
  return files;
}

async function indexSlaveDownloadFiles(repo, downloadId, files) {
  if (!files.length) return 0;
  let indexed = 0;
  for (const filePath of files) {
    const st = await fs.stat(filePath);
    const relpath = relativeToMediaRoot(filePath);
    await repo.pool.query(
      `INSERT INTO download_files (download_id, relpath, filesize, mtime_ms, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (download_id, relpath) DO UPDATE SET
         filesize = EXCLUDED.filesize,
         mtime_ms = EXCLUDED.mtime_ms,
         updated_at = now()`,
      [downloadId, relpath, st.size, Math.floor(st.mtimeMs)],
    );
    indexed++;
  }
  return indexed;
}

function startSlavePoller({ repo, logger, intervalMs = 5000 }) {
  let stopping = false;

  async function processOne(row) {
    const hubJobId = Number(row.hub_job_id);
    if (!Number.isFinite(hubJobId) || hubJobId <= 0) return;

    const hubJob = await repo.getJob(hubJobId);
    if (!hubJob || hubJob.status === 'done' || hubJob.status === 'failed' || hubJob.status === 'cancelled') {
      return; // al afgehandeld of niet meer bestaand
    }

    // Slave error? Markeer hub-job failed.
    if (row.slave_status === 'error') {
      await repo.failJob(hubJobId, row.slave_error || 'slave download failed', { retry: false });
      await repo.appendLog(hubJobId, 'error', `❌ slave error: ${row.slave_error || 'unknown'}`);
      logger.info('slave.failed', { hubJob: hubJobId, downloadId: row.id });
      return;
    }

    // Slave voltooid? Importeer file + thumb + mark done.
    if (row.slave_status === 'completed') {
      if (!row.filepath) {
        await repo.failJob(hubJobId, 'slave download completed without a file path', { retry: false });
        await repo.appendLog(hubJobId, 'error', '❌ slave klaar gemeld, maar zonder bestandspad');
        logger.warn('slave.completed_without_file', { hubJob: hubJobId, downloadId: row.id });
        return;
      }
      try {
        const mediaFiles = await collectSlaveMediaFiles(repo, row);
        if (!mediaFiles.length) {
          await repo.pool.query(
            `UPDATE downloads
                SET status='error',
                    error=$2,
                    updated_at=now()
              WHERE id=$1`,
            [row.id, 'slave download completed without importable media files'],
          );
          await repo.failJob(hubJobId, 'slave download completed without importable media files', { retry: false });
          await repo.appendLog(hubJobId, 'error', `❌ geen importeerbare media in slave output: ${row.filepath}`);
          logger.warn('slave.no_importable_media', { hubJob: hubJobId, downloadId: row.id, filepath: row.filepath });
          return;
        }

        const indexed = await indexSlaveDownloadFiles(repo, row.id, mediaFiles);
        let added = 0;
        let thumbGenerated = 0;

        for (const filePath of mediaFiles) {
          const inspected = await inspectSlaveFile(filePath);
          if (!inspected.ok) {
            logger.warn('slave.invalid_file_skipped', { hubJob: hubJobId, downloadId: row.id, filepath: filePath, reason: inspected.reason });
            continue;
          }
          await repo.addFile(hubJobId, { path: filePath, size: inspected.size, mime: null, checksum: null });
          added++;
          const ext = path.extname(filePath).toLowerCase();
          if (VIDEO_EXTS.has(ext)) {
            const thumb = await generateThumbnail(filePath);
            if (thumb) thumbGenerated++;
          }
        }

        if (added === 0) {
          await repo.failJob(hubJobId, 'slave media files were invalid', { retry: false });
          await repo.appendLog(hubJobId, 'error', `❌ slave media ongeldig: ${row.filepath}`);
          return;
        }
        await repo.appendLog(
          hubJobId,
          'info',
          `✅ slave klaar: ${added} bestand(en) gekoppeld, ${indexed} voor gallery geindexeerd${thumbGenerated ? `, ${thumbGenerated} thumb(s) gegenereerd` : ''}`,
        );
        await repo.completeJob(hubJobId);
        logger.info('slave.done', { hubJob: hubJobId, downloadId: row.id, filepath: row.filepath, files: added, indexed });
      } catch (e) {
        logger.warn('slave.handoff.error', { hubJob: hubJobId, err: String(e.message || e) });
      }
    }
  }

  async function tick() {
    try {
      // Vind hub-jobs in status='running' met slave-delegate adapter die een
      // simple_server_download_id hebben en waarvan de downloads rij klaar
      // of mislukt is.
      const { rows } = await repo.pool.query(
        `SELECT
           (j.options->>'simple_server_download_id')::bigint AS download_id,
           j.id AS hub_job_id,
           d.status    AS slave_status,
           d.filepath  AS filepath,
           d.error     AS slave_error,
           d.id        AS id
         FROM ${repo.schema}.jobs j
         JOIN downloads d
           ON d.id = (j.options->>'simple_server_download_id')::bigint
         WHERE j.status = 'running'
           AND j.adapter = 'slave-delegate'
           AND d.status IN ('completed','error','cancelled')
         LIMIT 50`,
      );
      for (const row of rows) {
        if (stopping) break;
        await processOne(row);
      }
    } catch (e) {
      logger.warn('slave.poller.error', { err: String(e.message || e) });
    }
  }

  async function loop() {
    while (!stopping) {
      await tick();
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  const loopPromise = loop();
  return { stop: async () => { stopping = true; await loopPromise; } };
}

module.exports = { startSlavePoller };
