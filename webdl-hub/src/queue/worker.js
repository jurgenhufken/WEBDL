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
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi', '.wmv', '.flv', '.ts', '.m2ts', '.mpg', '.mpeg', '.ogv', '.3gp', '.3g2']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);
const SKIP_EXTS = new Set(['.part', '.ytdl', '.tmp']);
const AUX_IMAGE_BASENAME_RE = /(^\d{1,3}[-_. ]?thumbnail|(?:^|[-_. ])thumbnail|_thumb(_v\d+)?|_preview|_logo)\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const SITE_SHELL_IMAGE_BASENAME_RE = /^(?:vipergirls|viper)[-_.]\d+\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const FORUM_CHROME_IMAGE_BASENAME_RE = /(?:^|[-_. ])(?:statusicon|reputation|avatar|button|spacer|blank)(?:[-_. ]|$)/i;

function isAuxiliaryImageBasename(name) {
  return AUX_IMAGE_BASENAME_RE.test(name)
    || SITE_SHELL_IMAGE_BASENAME_RE.test(name)
    || FORUM_CHROME_IMAGE_BASENAME_RE.test(name);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

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
    const p = new URL(url).pathname.toLowerCase();
    if (h.includes('vipergirls.to') || h.includes('viper.to')) return 'vipergirls';
    if (h.includes('youtube') || h.includes('youtu.be')) return 'youtube';
    if (h === 'flc.nyc3.digitaloceanspaces.com' && /\/data\/(?:attachments|video)\//i.test(p)) return 'footfetishforum';
    if (h.includes('footfetishforum.com')) return 'footfetishforum';
    if (h.includes('vimeo')) return 'vimeo';
    if (h.includes('tiktok')) return 'tiktok';
    if (h.includes('reddit')) return 'reddit';
    if (h.includes('redgifs') || h.includes('gifdeliverynetwork') || h.includes('gfycat')) return 'redgifs';
    if (h.includes('instagram')) return 'instagram';
    if (h.includes('twitter') || h.includes('x.com')) return 'twitter';
    if (h.includes('twitch')) return 'twitch';
    if (h.includes('danbooru')) return 'danbooru';
    return h.replace(/^www\./, '').split('.')[0];
  } catch { return 'unknown'; }
}

function titleFromThreadUrl(rawUrl) {
  try {
    const last = String(new URL(String(rawUrl || '')).pathname || '').split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(last.replace(/^\d+-/, '').replace(/[-_]+/g, ' ')).trim();
  } catch {
    const m = String(rawUrl || '').match(/\/threads\/\d+-([^/?#]+)/i);
    return m ? m[1].replace(/[-_]+/g, ' ').trim() : '';
  }
}

function comparableTitle(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\.(?:com|net|org)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isThreadShellImage(filePath, job, sourceUrl, fileInfo) {
  const ext = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) return false;
  const stem = path.basename(filePath, ext);
  if (!new RegExp(`(?:^|[-_. ])${String(job?.id || '')}$`).test(stem)) return false;
  if (sourceUrl && isImageUrlLike(sourceUrl)) return false;
  const threadTitle = comparableTitle(job?.options?.title || job?.options?.channel || titleFromThreadUrl(job?.options?.contextUrl || job?.url));
  const fileTitle = comparableTitle(fileInfo?.title || stem);
  return Boolean(threadTitle && fileTitle && (fileTitle === threadTitle || fileTitle.startsWith(threadTitle)));
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
          channelId: data.channel_id || data.uploader_id || '',
          channelUrl: data.channel_url || data.uploader_url || '',
          title: data.fulltitle || data.title || '',
          sourceUrl: data.webpage_url || data.original_url || data.url || '',
          platform: data.extractor_key ? data.extractor_key.toLowerCase() : '',
          duration: data.duration_string || (Number.isFinite(Number(data.duration)) ? String(Math.round(Number(data.duration))) : null),
          sourcePublishedAt: getYtdlpSourceTimestamp(data),
          ...galleryDlForumInfo(data),
        };
      }
    }
  } catch {}
  return null;
}

async function readInfoJsonForMedia(mediaPath, fallbackInfo = null) {
  try {
    const dir = path.dirname(mediaPath);
    const ext = path.extname(mediaPath);
    const base = path.basename(mediaPath, ext);
    const candidates = [
      path.join(dir, `${base}.info.json`),
      `${mediaPath}.json`,
      path.join(dir, `${base}.json`),
    ];
    for (const exact of candidates) {
      if (!fsSync.existsSync(exact)) continue;
      const raw = await fs.readFile(exact, 'utf8');
      const data = JSON.parse(raw);
      return {
        channel: data.channel || data.uploader || data.uploader_id || data.playlist_title || '',
        channelId: data.channel_id || data.uploader_id || '',
        channelUrl: data.channel_url || data.uploader_url || '',
        title: data.fulltitle || data.title || data.filename || '',
        sourceUrl: data.webpage_url || data.original_url || data.url || '',
        platform: data.extractor_key ? data.extractor_key.toLowerCase() : '',
        duration: data.duration_string || (Number.isFinite(Number(data.duration)) ? String(Math.round(Number(data.duration))) : null),
        sourcePublishedAt: getYtdlpSourceTimestamp(data),
        ...galleryDlForumInfo(data),
      };
    }
  } catch {}
  return fallbackInfo;
}

function getYtdlpSourceTimestamp(info) {
  try {
    if (!info || typeof info !== 'object') return null;
    const rawTimestamp = Number(info.release_timestamp || info.timestamp || info.modified_timestamp || 0);
    if (Number.isFinite(rawTimestamp) && rawTimestamp > 0) {
      const dt = new Date(rawTimestamp * 1000);
      if (Number.isFinite(dt.getTime())) return dt.toISOString();
    }
    const rawDate = String(info.upload_date || info.release_date || info.date || '').trim();
    const m = rawDate.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) {
      const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
      if (Number.isFinite(dt.getTime())) return dt.toISOString();
    }
  } catch {}
  return null;
}

function sanitizeFilePart(value, fallback = 'download') {
  const cleaned = String(value || '')
    .replace(/^Thread:\s*/i, '')
    .normalize('NFKD')
    .replace(/[^\w .()[\]-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

function idFromMediaUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''));
    const parts = String(u.pathname || '').split('/').filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i].replace(/\.(jpe?g|png|gif|webp|mp4|webm|m4v|mov)$/i, '');
      if (/^[a-z0-9]{8,}$/i.test(part)) return part;
    }
  } catch {}
  return '';
}

function galleryDlForumInfo(data) {
  if (!data || typeof data !== 'object') return {};
  const threadTitle = data.thread_title || data.source_thread_title || '';
  const threadId = data.thread_id || data.source_thread_id || '';
  const postTitle = data.post_title || data.source_post_title || '';
  const postNum = data.post_num || data.source_post_num || '';
  const postId = data.post_id || data.source_post_id || '';
  const forumTitle = data.forum_title || data.source_forum_title || '';
  const category = data.category || data.source_site || '';
  if (!threadTitle && !threadId && !postTitle && !postNum && !postId && !forumTitle) return {};
  return {
    sourceThreadTitle: threadTitle ? String(threadTitle) : '',
    sourceThreadId: threadId ? String(threadId) : '',
    sourcePostTitle: postTitle ? String(postTitle) : '',
    sourcePostNum: postNum ? String(postNum) : '',
    sourcePostId: postId ? String(postId) : '',
    sourceForumTitle: forumTitle ? String(forumTitle) : '',
    sourceSite: category ? String(category).toLowerCase() : '',
  };
}

function forumThreadIdFromUrl(rawUrl) {
  try {
    const m = String(new URL(String(rawUrl || '')).pathname || '').match(/\/threads\/(\d+)/i);
    return m ? m[1] : '';
  } catch {
    const m = String(rawUrl || '').match(/\/threads\/(\d+)/i);
    return m ? m[1] : '';
  }
}

function forumInfoFromJob(job) {
  const options = job?.options || {};
  const sourceUrl = options.contextUrl || options.url || job?.url || '';
  const pinnedVipergirls = isPinnedVipergirlsJob(job);
  const sourceThreadTitle = String(options.title || options.channel || titleFromThreadUrl(sourceUrl)).replace(/^thread_\d+$/i, '').trim();
  const sourceThreadId = forumThreadIdFromUrl(sourceUrl);
  if (!pinnedVipergirls && !sourceThreadTitle && !sourceThreadId) return null;
  return {
    sourceThreadTitle,
    sourceThreadId,
    sourcePostTitle: '',
    sourcePostNum: '',
    sourcePostId: '',
    sourceForumTitle: '',
    sourceSite: pinnedVipergirls ? 'vipergirls' : detectPlatform(sourceUrl || job?.url),
  };
}

function mergeForumInfo(primary, fallback) {
  if (!primary && !fallback) return null;
  const out = {};
  for (const key of [
    'sourceThreadTitle',
    'sourceThreadId',
    'sourcePostTitle',
    'sourcePostNum',
    'sourcePostId',
    'sourceForumTitle',
    'sourceSite',
  ]) {
    out[key] = (primary && primary[key]) || (fallback && fallback[key]) || '';
  }
  return Object.values(out).some(Boolean) ? out : null;
}

function sourceGraphFromForumInfo(info, sourceUrl, platform) {
  if (!info || (!info.sourceThreadTitle && !info.sourceThreadId && !info.sourcePostId && !info.sourcePostNum)) return null;
  const nodes = [];
  if (info.sourceSite || platform) nodes.push({ type: 'host', platform: info.sourceSite || platform });
  if (info.sourceForumTitle) nodes.push({ type: 'forum', title: info.sourceForumTitle });
  nodes.push({
    type: 'thread',
    id: info.sourceThreadId || null,
    title: info.sourceThreadTitle || '',
    url: sourceUrl || null,
  });
  nodes.push({
    type: 'post',
    id: info.sourcePostId || null,
    num: info.sourcePostNum || null,
    title: info.sourcePostTitle || '',
    url: sourceUrl || null,
  });
  return { nodes };
}

function isImageUrlLike(input) {
  try {
    const u = new URL(String(input || ''));
    return IMAGE_EXTS.has(path.extname(String(u.pathname || '')).toLowerCase());
  } catch {
    return IMAGE_EXTS.has(path.extname(String(input || '').split(/[?#]/)[0]).toLowerCase());
  }
}

function isLikelyThumbnailImageUrl(rawUrl) {
  try {
    const input = String(rawUrl || '').trim();
    if (!input || !isImageUrlLike(input)) return false;
    const u = new URL(input);
    const host = String(u.hostname || '').toLowerCase();
    const p = String(u.pathname || '').toLowerCase();
    if (/^(?:thumbs?|thumbnails?)\d*\./i.test(host)) return true;
    if ((host === 'vipr.im' || host.endsWith('.vipr.im')) && /^\/th\//i.test(p)) return true;
    if ((host === 'pixhost.to' || host.endsWith('.pixhost.to')) && /\/thumbs\//i.test(p)) return true;
    if (/\/(?:thumb|thumbs|thumbnail|thumbnails|preview|previews|small|mini|square)\//i.test(p)) return true;
    if (/\.(?:th|thumb|thumbnail|preview|small|md)\.(?:jpe?g|png|gif|webp|bmp|avif)(?:$|[?#])/i.test(input)) return true;
    if (/(?:^|[-_.\/])(?:thumb|thumbnail|preview|small|mini)(?:[-_.\/]|$)/i.test(p)) return true;
    return false;
  } catch {
    return false;
  }
}

function isPinnedVipergirlsJob(job) {
  return String(job?.options?.platform || '').toLowerCase() === 'vipergirls'
    || /vipergirls\.to/i.test(String(job?.options?.contextUrl || job?.options?.url || ''));
}

function pinnedVipergirlsTarget(job) {
  const options = job?.options || {};
  const haystack = [
    job?.url,
    options.url,
    options.contextUrl,
    options.pageUrl,
    options.title,
    options.channel,
    options.expandGroup,
  ].map((v) => String(v || '')).join(' ');

  if (/thread_?6777850|threads\/6777850|czechcasting/i.test(haystack)) {
    return {
      platform: 'czechcasting',
      channel: 'MyFav Czechcasting Model Collection Sets',
      sourcePlatform: 'vipergirls',
      sourceChannel: options.channel || 'thread_6777850',
    };
  }

  return {
    platform: 'vipergirls',
    channel: options.channel || 'vipergirls',
    sourcePlatform: 'vipergirls',
    sourceChannel: options.channel || 'vipergirls',
  };
}

function renameOutputForPinnedSource(filePath, job, sourceUrl, ext) {
  if (!isPinnedVipergirlsJob(job)) return filePath;
  const dir = path.dirname(filePath);
  const sourceId = idFromMediaUrl(sourceUrl || job.url) || String(job.id || 'item');
  const baseTitle = sanitizeFilePart(job?.options?.title || job?.options?.channel || 'vipergirls', 'vipergirls');
  const target = path.join(dir, `${baseTitle}_${sourceId}${ext}`);
  if (target === filePath) return filePath;
  try {
    if (fsSync.existsSync(target)) return target;
    fsSync.renameSync(filePath, target);
    return target;
  } catch {
    return filePath;
  }
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
async function syncToGallery(job, outputFiles, logger, repo) {
  const { Pool } = require('pg');
  const galleryPool = new Pool({ connectionString: DATABASE_URL, max: 2 });

  const platform = detectPlatform(job.url);

  // Probeer info.json te lezen voor betere metadata
  const workdir = path.dirname(outputFiles[0]?.path || '');
  const info = await readInfoJson(workdir);

  try {
    let inserted = 0;
    for (const f of outputFiles) {
      const ext = path.extname(f.path).toLowerCase();
      const isVideo = VIDEO_EXTS.has(ext);
      const isImage = IMAGE_EXTS.has(ext);
      if (!isVideo && !isImage) continue;
      // Skip thumbnails en temp files
      if (isAuxiliaryImageBasename(path.basename(f.path))) continue;
      if (SKIP_EXTS.has(ext)) continue;

      const fileInfo = await readInfoJsonForMedia(f.path, info);
      const pinnedVipergirls = isPinnedVipergirlsJob(job);
      const pinnedTarget = pinnedVipergirls ? pinnedVipergirlsTarget(job) : null;
      const rawSourceUrl = fileInfo?.sourceUrl || job.url;
      if (isThreadShellImage(f.path, job, rawSourceUrl, fileInfo)) continue;
      const imageQuality = isImage && isImageUrlLike(rawSourceUrl)
        ? (isLikelyThumbnailImageUrl(rawSourceUrl)
          ? { quality: 'thumbnail_rejected', wasThumbnail: true, rejected: true }
          : { quality: 'direct_image', wasThumbnail: false, rejected: false })
        : { quality: isImage ? 'unknown_source' : 'not_image', wasThumbnail: false, rejected: false };
      if (imageQuality.rejected) {
        if (repo && repo.appendLog) {
          await repo.appendLog(job.id, 'warn', `thumbnail overgeslagen, geen fullscale bron bevestigd: ${rawSourceUrl}`);
        }
        logger.warn('gallery.sync.thumbnail_skipped', { job: job.id, sourceUrl: rawSourceUrl, file: path.basename(f.path) });
        continue;
      }
      const finalPath = renameOutputForPinnedSource(f.path, job, rawSourceUrl, ext);
      if (finalPath !== f.path) {
        try {
          await galleryPool.query(`UPDATE webdl.files SET path = $1 WHERE job_id = $2 AND path = $3`, [finalPath, job.id, f.path]);
        } catch (_) {}
        f.path = finalPath;
      }
      const fileForumInfo = fileInfo && (fileInfo.sourceThreadTitle || fileInfo.sourceThreadId || fileInfo.sourcePostId || fileInfo.sourcePostNum)
        ? fileInfo
        : null;
      const forumInfo = mergeForumInfo(fileForumInfo, forumInfoFromJob(job));
      const forumThreadChannel = forumInfo?.sourceThreadTitle
        ? String(forumInfo.sourceThreadTitle).trim().toLowerCase()
        : '';
      const channel = forumThreadChannel || (pinnedVipergirls
        ? pinnedTarget.channel
        : (fileInfo?.channel || job.options?.channel || job.options?.playlistTitle || ''));
      const infoPlatform = String(fileInfo?.platform || '').toLowerCase();
      const realPlatform = pinnedVipergirls
        ? pinnedTarget.platform
        : (infoPlatform && infoPlatform !== 'generic' ? infoPlatform : platform);
      const sourceId = idFromMediaUrl(rawSourceUrl || job.url);
      const title = pinnedVipergirls
        ? `${sanitizeFilePart(job.options?.title || 'Vipergirls', 'Vipergirls')}${sourceId ? ` ${sourceId}` : ''}`
        : (fileInfo?.title || path.basename(f.path, ext).replace(/_/g, ' ').trim());
      const sourceUrl = rawSourceUrl;
      const sourceUrlIsJobUrl = sourceUrl && String(sourceUrl) === String(job.url || '');
      const shouldDedupeBySourceUrl = Boolean(sourceUrl) && !(sourceUrlIsJobUrl && outputFiles.length > 1);

      // Check for duplicate by filepath
      const existing = await galleryPool.query(
        'SELECT id FROM downloads WHERE filepath = $1 LIMIT 1',
        [f.path],
      );
      if (existing.rows.length > 0) continue;

      // Check for duplicate by source URL
      if (shouldDedupeBySourceUrl) {
        const byUrl = await galleryPool.query(
          'SELECT id FROM downloads WHERE source_url = $1 LIMIT 1',
          [sourceUrl],
        );
        if (byUrl.rows.length > 0) continue;
      }

      const stat = fsSync.statSync(f.path);
      // Gallery "recent" means imported/downloaded recently, not the original
      // publish date of a TikTok/YouTube post. Keep the source date only as
      // metadata so newly completed downloads actually surface at the top.
      const importedAt = new Date().toISOString();
      const result = await galleryPool.query(
        `INSERT INTO downloads
          (url, platform, channel, title, filename, filepath, filesize, format,
           status, progress, metadata, source_url, duration, created_at, updated_at, finished_at, is_thumb_ready)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                 'completed', 100, $9::jsonb, $10, $11, $12::timestamptz, $12::timestamptz, $12::timestamptz, $13)
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
          JSON.stringify({
            hub_job_id: job.id,
            adapter: job.adapter,
            source_published_at: fileInfo?.sourcePublishedAt || null,
            source_site: forumInfo?.sourceSite || null,
            source_thread_title: forumInfo?.sourceThreadTitle || null,
            source_thread_id: forumInfo?.sourceThreadId || null,
            source_forum_title: forumInfo?.sourceForumTitle || null,
            source_post_title: forumInfo?.sourcePostTitle || null,
            source_post_num: forumInfo?.sourcePostNum || null,
            source_post_id: forumInfo?.sourcePostId || null,
            source_graph: sourceGraphFromForumInfo(forumInfo, job.options?.contextUrl || job.url, realPlatform),
            youtube_channel_id: fileInfo?.channelId || job.options?.youtubeChannelId || null,
            youtube_channel_url: fileInfo?.channelUrl || job.options?.youtubeChannelUrl || null,
            indexed_channel: channel || null,
            webdl_image_quality: imageQuality.quality,
            webdl_was_thumbnail_url: imageQuality.wasThumbnail === true,
            source_context: pinnedVipergirls ? {
              platform: pinnedTarget.sourcePlatform,
              channel: pinnedTarget.sourceChannel,
              target_platform: pinnedTarget.platform,
              target_channel: pinnedTarget.channel,
              title: job.options?.title || null,
              url: job.options?.contextUrl || null,
            } : null,
          }),
          sourceUrl,
          fileInfo?.duration || null,
          importedAt,
          f._thumbPath ? true : false,
        ],
      );
      inserted += result.rowCount || 0;
      logger.info('gallery.synced', { job: job.id, file: path.basename(f.path), platform: realPlatform, channel });
    }
    return inserted;
  } catch (e) {
    logger.warn('gallery.sync.error', { job: job.id, err: e.message });
    return 0;
  } finally {
    await galleryPool.end();
  }
}

function isImportableMedia(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!VIDEO_EXTS.has(ext) && !IMAGE_EXTS.has(ext)) return false;
  if (isAuxiliaryImageBasename(path.basename(filePath))) return false;
  if (SKIP_EXTS.has(ext)) return false;
  return true;
}

async function filterSettledMediaOutputs(outputs, minAgeMs = 2500) {
  const now = Date.now();
  const out = [];
  for (const f of outputs) {
    if (!isImportableMedia(f.path)) continue;
    try {
      const st = await fs.stat(f.path);
      if (st.size > 0 && now - st.mtimeMs >= minAgeMs) out.push(f);
    } catch {}
  }
  return out;
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
  const heartbeatMs = intEnv('WEBDL_WORKER_HEARTBEAT_MS', 30_000);
  const staleRunningMinutes = intEnv('WEBDL_STALE_RUNNING_MINUTES', 15);

  async function reclaimStaleJobs() {
    try {
      const reclaimed = await repo.reclaimStaleRunning({ olderThanMinutes: staleRunningMinutes });
      if (reclaimed.markedFailed.length || reclaimed.requeued.length) {
        logger.info('worker.stale.reclaim', reclaimed);
      }
    } catch (e) {
      logger.warn('worker.stale.reclaim.error', { err: String(e.message || e) });
    }
  }

  // Reclaim stale jobs at startup and periodically. Active jobs refresh
  // locked_at through the heartbeat below, so stale means "worker died/stuck".
  reclaimStaleJobs();
  const staleTimer = setInterval(reclaimStaleJobs, Math.max(60_000, heartbeatMs * 2));
  if (typeof staleTimer.unref === 'function') staleTimer.unref();

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
    const skipPreDownloadDedup = String(job?.options?.source_quality || '') === 'vipr_full_image';
    if (!isExpandable && !skipPreDownloadDedup) {
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
    let rateLimited = false;
    let rateLimitMessage = '';
    const proc = runProcess(planned);
    const heartbeatTimer = setInterval(() => {
      repo.heartbeatJob(job.id, workerId).catch((e) => {
        logger.warn('job.heartbeat.error', { job: job.id, err: String(e.message || e) });
      });
    }, heartbeatMs);
    if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();

    const liveGallerySyncMs = intEnv('WEBDL_LIVE_GALLERY_SYNC_MS', 3_000);
    const enableLiveGallerySync = liveGallerySyncMs > 0 && typeof adapter.collectOutputs === 'function';
    let liveGallerySyncRunning = false;
    let lastLiveGallerySynced = 0;
    async function runLiveGallerySync() {
      if (liveGallerySyncRunning) return;
      liveGallerySyncRunning = true;
      try {
        const outs = await adapter.collectOutputs(workdir, { job, startedAtMs });
        const mediaOuts = await filterSettledMediaOutputs(outs, intEnv('WEBDL_LIVE_GALLERY_MIN_AGE_MS', 1_500));
        if (mediaOuts.length > lastLiveGallerySynced) {
          const freshJob = await repo.getJob(job.id).catch(() => null);
          const inserted = await syncToGallery(freshJob || job, mediaOuts, logger, repo);
          lastLiveGallerySynced = Math.max(lastLiveGallerySynced, mediaOuts.length);
          if (inserted > 0) {
            await repo.appendLog(job.id, 'info', `📺 live gallery sync: ${inserted} nieuw`);
          }
        }
      } catch (e) {
        logger.warn('gallery.live_sync.error', { job: job.id, err: String(e.message || e) });
      } finally {
        liveGallerySyncRunning = false;
      }
    }
    const liveGalleryTimer = enableLiveGallerySync ? setInterval(runLiveGallerySync, liveGallerySyncMs) : null;
    if (liveGalleryTimer && typeof liveGalleryTimer.unref === 'function') liveGalleryTimer.unref();
    if (enableLiveGallerySync) setTimeout(runLiveGallerySync, Math.min(1000, liveGallerySyncMs)).unref?.();

    proc.on('line', async ({ stream, line }) => {
      if (isYoutubeRateLimitMessage(line)) {
        rateLimited = true;
        rateLimitMessage = String(line || '').trim();
        job._rateLimited = true;
      }
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
        if (planned.logStdout && trimmed) {
          try { await repo.appendLog(job.id, 'info', trimmed.slice(0, 500)); } catch (_) {}
        }
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

    async function importOutputs({ partialReason = '' } = {}) {
      const outs = await adapter.collectOutputs(workdir, { job, startedAtMs });
      const mediaOuts = outs.filter((f) => isImportableMedia(f.path));
      if (partialReason && mediaOuts.length === 0) return 0;

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
      if (partialReason) {
        await repo.pool.query(
          `UPDATE ${repo.schema}.jobs
              SET options = COALESCE(options, '{}'::jsonb) || jsonb_build_object('partial_success', true, 'partial_reason', $2::text)
            WHERE id = $1`,
          [job.id, partialReason],
        );
      }
      await queue.complete(job.id);
      await repo.appendLog(
        job.id,
        partialReason ? 'warn' : 'info',
        partialReason
          ? `⚠️ gedeeltelijk klaar, ${mediaOuts.length} media-bestand(en) geïmporteerd; oorzaak: ${partialReason}`
          : `✅ klaar, ${outs.length} bestand(en)`,
      );
      logger.info(partialReason ? 'job.partial.done' : 'job.done', {
        job: job.id,
        files: outs.length,
        mediaFiles: mediaOuts.length,
        partialReason,
      });

      // Gallery sync — alleen voltooide of gedeeltelijk bruikbare downloads
      try {
        const freshJob = await repo.getJob(job.id);
        await syncToGallery(freshJob || job, outs, logger, repo);
        await repo.markGallerySynced(job.id);
        await repo.appendLog(job.id, 'info', '📺 gallery sync voltooid');
      } catch (e) {
        await repo.appendLog(job.id, 'warn', `gallery sync mislukt: ${e.message}`);
      }
      return mediaOuts.length;
    }

    try {
      const { code, signal, timedOut, idleTimedOut } = await proc.done;
      clearInterval(heartbeatTimer);
      if (liveGalleryTimer) clearInterval(liveGalleryTimer);
      if (code === 0) {
        await importOutputs();
        return true; // success
      } else {
        const reason = rateLimited
          ? `youtube rate limit: ${rateLimitMessage || 'Video unavailable; account tijdelijk rate-limited'}`
          : idleTimedOut
            ? `idle timeout (${Math.round((planned.idleTimeoutMs || 0) / 1000)}s zonder output)`
            : timedOut
              ? `timeout (${Math.round((planned.timeoutMs || 0) / 1000)}s)`
              : `exit ${code}${signal ? ` (${signal})` : ''}`;
        try {
          const imported = await importOutputs({ partialReason: reason });
          if (imported > 0) return true;
        } catch (e) {
          logger.warn('job.partial.import.error', { job: job.id, err: String(e.message || e) });
        }
        const retry = rateLimited ? true : job.attempts < job.max_attempts;
        await queue.fail(job.id, reason, { retry });
        await repo.appendLog(job.id, retry ? 'warn' : 'error', `${reason}${retry ? ' (retry)' : ''}`);
        logger.warn('job.failed', { job: job.id, code, signal, retry, timedOut, idleTimedOut });
        return false; // failure
      }
    } catch (err) {
      clearInterval(heartbeatTimer);
      if (liveGalleryTimer) clearInterval(liveGalleryTimer);
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
  const domainState = new Map(); // domain → { lastStartMs, consecutiveFails, pauseUntilMs }
  const youtubeRateLimitBackoffMs = Math.max(
    5 * 60 * 1000,
    Number.parseInt(process.env.WEBDL_YOUTUBE_RATE_LIMIT_BACKOFF_MS || String(65 * 60 * 1000), 10) || 65 * 60 * 1000,
  );

  // Configuratie per domein-patroon (defaults voor onbekende domeinen)
  const DOMAIN_THROTTLE = {
    'youtube':   { baseSpacingMs: 5000,  maxBackoffMs: 60000, jitterMs: 2000 },
    'tiktok':    { baseSpacingMs: 3000,  maxBackoffMs: 30000, jitterMs: 1500 },
    'instagram': { baseSpacingMs: 4000,  maxBackoffMs: 45000, jitterMs: 2000 },
    'reddit':    { baseSpacingMs: 2000,  maxBackoffMs: 20000, jitterMs: 1000 },
    'redgifs':   { baseSpacingMs: 2500,  maxBackoffMs: 30000, jitterMs: 1500 },
    '_default':  { baseSpacingMs: 500,   maxBackoffMs: 10000, jitterMs: 500  },
  };

  function domainKey(url) {
    try {
      const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      if (h.includes('youtube') || h.includes('youtu.be')) return 'youtube';
      if (h.includes('tiktok')) return 'tiktok';
      if (h.includes('instagram')) return 'instagram';
      if (h.includes('reddit')) return 'reddit';
      if (h.includes('redgifs') || h.includes('gifdeliverynetwork') || h.includes('gfycat')) return 'redgifs';
      return h;
    } catch { return 'unknown'; }
  }

  function getThrottleConfig(domain) {
    return DOMAIN_THROTTLE[domain] || DOMAIN_THROTTLE._default;
  }

  function getDomainState(domain) {
    if (!domainState.has(domain)) {
      domainState.set(domain, { lastStartMs: 0, consecutiveFails: 0, pauseUntilMs: 0 });
    }
    return domainState.get(domain);
  }

  function isYoutubeRateLimitMessage(text) {
    return /rate-limited by youtube|content isn't available,\s*try again later|try again later.*rate-limit/i.test(String(text || ''));
  }

  function getDomainPauseWaitMs(domain) {
    const ds = getDomainState(domain);
    return Math.max(0, Number(ds.pauseUntilMs || 0) - Date.now());
  }

  function computeWaitMs(domain) {
    const conf = getThrottleConfig(domain);
    const ds = getDomainState(domain);
    const elapsed = Date.now() - ds.lastStartMs;
    const pauseWait = getDomainPauseWaitMs(domain);

    // Backoff: spacing verdubbelt per opeenvolgende failure, met plafond
    const backoffMultiplier = Math.min(Math.pow(2, ds.consecutiveFails), 32);
    const spacing = Math.min(conf.baseSpacingMs * backoffMultiplier, conf.maxBackoffMs);
    const jitter = Math.floor(Math.random() * conf.jitterMs);
    const needed = spacing + jitter;

    return Math.max(pauseWait, needed - elapsed);
  }

  function markDomainStarted(domain) {
    getDomainState(domain).lastStartMs = Date.now();
  }

  function markDomainSuccess(domain) {
    const ds = getDomainState(domain);
    ds.consecutiveFails = 0;
  }

  function markDomainFailed(domain, { rateLimited = false } = {}) {
    const ds = getDomainState(domain);
    ds.consecutiveFails++;
    const conf = getThrottleConfig(domain);
    const backoff = Math.min(conf.baseSpacingMs * Math.pow(2, ds.consecutiveFails), conf.maxBackoffMs);
    if (domain === 'youtube' && rateLimited) {
      ds.pauseUntilMs = Math.max(Number(ds.pauseUntilMs || 0), Date.now() + youtubeRateLimitBackoffMs);
      logger.warn('throttle.youtube.rate_limit_pause', {
        domain,
        fails: ds.consecutiveFails,
        pauseMs: youtubeRateLimitBackoffMs,
        resumeAt: new Date(ds.pauseUntilMs).toISOString(),
      });
      return;
    }
    logger.info('throttle.backoff', { domain, fails: ds.consecutiveFails, nextDelayMs: backoff });
  }

  // Wrap runOne om domain throttle te beheren
  async function runOneThrottled(job) {
    const domain = domainKey(job.url);
    markDomainStarted(domain);
    const ok = await runOne(job);
    if (ok === false) {
      markDomainFailed(domain, { rateLimited: job._rateLimited === true });
    } else {
      markDomainSuccess(domain);
    }
  }

  // ─── Lane-based loops ──────────────────────────────────────────────────────
  // Elke lane heeft eigen concurrency-limiet en eigen worker-loop.
  //   process-video: 1 (ffmpeg merge CPU-zwaar)
  //   video:         4 (directe video, geen merge; netwerk-bound)
  //   gallery:       1 (gallery-dl batches; intern snel, onderling serieel)
  //   image:         8 (snel, netwerk-bound)
  const LANES = [
    { name: 'process-video', concurrency: intEnv('WEBDL_PROCESS_VIDEO_CONCURRENCY', 1) },
    { name: 'video',         concurrency: intEnv('WEBDL_DIRECT_VIDEO_CONCURRENCY', 2) },
    { name: 'gallery',       concurrency: intEnv('WEBDL_GALLERY_CONCURRENCY', 1) },
    { name: 'image',         concurrency: intEnv('WEBDL_IMAGE_CONCURRENCY', 8) },
  ];
  const laneActive = new Map(LANES.map((l) => [l.name, new Set()]));

  async function laneLoop(lane, maxConcurrency) {
    const laneSet = laneActive.get(lane);
    while (!stopping) {
      if (laneSet.size >= maxConcurrency) { await sleep(pollMs); continue; }
      if (lane === 'process-video') {
        const youtubePauseWaitMs = getDomainPauseWaitMs('youtube');
        if (youtubePauseWaitMs > 0) {
          logger.info('throttle.youtube.paused', { waitMs: youtubePauseWaitMs, lane });
          await sleep(Math.min(youtubePauseWaitMs, 30_000));
          continue;
        }
      }

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
    clearInterval(staleTimer);
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

module.exports = { startWorkerPool, syncToGallery, filterSettledMediaOutputs, isImportableMedia };
