// src/queue/worker.js — concurrency-loop die jobs claimt en adapters uitvoert.
'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { runProcess } = require('../util/process-runner');

const FFMPEG = process.env.WEBDL_FFMPEG || '/opt/homebrew/bin/ffmpeg';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://jurgen@localhost:5432/webdl';

// Video extensions die een thumbnail mogen krijgen
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi', '.flv', '.ts']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);
const SKIP_EXTS = new Set(['.part', '.ytdl', '.tmp']);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Thumbnail generatie ──────────────────────────────────────────────────────
function generateThumbnail(videoPath) {
  return new Promise((resolve) => {
    const ext = path.extname(videoPath).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) return resolve(null);

    const dir = path.dirname(videoPath);
    const base = path.basename(videoPath, path.extname(videoPath));
    const thumbPath = path.join(dir, `${base}_thumb.jpg`);

    execFile(FFMPEG, [
      '-y', '-i', videoPath,
      '-ss', '00:00:02',
      '-vframes', '1',
      '-vf', 'scale=320:-1',
      '-q:v', '6',
      thumbPath,
    ], { timeout: 30_000 }, (err) => {
      if (err || !fsSync.existsSync(thumbPath)) {
        execFile(FFMPEG, [
          '-y', '-i', videoPath,
          '-vframes', '1',
          '-vf', 'scale=320:-1',
          '-q:v', '6',
          thumbPath,
        ], { timeout: 15_000 }, (err2) => {
          resolve(err2 ? null : thumbPath);
        });
      } else {
        resolve(thumbPath);
      }
    });
  });
}

// ─── Platform detectie vanuit URL ─────────────────────────────────────────────
function detectPlatform(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes('youtube') || h.includes('youtu.be')) return 'youtube';
    if (h.includes('vimeo')) return 'vimeo';
    if (h.includes('tiktok')) return 'tiktok';
    if (h.includes('reddit')) return 'reddit';
    if (h.includes('instagram')) return 'instagram';
    if (h.includes('twitter') || h.includes('x.com')) return 'twitter';
    if (h.includes('twitch')) return 'twitch';
    if (h.includes('danbooru')) return 'danbooru';
    return h.replace(/^www\./, '').split('.')[0];
  } catch { return 'unknown'; }
}

// ─── Kanaal/uploader uit yt-dlp info.json ─────────────────────────────────────
async function readInfoJson(workdir) {
  try {
    const entries = await fs.readdir(workdir);
    for (const e of entries) {
      if (e.endsWith('.info.json')) {
        const raw = await fs.readFile(path.join(workdir, e), 'utf8');
        const data = JSON.parse(raw);
        return {
          channel: data.channel || data.uploader || data.uploader_id || data.playlist_title || '',
          title: data.fulltitle || data.title || '',
          sourceUrl: data.webpage_url || data.original_url || data.url || '',
          platform: data.extractor_key ? data.extractor_key.toLowerCase() : '',
        };
      }
    }
  } catch {}
  return null;
}

// ─── Pre-download dedup: check of URL al in simple-server gallery staat ─────
async function checkGalleryDuplicate(url) {
  if (!url) return null;
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    const { rows } = await pool.query(
      `SELECT id, filepath, title, status FROM downloads
         WHERE (source_url = $1 OR url = $1)
           AND status IN ('completed', 'downloading', 'postprocessing')
         ORDER BY
           CASE status WHEN 'completed' THEN 0 ELSE 1 END,
           id DESC
         LIMIT 1`,
      [url],
    );
    return rows[0] || null;
  } catch (_) {
    return null;
  } finally {
    await pool.end();
  }
}

// ─── Gallery sync: insert voltooide download in public.downloads ──────────────
async function syncToGallery(job, outputFiles, logger) {
  const { Pool } = require('pg');
  const galleryPool = new Pool({ connectionString: DATABASE_URL, max: 2 });

  const platform = detectPlatform(job.url);

  // Probeer info.json te lezen voor betere metadata
  const workdir = path.dirname(outputFiles[0]?.path || '');
  const info = await readInfoJson(workdir);

  const channel = info?.channel || (job.options?.playlistTitle) || '';
  const realPlatform = info?.platform || platform;

  try {
    for (const f of outputFiles) {
      const ext = path.extname(f.path).toLowerCase();
      const isVideo = VIDEO_EXTS.has(ext);
      const isImage = IMAGE_EXTS.has(ext);
      if (!isVideo && !isImage) continue;
      // Skip thumbnails en temp files
      if (/_thumb(_v\d+)?\.(jpe?g|png|webp)$/i.test(path.basename(f.path))) continue;
      if (SKIP_EXTS.has(ext)) continue;

      const title = path.basename(f.path, ext).replace(/_/g, ' ').trim();
      const sourceUrl = info?.sourceUrl || job.url;

      // Check for duplicate by filepath
      const existing = await galleryPool.query(
        'SELECT id FROM downloads WHERE filepath = $1 LIMIT 1',
        [f.path],
      );
      if (existing.rows.length > 0) continue;

      // Check for duplicate by source URL
      if (sourceUrl) {
        const byUrl = await galleryPool.query(
          'SELECT id FROM downloads WHERE source_url = $1 LIMIT 1',
          [sourceUrl],
        );
        if (byUrl.rows.length > 0) continue;
      }

      const stat = fsSync.statSync(f.path);
      await galleryPool.query(
        `INSERT INTO downloads
          (url, platform, channel, title, filename, filepath, filesize, format,
           status, progress, metadata, source_url, created_at, updated_at, finished_at, is_thumb_ready)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                 'completed', 100, $9::jsonb, $10, now(), now(), now(), $11)
         ON CONFLICT DO NOTHING`,
        [
          sourceUrl,
          realPlatform,
          channel,
          title,
          path.basename(f.path),
          f.path,
          stat.size,
          ext.replace('.', ''),
          JSON.stringify({ hub_job_id: job.id, adapter: job.adapter }),
          sourceUrl,
          f._thumbPath ? true : false,
        ],
      );
      logger.info('gallery.synced', { job: job.id, file: path.basename(f.path), platform: realPlatform, channel });
    }
  } catch (e) {
    logger.warn('gallery.sync.error', { job: job.id, err: e.message });
  } finally {
    await galleryPool.end();
  }
}

function startWorkerPool({
  queue,
  repo,
  adapters,
  logger,
  downloadRoot,
  concurrency = 2,
  pollMs = 1000,
}) {
  const byName = new Map(adapters.map((a) => [a.name, a]));
  const workerId = `w-${crypto.randomBytes(3).toString('hex')}`;
  let stopping = false;
  const active = new Set();

  // Reclaim stale jobs at startup: jobs marked 'running' from previous worker
  // processes that died without cleanup. 100%-jobs → done, rest → requeued.
  (async () => {
    try {
      const { rows: doneRows } = await repo.pool.query(
        `UPDATE ${repo.schema}.jobs
            SET status='done', finished_at=now(),
                locked_by=NULL, locked_at=NULL
          WHERE status='running' AND progress_pct >= 100
        RETURNING id`,
      );
      const { rows: requeuedRows } = await repo.pool.query(
        `UPDATE ${repo.schema}.jobs
            SET status='queued',
                locked_by=NULL, locked_at=NULL, started_at=NULL
          WHERE status='running'
            AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '10 minutes')
        RETURNING id`,
      );
      if (doneRows.length || requeuedRows.length) {
        logger.info('worker.startup.reclaim', {
          markedDone: doneRows.map((r) => r.id),
          requeued: requeuedRows.map((r) => r.id),
        });
      }
    } catch (e) {
      logger.warn('worker.startup.reclaim.error', { err: String(e.message || e) });
    }
  })();

  async function runOne(job) {
    const workdir = path.join(downloadRoot, String(job.id));
    await fs.mkdir(workdir, { recursive: true });

    const adapter = byName.get(job.adapter);
    if (!adapter) {
      await repo.appendLog(job.id, 'error', `Onbekende adapter: ${job.adapter}`);
      await queue.fail(job.id, `Onbekende adapter: ${job.adapter}`);
      return;
    }

    // Pre-download dedup: skip als URL al in simple-server gallery staat.
    // Alleen voor specifieke video/post URLs — niet voor playlists/channels
    // (die worden door yt-dlp zelf ge-expand).
    const urlLower = String(job.url || '').toLowerCase();
    const isExpandable =
      /\/playlist\?list=/.test(urlLower) ||
      /\/@[^/]+\/?(shorts|videos|streams)?\/?$/.test(urlLower) ||
      /\/channel\//.test(urlLower) ||
      /\/c\//.test(urlLower);
    if (!isExpandable) {
      try {
        const dupe = await checkGalleryDuplicate(job.url);
        if (dupe) {
          await repo.appendLog(
            job.id,
            'info',
            `⏭️  Al in gallery (download #${dupe.id}, status=${dupe.status}): ${dupe.title || dupe.filepath || ''}`,
          );
          await queue.progress(job.id, 100).catch(() => {});
          await queue.complete(job.id);
          logger.info('job.dedup.skipped', { job: job.id, galleryId: dupe.id, url: job.url });
          return;
        }
      } catch (e) {
        logger.warn('job.dedup.check.error', { job: job.id, err: String(e.message || e) });
      }
    }

    const planned = adapter.plan(job.url, { ...job.options, cwd: workdir });
    const startedAtMs = Date.now();
    await repo.appendLog(job.id, 'info', `start ${adapter.name}: ${planned.cmd} ${planned.args.join(' ')}`);
    logger.info('job.start', { job: job.id, adapter: adapter.name });

    let lastReported = -1;
    let lastLoggedTitle = '';
    const proc = runProcess(planned);

    proc.on('line', async ({ stream, line }) => {
      const prog = adapter.parseProgress(line);
      if (prog && typeof prog.pct === 'number') {
        const pct = Math.max(0, Math.min(100, prog.pct));
        if (pct - lastReported >= 1) {
          lastReported = pct;
          try { await queue.progress(job.id, pct, { speed: prog.speed, eta: prog.eta }); } catch (_) {}
        }
      } else if (stream === 'stderr') {
        try { await repo.appendLog(job.id, 'warn', line.slice(0, 500)); } catch (_) {}
      } else if (stream === 'stdout') {
        // Log yt-dlp [download] en [info] regels voor zichtbaarheid
        const trimmed = line.trim();
        if (trimmed.startsWith('[download] Downloading') || trimmed.startsWith('[download] Destination')) {
          try { await repo.appendLog(job.id, 'info', trimmed.slice(0, 300)); } catch (_) {}
        }
        // Log elke video-titel uit de playlist
        if (trimmed.startsWith('[download] Downloading item') || trimmed.startsWith('[youtube]')) {
          const titleMatch = trimmed.match(/Downloading item (\d+) of (\d+)/);
          if (titleMatch) {
            const msg = `📥 Video ${titleMatch[1]}/${titleMatch[2]}`;
            if (msg !== lastLoggedTitle) {
              lastLoggedTitle = msg;
              try { await repo.appendLog(job.id, 'info', msg); } catch (_) {}
            }
          }
        }
      }
    });

    try {
      const { code } = await proc.done;
      if (code === 0) {
        const outs = await adapter.collectOutputs(workdir, { job, startedAtMs });

        // Thumbnails genereren
        for (const f of outs) {
          try {
            const thumbPath = await generateThumbnail(f.path);
            if (thumbPath) {
              f._thumbPath = thumbPath;
              await repo.appendLog(job.id, 'info', `🖼️ thumbnail: ${path.basename(thumbPath)}`);
            }
          } catch (_) {}
        }

        for (const f of outs) await repo.addFile(job.id, f);
        await queue.complete(job.id);
        await repo.appendLog(job.id, 'info', `✅ klaar, ${outs.length} bestand(en)`);
        logger.info('job.done', { job: job.id, files: outs.length });

        // Gallery sync — alleen voltooide downloads
        try {
          const freshJob = await repo.getJob(job.id);
          await syncToGallery(freshJob || job, outs, logger);
          await repo.markGallerySynced(job.id);
          await repo.appendLog(job.id, 'info', '📺 gallery sync voltooid');
        } catch (e) {
          await repo.appendLog(job.id, 'warn', `gallery sync mislukt: ${e.message}`);
        }
        return true; // success
      } else {
        const retry = job.attempts < job.max_attempts;
        await queue.fail(job.id, `exit ${code}`, { retry });
        await repo.appendLog(job.id, retry ? 'warn' : 'error', `exit ${code}${retry ? ' (retry)' : ''}`);
        logger.warn('job.failed', { job: job.id, code, retry });
        return false; // failure
      }
    } catch (err) {
      const retry = job.attempts < job.max_attempts;
      await queue.fail(job.id, String(err.message || err), { retry });
      logger.error('job.error', { job: job.id, err: String(err.message || err) });
      return false; // failure
    }
  }

  // ─── Per-domain rate limiting ────────────────────────────────────────────────
  // Houdt per domein bij wanneer de laatste download startte en hoeveel
  // opeenvolgende failures er waren. Bij failures groeit de wachttijd
  // exponentieel (backoff). Bij successen reset de backoff.
  const domainState = new Map(); // domain → { lastStartMs, consecutiveFails }

  // Configuratie per domein-patroon (defaults voor onbekende domeinen)
  const DOMAIN_THROTTLE = {
    'youtube':   { baseSpacingMs: 5000,  maxBackoffMs: 60000, jitterMs: 2000 },
    'tiktok':    { baseSpacingMs: 3000,  maxBackoffMs: 30000, jitterMs: 1500 },
    'instagram': { baseSpacingMs: 4000,  maxBackoffMs: 45000, jitterMs: 2000 },
    'reddit':    { baseSpacingMs: 2000,  maxBackoffMs: 20000, jitterMs: 1000 },
    '_default':  { baseSpacingMs: 500,   maxBackoffMs: 10000, jitterMs: 500  },
  };

  function domainKey(url) {
    try {
      const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      if (h.includes('youtube') || h.includes('youtu.be')) return 'youtube';
      if (h.includes('tiktok')) return 'tiktok';
      if (h.includes('instagram')) return 'instagram';
      if (h.includes('reddit')) return 'reddit';
      return h;
    } catch { return 'unknown'; }
  }

  function getThrottleConfig(domain) {
    return DOMAIN_THROTTLE[domain] || DOMAIN_THROTTLE._default;
  }

  function getDomainState(domain) {
    if (!domainState.has(domain)) {
      domainState.set(domain, { lastStartMs: 0, consecutiveFails: 0 });
    }
    return domainState.get(domain);
  }

  function computeWaitMs(domain) {
    const conf = getThrottleConfig(domain);
    const ds = getDomainState(domain);
    const elapsed = Date.now() - ds.lastStartMs;

    // Backoff: spacing verdubbelt per opeenvolgende failure, met plafond
    const backoffMultiplier = Math.min(Math.pow(2, ds.consecutiveFails), 32);
    const spacing = Math.min(conf.baseSpacingMs * backoffMultiplier, conf.maxBackoffMs);
    const jitter = Math.floor(Math.random() * conf.jitterMs);
    const needed = spacing + jitter;

    return Math.max(0, needed - elapsed);
  }

  function markDomainStarted(domain) {
    getDomainState(domain).lastStartMs = Date.now();
  }

  function markDomainSuccess(domain) {
    const ds = getDomainState(domain);
    ds.consecutiveFails = 0;
  }

  function markDomainFailed(domain) {
    const ds = getDomainState(domain);
    ds.consecutiveFails++;
    const conf = getThrottleConfig(domain);
    const backoff = Math.min(conf.baseSpacingMs * Math.pow(2, ds.consecutiveFails), conf.maxBackoffMs);
    logger.info('throttle.backoff', { domain, fails: ds.consecutiveFails, nextDelayMs: backoff });
  }

  // Wrap runOne om domain throttle te beheren
  async function runOneThrottled(job) {
    const domain = domainKey(job.url);
    markDomainStarted(domain);
    const ok = await runOne(job);
    if (ok === false) {
      markDomainFailed(domain);
    } else {
      markDomainSuccess(domain);
    }
  }

  // ─── Lane-based loops ──────────────────────────────────────────────────────
  // Elke lane heeft eigen concurrency-limiet en eigen worker-loop.
  //   process-video: 1 (ffmpeg merge CPU-zwaar)
  //   video:         2 (directe video, geen merge)
  //   image:         6 (snel, netwerk-bound)
  const LANES = [
    { name: 'process-video', concurrency: 1 },
    { name: 'video',         concurrency: 2 },
    { name: 'image',         concurrency: 6 },
  ];
  const laneActive = new Map(LANES.map((l) => [l.name, new Set()]));

  async function laneLoop(lane, maxConcurrency) {
    const laneSet = laneActive.get(lane);
    while (!stopping) {
      if (laneSet.size >= maxConcurrency) { await sleep(pollMs); continue; }

      const job = await queue.claimNext(workerId, { lane }).catch((e) => {
        logger.error('queue.claim.error', { lane, err: String(e.message || e) });
        return null;
      });
      if (!job) { await sleep(pollMs); continue; }

      // Per-domain rate limiting: wacht indien nodig
      const domain = domainKey(job.url);
      const waitMs = computeWaitMs(domain);
      if (waitMs > 0) {
        logger.info('throttle.wait', { job: job.id, domain, waitMs, lane });
        await sleep(waitMs);
      }

      const p = runOneThrottled(job)
        .catch(() => { /* errors handled inside runOneThrottled */ })
        .finally(() => laneSet.delete(p));
      laneSet.add(p);
    }
    await Promise.all(laneSet);
  }

  const loopPromises = LANES.map((l) => laneLoop(l.name, l.concurrency));

  async function stop() {
    stopping = true;
    await Promise.all(loopPromises);
  }

  function stats() {
    const out = {};
    for (const l of LANES) out[l.name] = { active: laneActive.get(l.name).size, limit: l.concurrency };
    // Voeg throttle-info toe
    const throttle = {};
    for (const [domain, ds] of domainState) {
      throttle[domain] = {
        consecutiveFails: ds.consecutiveFails,
        nextWaitMs: computeWaitMs(domain),
      };
    }
    out._throttle = throttle;
    return out;
  }

  return { stop, workerId, stats };
}

module.exports = { startWorkerPool };
