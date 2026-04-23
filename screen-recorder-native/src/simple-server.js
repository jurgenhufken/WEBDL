const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const os = require('os');
const util = require('util');
const { exec, spawn } = require('child_process');

// ═══ Event Loop Yield — prevents sync I/O from starving Express ═══
const yieldEventLoop = () => new Promise(resolve => setImmediate(resolve));
const yieldEveryN = (n = 5) => { let c = 0; return async () => { if (++c % n === 0) await yieldEventLoop(); }; };
const { createDb } = require('./db-adapter');
const multer = require('multer');
const upload = multer({ dest: path.join(os.tmpdir(), 'webdl-uploads') });
// ========================
// CONFIGURATIE (GEEXTRAHEERD)
// ========================
const config = require('./config');
const logger = require('./utils/logger'); // Overschrijft console.log globaal automatisch via require

// ========================
// VIEW MODULES (GEEXTRAHEERD)
// ========================
const getViewerHTML = require('./views/viewer');
const getGalleryHTML = require('./views/gallery');
const getDashboardHTML = require('./views/dashboard');

const {
  PORT, BASE_DIR, DB_PATH, POSTGRES_URL, DB_ENGINE, LOG_FILE, DIRECTORY_FILTER_CONFIG,
  YT_DLP, FFMPEG, FFPROBE, OFSCRAPER, OFSCRAPER_CONFIG_DIR, GALLERY_DL, INSTALOADER, REDDIT_DL,
  TDL, TDL_NAMESPACE, TDL_THREADS, TDL_CONCURRENCY,
  REDDIT_DL_CLIENT_ID, REDDIT_DL_CLIENT_SECRET, REDDIT_DL_USERNAME, REDDIT_DL_PASSWORD, REDDIT_DL_AUTH_FILE, REDDIT_INDEX_MAX_ITEMS, REDDIT_INDEX_MAX_PAGES,
  VIDEO_DEVICE, AUDIO_DEVICE, RECORDING_FPS, VIDEO_CODEC, VIDEO_BITRATE, LIBX264_PRESET, AUDIO_BITRATE, RECORDING_AUDIO_CODEC, RECORDING_INPUT_PIXEL_FORMAT, RECORDING_FPS_MODE,
  FFMPEG_PROBESIZE, FFMPEG_ANALYZEDURATION, FFMPEG_THREAD_QUEUE_SIZE, FFMPEG_RTBUFSIZE, FFMPEG_MAX_MUXING_QUEUE_SIZE,
  MIN_SCREENSHOT_BYTES, MIN_THUMB_BYTES,
  FINALCUT_ENABLED, FINALCUT_VIDEO_CODEC, FINALCUT_X264_PRESET, FINALCUT_X264_CRF, FINALCUT_AUDIO_BITRATE,
  ADDON_PACKAGE_PATH, LEGACY_ADDON_PACKAGE_PATH,
  DEFAULT_VDH_IMPORT_DIR, ADDON_AUTO_BUILD_ON_START, ADDON_FORCE_REBUILD_ON_START,
  AUTO_IMPORT_ON_START, AUTO_IMPORT_ROOT_DIR, AUTO_IMPORT_MAX_DEPTH_RAW, AUTO_IMPORT_MIN_FILE_AGE_MS, AUTO_IMPORT_FLATTEN_TO_WEBDL, AUTO_IMPORT_MOVE_SOURCE, AUTO_IMPORT_POLL_MS,
  STARTUP_REHYDRATE_DELAY_MS, STARTUP_REHYDRATE_MAX_ROWS, STARTUP_REHYDRATE_MODE,
  METADATA_BLOCKED_DOMAIN_SUFFIXES, getAutoImportMaxDepth
} = config;

function tailTextFile(filePath, maxLines, maxBytes) {
  try {
    const lines = Math.max(1, Math.min(10000, parseInt(String(maxLines || '400'), 10) || 400));
    const bytes = Math.max(4096, Math.min(4 * 1024 * 1024, parseInt(String(maxBytes || '524288'), 10) || 524288));
    if (!filePath || !fs.existsSync(filePath)) return '';
    const st = fs.statSync(filePath);
    const end = Math.max(0, st.size);
    const start = Math.max(0, end - bytes);
    const len = Math.max(0, end - start);
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      const text = buf.toString('utf8');
      const parts = text.split(/\r?\n/);
      return parts.slice(Math.max(0, parts.length - lines)).join('\n');
    } finally {
      try { fs.closeSync(fd); } catch (e) { }
    }
  } catch (e) {
    return '';
  }
}

function parseAvfoundationDeviceList(text) {
  try {
    const raw = String(text || '');
    const out = { video: [], audio: [], raw };
    const lines = raw.split(/\r?\n/);
    let mode = '';
    for (const line of lines) {
      const l = String(line || '');
      if (/AVFoundation video devices:/i.test(l)) { mode = 'video'; continue; }
      if (/AVFoundation audio devices:/i.test(l)) { mode = 'audio'; continue; }
      const m = l.match(/\[(\d+)\]\s*(.+)\s*$/);
      if (!m) continue;
      const idx = parseInt(m[1], 10);
      const name = String(m[2] || '').trim();
      if (!Number.isFinite(idx) || !name) continue;
      if (mode === 'video') out.video.push({ index: idx, name }); else
        if (mode === 'audio') out.audio.push({ index: idx, name });
    }
    return out;
  } catch (e) {
    return { video: [], audio: [], raw: String(text || '') };
  }
}

function parseFootFetishForumThreadInfo(inputUrl) {
  try {
    const u = String(inputUrl || '');
    const m = u.match(/footfetishforum\.com\/threads\/([^\/\?#]+)\.(\d+)(?:\/|\?|#|$)/i);
    if (!m) return null;
    const slug = String(m[1] || '').trim();
    const id = String(m[2] || '').trim();
    if (!slug || !id) return null;
    let name = slug.replace(/[-_]+/g, ' ').trim();
    name = name.split(/\s+/g).filter(Boolean).map((w) => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
    return { id, name };
  } catch (e) {
    return null;
  }
}

function parseFootFetishForumAttachmentInfo(inputUrl) {
  try {
    const u = new URL(String(inputUrl || ''));
    const host = String(u.hostname || '').toLowerCase();
    if ((host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com')) && /\/attachments\//i.test(pathname)) {
      const m = pathname.match(/\/attachments\/([^\/]+)\.(\d+)(?:\/|\?|#|$)/i);
      if (m) {
        return {
          kind: 'page',
          slug: String(m[1] || '').trim().toLowerCase(),
          id: String(m[2] || '').trim()
        };
      }
    }
    // Remove the digitaloceanspaces.com domain check completely, as assets can be served from footfetishforum.com directly
    if (/\/data\/attachments\//i.test(pathname) || /\/attachments\//i.test(pathname)) {
      const base = path.basename(pathname || '');
      const m = base.match(/^(\d+)-([^./?#]+)/i);
      if (!m) return null;
      return {
        kind: 'asset',
        slug: '',
        id: String(m[1] || '').trim()
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

function parseAmateurVoyeurForumUrlInfo(inputUrl) {
  try {
    const u = new URL(String(inputUrl || ''));
    const host = String(u.hostname || '').toLowerCase();
    if (!(host === 'amateurvoyeurforum.com' || host === 'www.amateurvoyeurforum.com' || host.endsWith('.amateurvoyeurforum.com'))) return null;
    const pathname = String(u.pathname || '').toLowerCase();
    const clean = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (pathname === '/showthread.php') {
      const id = String(u.searchParams.get('t') || u.searchParams.get('p') || '').trim();
      if (!id) return null;
      return { kind: 'thread', id, name: `thread_${id}` };
    }
    if (pathname === '/forumdisplay.php') {
      const id = String(u.searchParams.get('f') || '').trim();
      if (!id) return null;
      return { kind: 'forum', id, name: `forum_${id}` };
    }
    if (pathname === '/attachment.php') {
      const id = String(u.searchParams.get('attachmentid') || '').trim();
      if (!id) return null;
      return { kind: 'attachment', id, name: `attachment_${id}` };
    }
    if (pathname === '/video.php') {
      const userId = String(u.searchParams.get('u') || '').trim();
      if (userId) return { kind: 'member', id: userId, name: `member_${userId}` };
      const tag = String(u.searchParams.get('tag') || '').trim();
      if (tag) {
        const safeTag = clean(tag);
        return { kind: 'tag', id: tag, name: safeTag ? `tag_${safeTag}` : 'videos' };
      }
      return { kind: 'videos', id: 'videos', name: 'videos' };
    }
    if (pathname === '/member.php') {
      const userId = String(u.searchParams.get('u') || '').trim();
      if (!userId) return null;
      return { kind: 'member', id: userId, name: `member_${userId}` };
    }
    return null;
  } catch (e) {
    return null;
  }
}

function moveFileSyncWithFallback(sourcePath, targetPath) {
  const src = path.resolve(String(sourcePath || ''));
  const dst = path.resolve(String(targetPath || ''));
  if (!src || !dst || src === dst) return dst;
  const dstDir = path.dirname(dst);
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });

  try {
    fs.renameSync(src, dst);
    return dst;
  } catch (e) {
    fs.copyFileSync(src, dst);
    if (fs.existsSync(src)) fs.unlinkSync(src);
    return dst;
  }
}

function isRedditRollingTargetUrl(input) {
  const target = String(toRedditDlTarget(input) || '');
  return /^r\//i.test(target) || /^u\//i.test(target);
}

function stripAnsiCodes(input) {
  return String(input || '').replace(/\u001b\[[0-9;]*m/g, '');
}

const IMPORTABLE_VIDEO_EXTS = new Set([
  '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.wmv', '.flv', '.ts', '.m2ts']
);

// Auto-import settings en Startup rehydrate settings worden nu beheerd in src/config.js.
// De variabelen zijn bovenaan via destructuring beschikbaar.

function loadDirectoryFilter() {
  try {
    if (!fs.existsSync(DIRECTORY_FILTER_CONFIG)) return null;
    const raw = fs.readFileSync(DIRECTORY_FILTER_CONFIG, 'utf8');
    const config = JSON.parse(raw);
    if (!config.enabled_dirs || !Array.isArray(config.enabled_dirs)) return null;
    return config.enabled_dirs.map(d => String(d).trim()).filter(Boolean);
  } catch (e) {
    console.warn('Directory filter config load failed:', e.message);
    return null;
  }
}

function shouldIncludePath(relPath, enabledDirs) {
  if (!enabledDirs || enabledDirs.length === 0) return true;
  const p = String(relPath || '').trim();
  if (!p) return true;
  for (const dir of enabledDirs) {
    if (typeof dir === 'string') {
      if (p === dir || p.startsWith(dir + '/') || p.includes('/' + dir + '/') || p.endsWith('/' + dir)) {
        return true;
      }
    }
  }
  return false;
}

// Platform/channel-aware filter for the mappen dialog
function shouldIncludeRow(row, enabledDirs) {
  if (!enabledDirs || enabledDirs.length === 0) return true;
  if (!row) return true;
  const rowPlatform = String(row.platform || '').toLowerCase().trim();
  const rowChannel = String(row.channel || '').toLowerCase().trim();
  if (!rowPlatform) return true;

  // Check if enabledDirs contains objects (new format) or strings (legacy)
  const hasObjects = enabledDirs.some(d => d && typeof d === 'object' && d.platform);
  if (!hasObjects) {
    // Legacy string-based filter
    const relPath = row.filepath ? path.relative(BASE_DIR, row.filepath) : (rowPlatform + '/' + (row.id || ''));
    return shouldIncludePath(relPath, enabledDirs);
  }

  // New object-based filter: [{platform: 'x', channels: ['a','b']}]
  for (const dir of enabledDirs) {
    if (!dir || typeof dir !== 'object') continue;
    const dirPlat = String(dir.platform || '').toLowerCase().trim();
    if (dirPlat !== rowPlatform) continue;
    // Platform matches - check channels
    if (!dir.channels || dir.channels.length === 0) return true; // whole platform selected
    for (const ch of dir.channels) {
      if (String(ch || '').toLowerCase().trim() === rowChannel) return true;
    }
  }
  return false;
}

function findFirstHttpUrl(text) {
  try {
    const m = String(text || '').match(/https?:\/\/[^\s"'<>]+/i);
    return m ? m[0] : '';
  } catch (e) {
    return '';
  }
}

function readImportSidecarMetadata(absVideoPath) {
  const out = { sourceUrl: '', title: '', channel: '', platform: '', sidecarPath: '' };
  try {
    const p = path.resolve(String(absVideoPath || ''));
    const ext = path.extname(p);
    const base = ext ? p.slice(0, -ext.length) : p;
    const candidates = [
      `${base}.info.json`,
      `${base}.json`,
      `${base}.url`,
      `${base}.txt`];


    for (const c of candidates) {
      if (!c || !fs.existsSync(c)) continue;
      const st = fs.statSync(c);
      if (!st || !st.isFile() || st.size <= 0 || st.size > 2 * 1024 * 1024) continue;
      const raw = fs.readFileSync(c, 'utf8');
      if (!raw) continue;

      if (/\.json$/i.test(c)) {
        try {
          const data = JSON.parse(raw);
          if (data && typeof data === 'object') {
            const sourceUrl = String(
              data.source_url || data.sourceUrl || data.webpage_url || data.original_url || data.url || ''
            ).trim();
            const title = String(data.title || data.fulltitle || data.name || '').trim();
            const channel = String(
              data.channel || data.uploader || data.uploader_id || data.author || data.subreddit || ''
            ).trim();
            const platform = String(data.platform || data.extractor_key || '').trim();
            if (sourceUrl) out.sourceUrl = sourceUrl;
            if (title) out.title = title;
            if (channel) out.channel = channel;
            if (platform) out.platform = platform;
            out.sidecarPath = c;
            return out;
          }
        } catch (e) { }
      }

      const sourceUrl = findFirstHttpUrl(raw);
      if (sourceUrl) {
        out.sourceUrl = sourceUrl;
        out.sidecarPath = c;
        return out;
      }
    }
  } catch (e) { }
  return out;
}

function inferPlatformFromImportedFile(absPath, sourceUrl) {
  const src = String(sourceUrl || '').trim();
  if (src) {
    try {
      const p = normalizePlatform(null, src);
      if (p && p !== 'unknown') return p;
    } catch (e) { }
  }

  const lower = String(absPath || '').toLowerCase();
  // 4K Downloader+ output → usually YouTube content
  if (lower.includes('_4kdownloader')) return 'youtube';
  if (lower.includes('reddit')) return 'reddit';
  if (lower.includes('youtube') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('tiktok')) return 'tiktok';
  if (lower.includes('instagram')) return 'instagram';
  if (lower.includes('facebook')) return 'facebook';
  if (lower.includes('threads')) return 'threads';
  return 'other';
}

function summarizeMediaDir(rootDir, maxScan = 12000) {
  try {
    const files = listMediaFilesInDir(rootDir, maxScan);
    let totalBytes = 0;
    for (const abs of files) {
      try {
        const st = fs.statSync(abs);
        const n = Number(st && st.size);
        if (Number.isFinite(n) && n > 0) totalBytes += n;
      } catch (e) { }
    }
    return { count: files.length, totalBytes: Math.max(0, totalBytes) };
  } catch (e) {
    return { count: 0, totalBytes: 0 };
  }
}

function resolveUsableFfmpegPath() {
  try {
    const configured = String(FFMPEG || '').trim();
    if (!configured) return 'ffmpeg';
    if (!configured.includes('/')) return configured;
    try {
      return fs.realpathSync(configured);
    } catch (e) {
      return configured;
    }
  } catch (e) {
    return 'ffmpeg';
  }
}

function isRedditFamilyUrl(input) {
  try {
    const u = new URL(String(input || ''));
    const h = String(u.hostname || '').toLowerCase();
    return h === 'reddit.com' || h.endsWith('.reddit.com') || h === 'redd.it' || h.endsWith('.redd.it');
  } catch (e) {
    return false;
  }
}

function relPathFromBaseDir(absPath) {
  try {
    const b = getBaseDirInfo();
    const baseResolved = b.resolved;
    const baseReal = b.real;
    const abs = path.resolve(String(absPath || ''));
    if (!abs) return '';
    if (baseReal && (abs === baseReal || abs.startsWith(baseReal + path.sep))) {
      return path.relative(baseReal, abs);
    }
    if (baseResolved && (abs === baseResolved || abs.startsWith(baseResolved + path.sep))) {
      return path.relative(baseResolved, abs);
    }
    const extra = Array.isArray(b.extra) ? b.extra : [];
    for (const r of extra) {
      const rr = r && r.resolved ? String(r.resolved) : '';
      const real = r && r.real ? String(r.real) : '';
      if (rr && (abs === rr || abs.startsWith(rr + path.sep))) return abs;
      if (real && (abs === real || abs.startsWith(real + path.sep))) return abs;
    }
    return '';
  } catch (e) {
    return '';
  }
}

function canonicalizeRedditCandidateUrl(input) {
  try {
    const u = new URL(String(input || ''));
    const host = String(u.hostname || '').toLowerCase();
    const p = String(u.pathname || '');
    u.hash = '';

    if (host === 'redd.it' || host.endsWith('.redd.it')) {
      const id = p.replace(/^\/+/, '').split('/')[0];
      if (id) return `https://redd.it/${id}`;
    }

    if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
      const postMatch = p.match(/^\/r\/([^\/\?#]+)\/comments\/([a-z0-9]+)/i);
      if (postMatch && postMatch[1] && postMatch[2]) return `https://www.reddit.com/r/${postMatch[1]}/comments/${postMatch[2]}/`;
      const userPost = p.match(/^\/(?:user|u)\/([^\/\?#]+)\/comments\/([a-z0-9]+)/i);
      if (userPost && userPost[1] && userPost[2]) return `https://www.reddit.com/user/${userPost[1]}/comments/${userPost[2]}/`;
      const subScope = p.match(/^\/r\/([^\/\?#]+)/i);
      if (subScope && subScope[1]) return `https://www.reddit.com/r/${subScope[1]}/`;
      const userScope = p.match(/^\/(?:user|u)\/([^\/\?#]+)/i);
      if (userScope && userScope[1]) return `https://www.reddit.com/user/${userScope[1]}/`;
    }

    return u.toString();
  } catch (e) {
    return String(input || '').trim();
  }
}

function extractRedditPostIdFromUrl(input) {
  try {
    const s = String(input || '').trim();
    if (!s) return '';
    const u = new URL(s);
    const host = String(u.hostname || '').toLowerCase();
    const p = String(u.pathname || '');
    if (host === 'redd.it' || host.endsWith('.redd.it')) {
      return p.replace(/^\/+/, '').split('/')[0] || '';
    }
    const m1 = p.match(/^\/r\/[^\/\?#]+\/comments\/([a-z0-9]+)/i);
    if (m1 && m1[1]) return m1[1];
    const m2 = p.match(/^\/(?:user|u)\/[^\/\?#]+\/comments\/([a-z0-9]+)/i);
    if (m2 && m2[1]) return m2[1];
    return '';
  } catch (e) {
    return '';
  }
}

function toRedditDlTarget(input) {
  try {
    const canonical = canonicalizeRedditCandidateUrl(input);
    const u = new URL(String(canonical || input || ''));
    const host = String(u.hostname || '').toLowerCase();
    const p = String(u.pathname || '');

    if (host === 'redd.it' || host.endsWith('.redd.it')) {
      const id = p.replace(/^\/+/, '').split('/')[0];
      if (id) return `p/${id}`;
    }
    const postId = extractRedditPostIdFromUrl(canonical);
    if (postId) return `p/${postId}`;

    if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
      const subMatch = p.match(/^\/r\/([^\/\?#]+)/i);
      if (subMatch && subMatch[1]) return `r/${subMatch[1]}`;
      const userMatch = p.match(/^\/(?:user|u)\/([^\/\?#]+)/i);
      if (userMatch && userMatch[1]) return `u/${userMatch[1]}`;
    }

    return '';
  } catch (e) {
    return '';
  }
}

function isLikelyRedditMediaPostData(data) {
  try {
    if (!data || typeof data !== 'object') return false;
    if (data.is_gallery === true) return true;
    if (data.media_metadata && typeof data.media_metadata === 'object' && Object.keys(data.media_metadata).length > 0) return true;
    const postHint = String(data.post_hint || '').toLowerCase();
    if (postHint === 'image' || postHint === 'hosted:video') return true;
    const domain = String(data.domain || '').toLowerCase();
    if (domain === 'i.redd.it' || domain === 'v.redd.it' || domain === 'preview.redd.it') return true;
    const url = String(data.url_overridden_by_dest || data.url || '').toLowerCase();
    if (/\.(jpg|jpeg|png|webp|gif|mp4|mov|webm)(\?|$)/i.test(url)) return true;
    return false;
  } catch (e) {
    return false;
  }
}

function safeIsAllowedExistingPath(p) {
  try {
    const abs = path.resolve(String(p || ''));
    if (!abs) return false;
    if (!fs.existsSync(abs)) return false;
    if (safeIsInsideBaseDir(abs)) return true;
    try {
      const real = fs.realpathSync(abs);
      if (real && safeIsInsideBaseDir(real)) return true;
    } catch (e) { }
    return false;
  } catch (e) {
    return false;
  }
}

function isInsidePrimaryBaseDir(p) {
  try {
    const b = getBaseDirInfo();
    const baseResolved = b.resolved;
    const baseReal = b.real;
    const abs = path.resolve(String(p || ''));
    return (
      abs === baseResolved ||
      abs.startsWith(baseResolved + path.sep) ||
      abs === baseReal ||
      abs.startsWith(baseReal + path.sep));

  } catch (e) {
    return false;
  }
}

function redditPermalinkFromPostData(data) {
  try {
    if (!data || typeof data !== 'object') return '';
    const permalink = String(data.permalink || '').trim();
    if (permalink) return `https://www.reddit.com${permalink.startsWith('/') ? '' : '/'}${permalink}`;
    const sub = String(data.subreddit || '').trim();
    const id = String(data.id || '').trim();
    if (sub && id) return `https://www.reddit.com/r/${sub}/comments/${id}/`;
    return '';
  } catch (e) {
    return '';
  }
}

async function fetchJsonWithTimeout(url, timeoutMs = 20000, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try { ctrl.abort(); } catch (e) { }
  }, Math.max(1000, timeoutMs));
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': REDDIT_DL_USERNAME ?
          `script:webdl-reddit-index:1.0 (by /u/${REDDIT_DL_USERNAME})` :
          'script:webdl-reddit-index:1.0 (by /u/webdl)',
        'Accept': 'application/json',
        ...headers
      },
      signal: ctrl.signal
    });
    const bodyText = await res.text();
    if (!res.ok) {
      const msg = bodyText ? `HTTP ${res.status}: ${bodyText.slice(0, 240)}` : `HTTP ${res.status}`;
      const err = new Error(msg);
      err.httpStatus = res.status;
      throw err;
    }
    try {
      return bodyText ? JSON.parse(bodyText) : {};
    } catch (e) {
      throw new Error(`JSON parse error: ${e.message}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

let redditOAuthTokenCache = { token: '', expiresAtMs: 0 };

async function getRedditOAuthAccessToken() {
  const now = Date.now();
  if (redditOAuthTokenCache.token && redditOAuthTokenCache.expiresAtMs > now + 30000) {
    return redditOAuthTokenCache.token;
  }
  if (!REDDIT_DL_CLIENT_ID || !REDDIT_DL_CLIENT_SECRET || !REDDIT_DL_USERNAME || !REDDIT_DL_PASSWORD) {
    return '';
  }

  const basic = Buffer.from(`${REDDIT_DL_CLIENT_ID}:${REDDIT_DL_CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'password',
    username: REDDIT_DL_USERNAME,
    password: REDDIT_DL_PASSWORD
  }).toString();

  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try { ctrl.abort(); } catch (e) { }
  }, 15000);
  try {
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': `script:webdl-reddit-index:1.0 (by /u/${REDDIT_DL_USERNAME})`
      },
      body,
      signal: ctrl.signal
    });
    if (!res.ok) return '';
    const data = await res.json();
    const token = String(data && data.access_token || '').trim();
    const expiresIn = Number(data && data.expires_in || 3600);
    if (!token) return '';
    redditOAuthTokenCache = {
      token,
      expiresAtMs: now + (Number.isFinite(expiresIn) ? Math.max(60, expiresIn) : 3600) * 1000
    };
    return token;
  } catch (e) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRedditListingJson(pathWithQuery, timeoutMs = 25000) {
  const tail = String(pathWithQuery || '').replace(/^\/+/, '');
  const candidates = [];

  try {
    const oauthToken = await getRedditOAuthAccessToken();
    if (oauthToken) {
      candidates.push({
        url: `https://oauth.reddit.com/${tail}`,
        headers: { 'Authorization': `Bearer ${oauthToken}` },
        label: 'oauth'
      });
    }
  } catch (e) { }

  candidates.push(
    { url: `https://www.reddit.com/${tail}`, headers: {}, label: 'www' },
    { url: `https://old.reddit.com/${tail}`, headers: {}, label: 'old' }
  );

  const errors = [];
  for (const c of candidates) {
    try {
      return await fetchJsonWithTimeout(c.url, timeoutMs, c.headers);
    } catch (e) {
      errors.push(`${c.label}: ${e.message || String(e)}`);
    }
  }
  throw new Error(`Reddit listing request failed (${errors.join(' | ')})`);
}

async function indexRedditSeedUrl(seedUrl, options = {}) {
  const canonicalSeed = canonicalizeRedditCandidateUrl(seedUrl);
  const maxItems = Math.max(1, Math.min(REDDIT_INDEX_MAX_ITEMS, Number(options.maxItems) || REDDIT_INDEX_MAX_ITEMS));
  const maxPages = Math.max(1, Math.min(REDDIT_INDEX_MAX_PAGES, Number(options.maxPages) || REDDIT_INDEX_MAX_PAGES));

  const postId = extractRedditPostIdFromUrl(canonicalSeed);
  if (postId) {
    return {
      seed: canonicalSeed,
      mode: 'post',
      urls: [canonicalSeed],
      scannedPages: 1,
      scannedPosts: 1,
      reachedEnd: true
    };
  }

  const target = toRedditDlTarget(canonicalSeed);
  if (!target) {
    return { seed: canonicalSeed, mode: 'unknown', urls: [], scannedPages: 0, scannedPosts: 0, reachedEnd: true };
  }

  const matchSub = target.match(/^r\/(.+)$/i);
  const matchUser = target.match(/^u\/(.+)$/i);
  let listingPath = '';
  let mode = 'unknown';
  if (matchSub && matchSub[1]) {
    mode = 'subreddit';
    listingPath = `r/${matchSub[1]}/new.json`;
  } else if (matchUser && matchUser[1]) {
    mode = 'user';
    listingPath = `user/${matchUser[1]}/submitted/.json`;
  } else {
    return { seed: canonicalSeed, mode: 'unknown', urls: [], scannedPages: 0, scannedPosts: 0, reachedEnd: true };
  }

  const out = [];
  const seen = new Set();
  let after = '';
  let scannedPages = 0;
  let scannedPosts = 0;
  let reachedEnd = false;

  while (scannedPages < maxPages && out.length < maxItems) {
    const q = new URLSearchParams({ limit: '100', raw_json: '1' });
    if (after) q.set('after', after);
    const payload = await fetchRedditListingJson(`${listingPath}?${q.toString()}`, 25000);
    scannedPages += 1;
    const children = ((payload || {}).data || {}).children || [];
    if (!Array.isArray(children) || children.length === 0) {
      reachedEnd = true;
      break;
    }

    for (const row of children) {
      const data = row && row.data ? row.data : null;
      if (!data) continue;
      scannedPosts += 1;
      if (!isLikelyRedditMediaPostData(data)) continue;
      const permalink = redditPermalinkFromPostData(data);
      if (!permalink) continue;
      const canonical = canonicalizeRedditCandidateUrl(permalink);
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      out.push(canonical);
      if (out.length >= maxItems) break;
    }

    after = String(((payload || {}).data || {}).after || '');
    if (!after) {
      reachedEnd = true;
      break;
    }
  }

  return {
    seed: canonicalSeed,
    mode,
    urls: out,
    scannedPages,
    scannedPosts,
    reachedEnd
  };
}

function hostMatchesAnySuffix(host, suffixes) {
  const h = String(host || '').toLowerCase();
  if (!h) return false;
  for (const s of Array.isArray(suffixes) ? suffixes : []) {
    const suf = String(s || '').toLowerCase();
    if (!suf) continue;
    if (h === suf || h.endsWith(`.${suf}`)) return true;
  }
  return false;
}

function shouldSkipMetadataFetchForUrl(inputUrl, platform) {
  try {
    if (String(platform || '').toLowerCase() === 'reddit') return true;
    const u = new URL(String(inputUrl || ''));
    const host = String(u.hostname || '').toLowerCase();
    if (hostMatchesAnySuffix(host, METADATA_BLOCKED_DOMAIN_SUFFIXES)) return true;
    return false;
  } catch (e) {
    return false;
  }
}

// Geeft het absolute pad terug van het eerste (alfabetisch) geïndexeerde bestand
// voor een specifieke download. Nodig voor platforms waar meerdere downloads
// dezelfde filepath (gedeelde channel-dir) delen, bv. gallery-dl/pornpics:
// dan staat er in downloads.filepath alleen de channel-dir en moeten we via
// download_files de echte per-download subdir achterhalen. Retourneert null
// als er geen indexering is of het bestand niet bestaat.
async function getFirstDownloadFileAbs(downloadId) {
  try {
    const id = Number(downloadId);
    if (!Number.isFinite(id)) return null;
    const cache = getFirstDownloadFileAbs._cache || (getFirstDownloadFileAbs._cache = new Map());
    const cached = cache.get(id);
    if (cached && (Date.now() - (cached.at || 0)) < 30000) {
      return cached.abs || null;
    }
    const row = await db.prepare(
      db.isPostgres
        ? `SELECT relpath FROM download_files WHERE download_id = $1 ORDER BY relpath ASC LIMIT 1`
        : `SELECT relpath FROM download_files WHERE download_id = ? ORDER BY relpath ASC LIMIT 1`
    ).get(id);
    if (!row || !row.relpath) {
      cache.set(id, { at: Date.now(), abs: null });
      return null;
    }
    const abs = path.resolve(BASE_DIR, String(row.relpath));
    if (!safeIsAllowedExistingPath(abs)) {
      cache.set(id, { at: Date.now(), abs: null });
      return null;
    }
    cache.set(id, { at: Date.now(), abs });
    if (cache.size > 2000) {
      const keys = Array.from(cache.keys()).slice(0, 500);
      for (const k of keys) cache.delete(k);
    }
    return abs;
  } catch (e) {
    return null;
  }
}

function pickPrimaryMediaFile(absDir, maxScan = 600) {
  try {
    const dir = path.resolve(String(absDir || ''));
    if (!dir || !safeIsInsideBaseDir(dir) || !fs.existsSync(dir)) return null;

    const cache = pickPrimaryMediaFile._cache || (pickPrimaryMediaFile._cache = new Map());
    let dirMtimeMs = 0;
    try {
      const stDir = fs.statSync(dir);
      dirMtimeMs = stDir && Number.isFinite(stDir.mtimeMs) ? stDir.mtimeMs : 0;
    } catch (e) {
      dirMtimeMs = 0;
    }

    try {
      const cached = cache.get(dir);
      if (cached && cached.dirMtimeMs === dirMtimeMs && Date.now() - (cached.at || 0) < 8000) {
        return cached.value || null;
      }
    } catch (e) { }

    const files = listMediaFilesInDir(dir, maxScan);
    if (!files.length) {
      try { cache.set(dir, { at: Date.now(), dirMtimeMs, value: null }); } catch (e) { }
      return null;
    }

    const videoExts = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);
    const imageExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif', '.heic', '.heif']);

    let best = null;
    let bestScore = -Infinity;
    for (const file of files) {
      if (!file || !safeIsInsideBaseDir(file) || !fs.existsSync(file)) continue;
      const name = path.basename(file).toLowerCase();
      const ext = path.extname(file).toLowerCase();
      let score = 0;
      if (videoExts.has(ext)) score += 1000; else
        if (imageExts.has(ext)) score += 300; else
          score += 50;
      if (!/_raw/i.test(name)) score += 120;
      if (/final|edited|merged/.test(name)) score += 40;
      if (/\.mp4$/.test(name)) score += 20;
      try {
        const st = fs.statSync(file);
        if (st && st.mtimeMs) score += st.mtimeMs / 1000000;
      } catch (e) { }
      if (score > bestScore) {
        bestScore = score;
        best = file;
      }
    }

    if (!best) {
      try { cache.set(dir, { at: Date.now(), dirMtimeMs, value: null }); } catch (e) { }
      return null;
    }

    let mtime = 0;
    try {
      const st = fs.statSync(best);
      if (st && st.mtimeMs) mtime = st.mtimeMs;
    } catch (e) { }

    const out = { path: best, mtime };
    try {
      cache.set(dir, { at: Date.now(), dirMtimeMs, value: out });
      if (cache.size > 900) {
        const overflow = cache.size - 750;
        let n = 0;
        for (const k of cache.keys()) {
          cache.delete(k);
          n++;
          if (n >= overflow) break;
        }
      }
    } catch (e) { }
    return out;
  } catch (e) {
    return null;
  }
}
function getAvfoundationDeviceListCached(maxAgeMs = 60 * 1000) {
  return new Promise((resolve) => {
    try {
      const now = Date.now();
      if (avfoundationDeviceListCache && now - (avfoundationDeviceListCache.ts || 0) < maxAgeMs) {
        return resolve(avfoundationDeviceListCache.data);
      }

      const args = ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''];
      const proc = spawn(FFMPEG, args);
      let stderr = '';
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try { proc.kill('SIGKILL'); } catch (e) { }
        const data = parseAvfoundationDeviceList(stderr);
        avfoundationDeviceListCache = { ts: now, data };
        resolve(data);
      }, 12000);

      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', () => {
        if (done) return;
        done = true;
        try { clearTimeout(timer); } catch (e) { }
        const data = parseAvfoundationDeviceList(stderr);
        avfoundationDeviceListCache = { ts: now, data };
        resolve(data);
      });
      proc.on('error', () => {
        if (done) return;
        done = true;
        try { clearTimeout(timer); } catch (e) { }
        const data = parseAvfoundationDeviceList(stderr);
        avfoundationDeviceListCache = { ts: now, data };
        resolve(data);
      });
    } catch (e) {
      resolve({ video: [], audio: [], raw: '' });
    }
  });
}

function pickAvfoundationScreenVideoDevice(devices) {
  try {
    const list = devices && Array.isArray(devices.video) ? devices.video : [];
    if (!list.length) return null;
    const wanted = list.find((d) => /capture\s*screen/i.test(String(d.name || '')));
    if (wanted && Number.isFinite(wanted.index)) return wanted;
    const screenish = list.find((d) => /screen|display/i.test(String(d.name || '')));
    if (screenish && Number.isFinite(screenish.index)) return screenish;
    const first = list[0];
    if (first && Number.isFinite(first.index)) return first;
    return null;
  } catch (e) {
    return null;
  }
}

function pickAvfoundationDefaultAudioDevice(devices) {
  try {
    const list = devices && Array.isArray(devices.audio) ? devices.audio : [];
    if (!list.length) return null;
    const multi = list.find((d) => /multi\s*-?\s*output|aggregate/i.test(String(d.name || '')));
    if (multi && Number.isFinite(multi.index)) return multi;
    const systemAudio = list.find((d) => /blackhole|loopback|soundflower/i.test(String(d.name || '')));
    if (systemAudio && Number.isFinite(systemAudio.index)) return systemAudio;
    return null;
  } catch (e) {
    return null;
  }
}

function resolveAddonSourceDir() {
  const candidates = [];

  if (process.env.WEBDL_ADDON_SOURCE_DIR) candidates.push(String(process.env.WEBDL_ADDON_SOURCE_DIR));
  candidates.push(path.resolve(__dirname, '..', '..', '..', 'firefox-native-controller'));
  candidates.push(path.resolve(process.cwd(), '..', 'firefox-native-controller'));
  candidates.push(path.resolve(process.cwd(), 'firefox-native-controller'));
  candidates.push(path.join(os.homedir(), 'WEBDL', 'firefox-native-controller'));

  for (const dir of candidates) {
    try {
      const manifestPath = path.join(dir, 'manifest.json');
      if (fs.existsSync(manifestPath)) return dir;
    } catch (e) { }
  }

  return candidates[0];
}

// getViewerHTML → extracted to ./views/viewer.js

// getGalleryHTML → extracted to ./views/gallery.js

const ADDON_SOURCE_DIR = resolveAddonSourceDir();

function getAddonBuildMarker() {
  try {
    const toolbarPath = path.join(ADDON_SOURCE_DIR, 'content', 'debug-toolbar.js');
    if (!fs.existsSync(toolbarPath)) return null;
    const src = fs.readFileSync(toolbarPath, 'utf8');
    const m = src.match(/WEBDL_BUILD\s*=\s*['\"]([^'\"]+)['\"]/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

function getAddonBuildState() {
  const manifestPath = path.join(ADDON_SOURCE_DIR, 'manifest.json');
  const outPath = ADDON_PACKAGE_PATH;
  const outStat = fs.existsSync(outPath) ? fs.statSync(outPath) : null;
  const packageMtimeMs = outStat ? outStat.mtimeMs : 0;

  const state = {
    sourceDir: ADDON_SOURCE_DIR,
    packagePath: outPath,
    manifestPath,
    packageExists: !!outStat,
    packageSizeBytes: outStat ? outStat.size : 0,
    packageMtimeMs,
    packageMtimeIso: outStat ? new Date(outStat.mtimeMs).toISOString() : null,
    sourceExists: fs.existsSync(manifestPath),
    sourceFileCount: 0,
    sourceNewestMtimeMs: 0,
    sourceNewestIso: null,
    sourceNewestFile: null,
    sourceManifestVersion: null,
    sourceBuildMarker: getAddonBuildMarker()
  };

  if (!state.sourceExists) return state;

  try {
    const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw);
    state.sourceManifestVersion = manifest && manifest.version ? String(manifest.version) : null;
  } catch (e) { }

  const stack = [ADDON_SOURCE_DIR];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }

    for (const entry of entries) {
      const name = String(entry && entry.name ? entry.name : '');
      if (!name) continue;
      if (name === '.git' || name === 'node_modules' || name === '.DS_Store') continue;

      const abs = path.join(dir, name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;

      state.sourceFileCount += 1;
      let st = null;
      try {
        st = fs.statSync(abs);
      } catch (e) {
        continue;
      }
      if (st.mtimeMs >= state.sourceNewestMtimeMs) {
        state.sourceNewestMtimeMs = st.mtimeMs;
        state.sourceNewestIso = new Date(st.mtimeMs).toISOString();
        state.sourceNewestFile = path.relative(ADDON_SOURCE_DIR, abs);
      }
    }
  }

  return state;
}

const NICE_LEVEL = parseInt(process.env.WEBDL_NICE_LEVEL || '10', 10);
const YTDLP_CONCURRENT_FRAGMENTS = String(process.env.WEBDL_YTDLP_CONCURRENT_FRAGMENTS || '4');
const POSTPROCESS_THREADS = String(process.env.WEBDL_POSTPROCESS_THREADS || '').trim();
const YTDLP_YT_SLEEP_INTERVAL = parseInt(process.env.WEBDL_YTDLP_YOUTUBE_SLEEP_INTERVAL || '0', 10);
const YTDLP_YT_MAX_SLEEP_INTERVAL = parseInt(process.env.WEBDL_YTDLP_YOUTUBE_MAX_SLEEP_INTERVAL || '0', 10);
const YTDLP_YT_SLEEP_REQUESTS = parseFloat(process.env.WEBDL_YTDLP_YOUTUBE_SLEEP_REQUESTS || '0');
const YTDLP_YT_LIMIT_RATE = String(process.env.WEBDL_YTDLP_YOUTUBE_LIMIT_RATE || '').trim();

const YTDLP_COOKIES_MODE = String(process.env.WEBDL_YTDLP_COOKIES_MODE || 'browser').trim().toLowerCase();
const YTDLP_COOKIES_FILE = String(process.env.WEBDL_YTDLP_COOKIES_FILE || '').trim();
const YTDLP_COOKIES_BROWSER = String(process.env.WEBDL_YTDLP_COOKIES_BROWSER || 'firefox').trim();
const YTDLP_COOKIES_BROWSER_PROFILE = String(process.env.WEBDL_YTDLP_COOKIES_BROWSER_PROFILE || '').trim();
const YTDLP_USE_COOKIES_FOR_METADATA = String(process.env.WEBDL_YTDLP_USE_COOKIES_FOR_METADATA || '0') === '1';
const YTDLP_METADATA_TIMEOUT_MS = parseInt(process.env.WEBDL_YTDLP_METADATA_TIMEOUT_MS || '45000', 10);

const CHB_RECORDING_INPUT_PIXEL_FORMAT = String(process.env.WEBDL_CHB_RECORDING_INPUT_PIXEL_FORMAT || 'nv12').trim();
const CHB_RECORDING_VIDEO_CODEC = String(process.env.WEBDL_CHB_RECORDING_VIDEO_CODEC || 'libx264').trim();
const CHB_RECORDING_X264_PRESET = String(process.env.WEBDL_CHB_RECORDING_X264_PRESET || LIBX264_PRESET).trim();

function buildCookiesFromBrowserSpec() {
  const browserName = YTDLP_COOKIES_BROWSER || 'firefox';
  if (YTDLP_COOKIES_BROWSER_PROFILE) return `${browserName}:${YTDLP_COOKIES_BROWSER_PROFILE}`;
  return browserName;
}

function getYtDlpCookieArgs(purpose = 'download') {
  const p = String(purpose || 'download').toLowerCase();
  const allowCookies = p === 'download' || p === 'metadata' && YTDLP_USE_COOKIES_FOR_METADATA;
  if (!allowCookies) return [];

  if (YTDLP_COOKIES_MODE === 'none' || YTDLP_COOKIES_MODE === 'off' || YTDLP_COOKIES_MODE === '0') return [];

  if (YTDLP_COOKIES_MODE === 'file') {
    if (YTDLP_COOKIES_FILE) {
      try {
        if (fs.existsSync(YTDLP_COOKIES_FILE)) return ['--cookies', YTDLP_COOKIES_FILE];
      } catch (e) { }
    }
    return [];
  }

  if (YTDLP_COOKIES_MODE === 'browser') {
    return ['--cookies-from-browser', buildCookiesFromBrowserSpec()];
  }

  return [];
}

function spawnNice(command, args, options = {}) {
  if (Number.isFinite(NICE_LEVEL) && NICE_LEVEL > 0) {
    return spawn('/usr/bin/nice', ['-n', String(NICE_LEVEL), command, ...args], options);
  }
  return spawn(command, args, options);
}

// Zorg dat basemap bestaat
if (!fs.existsSync(BASE_DIR)) {
  fs.mkdirSync(BASE_DIR, { recursive: true });
}

// ========================
// DATABASE
// ========================
const DATABASE_URL = String(process.env.DATABASE_URL || 'postgres://localhost/webdl').trim();
const DEFAULT_DB_ENGINE = 'postgres';
const WEBDL_DB_ENGINE = 'postgres';
if ((WEBDL_DB_ENGINE === 'postgres' || WEBDL_DB_ENGINE === 'pg') && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required when WEBDL_DB_ENGINE=postgres');
}
const db = createDb({ engine: WEBDL_DB_ENGINE, sqlitePath: DB_PATH, databaseUrl: DATABASE_URL });
if (db.isSqlite) db.pragma('journal_mode = WAL');

async function ensurePostgresSchemaReady() {
  if (!db.isPostgres) return;
  try {
    await db.prepare('ALTER TABLE downloads ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP').run();
  } catch (e) { }
  try {
    await db.prepare('ALTER TABLE downloads ADD COLUMN IF NOT EXISTS rating DOUBLE PRECISION').run();
  } catch (e) { }
  try {
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_downloads_finished_at ON downloads(finished_at DESC)').run();
  } catch (e) { }
  try {
    await db.prepare('ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS rating DOUBLE PRECISION').run();
  } catch (e) { }
  try {
    await db.prepare('ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP').run();
  } catch (e) { }

  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS tags (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL
      )
    `).run();
  } catch (e) { console.error('Error creating tags table:', e); }

  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS media_tags (
        kind TEXT NOT NULL,
        media_id TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (kind, media_id, tag_id),
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      )
    `).run();
  } catch (e) { console.error('Error creating media_tags table:', e); }

}

if (db.isSqlite) db.exec(`
  CREATE TABLE IF NOT EXISTS downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    platform TEXT DEFAULT 'unknown',
    channel TEXT DEFAULT 'unknown',
    title TEXT DEFAULT 'untitled',
    description TEXT,
    duration TEXT,
    thumbnail TEXT,
    filename TEXT,
    filepath TEXT,
    filesize INTEGER,
    format TEXT,
    status TEXT DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    error TEXT,
    metadata TEXT,
    rating REAL,
    source_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT,
    platform TEXT,
    channel TEXT,
    title TEXT,
    filename TEXT,
    filepath TEXT,
    filesize INTEGER,
    rating REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );


  CREATE TABLE IF NOT EXISTS download_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    download_id INTEGER NOT NULL,
    relpath TEXT NOT NULL,
    filesize INTEGER,
    mtime_ms INTEGER,
    created_at TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(download_id, relpath)
  );

  CREATE INDEX IF NOT EXISTS idx_download_files_download_id ON download_files(download_id);
  CREATE INDEX IF NOT EXISTS idx_download_files_mtime ON download_files(mtime_ms DESC);
  CREATE INDEX IF NOT EXISTS idx_download_files_updated ON download_files(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_download_files_created ON download_files(created_at DESC);
`);

if (db.isSqlite) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_tags (
      kind TEXT NOT NULL,
      media_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (kind, media_id, tag_id),
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
  `);
}

try {
  if (db.isSqlite) {
    const cols = db.prepare("PRAGMA table_info(downloads)").all();
    const hasFinishedAt = (cols || []).some((c) => String(c && c.name ? c.name : '') === 'finished_at');
    if (!hasFinishedAt) {
      if (db.isSqlite) db.exec('ALTER TABLE downloads ADD COLUMN finished_at DATETIME');
    }
    const hasRating = (cols || []).some((c) => String(c && c.name ? c.name : '') === 'rating');
    if (!hasRating) {
      if (db.isSqlite) db.exec('ALTER TABLE downloads ADD COLUMN rating REAL');
    }
  }
} catch (e) { }

try {
  if (db.isSqlite) {
    const cols = db.prepare("PRAGMA table_info(screenshots)").all();
    const hasRating = (cols || []).some((c) => String(c && c.name ? c.name : '') === 'rating');
    if (!hasRating) {
      if (db.isSqlite) db.exec('ALTER TABLE screenshots ADD COLUMN rating REAL');
    }
    const hasUpdatedAt = (cols || []).some((c) => String(c && c.name ? c.name : '') === 'updated_at');
    if (!hasUpdatedAt) {
      if (db.isSqlite) db.exec('ALTER TABLE screenshots ADD COLUMN updated_at DATETIME');
      try {
        if (db.isSqlite) db.exec("UPDATE screenshots SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL OR TRIM(updated_at) = ''");
      } catch (e) { }
    }
  }
} catch (e) { }

try {
  if (db.isSqlite) db.exec('CREATE INDEX IF NOT EXISTS idx_downloads_finished_at ON downloads(finished_at DESC)');
} catch (e) { }

try {
  if (db.isSqlite) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_downloads_status_finished ON downloads(status, finished_at DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_downloads_status_updated ON downloads(status, updated_at DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_screenshots_filepath ON screenshots(filepath)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_screenshots_created ON screenshots(created_at DESC)');
  } else {
    db.exec('CREATE INDEX IF NOT EXISTS idx_downloads_status_finished ON downloads(status, finished_at DESC NULLS LAST)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_downloads_status_updated ON downloads(status, updated_at DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_screenshots_filepath ON screenshots(filepath)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_screenshots_created ON screenshots(created_at DESC)');
  }
} catch (e) { }

try {
  if (db.isSqlite) {
    db.exec("UPDATE downloads SET finished_at = COALESCE(finished_at, updated_at) WHERE status IN ('completed','error','cancelled') AND (finished_at IS NULL OR TRIM(finished_at)='')");
    db.exec("UPDATE downloads SET status = 'pending' WHERE status IN ('downloading', 'postprocessing', 'queued')");
  } else if (db.isPostgres) {
    db.query("UPDATE downloads SET finished_at = COALESCE(finished_at, updated_at) WHERE status IN ('completed','error','cancelled') AND finished_at IS NULL").catch(() => { });
    db.query("UPDATE downloads SET status = 'pending' WHERE status IN ('downloading', 'postprocessing', 'queued')").catch(() => { });
  }
} catch (e) { }

try {
  if (db.isSqlite) db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_downloads_finished_at_insert
    AFTER INSERT ON downloads
    WHEN NEW.status IN ('completed','error','cancelled') AND (NEW.finished_at IS NULL OR TRIM(NEW.finished_at)='')
    BEGIN
      UPDATE downloads
      SET finished_at = STRFTIME('%Y-%m-%d %H:%M:%f','now')
      WHERE id = NEW.id;
    END;
  `);
} catch (e) { }

try {
  if (db.isSqlite) db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_downloads_finished_at_update
    AFTER UPDATE OF status ON downloads
    WHEN NEW.status IN ('completed','error','cancelled') AND (NEW.finished_at IS NULL OR TRIM(NEW.finished_at)='')
    BEGIN
      UPDATE downloads
      SET finished_at = STRFTIME('%Y-%m-%d %H:%M:%f','now')
      WHERE id = NEW.id;
    END;
  `);
} catch (e) { }

try {
  if (db.isSqlite) db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_downloads_finished_at_clear
    AFTER UPDATE OF status ON downloads
    WHEN OLD.status IN ('completed','error','cancelled') AND NEW.status NOT IN ('completed','error','cancelled')
    BEGIN
      UPDATE downloads
      SET finished_at = NULL
      WHERE id = NEW.id;
    END;
  `);
} catch (e) { }

const insertDownload = db.prepare(`INSERT INTO downloads (url, platform, channel, title, status) VALUES (?, ?, ?, ?, 'pending')`);
const rawUpdateDownload = db.prepare(`UPDATE downloads SET status=?, progress=?, filepath=?, filename=?, filesize=?, format=?, metadata=?, error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const rawUpdateDownloadStatus = db.prepare(`UPDATE downloads SET status=?, progress=?, error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const updateDownloadMeta = db.prepare(`UPDATE downloads SET title=?, channel=?, description=?, duration=?, thumbnail=?, metadata=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const updateDownloadBasics = db.prepare(`UPDATE downloads SET platform=?, channel=?, title=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const updateDownloadFilepath = db.prepare(`UPDATE downloads SET filepath=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const updateDownloadSourceUrl = db.prepare(`UPDATE downloads SET source_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const updateDownloadThumbnail = db.prepare(`UPDATE downloads SET thumbnail=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const updateDownloadRating = db.prepare(`UPDATE downloads SET rating=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const updateDownloadUrl = db.prepare(`UPDATE downloads SET url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const rawGetDownload = db.prepare(`SELECT * FROM downloads WHERE id=?`);
const getDownload = rawGetDownload;
const updateScreenshotRating = db.prepare(`UPDATE screenshots SET rating=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const DOWNLOAD_ACTIVITY_MAX = Math.max(50, Math.min(1000, parseInt(process.env.WEBDL_DOWNLOAD_ACTIVITY_MAX || '300', 10) || 300));
const recentDownloadActivity = [];
const downloadActivityContextById = new Map();
const downloadActivityLastStatusById = new Map();
const downloadActivityLastProgressBucketById = new Map();
const downloadActivityLastErrorById = new Map();

function trimDownloadActivityString(v, max = 180) {
  try {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    return s.length > max ? (s.slice(0, Math.max(1, max - 1)) + '…') : s;
  } catch (e) {
    return '';
  }
}

function summarizeDownloadActivityUrl(v) {
  try {
    const s = String(v || '').trim();
    if (!s) return '';
    const u = new URL(s);
    const host = String(u.hostname || '').toLowerCase();
    const p = trimDownloadActivityString(String(u.pathname || ''), 90);
    return p ? `${host}${p}` : host;
  } catch (e) {
    return trimDownloadActivityString(v, 90);
  }
}

function setDownloadActivityContext(downloadId, patch) {
  try {
    const id = Number(downloadId);
    if (!Number.isFinite(id)) return null;
    const prev = downloadActivityContextById.get(id) || {};
    const next = {
      download_id: id,
      url: patch && patch.url ? String(patch.url) : (prev.url || ''),
      source_url: patch && patch.source_url ? String(patch.source_url) : (prev.source_url || ''),
      platform: patch && patch.platform ? String(patch.platform) : (prev.platform || ''),
      channel: patch && patch.channel ? String(patch.channel) : (prev.channel || ''),
      title: patch && patch.title ? String(patch.title) : (prev.title || ''),
      filepath: patch && patch.filepath ? String(patch.filepath) : (prev.filepath || ''),
      filename: patch && patch.filename ? String(patch.filename) : (prev.filename || ''),
      thumbnail: patch && typeof patch.thumbnail !== 'undefined' ? String(patch.thumbnail) : (prev.thumbnail || ''),
      progress: patch && typeof patch.progress !== 'undefined' ? patch.progress : prev.progress,
      status: patch && patch.status ? String(patch.status) : (prev.status || ''),
      lane: patch && patch.lane ? String(patch.lane) : (prev.lane || ''),
      driver: patch && patch.driver ? String(patch.driver) : (prev.driver || '')
    };
    downloadActivityContextById.set(id, next);
    if (downloadActivityContextById.size > 4000) {
      const keys = Array.from(downloadActivityContextById.keys()).slice(0, Math.max(1, downloadActivityContextById.size - 2500));
      for (const k of keys) downloadActivityContextById.delete(k);
    }
    return next;
  } catch (e) {
    return null;
  }
}

async function hydrateDownloadActivityContext(downloadId) {
  try {
    const id = Number(downloadId);
    if (!Number.isFinite(id)) return null;
    const prev = downloadActivityContextById.get(id) || {};
    if (prev.platform && prev.title && prev.url) return prev;
    const row = await rawGetDownload.get(id);
    if (!row) return prev;
    return setDownloadActivityContext(id, {
      url: row.url || '',
      sourceUrl: row.source_url || '',
      source_url: row.source_url || '',
      platform: row.platform || '',
      channel: row.channel || '',
      title: row.title || '',
      filepath: row.filepath || '',
      filename: row.filename || ''
    });
  } catch (e) {
    return null;
  }
}

function pushRecentDownloadActivity(entry) {
  try {
    recentDownloadActivity.push(entry);
    if (recentDownloadActivity.length > DOWNLOAD_ACTIVITY_MAX) {
      recentDownloadActivity.splice(0, recentDownloadActivity.length - DOWNLOAD_ACTIVITY_MAX);
    }
  } catch (e) { }
}

function printRecentDownloadActivity(entry) {
  try {
    if (!entry) return;
    const parts = [];
    const id = Number(entry.download_id);
    parts.push(`[DL #${Number.isFinite(id) ? id : '?'}]`);
    if (entry.event) parts.push(String(entry.event).toUpperCase());
    if (entry.status && entry.status !== entry.event) parts.push(String(entry.status).toUpperCase());
    const plat = trimDownloadActivityString(entry.platform || '', 40);
    const ch = trimDownloadActivityString(entry.channel || '', 50);
    if (plat || ch) parts.push((plat || '?') + (ch ? `/${ch}` : ''));
    const title = trimDownloadActivityString(entry.title || '', 120);
    if (title) parts.push(`:: ${title}`);
    const tail = [];
    if (entry.lane) tail.push(`lane=${entry.lane}`);
    if (entry.driver) tail.push(`driver=${entry.driver}`);
    if (Number.isFinite(Number(entry.progress))) tail.push(`${Math.max(0, Math.min(100, Number(entry.progress)))}%`);
    if (entry.url) tail.push(summarizeDownloadActivityUrl(entry.url));
    if (entry.error) tail.push(trimDownloadActivityString(entry.error, 220));
    if (entry.filename) tail.push(trimDownloadActivityString(entry.filename, 80));
    else if (entry.filepath && (entry.status === 'completed' || entry.event === 'completed')) tail.push(trimDownloadActivityString(path.basename(String(entry.filepath || '')), 80));
    const msg = parts.join(' ') + (tail.length ? ` | ${tail.join(' | ')}` : '');
    console.log(msg);
  } catch (e) { }
}

async function emitDownloadEventActivity(event, downloadId, extra = {}) {
  try {
    const id = Number(downloadId);
    if (!Number.isFinite(id)) return;
    setDownloadActivityContext(id, extra || {});
    const ctx = await hydrateDownloadActivityContext(id) || {};
    const entry = {
      at: new Date().toISOString(),
      event: String(event || 'event'),
      status: extra && extra.status ? String(extra.status) : null,
      download_id: id,
      progress: Number.isFinite(Number(extra && extra.progress)) ? Number(extra.progress) : null,
      platform: extra && extra.platform ? String(extra.platform) : (ctx.platform || null),
      channel: extra && extra.channel ? String(extra.channel) : (ctx.channel || null),
      title: extra && extra.title ? String(extra.title) : (ctx.title || null),
      url: extra && extra.url ? String(extra.url) : (ctx.url || null),
      source_url: extra && extra.source_url ? String(extra.source_url) : (ctx.source_url || null),
      filepath: extra && extra.filepath ? String(extra.filepath) : (ctx.filepath || null),
      filename: extra && extra.filename ? String(extra.filename) : (ctx.filename || null),
      lane: extra && extra.lane ? String(extra.lane) : (ctx.lane || null),
      driver: extra && extra.driver ? String(extra.driver) : (ctx.driver || null),
      error: extra && extra.error ? trimDownloadActivityString(extra.error, 220) : null
    };
    pushRecentDownloadActivity(entry);
    printRecentDownloadActivity(entry);
  } catch (e) { }
}

async function emitDownloadStatusActivity(downloadId, status, progress, error, extra = {}) {
  try {
    const id = Number(downloadId);
    if (!Number.isFinite(id)) return;
    const st = String(status || '').toLowerCase();
    const pct = Number.isFinite(Number(progress)) ? Math.max(0, Math.min(100, Number(progress))) : null;
    setDownloadActivityContext(id, { ...(extra || {}), status: st, progress: pct });
    const prevStatus = String(downloadActivityLastStatusById.get(id) || '').toLowerCase();
    let shouldLog = false;
    if (st && st !== prevStatus) shouldLog = true;
    if (!shouldLog && st === 'downloading' && pct != null) {
      const bucket = Math.max(0, Math.min(100, Math.floor(pct / 25) * 25));
      const prevBucket = Number.isFinite(Number(downloadActivityLastProgressBucketById.get(id))) ? Number(downloadActivityLastProgressBucketById.get(id)) : -1;
      if (bucket !== prevBucket) {
        downloadActivityLastProgressBucketById.set(id, bucket);
        shouldLog = true;
      }
    }
    if (!shouldLog && st === 'error') {
      const errText = trimDownloadActivityString(error, 220);
      const prevErr = String(downloadActivityLastErrorById.get(id) || '');
      if (errText && errText !== prevErr) {
        downloadActivityLastErrorById.set(id, errText);
        shouldLog = true;
      }
    }
    if (!shouldLog) return;
    if (st) downloadActivityLastStatusById.set(id, st);
    const ctx = await hydrateDownloadActivityContext(id) || {};
    const entry = {
      at: new Date().toISOString(),
      event: st || 'status',
      status: st || null,
      download_id: id,
      progress: pct,
      platform: extra && extra.platform ? String(extra.platform) : (ctx.platform || null),
      channel: extra && extra.channel ? String(extra.channel) : (ctx.channel || null),
      title: extra && extra.title ? String(extra.title) : (ctx.title || null),
      url: extra && extra.url ? String(extra.url) : (ctx.url || null),
      source_url: extra && extra.source_url ? String(extra.source_url) : (ctx.source_url || null),
      filepath: extra && extra.filepath ? String(extra.filepath) : (ctx.filepath || null),
      filename: extra && extra.filename ? String(extra.filename) : (ctx.filename || null),
      lane: extra && extra.lane ? String(extra.lane) : (ctx.lane || null),
      driver: extra && extra.driver ? String(extra.driver) : (ctx.driver || null),
      error: error ? trimDownloadActivityString(error, 220) : null
    };
    pushRecentDownloadActivity(entry);
    printRecentDownloadActivity(entry);
  } catch (e) { }
}

const updateDownload = {
  run: async (status, progress, filepath, filename, filesize, format, metadata, error, id) => {
    const out = await rawUpdateDownload.run(status, progress, filepath, filename, filesize, format, metadata, error, id);
    setDownloadActivityContext(id, { filepath, filename });
    await emitDownloadStatusActivity(id, status, progress, error, { filepath, filename });
    return out;
  }
};

const updateDownloadStatus = {
  run: async (status, progress, error, id) => {
    const out = await rawUpdateDownloadStatus.run(status, progress, error, id);
    await emitDownloadStatusActivity(id, status, progress, error);

    // Auto-tagging hook when a download completes
    if (status === 'completed') {
      try {
        const d = await db.prepare('SELECT title, filename, filepath FROM downloads WHERE id = ' + (db.isPostgres ? '$1' : '?')).get(id);
        if (d) {
          const text = (d.title || '') + ' ' + (d.filename || '') + ' ' + (d.filepath || '');
          extractAndSaveTags('d', String(id), text);
        }
      } catch (e) {
        console.error('Error in auto-tag hook:', e);
      }
    }
    return out;
  }
};
const findReusableDownloadByUrl = db.prepare(`
  SELECT id, url, platform, channel, title, status, progress, filepath, filename
  FROM downloads
  WHERE url=?
    AND status IN ('completed', 'pending', 'queued', 'downloading', 'postprocessing', 'error')
  ORDER BY
    CASE status
      WHEN 'completed' THEN 0
      WHEN 'downloading' THEN 1
      WHEN 'postprocessing' THEN 2
      WHEN 'queued' THEN 3
      WHEN 'pending' THEN 4
      ELSE 9
    END,
    updated_at DESC,
    created_at DESC,
    id DESC
  LIMIT 1
`);
const findReusableDownloadByUrlExcludingId = db.prepare(`
  SELECT id, url, platform, channel, title, status, progress, filepath, filename, filesize, format, metadata
  FROM downloads
  WHERE url=?
    AND id<>?
    AND status IN ('completed', 'pending', 'queued', 'downloading', 'postprocessing')
  ORDER BY
    CASE status
      WHEN 'completed' THEN 0
      WHEN 'downloading' THEN 1
      WHEN 'postprocessing' THEN 2
      WHEN 'queued' THEN 3
      WHEN 'pending' THEN 4
      ELSE 9
    END,
    updated_at DESC,
    created_at DESC,
    id DESC
  LIMIT 1
`);
const findReusableDownloadBySourceRef = db.prepare(`
  SELECT id, url, source_url, platform, channel, title, status, progress, filepath, filename, filesize, format, metadata
  FROM downloads
  WHERE (url=? OR source_url=?)
    AND status IN ('completed', 'pending', 'queued', 'downloading', 'postprocessing')
  ORDER BY
    CASE status
      WHEN 'completed' THEN 0
      WHEN 'downloading' THEN 1
      WHEN 'postprocessing' THEN 2
      WHEN 'queued' THEN 3
      WHEN 'pending' THEN 4
      ELSE 9
    END,
    updated_at DESC,
    created_at DESC,
    id DESC
  LIMIT 1
`);
const getDownloadIdByFilepath = db.prepare(`SELECT id FROM downloads WHERE filepath=? LIMIT 1`);
const getAllDownloads = db.prepare(`SELECT * FROM downloads WHERE status IN ('downloading', 'postprocessing') ORDER BY updated_at DESC, created_at DESC LIMIT 500`);
const getActiveDownloads = db.prepare(`
  SELECT *
  FROM downloads
  WHERE status IN ('pending', 'queued', 'downloading', 'postprocessing')
  ORDER BY
    CASE status
      WHEN 'downloading' THEN 0
      WHEN 'postprocessing' THEN 1
      WHEN 'queued' THEN 2
      WHEN 'pending' THEN 3
      ELSE 9
    END,
    updated_at DESC,
    created_at DESC
`);

const getRecentQueuedDownloads = db.prepare(`
  SELECT id, url, source_url, platform, channel, title, status, progress, filepath, created_at, updated_at, thumbnail
  FROM downloads
  WHERE status IN ('pending', 'queued', 'downloading', 'postprocessing')
  ORDER BY
    CASE status
      WHEN 'downloading' THEN 0
      WHEN 'postprocessing' THEN 1
      WHEN 'queued' THEN 2
      WHEN 'pending' THEN 3
      ELSE 9
    END,
    updated_at DESC,
    created_at DESC,
    id DESC
  LIMIT ?
`);

const getRecentQueuedDownloadsByChannel = db.prepare(`
  SELECT id, url, source_url, platform, channel, title, status, progress, filepath, created_at, updated_at, thumbnail
  FROM downloads
  WHERE status IN ('pending', 'queued', 'downloading', 'postprocessing')
    AND platform = ?
    AND channel = ?
  ORDER BY
    CASE status
      WHEN 'downloading' THEN 0
      WHEN 'postprocessing' THEN 1
      WHEN 'queued' THEN 2
      WHEN 'pending' THEN 3
      ELSE 9
    END,
    updated_at DESC,
    created_at DESC,
    id DESC
  LIMIT ?
`);

const getActiveDownloadStatusCounts = db.prepare(`
  SELECT status, COUNT(*) AS n
  FROM downloads
  WHERE status IN ('pending', 'queued', 'downloading', 'postprocessing')
  GROUP BY status
`);

const getInProgressDownloadCount = db.prepare(`
  SELECT COUNT(*) AS n
  FROM downloads
  WHERE status IN ('downloading', 'postprocessing')
`);

const insertCompletedDownload = db.prepare(`
  INSERT INTO downloads (url, platform, channel, title, filename, filepath, filesize, format, status, progress, metadata)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertScreenshot = db.prepare(`INSERT INTO screenshots (url, platform, channel, title, filename, filepath, filesize) VALUES (?, ?, ?, ?, ?, ?, ?)`);
const getAllScreenshots = db.prepare(`SELECT * FROM screenshots ORDER BY created_at DESC`);

const upsertDownloadFile = db.prepare(`
  INSERT INTO download_files (download_id, relpath, filesize, mtime_ms, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(download_id, relpath) DO UPDATE SET
    filesize=excluded.filesize,
    mtime_ms=excluded.mtime_ms,
    created_at=COALESCE(download_files.created_at, excluded.created_at),
    updated_at=excluded.updated_at
`);

const deleteDownloadFile = db.prepare(`
  DELETE FROM download_files
  WHERE download_id = ?
    AND relpath = ?
`);
const deleteThumbnailFiles = db.prepare(`
  DELETE FROM download_files
  WHERE relpath LIKE '%_thumb.jpg'
     OR relpath LIKE '%_thumb.png'
     OR relpath LIKE '%_logo.jpg'
     OR relpath LIKE '%_logo.png'
`);

const getReadyDownloadsForFileIndex = db.prepare(`
  SELECT id, filepath, created_at, updated_at, finished_at, status
  FROM downloads
  WHERE filepath IS NOT NULL
    AND TRIM(filepath) != ''
    AND status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
  ORDER BY COALESCE(finished_at, updated_at, created_at) DESC, id DESC
  LIMIT ?
`);

const getInProgressDownloadsForFileIndex = db.prepare(`
  SELECT id, filepath, created_at, updated_at, finished_at, status
  FROM downloads
  WHERE filepath IS NOT NULL
    AND TRIM(filepath) != ''
    AND status IN ('downloading', 'postprocessing')
  ORDER BY updated_at DESC, created_at DESC, id DESC
  LIMIT ?
`);

const getDownloadFilesCountByDownloadId = db.prepare(`
  SELECT COUNT(*) AS n
  FROM download_files
  WHERE download_id = ?
`);

const DOWNLOAD_FILES_AUTO_INDEX_MS = Math.max(2000, parseInt(process.env.WEBDL_DOWNLOAD_FILES_AUTO_INDEX_MS || '8000', 10) || 8000);
const DOWNLOAD_FILES_AUTO_INDEX_MAX_DOWNLOADS = Math.max(1, Math.min(8, parseInt(process.env.WEBDL_DOWNLOAD_FILES_AUTO_INDEX_MAX_DOWNLOADS || '2', 10) || 2));
const DOWNLOAD_FILES_AUTO_INDEX_MAX_FILES = Math.max(200, Math.min(20000, parseInt(process.env.WEBDL_DOWNLOAD_FILES_AUTO_INDEX_MAX_FILES || '7000', 10) || 7000));
const DOWNLOAD_FILES_ACTIVE_INDEX_MAX_DOWNLOADS = Math.max(1, Math.min(8, parseInt(process.env.WEBDL_DOWNLOAD_FILES_ACTIVE_INDEX_MAX_DOWNLOADS || '2', 10) || 2));
const DOWNLOAD_FILES_ACTIVE_INDEX_MAX_FILES = Math.max(50, Math.min(5000, parseInt(process.env.WEBDL_DOWNLOAD_FILES_ACTIVE_INDEX_MAX_FILES || '600', 10) || 600));
const DOWNLOAD_FILES_ACTIVE_INDEX_SKIP_MS = Math.max(800, parseInt(process.env.WEBDL_DOWNLOAD_FILES_ACTIVE_INDEX_SKIP_MS || '2500', 10) || 2500);
const DOWNLOAD_FILES_ACTIVE_FILE_STABLE_MS = Math.max(1200, parseInt(process.env.WEBDL_DOWNLOAD_FILES_ACTIVE_FILE_STABLE_MS || '4500', 10) || 4500);
let downloadFilesAutoIndexInProgress = false;
const downloadFilesAutoIndexLastById = new Map();
const downloadFilesActiveIndexLastById = new Map();

function isReadyDownloadStatus(st) {
  const s = String(st || '').toLowerCase();
  if (!s) return false;
  if (s === 'pending' || s === 'queued' || s === 'downloading' || s === 'postprocessing') return false;
  return true;
}

function isMediaFilePath(absPath) {
  try {
    const ext = String(path.extname(String(absPath || '')).toLowerCase() || '');
    if (ext && ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.unknown_video'].includes(ext)) return true;
    if (ext && ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif', '.heic', '.heif'].includes(ext)) return true;
    const sn = sniffMediaKindByMagic(String(absPath || ''));
    if (sn === 'image' || sn === 'video') return true;
  } catch (e) { }
  return false;
}

async function indexDownloadFilesForDownload(row) {
  try {
    if (!row || !row.id) return { ok: false, reason: 'no row' };
    const allowNotReady = !!(row && row._allowNotReady);
    const status = String(row.status || '').toLowerCase();
    if (!allowNotReady && !isReadyDownloadStatus(status)) return { ok: false, reason: 'not ready' };
    const fp = String(row.filepath || '').trim();

    if (row.platform === 'patreon') {
      console.log(`[DEBUG-PATREON-EXPAND] Processing id=${row.id}, fp=${fp}, isAllowed=${safeIsAllowedExistingPath(path.resolve(fp))}`);
    }

    if (!fp) return { ok: false, reason: 'no filepath' };
    const abs = path.resolve(fp);
    if (!safeIsAllowedExistingPath(abs)) return { ok: false, reason: 'not allowed' };
    let st = null;
    try { st = fs.statSync(abs); } catch (e) { st = null; }
    if (!st) return { ok: false, reason: 'missing' };

    const downloadId = Number(row.id);
    const createdAt = (row.created_at != null && row.created_at !== '') ? String(row.created_at) : '';

    const upsertOne = async (absFile) => {
      try {
        if (!absFile) return;
        if (!safeIsAllowedExistingPath(absFile)) return;
        if (!isMediaFilePath(absFile)) return;
        if (isAuxiliaryMediaPath(absFile)) return;
        const rel = relPathFromBaseDir(absFile);
        if (!rel) return;
        if (!path.isAbsolute(rel) && rel.startsWith('..')) return;
        const st2 = fs.statSync(absFile);
        const size = st2 && Number.isFinite(st2.size) ? st2.size : 0;
        const mtime = st2 && Number.isFinite(st2.mtimeMs) ? Math.floor(st2.mtimeMs) : 0;
        if (allowNotReady && !isReadyDownloadStatus(status)) {
          const ageMs = mtime > 0 ? (Date.now() - mtime) : 0;
          if (!(mtime > 0 && ageMs >= DOWNLOAD_FILES_ACTIVE_FILE_STABLE_MS)) {
            try { await deleteDownloadFile.run(downloadId, rel); } catch (e) { }
            return;
          }
        }
        await upsertDownloadFile.run(downloadId, rel, size, mtime, createdAt, createdAt);
      } catch (e) { }
    };

    if (st.isDirectory && st.isDirectory()) {
      const maxFiles = (row && Number.isFinite(Number(row._maxFiles))) ? Math.max(1, Number(row._maxFiles)) : DOWNLOAD_FILES_AUTO_INDEX_MAX_FILES;
      const files = listMediaFilesInDir(abs, maxFiles);
      if (!files || !files.length) return { ok: true, reason: 'dir empty' };
      const maybeYield = yieldEveryN(8);
      for (const f of files) {
        await upsertOne(f);
        await maybeYield();
      }
      return { ok: true, reason: 'dir indexed', n: files.length };
    }

    await upsertOne(abs);
    return { ok: true, reason: 'file indexed' };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  }
}

async function maybeAutoIndexDownloadFiles() {
  if (downloadFilesAutoIndexInProgress) return;
  downloadFilesAutoIndexInProgress = true;
  try {
    try {
      const rows = await getInProgressDownloadsForFileIndex.all(Math.max(1, DOWNLOAD_FILES_ACTIVE_INDEX_MAX_DOWNLOADS * 6));
      let did = 0;
      for (const r0 of rows || []) {
        if (!r0 || did >= DOWNLOAD_FILES_ACTIVE_INDEX_MAX_DOWNLOADS) break;
        const id = Number(r0.id);
        if (!Number.isFinite(id)) continue;
        const now = Date.now();
        const last = downloadFilesActiveIndexLastById.has(id) ? Number(downloadFilesActiveIndexLastById.get(id) || 0) : 0;
        if (last && (now - last) < DOWNLOAD_FILES_ACTIVE_INDEX_SKIP_MS) continue;
        const r = { ...r0, _allowNotReady: true, _maxFiles: DOWNLOAD_FILES_ACTIVE_INDEX_MAX_FILES };
        await indexDownloadFilesForDownload(r);
        downloadFilesActiveIndexLastById.set(id, now);
        did++;
        await yieldEventLoop();
      }
    } catch (e) { }

    const rows = await getReadyDownloadsForFileIndex.all(Math.max(1, DOWNLOAD_FILES_AUTO_INDEX_MAX_DOWNLOADS * 6));
    let did = 0;
    for (const r of rows || []) {
      if (!r || did >= DOWNLOAD_FILES_AUTO_INDEX_MAX_DOWNLOADS) break;
      const id = Number(r.id);
      if (!Number.isFinite(id)) continue;

      let n = 0;
      try {
        const c = await getDownloadFilesCountByDownloadId.get(id);
        n = c && Number.isFinite(Number(c.n)) ? Number(c.n) : 0;
      } catch (e) {
        n = 0;
      }

      const now = Date.now();
      const last = downloadFilesAutoIndexLastById.has(id) ? Number(downloadFilesAutoIndexLastById.get(id) || 0) : 0;
      const recentSkipMs = n > 0 ? 15 * 60 * 1000 : 0;
      if (recentSkipMs && last && (now - last) < recentSkipMs) continue;

      await indexDownloadFilesForDownload(r);
      downloadFilesAutoIndexLastById.set(id, now);
      did++;
      await yieldEventLoop();
    }
  } catch (e) {
  } finally {
    downloadFilesAutoIndexInProgress = false;
  }
}

async function indexDownloadDirImmediately(downloadId) {
  try {
    const id = Number(downloadId);
    if (!Number.isFinite(id)) return false;
    const row = await getDownload.get(id);
    if (!row) return false;

    // We allowNotReady=true so that it indexes even if the DB says 'downloading'
    // This is run right before/after the status is set to 'completed'
    const r = { ...row, _allowNotReady: true, _maxFiles: DOWNLOAD_FILES_AUTO_INDEX_MAX_FILES };
    const res = await indexDownloadFilesForDownload(r);

    if (res && res.ok) {
      const now = Date.now();
      downloadFilesAutoIndexLastById.set(id, now);
      downloadFilesActiveIndexLastById.set(id, now);
      try { recentFilesTopCache.clear(); } catch (e) { }
      return true;
    }
  } catch (e) {
    console.error(`⚠️ Fout in indexDownloadDirImmediately: ${e.message}`);
  }
  return false;
}

const getRecentIndexedMedia = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
  )
  ORDER BY ts DESC
  LIMIT ? OFFSET ?
` : `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at AS created_at,
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
  )
  ORDER BY ts DESC
  LIMIT ? OFFSET ?
`);

const getRecentDashboardBatchFiles = db.prepare(db.isPostgres ? `
  SELECT
    'p' AS kind,
    f.relpath AS id,
    d.platform AS platform,
    d.channel AS channel,
    d.title AS title,
    f.relpath AS filepath,
    COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
    COALESCE(NULLIF(CAST(f.mtime_ms AS BIGINT), 0), CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT)) AS ts,
    NULL AS thumbnail,
    d.url AS url,
    d.source_url AS source_url,
    d.rating AS rating,
    'd' AS rating_kind,
    d.id AS rating_id
  FROM download_files f
  JOIN downloads d ON d.id = f.download_id
  WHERE d.status NOT IN ('pending', 'queued')
  ORDER BY ts DESC
  LIMIT ?
` : `
  SELECT
    'p' AS kind,
    f.relpath AS id,
    d.platform AS platform,
    d.channel AS channel,
    d.title AS title,
    f.relpath AS filepath,
    COALESCE(f.created_at, d.created_at) AS created_at,
    COALESCE(NULLIF(CAST(f.mtime_ms AS INTEGER), 0), COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0)) AS ts,
    NULL AS thumbnail,
    d.url AS url,
    d.source_url AS source_url,
    d.rating AS rating,
    'd' AS rating_kind,
    d.id AS rating_id
  FROM download_files f
  JOIN downloads d ON d.id = f.download_id
  WHERE d.status NOT IN ('pending', 'queued')
  ORDER BY ts DESC
  LIMIT ?
`);

const getRecentHybridMediaWithActiveFiles = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.status NOT IN ('pending', 'queued')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY ts DESC
  LIMIT ? OFFSET ?
` : `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(NULLIF(CAST(f.mtime_ms AS INTEGER), 0), COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0)) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.status NOT IN ('pending', 'queued')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at AS created_at,
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY ts DESC
  LIMIT ? OFFSET ?
`);

const getRecentHybridMedia = db.prepare(`
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT * FROM (
      SELECT DISTINCT ON (f.relpath)
        'p' AS kind,
        f.relpath AS id,
        d.platform AS platform,
        d.channel AS channel,
        d.title AS title,
        f.relpath AS filepath,
        COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
        CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
        NULL::text AS thumbnail,
        d.url AS url,
        d.source_url AS source_url,
        d.rating AS rating,
        'd' AS rating_kind,
        d.id AS rating_id
      FROM download_files f
      JOIN downloads d ON d.id = f.download_id
      WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
        AND d.id > (SELECT MAX(id) - 10000 FROM downloads)
      ORDER BY f.relpath, (CASE WHEN lower(d.channel) = 'unknown' THEN 0 ELSE 1 END) DESC, d.id DESC
    ) deduped_files

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND d.id > (SELECT MAX(id) - 20000 FROM downloads)
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY ts DESC
  LIMIT ? OFFSET ?
`);

const getHybridMediaByChannel = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.platform = ? AND s.channel = ?
      AND s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY ts DESC
  LIMIT ? OFFSET ?
` : `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at AS created_at,
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.platform = ? AND s.channel = ?
      AND s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY ts DESC
  LIMIT ? OFFSET ?
`);

const getRecentHybridMediaByOldest = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY ts ASC
  LIMIT ? OFFSET ?
` : `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at AS created_at,
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY ts ASC
  LIMIT ? OFFSET ?
`);

const getRecentHybridMediaByNameAsc = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY LOWER(COALESCE(NULLIF(title, ''), id)) ASC, ts DESC
  LIMIT ? OFFSET ?
` : `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at AS created_at,
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY LOWER(COALESCE(NULLIF(title, ''), id)) ASC, ts DESC
  LIMIT ? OFFSET ?
`);

const getRecentHybridMediaByNameDesc = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY LOWER(COALESCE(NULLIF(title, ''), id)) DESC, ts DESC
  LIMIT ? OFFSET ?
` : `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at AS created_at,
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY LOWER(COALESCE(NULLIF(title, ''), id)) DESC, ts DESC
  LIMIT ? OFFSET ?
`);

const getHybridMediaByChannelByOldest = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.platform = ? AND s.channel = ?
      AND s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY ts ASC
  LIMIT ? OFFSET ?
` : `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at AS created_at,
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.platform = ? AND s.channel = ?
      AND s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY ts ASC
  LIMIT ? OFFSET ?
`);

const getHybridMediaByChannelByNameAsc = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.platform = ? AND s.channel = ?
      AND s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY LOWER(COALESCE(NULLIF(title, ''), id)) ASC, ts DESC
  LIMIT ? OFFSET ?
` : `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at AS created_at,
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.platform = ? AND s.channel = ?
      AND s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY LOWER(COALESCE(NULLIF(title, ''), id)) ASC, ts DESC
  LIMIT ? OFFSET ?
`);

const getHybridMediaByChannelByNameDesc = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.platform = ? AND s.channel = ?
      AND s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY LOWER(COALESCE(NULLIF(title, ''), id)) DESC, ts DESC
  LIMIT ? OFFSET ?
` : `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at AS created_at,
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.platform = ? AND s.channel = ?
      AND s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY LOWER(COALESCE(NULLIF(title, ''), id)) DESC, ts DESC
  LIMIT ? OFFSET ?
`);

const getHybridMediaByChannelWithActiveFiles = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
      COALESCE(NULLIF(CAST(f.mtime_ms AS BIGINT), 0), CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT)) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.platform = ? AND s.channel = ?
      AND s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY ts DESC
  LIMIT ? OFFSET ?
` : `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(NULLIF(CAST(f.mtime_ms AS INTEGER), 0), COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0)) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at AS created_at,
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.platform = ? AND s.channel = ?
      AND s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY ts DESC
  LIMIT ? OFFSET ?
`);

const getRecentHybridMediaByRatingDesc = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY (rating IS NULL) ASC, rating DESC, ts DESC
  LIMIT ? OFFSET ?
` : `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at AS created_at,
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY (rating IS NULL) ASC, rating DESC, ts DESC
  LIMIT ? OFFSET ?
`);

const getRecentHybridMediaByRatingAsc = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY (rating IS NULL) ASC, rating ASC, ts DESC
  LIMIT ? OFFSET ?
` : `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at AS created_at,
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY (rating IS NULL) ASC, rating ASC, ts DESC
  LIMIT ? OFFSET ?
`);

const getHybridMediaByChannelByRatingDesc = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.platform = ? AND s.channel = ?
      AND s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY (rating IS NULL) ASC, rating DESC, ts DESC
  LIMIT ? OFFSET ?
` : `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at AS created_at,
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.platform = ? AND s.channel = ?
      AND s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY (rating IS NULL) ASC, rating DESC, ts DESC
  LIMIT ? OFFSET ?
`);

const getHybridMediaByChannelByRatingAsc = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.platform = ? AND s.channel = ?
      AND s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY (rating IS NULL) ASC, rating ASC, ts DESC
  LIMIT ? OFFSET ?
` : `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.platform = ? AND d.channel = ?
      AND d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND d.filepath != ''
      AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at AS created_at,
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.platform = ? AND s.channel = ?
      AND s.filepath IS NOT NULL
      AND s.filepath != ''
  )
  ORDER BY (rating IS NULL) ASC, rating ASC, ts DESC
  LIMIT ? OFFSET ?
`);

const getIndexedMediaByChannel = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.platform = ? AND d.channel = ?

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.platform = ? AND s.channel = ?
  )
  ORDER BY ts DESC
  LIMIT ? OFFSET ?
` : `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      f.relpath AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.platform = ? AND d.channel = ?

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at AS created_at,
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.platform = ? AND s.channel = ?
  )
  ORDER BY ts DESC
  LIMIT ? OFFSET ?
`);

const getDownloadsForIndex = db.prepare(`
  SELECT *
  FROM downloads
  WHERE filepath IS NOT NULL AND TRIM(filepath) != ''
  ORDER BY updated_at DESC, created_at DESC
`);

const getStats = db.prepare(db.isPostgres ? `
  SELECT
    (SELECT COUNT(*)::int FROM downloads) AS downloads_count,
    (SELECT COUNT(*)::int FROM screenshots) AS screenshots_count,
    (SELECT COUNT(*)::int FROM download_files) AS download_files_count,
    COALESCE((SELECT MAX(created_at)::text FROM downloads), '') AS downloads_created_last,
    COALESCE((
      SELECT MAX(ts)::text
      FROM (
        SELECT finished_at AS ts FROM downloads WHERE status IN ('completed')
        UNION ALL
        SELECT updated_at AS ts FROM downloads WHERE status IN ('completed')
      ) t
    ), '') AS downloads_finished_last,
    COALESCE((SELECT MAX(updated_at)::text FROM downloads), '') AS downloads_last,
    COALESCE((SELECT MAX(COALESCE(updated_at, created_at))::text FROM screenshots), '') AS screenshots_last,
    COALESCE((SELECT MAX(updated_at)::text FROM download_files), '') AS download_files_last
` : `
  SELECT
    (SELECT COUNT(*) FROM downloads) AS downloads_count,
    (SELECT COUNT(*) FROM screenshots) AS screenshots_count,
    (SELECT COUNT(*) FROM download_files) AS download_files_count,
    COALESCE((SELECT MAX(created_at) FROM downloads), '') AS downloads_created_last,
    COALESCE(
      MAX(
        (SELECT MAX(finished_at) FROM downloads WHERE status IN ('completed')),
        (SELECT MAX(updated_at) FROM downloads WHERE status IN ('completed'))
      ),
    '') AS downloads_finished_last,
    COALESCE((SELECT MAX(updated_at) FROM downloads), '') AS downloads_last,
    COALESCE((SELECT MAX(COALESCE(updated_at, created_at)) FROM screenshots), '') AS screenshots_last,
    COALESCE((SELECT MAX(updated_at) FROM download_files), '') AS download_files_last
`);

let statsRowCache = null;
let statsRowCacheAt = 0;
let statsRowInflight = null;
const STATS_ROW_CACHE_MS = Math.max(150, parseInt(process.env.WEBDL_STATS_ROW_CACHE_MS || '800', 10) || 800);

async function getStatsRowCached() {
  const now = Date.now();
  if (statsRowCache && now - statsRowCacheAt < STATS_ROW_CACHE_MS) return statsRowCache;
  // Mutex: if a stats query is already running, wait for it
  if (statsRowInflight) return statsRowInflight;
  statsRowInflight = (async () => {
    try {
      const row = await Promise.resolve(getStats.get());
      statsRowCache = row || {};
      statsRowCacheAt = Date.now();
      return statsRowCache;
    } finally {
      statsRowInflight = null;
    }
  })();
  return statsRowInflight;
}

let statsCache = null;
let statsCacheAt = 0;
const STATS_CACHE_MS = Math.max(250, parseInt(process.env.WEBDL_STATS_CACHE_MS || '1500', 10) || 1500);

// Media file path cache — avoids DB hit on every Range request for the same video
const mediaFileCache = new Map();
setInterval(() => { if (mediaFileCache.size > 2000) mediaFileCache.clear(); }, 300000);

// File existence cache — avoids repeated stat() calls for missing files
const _fileExistsMap = new Map();
const _FILE_EXISTS_TTL = 60000; // 60s cache
function fileExistsCache(fp) {
  const cached = _fileExistsMap.get(fp);
  const now = Date.now();
  if (cached !== undefined && now - (cached.at || 0) < _FILE_EXISTS_TTL) return cached.v;
  let exists = false;
  try { exists = fs.existsSync(fp); } catch (e) {}
  _fileExistsMap.set(fp, { v: exists, at: now });
  // Prune cache periodically
  if (_fileExistsMap.size > 5000) {
    for (const [k, v] of _fileExistsMap) { if (now - v.at > _FILE_EXISTS_TTL) _fileExistsMap.delete(k); }
  }
  return exists;
}

let recentFilesTopCache = new Map();
let recentFilesTopCacheAt = 0;
let galleryFastPathCache = null; // { key, ts, data } - 3s TTL simple cache
const RECENT_FILES_TOP_CACHE_MS = Math.max(250, parseInt(process.env.WEBDL_RECENT_FILES_TOP_CACHE_MS || '2000', 10) || 2000);

function buildRecentFilesCacheMarker(stats) {
  try {
    const s = stats && typeof stats === 'object' ? stats : {};
    return [
      s.downloads_count != null ? String(s.downloads_count) : '',
      s.screenshots_count != null ? String(s.screenshots_count) : '',
      s.download_files_count != null ? String(s.download_files_count) : '',
      s.downloads_created_last ? String(s.downloads_created_last) : '',
      s.downloads_finished_last ? String(s.downloads_finished_last) : '',
      s.downloads_last ? String(s.downloads_last) : '',
      s.screenshots_last ? String(s.screenshots_last) : '',
      s.download_files_last ? String(s.download_files_last) : ''].
      join('|');
  } catch (e) {
    return '';
  }
}

const getRecentMedia = db.prepare(`
  SELECT kind, id, platform, channel, title, filepath, created_at, thumbnail, url, source_url, rating
  FROM (
    SELECT 'd' AS kind, id, platform, channel, title, filepath, created_at, thumbnail, url, source_url, rating, COALESCE(finished_at, updated_at) AS sort_ts
    FROM downloads
    WHERE status = 'completed' AND filepath IS NOT NULL AND TRIM(filepath) != ''
    UNION ALL
    SELECT 's' AS kind, id, platform, channel, title, filepath, created_at, NULL AS thumbnail, url, NULL AS source_url, rating, created_at AS sort_ts
    FROM screenshots
    WHERE filepath IS NOT NULL AND TRIM(filepath) != ''
  )
  ORDER BY sort_ts DESC
  LIMIT ? OFFSET ?
`);

const getRecentMediaByRatingDesc = db.prepare(`
  SELECT kind, id, platform, channel, title, filepath, created_at, thumbnail, url, source_url, rating
  FROM (
    SELECT 'd' AS kind, id, platform, channel, title, filepath, created_at, thumbnail, url, source_url, rating, COALESCE(finished_at, updated_at) AS sort_ts
    FROM downloads
    WHERE status = 'completed' AND filepath IS NOT NULL AND TRIM(filepath) != ''
    UNION ALL
    SELECT 's' AS kind, id, platform, channel, title, filepath, created_at, NULL AS thumbnail, url, NULL AS source_url, rating, created_at AS sort_ts
    FROM screenshots
    WHERE filepath IS NOT NULL AND TRIM(filepath) != ''
  )
  ORDER BY (rating IS NULL) ASC, rating DESC, sort_ts DESC
  LIMIT ? OFFSET ?
`);

const getRecentMediaByRatingAsc = db.prepare(`
  SELECT kind, id, platform, channel, title, filepath, created_at, thumbnail, url, source_url, rating
  FROM (
    SELECT 'd' AS kind, id, platform, channel, title, filepath, created_at, thumbnail, url, source_url, rating, COALESCE(finished_at, updated_at) AS sort_ts
    FROM downloads
    WHERE status = 'completed' AND filepath IS NOT NULL AND TRIM(filepath) != ''
    UNION ALL
    SELECT 's' AS kind, id, platform, channel, title, filepath, created_at, NULL AS thumbnail, url, NULL AS source_url, rating, created_at AS sort_ts
    FROM screenshots
    WHERE filepath IS NOT NULL AND TRIM(filepath) != ''
  )
  ORDER BY (rating IS NULL) ASC, rating ASC, sort_ts DESC
  LIMIT ? OFFSET ?
`);

const getMediaChannels = db.prepare(`
  SELECT platform, channel, COUNT(*) AS count, MAX(ts) AS last_at
  FROM (
    SELECT platform, channel,
      CASE WHEN status = 'completed' THEN COALESCE(finished_at, updated_at) ELSE created_at END AS ts
    FROM downloads
    WHERE (status = 'completed' AND filepath IS NOT NULL AND TRIM(filepath) != '')
       OR status IN ('pending', 'queued', 'downloading', 'postprocessing')
    UNION ALL
    SELECT platform, channel, created_at AS ts
    FROM screenshots
    WHERE filepath IS NOT NULL AND TRIM(filepath) != ''
  )
  WHERE platform IS NOT NULL AND TRIM(platform) != ''
    AND channel IS NOT NULL AND TRIM(channel) != ''
  GROUP BY platform, channel
  ORDER BY last_at DESC
  LIMIT ? OFFSET ?
`);

const getIndexedChannels = db.prepare(db.isPostgres ? `
  SELECT platform, channel, COUNT(*) AS count, MAX(ts) AS last_at
  FROM (
    SELECT d.platform AS platform, d.channel AS channel, CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    UNION ALL
    SELECT platform AS platform, channel AS channel, CAST(EXTRACT(EPOCH FROM created_at) * 1000 AS BIGINT) AS ts
    FROM screenshots
  )
  WHERE platform IS NOT NULL AND TRIM(platform) != ''
    AND channel IS NOT NULL AND TRIM(channel) != ''
  GROUP BY platform, channel
  ORDER BY last_at DESC
  LIMIT ? OFFSET ?
` : `
  SELECT platform, channel, COUNT(*) AS count, MAX(ts) AS last_at
  FROM (
    SELECT d.platform AS platform, d.channel AS channel, COALESCE(CAST(strftime('%s', COALESCE(d.finished_at, d.created_at)) AS INTEGER) * 1000, 0) AS ts
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    UNION ALL
    SELECT platform AS platform, channel AS channel, CAST(strftime('%s', created_at) AS INTEGER) * 1000 AS ts
    FROM screenshots
  )
  WHERE platform IS NOT NULL AND TRIM(platform) != ''
    AND channel IS NOT NULL AND TRIM(channel) != ''
  GROUP BY platform, channel
  ORDER BY last_at DESC
  LIMIT ? OFFSET ?
`);

const getMediaByChannel = db.prepare(`
  SELECT kind, id, platform, channel, title, filepath, created_at, thumbnail, url, source_url, rating
  FROM (
    SELECT 'd' AS kind, id, platform, channel, title, filepath, created_at, thumbnail, url, source_url, rating, COALESCE(finished_at, updated_at) AS sort_ts
    FROM downloads
    WHERE status = 'completed' AND filepath IS NOT NULL AND TRIM(filepath) != ''
    UNION ALL
    SELECT 's' AS kind, id, platform, channel, title, filepath, created_at, NULL AS thumbnail, url, NULL AS source_url, rating, created_at AS sort_ts
    FROM screenshots
    WHERE filepath IS NOT NULL AND TRIM(filepath) != ''
  )
  WHERE platform = ? AND channel = ?
  ORDER BY sort_ts DESC
  LIMIT ? OFFSET ?
`);

const getMediaByChannelByRatingDesc = db.prepare(`
  SELECT kind, id, platform, channel, title, filepath, created_at, thumbnail, url, source_url, rating
  FROM (
    SELECT 'd' AS kind, id, platform, channel, title, filepath, created_at, thumbnail, url, source_url, rating, COALESCE(finished_at, updated_at) AS sort_ts
    FROM downloads
    WHERE status = 'completed' AND filepath IS NOT NULL AND TRIM(filepath) != ''
    UNION ALL
    SELECT 's' AS kind, id, platform, channel, title, filepath, created_at, NULL AS thumbnail, url, NULL AS source_url, rating, created_at AS sort_ts
    FROM screenshots
    WHERE filepath IS NOT NULL AND TRIM(filepath) != ''
  )
  WHERE platform = ? AND channel = ?
  ORDER BY (rating IS NULL) ASC, rating DESC, sort_ts DESC
  LIMIT ? OFFSET ?
`);

const getMediaByChannelByRatingAsc = db.prepare(`
  SELECT kind, id, platform, channel, title, filepath, created_at, thumbnail, url, source_url, rating
  FROM (
    SELECT 'd' AS kind, id, platform, channel, title, filepath, created_at, thumbnail, url, source_url, rating, COALESCE(finished_at, updated_at) AS sort_ts
    FROM downloads
    WHERE status = 'completed' AND filepath IS NOT NULL AND TRIM(filepath) != ''
    UNION ALL
    SELECT 's' AS kind, id, platform, channel, title, filepath, created_at, NULL AS thumbnail, url, NULL AS source_url, rating, created_at AS sort_ts
    FROM screenshots
    WHERE filepath IS NOT NULL AND TRIM(filepath) != ''
  )
  WHERE platform = ? AND channel = ?
  ORDER BY (rating IS NULL) ASC, rating ASC, sort_ts DESC
  LIMIT ? OFFSET ?
`);

// ========================
// ACTIEVE DOWNLOADS TRACKER
// ========================
const activeProcesses = new Map();

let HEAVY_DOWNLOAD_CONCURRENCY = parseInt(process.env.WEBDL_HEAVY_DOWNLOAD_CONCURRENCY || '4', 10);
let LIGHT_DOWNLOAD_CONCURRENCY = parseInt(process.env.WEBDL_LIGHT_DOWNLOAD_CONCURRENCY || '12', 10);

const initialYoutubeConcurrency = parseInt(process.env.WEBDL_YOUTUBE_DOWNLOAD_CONCURRENCY || '1', 10);
const initialYoutubeSpacing = parseInt(process.env.WEBDL_YOUTUBE_START_SPACING_MS || '0', 10);
const initialYoutubeJitter = parseInt(process.env.WEBDL_YOUTUBE_START_JITTER_MS || '0', 10);

const runtimeYoutubeConfig = {
  concurrency: Number.isFinite(initialYoutubeConcurrency) ? Math.max(0, initialYoutubeConcurrency) : 1,
  spacingMs: Number.isFinite(initialYoutubeSpacing) ? Math.max(0, initialYoutubeSpacing) : 0,
  jitterMs: Number.isFinite(initialYoutubeJitter) ? Math.max(0, initialYoutubeJitter) : 0,
  updatedAt: Date.now()
};

function getYoutubeRuntimeConfig() {
  return {
    concurrency: runtimeYoutubeConfig.concurrency,
    spacingMs: runtimeYoutubeConfig.spacingMs,
    jitterMs: runtimeYoutubeConfig.jitterMs,
    updatedAt: runtimeYoutubeConfig.updatedAt
  };
}

function setYoutubeRuntimeConfig({ concurrency, spacingMs, jitterMs }) {
  if (Number.isFinite(concurrency)) runtimeYoutubeConfig.concurrency = Math.max(0, Math.floor(concurrency));
  if (Number.isFinite(spacingMs)) runtimeYoutubeConfig.spacingMs = Math.max(0, Math.floor(spacingMs));
  if (Number.isFinite(jitterMs)) runtimeYoutubeConfig.jitterMs = Math.max(0, Math.floor(jitterMs));
  runtimeYoutubeConfig.updatedAt = Date.now();
  runDownloadSchedulerSoon();
  return getYoutubeRuntimeConfig();
}

function resetYoutubeRuntimeConfig() {
  runtimeYoutubeConfig.concurrency = Number.isFinite(initialYoutubeConcurrency) ? Math.max(0, initialYoutubeConcurrency) : 1;
  runtimeYoutubeConfig.spacingMs = Number.isFinite(initialYoutubeSpacing) ? Math.max(0, initialYoutubeSpacing) : 0;
  runtimeYoutubeConfig.jitterMs = Number.isFinite(initialYoutubeJitter) ? Math.max(0, initialYoutubeJitter) : 0;
  runtimeYoutubeConfig.updatedAt = Date.now();
  runDownloadSchedulerSoon();
  return getYoutubeRuntimeConfig();
}
const SMALL_DURATION_SECONDS = parseInt(process.env.WEBDL_SMALL_DURATION_SECONDS || String(8 * 60), 10);
const METADATA_PROBE_CONCURRENCY = parseInt(process.env.WEBDL_METADATA_PROBE_CONCURRENCY || '1', 10);
const METADATA_PROBE_ENABLED = String(process.env.WEBDL_METADATA_PROBE_ENABLED || '1').trim() !== '0';
const STARTUP_METADATA_PROBE_ENABLED = String(process.env.WEBDL_STARTUP_METADATA_PROBE || '0').trim() !== '0';

let lastYoutubeStartMs = 0;

const queuedHeavy = [];
const queuedLight = [];
const queuedBatch = [];
const BATCH_DOWNLOAD_CONCURRENCY = parseInt(process.env.WEBDL_BATCH_DOWNLOAD_CONCURRENCY || '2', 10);
const POSTPROCESS_CONCURRENCY = Math.max(1, parseInt(process.env.WEBDL_POSTPROCESS_CONCURRENCY || '1', 10) || 1);
const queuedPostprocess = [];
const postprocessJobs = new Map();
const activePostprocessJobs = new Set();
const queuedJobs = new Map();
const jobLane = new Map();
const jobPlatform = new Map();
const metadataProbeQueue = [];
let metadataProbeActive = 0;
const startingJobs = new Set();
const cancelledJobs = new Set();
const onHoldJobs = new Set();

// Single source of truth for gallery/dashboard
let runtimeActiveRows = [];
let runtimeActiveIdSet = new Set();
let runtimeActiveSyncedAt = 0;

async function syncRuntimeActiveState() {
  try {
    const ids = new Set();
    for (const id of activeProcesses.keys()) ids.add(id);
    for (const id of startingJobs) ids.add(id);
    const rows = [];
    for (const id of ids) {
      const row = await getDownload.get(id);
      if (!row) continue;
      const status = String(row.status || '').toLowerCase();
      if (status === 'queued' || status === 'pending') continue;
      rows.push(row);
    }
    const rank = (s) => {
      if (s === 'downloading') return 0;
      if (s === 'postprocessing') return 1;
      if (s === 'queued') return 2;
      if (s === 'pending') return 3;
      return 9;
    };
    rows.sort((a, b) => rank(a.status) - rank(b.status));
    runtimeActiveRows = rows;
    runtimeActiveIdSet = ids;
    runtimeActiveSyncedAt = Date.now();
  } catch (e) {
    console.error(`Runtime active sync failed: ${e.message}`);
  }
}

function isCancelled(id) {
  return cancelledJobs.has(id);
}

function isOnHold(id) {
  return onHoldJobs.has(id);
}

function clearOnHold(id) {
  onHoldJobs.delete(id);
}

function abortKind(id) {
  if (isCancelled(id)) return 'cancelled';
  if (isOnHold(id)) return 'on_hold';
  return null;
}

async function applyAbortStatus(id, kind) {
  try {
    const postprocessJob = postprocessJobs.get(id);
    const isActivePostprocess = activePostprocessJobs.has(id);
    if (postprocessJob) postprocessJob.aborted = kind;
    const proc = activeProcesses.get(id);
    if (proc) {
      try { proc.kill('SIGTERM'); } catch (e) { }
      try { activeProcesses.delete(id); } catch (e) { }
    }

    if (kind === 'cancelled') {
      clearCancelled(id);
      startingJobs.delete(id);
      queuedJobs.delete(id);
      removeFromQueue(queuedHeavy, id);
      removeFromQueue(queuedLight, id);
      removeFromQueue(queuedBatch, id);
      removeFromQueue(queuedPostprocess, id);
      if (!isActivePostprocess) {
        postprocessJobs.delete(id);
        try { if (postprocessJob && typeof postprocessJob.resolve === 'function') postprocessJob.resolve(false); } catch (e) { }
      }
      jobLane.delete(id);
      await updateDownloadStatus.run('cancelled', 0, null, id);
      try { runDownloadSchedulerSoon(); } catch (e) { }
      try { runPostprocessSchedulerSoon(); } catch (e) { }
      try { syncRuntimeActiveState().catch(() => { }); } catch (e) { }
      return true;
    }
    if (kind === 'on_hold') {
      startingJobs.delete(id);
      queuedJobs.delete(id);
      removeFromQueue(queuedHeavy, id);
      removeFromQueue(queuedLight, id);
      removeFromQueue(queuedBatch, id);
      removeFromQueue(queuedPostprocess, id);
      if (!isActivePostprocess) {
        postprocessJobs.delete(id);
        try { if (postprocessJob && typeof postprocessJob.resolve === 'function') postprocessJob.resolve(false); } catch (e) { }
      }
      jobLane.delete(id);
      await updateDownloadStatus.run('on_hold', 0, null, id);
      try { runDownloadSchedulerSoon(); } catch (e) { }
      try { runPostprocessSchedulerSoon(); } catch (e) { }
      try { syncRuntimeActiveState().catch(() => { }); } catch (e) { }
      return true;
    }
  } catch (e) { }
  return false;
}

function clearCancelled(id) {
  cancelledJobs.delete(id);
}

function isQueued(id) {
  return queuedJobs.has(id);
}

function removeFromQueue(arr, id) {
  const idx = arr.indexOf(id);
  if (idx >= 0) arr.splice(idx, 1);
}

function activeLaneCount(lane) {
  const ids = new Set();
  for (const id of activeProcesses.keys()) ids.add(id);
  for (const id of startingJobs) ids.add(id);
  let n = 0;
  for (const id of ids) {
    if (jobLane.get(id) === lane) n++;
  }
  return n;
}

function detectLane(platform, url = '') {
  const p = String(platform || '').toLowerCase();
  const u = String(url || '').toLowerCase();

  // If this is a live stream or explicitly a video, definitely heavy
  if (u.includes('is_live=true') || u.includes('/live/') || u.includes('tiktok.com/@') && !u.includes('/photo/')) {
    return 'heavy';
  }

  // Only pure image/direct link platforms get the fast lane
  const lightPlatforms = [
    'footfetishforum', 'forum-area', 'imagetwist', 'pixhost', 'postimg', 'bunkr', 'jpg', 'aznudefeet', 'pornpics',
    'kinky', 'wikifeet', 'wikifeetx', 'elitebabes', 'erome'
  ];

  if (lightPlatforms.includes(p)) return 'light';

  // Everything else (youtube, onlyfans, tiktok videos, instagram zips, reddit videos, wikifeet galleries) is heavy
  return 'heavy';
}

function deriveEarlyThumbnail(url, platform) {
  if (!url) return '';
  try {
    // YouTube: extract video ID and use ytimg.com
    if (platform === 'youtube' || platform === 'youtube-shorts') {
      try {
        const u = new URL(url);
        let vid = '';
        if (u.hostname.includes('youtube.com') && u.searchParams.has('v')) vid = u.searchParams.get('v');
        else if (u.hostname.includes('youtu.be')) vid = u.pathname.substring(1);
        else if (u.hostname.includes('youtube.com') && u.pathname.startsWith('/shorts/')) vid = u.pathname.split('/')[2];
        if (vid) return 'https://i.ytimg.com/vi/' + vid + '/mqdefault.jpg';
      } catch (e) { }
    }
    // Direct image URLs (any platform)
    if (/\.(jpg|jpeg|png|webp|gif|avif|bmp)(?:\?|$)/i.test(url)) return url;
    // For image-serving platforms, the URL itself IS the media — store it so gallery can attempt to load or proxy
    const imageHostPlatforms = ['footfetishforum', 'aznudefeet', 'imagetwist', 'pixhost', 'postimg', 'bunkr', 'jpg'];
    if (imageHostPlatforms.includes(platform)) return url;
  } catch (e) { }
  return '';
}

async function enqueueDownloadJob(downloadId, url, platform, channel, title, metadata, laneOverride) {
  const lane = laneOverride || detectLane(platform, url);
  const earlyThumb = deriveEarlyThumbnail(url, platform);
  setDownloadActivityContext(downloadId, { url, platform, channel, title, lane, thumbnail: earlyThumb });
  jobLane.set(downloadId, lane);
  jobPlatform.set(downloadId, platform);

  // Priority mode: bypass queue, start immediately
  if (globalPriorityMode) {
    console.log(`🔥 PRIO DISPATCH #${downloadId}: ${url.slice(0, 80)}`);
    await updateDownloadStatus.run('downloading', 0, null, downloadId);
    startingJobs.add(downloadId);
    try {
      startDownload(downloadId, url, platform, channel, title, metadata)
        .catch(() => {}).finally(() => {
          startingJobs.delete(downloadId);
          runDownloadSchedulerSoon();
        });
    } catch (e) {
      await updateDownloadStatus.run('error', 0, e.message, downloadId);
      startingJobs.delete(downloadId);
    }
    return;
  }

  queuedJobs.set(downloadId, { downloadId, url, platform, channel, title, metadata });
  await updateDownloadStatus.run('queued', 0, null, downloadId);

  if (lane === 'batch') queuedBatch.push(downloadId); else
    if (lane === 'light') queuedLight.unshift(downloadId); else
      queuedHeavy.unshift(downloadId);

  if (METADATA_PROBE_ENABLED && METADATA_PROBE_CONCURRENCY > 0 && platform !== 'onlyfans' && platform !== 'instagram' && platform !== 'wikifeet' && platform !== 'kinky' && platform !== 'tiktok' && platform !== 'reddit' && platform !== 'aznudefeet' && platform !== 'amateurvoyeurforum' && platform !== 'pornpics') {
    metadataProbeQueue.push({ downloadId, url });
  }

  runDownloadSchedulerSoon();
  if (METADATA_PROBE_ENABLED && METADATA_PROBE_CONCURRENCY > 0) runMetadataProbeSchedulerSoon();
}

let schedulerTimer = null;
function runDownloadSchedulerSoon() {
  if (schedulerTimer) return;
  schedulerTimer = setTimeout(() => {
    schedulerTimer = null;
    runDownloadScheduler();
    syncRuntimeActiveState().catch(() => { });
  }, 120);
}

async function runDownloadScheduler() {
  const heavyLimit = Math.max(0, HEAVY_DOWNLOAD_CONCURRENCY);
  const lightLimit = Math.max(0, LIGHT_DOWNLOAD_CONCURRENCY);

  // YouTube settings
  const youtubeSettings = getYoutubeRuntimeConfig();
  const youtubeLimit = Math.max(0, youtubeSettings.concurrency);
  const youtubeSpacingMs = Math.max(0, youtubeSettings.spacingMs);
  const youtubeJitterMs = Math.max(0, youtubeSettings.jitterMs);

  const countRuntimePlatform = (platform) => {
    try {
      const p = String(platform || '').toLowerCase();
      if (!p) return 0;
      let n = 0;
      for (const id of activeProcesses.keys()) {
        const plat = String(jobPlatform.get(id) || '').toLowerCase();
        if (plat === p) n++;
      }
      return n;
    } catch (e) { return 0; }
  };

  const canStartYoutubeNow = () => {
    const active = countRuntimePlatform('youtube');
    if (active >= youtubeLimit) return false;
    const now = Date.now();
    if (lastYoutubeStartMs && now < lastYoutubeStartMs) return false;
    return true;
  };

  const markYoutubeStarted = () => {
    const base = youtubeSpacingMs;
    const jitter = youtubeJitterMs > 0 ? Math.floor(Math.random() * (youtubeJitterMs + 1)) : 0;
    lastYoutubeStartMs = Date.now() + base + jitter;
  };

  const shiftNextEligible = (queue, lane) => {
    const n = queue.length;
    for (let i = 0; i < n; i++) {
      const id = queue.shift();
      const job = queuedJobs.get(id);
      if (!job) continue;
      const plat = String(job.platform || '').toLowerCase();
      if ((plat === 'youtube' || plat === 'youtube-shorts') && !canStartYoutubeNow()) {
        queue.push(id);
        continue;
      }
      return { id, job };
    }
    return null;
  };

  let heavyActive = activeLaneCount('heavy');
  let lightActive = activeLaneCount('light');

  while (heavyActive < heavyLimit && queuedHeavy.length > 0) {
    const picked = shiftNextEligible(queuedHeavy, 'heavy');
    if (!picked) break;
    const { id, job } = picked;
    queuedJobs.delete(id);
    heavyActive++;
    startingJobs.add(id);
    try { jobPlatform.set(id, job.platform); } catch (e) { }
    if (String(job.platform || '').toLowerCase() === 'youtube') markYoutubeStarted();

    // PUSH PROGRESS!
    const earlyThumb = job.metadata?.thumbnail || deriveEarlyThumbnail(job.url, job.platform);
    setDownloadActivityContext(id, { url: job.url, platform: job.platform, channel: job.channel, title: job.title, lane: 'heavy', thumbnail: earlyThumb, progress: job.progress || 0 });

    try {
      startDownload(job.downloadId, job.url, job.platform, job.channel, job.title, job.metadata)
        .catch(() => { }).finally(() => {
          startingJobs.delete(id);
          runDownloadSchedulerSoon();
        });
    } catch (e) {
      await updateDownloadStatus.run('error', 0, e.message, job.downloadId);
      jobLane.delete(job.downloadId);
      startingJobs.delete(id);
    }
  }

  while (lightActive < lightLimit && queuedLight.length > 0) {
    const picked = shiftNextEligible(queuedLight, 'light');
    if (!picked) break;
    const { id, job } = picked;
    queuedJobs.delete(id);
    lightActive++;
    startingJobs.add(id);
    try { jobPlatform.set(id, job.platform); } catch (e) { }
    if (String(job.platform || '').toLowerCase() === 'youtube') markYoutubeStarted();

    // PUSH PROGRESS!
    const earlyThumb = job.metadata?.thumbnail || deriveEarlyThumbnail(job.url, job.platform);
    setDownloadActivityContext(id, { url: job.url, platform: job.platform, channel: job.channel, title: job.title, lane: 'light', thumbnail: earlyThumb, progress: job.progress || 0 });

    try {
      startDownload(job.downloadId, job.url, job.platform, job.channel, job.title, job.metadata)
        .catch(() => { }).finally(() => {
          startingJobs.delete(id);
          // Throttle CDN image downloads: 500ms delay between dispatches
          // to prevent event loop flooding from rapid-fire completions
          const plat = String(job.platform || '').toLowerCase();
          if (plat === 'pornpics' || plat === 'elitebabes' || plat === 'erome' || (job.url && /^https?:\/\/cdn\./i.test(job.url))) {
            setTimeout(() => runDownloadSchedulerSoon(), 500);
          } else {
            runDownloadSchedulerSoon();
          }
        });
    } catch (e) {
      await updateDownloadStatus.run('error', 0, e.message, job.downloadId);
      jobLane.delete(job.downloadId);
      startingJobs.delete(id);
    }
  }

  // Batch lane: lower priority, only runs when normal lanes have spare capacity
  const batchLimit = Math.max(0, BATCH_DOWNLOAD_CONCURRENCY);
  let batchActive = activeLaneCount('batch');
  const totalNormalActive = heavyActive + lightActive;
  while (batchActive < batchLimit && queuedBatch.length > 0 && totalNormalActive < (heavyLimit + lightLimit - 1)) {
    const picked = shiftNextEligible(queuedBatch, 'batch');
    if (!picked) break;
    const { id, job } = picked;
    queuedJobs.delete(id);
    batchActive++;
    startingJobs.add(id);
    try { jobPlatform.set(id, job.platform); } catch (e) { }

    const earlyThumb = job.metadata?.thumbnail || deriveEarlyThumbnail(job.url, job.platform);
    setDownloadActivityContext(id, { url: job.url, platform: job.platform, channel: job.channel, title: job.title, lane: 'batch', thumbnail: earlyThumb, progress: job.progress || 0 });

    try {
      startDownload(job.downloadId, job.url, job.platform, job.channel, job.title, job.metadata)
        .catch(() => { }).finally(() => {
          startingJobs.delete(id);
          runDownloadSchedulerSoon();
        });
    } catch (e) {
      await updateDownloadStatus.run('error', 0, e.message, job.downloadId);
      jobLane.delete(job.downloadId);
      startingJobs.delete(id);
    }
  }

  // Auto-rehydrate: if all in-memory queues are empty, pull more pending items from DB
  if (queuedHeavy.length === 0 && queuedLight.length === 0 && queuedBatch.length === 0) {
    scheduleAutoRehydrate();
  }
}

let autoRehydrateTimer = null;
function scheduleAutoRehydrate() {
  if (autoRehydrateTimer) return;
  autoRehydrateTimer = setTimeout(async () => {
    autoRehydrateTimer = null;
    try {
      const rows = await db.prepare(
        `SELECT id, url, platform, channel, title, metadata, status
         FROM downloads
         WHERE status = 'pending'
         ORDER BY COALESCE(priority, 0) DESC, id ASC
         LIMIT 250`
      ).all();
      if (!rows || rows.length === 0) return;
      console.log(`🔁 Auto-rehydrate: loading ${rows.length} pending items into queue...`);
      let loaded = 0;
      for (const row of rows) {
        const id = Number(row.id);
        if (!Number.isFinite(id)) continue;
        if (activeProcesses.has(id) || startingJobs.has(id) || queuedJobs.has(id)) continue;
        const url = String(row.url || '').trim();
        if (!url || url.startsWith('recording:')) continue;
        let parsedMeta = null;
        try { if (row.metadata) parsedMeta = JSON.parse(row.metadata); } catch (e) {}
        if (parsedMeta && parsedMeta.webdl_kind === 'recording') continue;
        const storedPlatform = String(row.platform || '').trim().toLowerCase();
        const platform = normalizePlatform(storedPlatform, url);
        const channel = (row.channel && row.channel !== 'unknown') ? row.channel : deriveChannelFromUrl(platform, url) || 'unknown';
        const title = (row.title && row.title !== 'untitled') ? row.title : deriveTitleFromUrl(url);
        const lane = detectLane(platform, url);
        queuedJobs.set(id, { downloadId: id, url, platform, channel, title, metadata: parsedMeta, progress: 0 });
        jobLane.set(id, lane);
        jobPlatform.set(id, platform);
        if (lane === 'light') queuedLight.push(id); else queuedHeavy.push(id);
        try { await db.prepare("UPDATE downloads SET status = 'queued' WHERE id = ?").run(id); } catch (e) {}
        loaded++;
      }
      if (loaded > 0) {
        console.log(`🔁 Auto-rehydrate: ${loaded} items geladen, scheduler starten...`);
        runDownloadSchedulerSoon();
      }
    } catch (e) {
      console.error('Auto-rehydrate error:', e.message);
    }
  }, 2000);
}

// Periodic check: if in-memory queues are empty but pending items exist, trigger rehydrate
setInterval(() => {
  if (queuedHeavy.length === 0 && queuedLight.length === 0 && queuedBatch.length === 0) {
    scheduleAutoRehydrate();
  }
}, 10000);

let postprocessSchedulerTimer = null;
function runPostprocessSchedulerSoon() {
  if (postprocessSchedulerTimer) return;
  postprocessSchedulerTimer = setTimeout(() => {
    postprocessSchedulerTimer = null;
    runPostprocessScheduler();
    syncRuntimeActiveState().catch(() => { });
  }, 120);
}

function enqueuePostprocessJob(downloadId, job) {
  if (!Number.isFinite(Number(downloadId)) || !job || typeof job.run !== 'function') return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    postprocessJobs.set(downloadId, { ...job, resolve, reject });
    if (!queuedPostprocess.includes(downloadId)) queuedPostprocess.push(downloadId);
    const queuedStatus = String(job.queuedStatus || '').trim().toLowerCase();
    Promise.resolve().then(async () => {
      if (queuedStatus) {
        try {
          await updateDownloadStatus.run(queuedStatus, Number.isFinite(job.queuedProgress) ? job.queuedProgress : 0, null, downloadId);
        } catch (e) { }
      }
      runPostprocessSchedulerSoon();
    }).catch((e) => {
      postprocessJobs.delete(downloadId);
      removeFromQueue(queuedPostprocess, downloadId);
      reject(e);
    });
  });
}

async function runPostprocessScheduler() {
  while (activePostprocessJobs.size < POSTPROCESS_CONCURRENCY && queuedPostprocess.length > 0) {
    const downloadId = queuedPostprocess.shift();
    if (!downloadId) continue;
    const job = postprocessJobs.get(downloadId);
    if (!job || typeof job.run !== 'function') continue;
    const queuedAbort = abortKind(downloadId);
    if (queuedAbort) {
      await applyAbortStatus(downloadId, queuedAbort);
      postprocessJobs.delete(downloadId);
      try { if (typeof job.resolve === 'function') job.resolve(false); } catch (e) { }
      continue;
    }

    activePostprocessJobs.add(downloadId);
    Promise.resolve().then(async () => {
      try {
        const startStatus = String(job.startStatus || '').trim().toLowerCase();
        if (startStatus) {
          await updateDownloadStatus.run(startStatus, Number.isFinite(job.startProgress) ? job.startProgress : 0, null, downloadId);
        }
        await job.run();
        try { if (typeof job.resolve === 'function') job.resolve(true); } catch (e) { }
      } catch (e) {
        const aborted = job.aborted || abortKind(downloadId);
        if (aborted) {
          if (!job.aborted) await applyAbortStatus(downloadId, aborted);
          try { if (typeof job.resolve === 'function') job.resolve(false); } catch (err) { }
        } else {
          await updateDownloadStatus.run('error', 0, e && e.message ? e.message : String(e), downloadId);
          try { if (typeof job.reject === 'function') job.reject(e); } catch (err) { }
        }
      } finally {
        activePostprocessJobs.delete(downloadId);
        postprocessJobs.delete(downloadId);
        runPostprocessSchedulerSoon();
        try { syncRuntimeActiveState().catch(() => { }); } catch (e) { }
      }
    }).catch(() => { });
  }
}

let metadataProbeTimer = null;
function runMetadataProbeSchedulerSoon() {
  if (metadataProbeTimer) return;
  metadataProbeTimer = setTimeout(() => {
    metadataProbeTimer = null;
    runMetadataProbeScheduler();
  }, 300);
}

function runMetadataProbeScheduler() {
  while (metadataProbeActive < Math.max(0, METADATA_PROBE_CONCURRENCY) && metadataProbeQueue.length > 0) {
    const item = metadataProbeQueue.shift();
    if (!item) continue;
    const { downloadId, url } = item;
    if (!isQueued(downloadId)) continue;
    metadataProbeActive++;
    fetchMetadataWithTimeout(url, Math.min(20000, Math.max(5000, YTDLP_METADATA_TIMEOUT_MS))).then((meta) => {
      if (!isQueued(downloadId)) return;
      const plat = String(jobPlatform.get(downloadId) || '').toLowerCase();
      if (plat === 'youtube') return;
      const dur = meta && Number.isFinite(meta.durationSeconds) ? meta.durationSeconds : null;
      if (dur !== null && dur > 0 && dur <= SMALL_DURATION_SECONDS) {
        const lane = jobLane.get(downloadId);
        if (lane === 'heavy') {
          jobLane.set(downloadId, 'light');
          removeFromQueue(queuedHeavy, downloadId);
          queuedLight.push(downloadId);
        }
      }
    }).catch(() => { }).finally(() => {
      metadataProbeActive--;
      runMetadataProbeSchedulerSoon();
      runDownloadSchedulerSoon();
    });
  }
}

async function getRuntimeActiveDownloadRows() {
  try {
    const ids = new Set();
    for (const id of activeProcesses.keys()) ids.add(id);
    for (const id of startingJobs) ids.add(id);
    for (const id of activePostprocessJobs) ids.add(id);
    const rows = [];
    for (const id of ids) {
      const row = await getDownload.get(id);
      if (!row) continue;
      const status = String(row.status || '').toLowerCase();
      if (status === 'queued' || status === 'pending') continue;
      rows.push(row);
    }
    const rank = (s) => {
      if (s === 'downloading') return 0;
      if (s === 'postprocessing') return 1;
      if (s === 'queued') return 2;
      if (s === 'pending') return 3;
      return 9;
    };
    rows.sort((a, b) => {
      const ra = rank(String(a && a.status ? a.status : ''));
      const rb = rank(String(b && b.status ? b.status : ''));
      if (ra !== rb) return ra - rb;
      const ua = String(a && a.updated_at ? a.updated_at : '');
      const ub = String(b && b.updated_at ? b.updated_at : '');
      if (ua !== ub) return ub.localeCompare(ua);
      const ca = String(a && a.created_at ? a.created_at : '');
      const cb = String(b && b.created_at ? b.created_at : '');
      return cb.localeCompare(ca);
    });
    return rows;
  } catch (e) {
    return [];
  }
}

async function rehydrateDownloadQueueWithMode(modeRaw, maxRowsRaw) {
  try {
    const mode = String(modeRaw || '').trim().toLowerCase();
    if (!mode || mode === '0' || mode === 'off' || mode === 'none' || mode === 'false' || mode === 'disabled') {
      return { success: true, mode: 'off', queued: 0 };
    }
    const maxRows = Math.max(0, parseInt(String(maxRowsRaw == null ? STARTUP_REHYDRATE_MAX_ROWS : maxRowsRaw), 10) || STARTUP_REHYDRATE_MAX_ROWS);
    const statusList = (mode === 'all' || mode === 'missing') ?
      "('pending', 'queued', 'downloading', 'postprocessing')" :
      mode === 'queued' || mode === 'pending' ?
        "('pending', 'queued')" :
        mode === 'post' || mode === 'postprocessing' || mode === 'postproc' ?
          "('postprocessing')" :
          "('downloading', 'postprocessing')";
    const rows = await db.prepare(
      `SELECT id, url, platform, channel, title, metadata, status
       FROM downloads
       WHERE status IN ${statusList}
       ORDER BY
         CASE status
           WHEN 'downloading' THEN 0
           WHEN 'postprocessing' THEN 1
           WHEN 'queued' THEN 2
           WHEN 'pending' THEN 3
           ELSE 9
         END,
         created_at DESC,
         id DESC
       LIMIT ?`
    ).all(maxRows);

    let queued = 0;
    for (const row of rows || []) {
      const id = Number(row.id);
      if (!Number.isFinite(id)) continue;
      if (activeProcesses.has(id) || startingJobs.has(id) || queuedJobs.has(id)) continue;

      const url = String(row.url || '').trim();
      if (!url) continue;

      let parsedMeta = null;
      if (typeof row.metadata === 'string' && row.metadata.trim()) {
        try { parsedMeta = JSON.parse(row.metadata); } catch (e) { parsedMeta = null; }
      }
      if (url.startsWith('recording:') || parsedMeta && parsedMeta.webdl_kind === 'recording') continue;

      const storedPlatform = row.platform && String(row.platform).trim() ? String(row.platform).trim() : '';
      const platform = normalizePlatform(storedPlatform, url);

      const storedChannel = row.channel && String(row.channel).trim() ? String(row.channel).trim() : '';
      const channel = storedChannel && storedChannel !== 'unknown' ? storedChannel : deriveChannelFromUrl(platform, url) || 'unknown';

      const storedTitle = row.title && String(row.title).trim() ? String(row.title).trim() : '';
      const title = storedTitle && storedTitle !== 'untitled' ? storedTitle : deriveTitleFromUrl(url);

      if (platform !== storedPlatform || channel !== storedChannel || title !== storedTitle) {
        await updateDownloadBasics.run(platform, channel, title, id);
      }

      const metadata = parsedMeta;

      let initialProgress = 0;
      if (row.status === 'downloading' || row.status === 'postprocessing') {
        const dbProg = await getDatabaseProgress(id);
        if (dbProg != null) initialProgress = dbProg;
      }

      const lane = detectLane(platform, url);
      queuedJobs.set(id, { downloadId: id, url, platform, channel, title, metadata, progress: initialProgress });
      jobLane.set(id, lane);
      jobPlatform.set(id, platform);
      if (lane === 'light') queuedLight.push(id); else
        queuedHeavy.push(id);
      queued++;
    }

    runDownloadSchedulerSoon();
    return { success: true, mode, queued };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function rehydrateDownloadQueue() {
  try {
    const mode = String(STARTUP_REHYDRATE_MODE || '').trim().toLowerCase();
    if (!mode || mode === '0' || mode === 'off' || mode === 'none' || mode === 'false' || mode === 'disabled') {
      return;
    }
    const statusList = (mode === 'all' || mode === 'missing') ?
      "('pending', 'queued', 'downloading', 'postprocessing')" :
      mode === 'queued' || mode === 'pending' ?
        "('pending', 'queued')" :
        mode === 'post' || mode === 'postprocessing' || mode === 'postproc' ?
          "('postprocessing')" :
          "('downloading', 'postprocessing')";
    const rows = await db.prepare(
      `SELECT id, url, platform, channel, title, metadata, status
       FROM downloads
       WHERE status IN ${statusList}
       ORDER BY
         CASE status
           WHEN 'downloading' THEN 0
           WHEN 'postprocessing' THEN 1
           WHEN 'queued' THEN 2
           WHEN 'pending' THEN 3
           ELSE 9
         END,
         created_at DESC,
         id DESC
       LIMIT ?`
    ).all(STARTUP_REHYDRATE_MAX_ROWS);

    for (const row of rows) {
      const id = Number(row.id);
      if (!Number.isFinite(id)) continue;
      if (activeProcesses.has(id) || startingJobs.has(id) || queuedJobs.has(id)) continue;

      const url = String(row.url || '').trim();
      if (!url) continue;

      let parsedMeta = null;
      if (typeof row.metadata === 'string' && row.metadata.trim()) {
        try {
          parsedMeta = JSON.parse(row.metadata);
        } catch (e) {
          parsedMeta = null;
        }
      }

      // Recordings are stored in the downloads table for dashboard/viewer only.
      // Never rehydrate them into the download scheduler.
      if (url.startsWith('recording:') || parsedMeta && parsedMeta.webdl_kind === 'recording') {
        continue;
      }

      const storedPlatform = row.platform && String(row.platform).trim() ? String(row.platform).trim() : '';
      const platform = normalizePlatform(storedPlatform, url);

      const storedChannel = row.channel && String(row.channel).trim() ? String(row.channel).trim() : '';
      const channel = storedChannel && storedChannel !== 'unknown' ? storedChannel : deriveChannelFromUrl(platform, url) || 'unknown';

      const storedTitle = row.title && String(row.title).trim() ? String(row.title).trim() : '';
      const title = storedTitle && storedTitle !== 'untitled' ? storedTitle : deriveTitleFromUrl(url);

      if (platform !== storedPlatform || channel !== storedChannel || title !== storedTitle) {
        await updateDownloadBasics.run(platform, channel, title, id);
      }

      const metadata = parsedMeta;

      let initialProgress = 0;
      if (row.status === 'downloading' || row.status === 'postprocessing') {
        try {
          const progRow = await db.prepare("SELECT progress FROM downloads WHERE id = ?").get(id);
          if (progRow && progRow.progress != null) initialProgress = progRow.progress;
        } catch (e) { /* ignore */ }
      }

      const lane = detectLane(platform, url);
      queuedJobs.set(id, { downloadId: id, url, platform, channel, title, metadata, progress: initialProgress });
      jobLane.set(id, lane);
      jobPlatform.set(id, platform);
      if (lane === 'light') queuedLight.push(id); else
        queuedHeavy.push(id);

      // Ensure DB status is 'queued' so items don't stay stuck as 'pending' across restarts
      if (row.status !== 'queued') {
        try { await db.prepare("UPDATE downloads SET status = 'queued' WHERE id = ?").run(id); } catch (e) {}
      }

      if (STARTUP_METADATA_PROBE_ENABLED && METADATA_PROBE_ENABLED && METADATA_PROBE_CONCURRENCY > 0 && platform !== 'onlyfans' && platform !== 'instagram' && platform !== 'wikifeet' && platform !== 'kinky' && platform !== 'tiktok' && platform !== 'reddit' && platform !== 'aznudefeet' && platform !== 'amateurvoyeurforum') {
        metadataProbeQueue.push({ downloadId: id, url });
      }
    }

    if (rows.length >= STARTUP_REHYDRATE_MAX_ROWS) {
      console.log(`ℹ️ Startup rehydrate gelimiteerd op ${STARTUP_REHYDRATE_MAX_ROWS} rows`);
    }

    runDownloadSchedulerSoon();
    if (mode === 'all' && STARTUP_METADATA_PROBE_ENABLED && METADATA_PROBE_ENABLED && METADATA_PROBE_CONCURRENCY > 0) {
      runMetadataProbeSchedulerSoon();
    }
  } catch (e) {
    console.error('rehydrateDownloadQueue failed:', e);
  }
}

// ========================
// RECORDING STATE
let activeRecordings = new Map();
Object.defineProperty(global, 'isRecording', { get: () => activeRecordings.size > 0 });

let avfoundationDeviceListCache = null;

// ========================
// EXPRESS APP
// ========================
const expressApp = express();
const server = http.createServer(expressApp);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept']
  },
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

expressApp.use(express.json({ limit: '50mb' }));
// Serve downloaded files directly as static assets (fast thumbnails, no DB lookup)
expressApp.use('/webdl-static', express.static(BASE_DIR, { maxAge: '1h', immutable: true }));

expressApp.get('/favicon.ico', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=604800');
  return res.status(204).send('');
});

expressApp.get('/debug/logs', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const lines = Math.max(1, Math.min(10000, parseInt(String(req.query.lines || '500'), 10) || 500));
    const download = String(req.query.download || '') === '1';
    const body = tailTextFile(LOG_FILE, lines, 524288);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (download) {
      res.setHeader('Content-Disposition', 'attachment; filename="webdl-server.log"');
    }
    return res.status(200).send(body || '');
  } catch (e) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send('');
  }
});

// CORS
expressApp.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

expressApp.post('/api/queue/resume', async (req, res) => {
  const mode = String(req.body && req.body.mode ? req.body.mode : 'all');
  const max = Number.isFinite(Number(req.body && req.body.max)) ? Number(req.body.max) : 500;
  try {
    const result = await rehydrateDownloadQueueWithMode(mode, max);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: String(e && e.message ? e.message : e) });
  }
});

// Global priority mode — when ON, new downloads get priority=1
let globalPriorityMode = false;
expressApp.get('/api/settings/priority', (req, res) => {
  res.json({ success: true, priority: globalPriorityMode });
});
expressApp.post('/api/settings/priority', (req, res) => {
  globalPriorityMode = !!(req.body && req.body.enabled);
  console.log(`🔥 Priority mode: ${globalPriorityMode ? 'AAN' : 'UIT'}`);
  res.json({ success: true, priority: globalPriorityMode });
});

async function relaySocketCommandToHttp(endpoint, payload) {
  const target = `http://127.0.0.1:${PORT}${endpoint}`;
  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        error: data && data.error ? data.error : `HTTP ${response.status}`,
        status: response.status
      };
    }
    if (data && typeof data === 'object') return data;
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message || 'Socket relay failed' };
  }
}

function broadcastRecordingState() {
  try {
    io.emit('recording-status-changed', { isRecording });
  } catch (e) { }
}

io.on('connection', (socket) => {
  console.log('🔌 Client verbonden');
  socket.emit('connection-state', {
    success: true,
    connected: true,
    serverTime: new Date().toISOString()
  });
  socket.emit('recording-status-changed', { isRecording });

  socket.on('webdl:request', async (message, ack) => {
    const reply = (payload) => {
      if (typeof ack === 'function') {
        try { ack(payload); } catch (e) { }
      }
    };

    const action = String(message && message.action ? message.action : '').trim().toLowerCase();
    const payload = message && message.payload && typeof message.payload === 'object' ?
      message.payload :
      {};

    if (!action) {
      reply({ success: false, error: 'Action ontbreekt' });
      return;
    }

    if (action === 'status') {
      reply({
        success: true,
        isRecording,
        activeDownloads: (await getRuntimeActiveDownloadRows()).length,
        serverTime: new Date().toISOString()
      });
      return;
    }

    if (action === 'start-recording') {
      reply(await relaySocketCommandToHttp('/start-recording', payload));
      return;
    }

    if (action === 'stop-recording') {
      reply(await relaySocketCommandToHttp('/stop-recording', payload));
      return;
    }

    if (action === 'screenshot') {
      reply(await relaySocketCommandToHttp('/screenshot', payload));
      return;
    }

    if (action === 'download') {
      reply(await relaySocketCommandToHttp('/download', payload));
      return;
    }

    if (action === 'open') {
      reply(await relaySocketCommandToHttp('/open', payload));
      return;
    }

    reply({ success: false, error: `Onbekende action: ${action}` });
  });
});

expressApp.post('/media/open', async (req, res) => {
  const kind = String(req.body && req.body.kind ? req.body.kind : '').toLowerCase();
  const id = parseInt(req.body && req.body.id != null ? req.body.id : '', 10);
  const relPath = String(req.body && req.body.path ? req.body.path : '').trim();
  const action = String(req.body && req.body.action ? req.body.action : 'open').toLowerCase();

  try {
    let fp = '';
    if (relPath) {
      const abs = safeResolveMediaRelPath(relPath);
      if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'bestand niet gevonden' });
      fp = abs;
    } else {
      if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'id is vereist' });
      let row = null;
      if (kind === 'd') row = await getDownload.get(id); else
        if (kind === 's') row = await db.prepare(`SELECT * FROM screenshots WHERE id=?`).get(id); else
          return res.status(400).json({ success: false, error: 'kind moet d of s zijn' });
      if (!row) return res.status(404).json({ success: false, error: 'niet gevonden' });

      fp = String(row.filepath || '').trim();

      if (row.platform === 'patreon') {
        console.log(`[DEBUG-PATREON-EXPAND] Processing id=${row.id}, fp=${fp}, isAllowed=${safeIsAllowedExistingPath(path.resolve(fp))}`);
      }

      if (!fp || !safeIsAllowedExistingPath(fp)) return res.status(404).json({ success: false, error: 'bestand niet gevonden' });
    }

    const stat = fs.statSync(fp);
    if (action === 'finder') {
      if (stat.isDirectory()) {
        spawn('/usr/bin/open', [fp]);
      } else {
        spawn('/usr/bin/open', ['-R', fp]);
      }
      return res.json({ success: true });
    }

    spawn('/usr/bin/open', [fp]);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

function safeResolveMediaRelPath(relPath) {
  try {
    const raw = String(relPath || '').trim();
    if (!raw) return null;

    const candidates = [];
    try {
      if (path.isAbsolute(raw)) candidates.push(path.resolve(raw));
    } catch (e) { }
    try {
      const rel = raw.replace(/^\/+/, '');
      if (rel) candidates.push(path.resolve(BASE_DIR, rel));
    } catch (e) { }

    for (const abs of candidates) {
      try {
        if (safeIsAllowedExistingPath(abs)) return abs;
      } catch (e) { }
    }
    return null;
  } catch (e) {
    return null;
  }
}

expressApp.get('/media/path', (req, res) => {
  const rel = String(req.query.path || '').trim();
  const abs = safeResolveMediaRelPath(rel);
  if (!abs || !fs.existsSync(abs)) return res.status(404).end();
  try {
    const st = fs.statSync(abs);
    if (st && st.isDirectory && st.isDirectory()) return res.status(400).end();
  } catch (e) {
    return res.status(404).end();
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    const ext = String(path.extname(abs || '')).toLowerCase();
    // Force video/mp4 for containers browsers can't handle by MIME
    if (ext === '.mov' || ext === '.m4v' || ext === '.mkv') {
      res.setHeader('Content-Type', 'video/mp4');
    } else {
      const known = new Set(['.mp4', '.webm', '.mkv', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif', '.heic', '.heif']);
      if (!known.has(ext)) {
        const mime = sniffMediaMimeByMagic(abs);
        if (mime) res.setHeader('Content-Type', mime);
      }
    }
  } catch (e) { }
  return res.sendFile(abs, (err) => {
    if (!err) return;
    if (res.headersSent) return;
    const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
    if (status === 404) return res.status(404).end();
    console.warn(`media path sendFile failed: ${err.message}`);
    return res.status(500).end();
  });
});

// Streaming transcoder for AV1 → H.264 (M1 has no hardware AV1 decode)
const _streamCodecCache = new Map(); // filepath → codec_name
expressApp.get('/media/stream', async (req, res) => {
  try {
    let abs = '';
    const rel = String(req.query.path || '').trim();
    const kind = String(req.query.kind || '').trim();
    const id = parseInt(req.query.id, 10);
    if (rel) {
      abs = safeResolveMediaRelPath(rel);
    } else if (kind === 'd' && Number.isFinite(id)) {
      try {
        const row = await getDownload.get(id);
        if (row && row.filepath) abs = String(row.filepath).trim();
      } catch (e) {}
    }
    if (!abs || !safeIsAllowedExistingPath(abs)) return res.status(404).end();
    const ext = String(path.extname(abs)).toLowerCase();
    const videoExts = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi']);
    if (!videoExts.has(ext)) {
      // Not a video — just serve directly
      return res.sendFile(abs);
    }

    // Probe codec (cached)
    let codec = _streamCodecCache.get(abs);
    if (!codec) {
      try {
        const probeResult = require('child_process').execSync(
          `ffprobe -v quiet -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "${abs.replace(/"/g, '\\"')}"`,
          { timeout: 5000, encoding: 'utf8' }
        ).trim().split('\n')[0].trim();
        codec = probeResult || 'unknown';
        _streamCodecCache.set(abs, codec);
        // Limit cache size
        if (_streamCodecCache.size > 500) {
          const first = _streamCodecCache.keys().next().value;
          _streamCodecCache.delete(first);
        }
      } catch (e) {
        codec = 'unknown';
      }
    }

    // If not AV1, serve directly (browser can handle H.264/VP9 fine)
    if (codec !== 'av1') {
      res.setHeader('Cache-Control', 'no-store');
      if (ext === '.mkv' || ext === '.mov' || ext === '.m4v') {
        res.setHeader('Content-Type', 'video/mp4');
      }
      return res.sendFile(abs, (err) => {
        if (!err) return;
        if (res.headersSent) return;
        res.status(err.code === 'ENOENT' ? 404 : 500).end();
      });
    }

    // AV1 detected — transcode to H.264 on the fly
    console.log(`[stream] Transcoding AV1→H.264: ${path.basename(abs)}`);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Transfer-Encoding', 'chunked');

    const ffmpeg = require('child_process').spawn('ffmpeg', [
      '-i', abs,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-vf', 'scale=min(1280\\,iw):-2',  // Cap at 720p width for smooth playback
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', 'frag_keyframe+empty_moov+faststart',
      '-f', 'mp4',
      'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    ffmpeg.stdout.pipe(res);
    ffmpeg.stderr.on('data', () => {}); // Suppress stderr

    req.on('close', () => {
      try { ffmpeg.kill('SIGTERM'); } catch (e) {}
    });
    res.on('close', () => {
      try { ffmpeg.kill('SIGTERM'); } catch (e) {}
    });
    ffmpeg.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });
    ffmpeg.on('exit', () => {
      try { res.end(); } catch (e) {}
    });
  } catch (e) {
    console.error('[stream] Error:', e.message);
    if (!res.headersSent) res.status(500).end();
  }
});


expressApp.get('/media/path-thumb', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  (async () => {
    const rel = String(req.query.path || '').trim();
    const abs = safeResolveMediaRelPath(rel);
    if (!abs || !fs.existsSync(abs)) return res.status(404).end();
    try {
      const thumbPath = await pickOrCreateThumbPath(abs, { allowGenerate: false });
      if (!thumbPath || !fs.existsSync(thumbPath)) {
        let sched = 'error';
        try { sched = scheduleThumbGeneration(abs) || 'error'; } catch (e) { }
        logMissingThumbOnce('path-thumb', rel, sched);
        return res.redirect(302, `/media/pending-thumb.svg?kind=path&id=${encodeURIComponent(rel.slice(0, 120))}`);
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      try {
        const ext = String(path.extname(thumbPath || '')).toLowerCase();
        const known = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif', '.heic', '.heif']);
        if (!known.has(ext)) {
          const mime = sniffMediaMimeByMagic(thumbPath);
          if (mime) res.setHeader('Content-Type', mime);
        }
      } catch (e) { }
      return res.sendFile(thumbPath, (err) => {
        if (!err) return;
        if (err && (err.code === 'ECONNABORTED' || /aborted/i.test(String(err.message || '')))) return;
        if (res.headersSent) return;
        const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
        if (status === 404) return res.status(404).end();
        console.warn(`media path thumb sendFile failed: ${err.message}`);
        return res.status(500).end();
      });
    } catch (e) {
      return res.status(500).end();
    }
  })();
});

// Lightweight server-side image proxy for queue card thumbnails
const proxyThumbCache = new Map();
expressApp.get('/api/proxy-thumb', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url || !url.startsWith('http')) return res.status(400).end();
  try {
    // Check memory cache first (up to 200 entries, 5 min TTL)
    const cached = proxyThumbCache.get(url);
    if (cached && Date.now() - cached.at < 300000) {
      res.setHeader('Content-Type', cached.ct || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.end(cached.buf);
    }
    // Trim cache
    if (proxyThumbCache.size > 200) {
      const keys = Array.from(proxyThumbCache.keys()).slice(0, 100);
      for (const k of keys) proxyThumbCache.delete(k);
    }
    const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
    // Try to load cookies for the domain
    try {
      const hostname = new URL(url).hostname;
      if (typeof loadCookiesForDomain === 'function') {
        const cookieStr = await loadCookiesForDomain(hostname);
        if (cookieStr) headers['Cookie'] = cookieStr;
      }
    } catch (e) { }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);
    if (!resp.ok) return res.status(resp.status).end();
    const ct = resp.headers.get('content-type') || 'image/jpeg';
    if (!ct.startsWith('image/')) return res.status(415).end();
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > 0 && buf.length < 10 * 1024 * 1024) {
      proxyThumbCache.set(url, { buf, ct, at: Date.now() });
    }
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.end(buf);
  } catch (e) {
    res.status(502).end();
  }
});

expressApp.get('/media/pending-thumb.svg', (req, res) => {
  try {
    const kind = String(req.query.kind || '').toLowerCase();
    const id = String(req.query.id || '').trim();
    const label = (kind === 's' ? 'shot' : kind === 'd' ? 'dl' : 'thumb') + (id ? ` #${id}` : '');
    const t = label.slice(0, 80);
    const safe = t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="100%" height="100%" fill="#000"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#00d4ff" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="18">${safe}</text></svg>`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    return res.status(200).send(svg);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send('');
  }
});

expressApp.post('/media/open-path', (req, res) => {
  const rel = String(req.body && req.body.path ? req.body.path : '').trim();
  const action = String(req.body && req.body.action ? req.body.action : 'open').toLowerCase();
  const abs = safeResolveMediaRelPath(rel);
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'bestand niet gevonden' });
  try {
    const stat = fs.statSync(abs);
    if (action === 'finder') {
      if (stat.isDirectory && stat.isDirectory()) spawn('/usr/bin/open', [abs]); else
        spawn('/usr/bin/open', ['-R', abs]);
      return res.json({ success: true });
    }
    spawn('/usr/bin/open', [abs]);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ========================
// HULPFUNCTIES
// ========================
function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim().substring(0, 100);
}

function makeStableShortHash(input) {
  const str = String(input || '');
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36).slice(0, 8);
}

function buildVdhImportTargetPath(absSourcePath, targetDir) {
  const src = path.resolve(String(absSourcePath || ''));
  const ext = path.extname(src).toLowerCase();
  const safeExt = IMPORTABLE_VIDEO_EXTS.has(ext) ? ext : '.mp4';
  const baseName = sanitizeName(path.basename(src, ext) || 'imported-video').replace(/\s+/g, '_').slice(0, 80) || 'imported_video';
  const sourceHash = makeStableShortHash(src);
  const filename = `${baseName}_${sourceHash}${safeExt}`;
  return path.join(path.resolve(targetDir), filename);
}

function makeScreenshotFilename() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const nonce = Math.random().toString(36).slice(2, 6);
  return `screenshot_${timestamp}_${nonce}.jpg`;
}

function makeThumbPlaceholderDataUrl(label = 'thumb…') {
  try {
    const t = String(label || '').slice(0, 80);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="100%" height="100%" fill="#000"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#00d4ff" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="18">${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  } catch (e) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="100%" height="100%" fill="#000"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#00d4ff" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="18">thumb…</text></svg>');
  }
}

function sendThumbPlaceholder(res, label) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    return res.type('image/svg+xml').send(decodeURIComponent(makeThumbPlaceholderDataUrl(label).split(',')[1] || ''));
  } catch (e) {
    try {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(204).end();
    } catch (e2) {
      return;
    }
  }
}

let thumbMissingLogAt = 0;
let thumbMissingTotal = 0;
const thumbMissingSeen = new Set();
const thumbMissingLogged = new Set();
function logMissingThumbOnce(tag, key, extra) {
  try {
    const k = `${String(tag || 'thumb')}:${String(key || '')}`;
    if (!key) return;
    thumbMissingTotal++;
    if (!thumbMissingSeen.has(k)) thumbMissingSeen.add(k);
    const now = Date.now();
    if (!thumbMissingLogged.has(k) && now - thumbMissingLogAt >= 250) {
      thumbMissingLogAt = now;
      thumbMissingLogged.add(k);
      console.warn(`⚠️ thumb missing: ${k}${extra ? ' ' + String(extra) : ''}`);
    }
    if (thumbMissingSeen.size > 25000) {
      const arr = Array.from(thumbMissingSeen);
      thumbMissingSeen.clear();
      for (const x of arr.slice(-18000)) thumbMissingSeen.add(x);
    }
    if (thumbMissingLogged.size > 8000) {
      const arr = Array.from(thumbMissingLogged);
      thumbMissingLogged.clear();
      for (const x of arr.slice(-6000)) thumbMissingLogged.add(x);
    }
  } catch (e) { }
}

function convertToJpg(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-i', inputPath, '-q:v', '1', outputPath];
    const proc = spawn(FFMPEG, args);
    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(stderr || `ffmpeg exit code ${code}`));
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

function probeVideoDurationSeconds(filePath) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath];
    const proc = spawn(FFPROBE, args);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', () => {
      try {
        const raw = String(out || '').trim();
        const n = parseFloat(raw);
        if (Number.isFinite(n) && n > 0) return resolve(n);
      } catch (e) { }
      reject(new Error(String(err || out || 'ffprobe duration failed').trim()));
    });
    proc.on('error', reject);
  });
}

function moveFileSync(srcPath, destPath) {
  try {
    fs.renameSync(srcPath, destPath);
  } catch (e) {
    if (e && e.code === 'EXDEV') {
      fs.copyFileSync(srcPath, destPath);
      try { fs.unlinkSync(srcPath); } catch (e2) { }
      return;
    }
    throw e;
  }
}

let baseDirInfoCache = null;
function getBaseDirInfo() {
  if (baseDirInfoCache) return baseDirInfoCache;
  const resolved = path.resolve(BASE_DIR);
  let real = resolved;
  try {
    if (fs.existsSync(resolved)) real = fs.realpathSync(resolved);
  } catch (e) {
    real = resolved;
  }
  const extraRaw = String(process.env.WEBDL_EXTRA_MEDIA_ROOTS || process.env.WEBDL_ALLOWED_MEDIA_ROOTS || '').trim();
  const extra = [];
  if (extraRaw) {
    for (const part of extraRaw.split(/[\n;,]+/g)) {
      const p = String(part || '').trim();
      if (!p) continue;
      try {
        const r = path.resolve(p);
        let rr = r;
        try {
          if (fs.existsSync(r)) rr = fs.realpathSync(r);
        } catch (e) {
          rr = r;
        }
        extra.push({ resolved: r, real: rr });
      } catch (e) { }
    }
  }
  baseDirInfoCache = { resolved, real, extra };
  return baseDirInfoCache;
}

function safeIsInsideBaseDir(p) {
  try {
    const b = getBaseDirInfo();
    const baseResolved = b.resolved;
    const baseReal = b.real;
    const abs = path.resolve(String(p || ''));
    const inBase =
      abs === baseResolved ||
      abs.startsWith(baseResolved + path.sep) ||
      abs === baseReal ||
      abs.startsWith(baseReal + path.sep);

    if (inBase) return true;
    const extra = Array.isArray(b.extra) ? b.extra : [];
    for (const r of extra) {
      const rr = r && r.resolved ? String(r.resolved) : '';
      const real = r && r.real ? String(r.real) : '';
      if (rr && (abs === rr || abs.startsWith(rr + path.sep))) return true;
      if (real && (abs === real || abs.startsWith(real + path.sep))) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

function pickThumbnailFile(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return null;
    const abs = path.resolve(String(dir));
    if (!safeIsInsideBaseDir(abs)) return null;

    if (fs.statSync(abs).isFile() && isImagePath(abs)) {
      return abs;
    }

    const rootDir = fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
    if (!safeIsInsideBaseDir(rootDir)) return null;

    const candidates = [];
    const queue = [{ d: rootDir, depth: 0 }];
    const seenDirs = new Set();
    let scannedFiles = 0;
    const MAX_DEPTH = 3;
    const MAX_DIRS = 220;
    const MAX_FILES = 1600;

    while (queue.length) {
      const cur = queue.shift();
      if (!cur || !cur.d) continue;
      if (cur.depth > MAX_DEPTH) continue;
      const dirPath = path.resolve(cur.d);
      if (!safeIsInsideBaseDir(dirPath)) continue;
      if (seenDirs.has(dirPath)) continue;
      seenDirs.add(dirPath);
      if (seenDirs.size > MAX_DIRS) break;

      let entries = [];
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch (e) {
        continue;
      }

      for (const e of entries) {
        if (!e) continue;
        const full = path.join(dirPath, e.name);
        if (e.isDirectory()) {
          if (cur.depth < MAX_DEPTH) queue.push({ d: full, depth: cur.depth + 1 });
          continue;
        }

        if (!e.isFile()) continue;
        if (!isImagePath(full)) continue;
        scannedFiles++;
        if (scannedFiles > MAX_FILES) break;
        let score = 0;
        if (/(thumb|thumbnail|cover|poster)/i.test(e.name)) score += 1000;
        if (/(\.|_)(jpg|jpeg|png)$/i.test(e.name)) score += 10;
        score -= cur.depth * 60;
        candidates.push({ name: e.name, path: full, score });
      }

      if (scannedFiles > MAX_FILES) break;
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return candidates[0].path;
  } catch (e) {
    return null;
  }
}

function pickThumbnailFileShallow(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return null;
    const abs = path.resolve(String(dir));
    if (!safeIsInsideBaseDir(abs)) return null;
    const stat = fs.statSync(abs);
    if (!stat.isDirectory()) return null;

    const entries = fs.readdirSync(abs, { withFileTypes: true });
    const candidates = [];
    const subdirs = [];
    for (const e of entries) {
      if (!e || e.name.startsWith('.')) continue;
      if (e.isFile()) {
        const full = path.join(abs, e.name);
        if (!safeIsInsideBaseDir(full)) continue;
        if (!isImagePath(full)) continue;
        let score = 0;
        if (/(thumb|thumbnail|cover|poster)/i.test(e.name)) score += 1000;
        if (/\.(jpg|jpeg|png|webp)$/i.test(e.name)) score += 10;
        candidates.push({ name: e.name, path: full, score });
      } else if (e.isDirectory()) {
        subdirs.push(path.join(abs, e.name));
      }
    }

    // If no images at root, look one level deeper (for gallery-dl/directlink/ etc.)
    if (!candidates.length && subdirs.length) {
      for (const sub of subdirs) {
        try {
          const subEntries = fs.readdirSync(sub, { withFileTypes: true });
          for (const se of subEntries) {
            if (!se || se.name.startsWith('.')) continue;
            if (se.isFile()) {
              const full = path.join(sub, se.name);
              if (!safeIsInsideBaseDir(full) || !isImagePath(full)) continue;
              candidates.push({ name: se.name, path: full, score: 5 });
              if (candidates.length >= 3) break; // Just need one
            } else if (se.isDirectory()) {
              // One more level deep (gallery-dl/directlink/)
              try {
                const deepEntries = fs.readdirSync(path.join(sub, se.name), { withFileTypes: true });
                for (const de of deepEntries) {
                  if (!de || de.name.startsWith('.') || !de.isFile()) continue;
                  const full = path.join(sub, se.name, de.name);
                  if (!safeIsInsideBaseDir(full) || !isImagePath(full)) continue;
                  candidates.push({ name: de.name, path: full, score: 3 });
                  if (candidates.length >= 3) break;
                }
              } catch (e) {}
            }
            if (candidates.length >= 3) break;
          }
        } catch (e) {}
        if (candidates.length >= 3) break;
      }
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return candidates[0].path;
  } catch (e) {
    return null;
  }
}

function isVideoPath(fp) {
  const ext = String(path.extname(String(fp || '')).toLowerCase() || '');
  return ['.mp4', '.mov', '.m4v', '.webm', '.mkv'].includes(ext);
}

function isImagePath(fp) {
  const ext = String(path.extname(String(fp || '')).toLowerCase() || '');
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.avif', '.heic', '.heif'].includes(ext);
}

function sniffMediaKindByMagic(absPath) {
  try {
    const abs = path.resolve(String(absPath || ''));
    if (!abs || !safeIsAllowedExistingPath(abs)) return null;
    const st = fs.existsSync(abs) ? fs.statSync(abs) : null;
    if (!st || !st.isFile || !st.isFile()) return null;
    if ((st.size || 0) < 12) return null;

    const fd = fs.openSync(abs, 'r');
    try {
      const buf = Buffer.alloc(64);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      if (!n || n < 12) return null;

      if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image';
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image';
      if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image';
      if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image';

      if (n >= 12) {
        const riff = buf.toString('ascii', 0, 4);
        const webp = buf.toString('ascii', 8, 12);
        if (riff === 'RIFF' && webp === 'WEBP') return 'image';
      }

      if (n >= 12) {
        const box = buf.toString('ascii', 4, 8);
        if (box === 'ftyp') {
          const brand = buf.toString('ascii', 8, 12);
          const brands = new Set(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ', 'qt  ', '3gp4', '3gp5']);
          if (brands.has(brand)) return 'video';
          if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('hevc') || brand.startsWith('mif1')) return 'image';
        }
      }

      if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video';
      return null;
    } finally {
      try { fs.closeSync(fd); } catch (e) { }
    }
  } catch (e) {
    return null;
  }
}

function sniffMediaMimeByMagic(absPath) {
  try {
    const abs = path.resolve(String(absPath || ''));
    if (!abs || !safeIsAllowedExistingPath(abs)) return '';
    const st = fs.existsSync(abs) ? fs.statSync(abs) : null;
    if (!st || !st.isFile || !st.isFile()) return '';
    if ((st.size || 0) < 12) return '';
    const fd = fs.openSync(abs, 'r');
    try {
      const buf = Buffer.alloc(64);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      if (!n || n < 12) return '';
      if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
      if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
      if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
      if (n >= 12) {
        const riff = buf.toString('ascii', 0, 4);
        const webp = buf.toString('ascii', 8, 12);
        if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
      }
      if (n >= 12) {
        const box = buf.toString('ascii', 4, 8);
        if (box === 'ftyp') return 'video/mp4';
      }
      if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
    } finally {
      try { fs.closeSync(fd); } catch (e) { }
    }
  } catch (e) { }
  return '';
}

function isStableEnoughForVideoThumb(videoPath) {
  try {
    const st = fs.statSync(videoPath);
    const ageMs = Date.now() - (st.mtimeMs || 0);
    const size = st && st.size ? st.size : 0;
    if (size <= 0) return false;
    if (ageMs < 1500) return false;
    if (size < 256 * 1024 && ageMs < 15000) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function findFirstVideoInDir(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return null;
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return null;
    if (!safeIsInsideBaseDir(dir)) return null;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e || !e.isFile()) continue;
      const full = path.join(dir, e.name);
      if (isVideoPath(full)) return full;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function findFirstVideoInDirDeep(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return null;
    const abs = path.resolve(String(dir));
    const stat = fs.statSync(abs);
    if (!stat.isDirectory()) return null;
    if (!safeIsInsideBaseDir(abs)) return null;

    const queue = [{ d: abs, depth: 0 }];
    const seenDirs = new Set();
    const MAX_DEPTH = 3;
    const MAX_DIRS = 220;
    let scannedFiles = 0;
    const MAX_FILES = 1600;

    while (queue.length) {
      const cur = queue.shift();
      if (!cur || !cur.d) continue;
      if (cur.depth > MAX_DEPTH) continue;
      const dirPath = path.resolve(cur.d);
      if (!safeIsInsideBaseDir(dirPath)) continue;
      if (seenDirs.has(dirPath)) continue;
      seenDirs.add(dirPath);
      if (seenDirs.size > MAX_DIRS) break;

      let entries = [];
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch (e) {
        continue;
      }

      for (const e of entries) {
        if (!e) continue;
        const full = path.join(dirPath, e.name);
        if (e.isDirectory()) {
          if (cur.depth < MAX_DEPTH) queue.push({ d: full, depth: cur.depth + 1 });
          continue;
        }
        if (!e.isFile()) continue;
        scannedFiles++;
        if (scannedFiles > MAX_FILES) break;
        if (isVideoPath(full)) return full;
      }
      if (scannedFiles > MAX_FILES) break;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function makeVideoThumbPath(videoPath) {
  try {
    const dir = path.dirname(videoPath);
    const base = path.basename(videoPath, path.extname(videoPath));
    return path.join(dir, `${base}_thumb_v3.jpg`);
  } catch (e) {
    return null;
  }
}

async function extractVideoThumbnail(videoPath, outJpgPath) {
  const vfBase = 'scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2:black,setsar=1';
  let durSec = null;
  try {
    durSec = await probeVideoDurationSeconds(videoPath);
  } catch (e) {
    durSec = null;
  }

  const attemptsSec = [];
  const push = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    if (n < 0.2) return;
    attemptsSec.push(n);
  };

  // Recordings can have long black intros; try later timestamps first.
  push(30);
  push(60);
  push(120);
  push(240);
  push(12);
  push(6);
  push(2);
  push(0.5);

  if (Number.isFinite(durSec) && durSec > 1) {
    const maxT = Math.max(0.5, durSec - 0.75);
    push(Math.min(maxT, durSec * 0.10));
    push(Math.min(maxT, durSec * 0.30));
    push(Math.min(maxT, durSec * 0.60));
    push(Math.min(maxT, durSec * 0.85));
  }

  const uniq = [];
  const seen = new Set();
  for (const t of attemptsSec) {
    const key = String(Math.round(t * 10) / 10);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(t);
  }

  let lastErr = '';
  for (const t of uniq) {
    try {
      const ss = String(Math.max(0, t));
      await new Promise((resolve, reject) => {
        const vf = `thumbnail=240,${vfBase}`;
        const args = [
          '-y',
          '-hide_banner',
          '-loglevel', 'error',
          '-ss', ss,
          '-i', videoPath,
          '-frames:v', '1',
          '-an',
          '-vf', vf,
          '-q:v', '3',
          outJpgPath];

        const proc = spawn(FFMPEG, args);
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
          let outSize = 0;
          try {
            if (code === 0 && outJpgPath && fs.existsSync(outJpgPath)) {
              const st = fs.statSync(outJpgPath);
              outSize = st && st.size ? st.size : 0;
              if (outSize >= MIN_THUMB_BYTES) return resolve();
            }
          } catch (e) { }
          try { if (outJpgPath) fs.rmSync(outJpgPath, { force: true }); } catch (e) { }
          reject(new Error(stderr || `ffmpeg exit code ${code}${outSize ? ` (thumb ${outSize} bytes)` : ''}`));
        });
        proc.on('error', reject);
      });
      return outJpgPath;
    } catch (e) {
      lastErr = e && e.message ? e.message : String(e);
    }
  }

  throw new Error(lastErr || 'ffmpeg thumbnail failed');
}

const THUMB_GEN_CONCURRENCY = Math.max(0, parseInt(process.env.WEBDL_THUMB_GEN_CONCURRENCY || '2', 10) || 2);
const THUMB_GEN_MAX_QUEUE = Math.max(50, Math.min(5000, parseInt(process.env.WEBDL_THUMB_GEN_MAX_QUEUE || '1200', 10) || 1200));
let thumbGenActive = 0;
let thumbGenTimer = null;
const thumbGenQueue = [];
const thumbGenQueued = new Set();
const thumbGenInflight = new Set();

const THUMB_GEN_COOLDOWN_MS = Math.max(2500, parseInt(process.env.WEBDL_THUMB_GEN_COOLDOWN_MS || '30000', 10) || 30000);
const thumbGenCooldownUntil = new Map();

let thumbGenScheduleTotal = 0;
let thumbGenScheduleEnqueued = 0;
const thumbGenScheduleDenied = {
  no_concurrency: 0,
  empty_path: 0,
  not_allowed: 0,
  dup: 0,
  queue_full: 0,
  cooldown: 0
};

const thumbGenFailOnce = new Set();
function logThumbGenFailureOnce(abs, err) {
  try {
    const msg = (err && err.message) ? String(err.message) : String(err || '');
    const key = String(abs || '') + '::' + msg.slice(0, 220);
    if (!key.trim()) return;
    if (thumbGenFailOnce.has(key)) return;
    thumbGenFailOnce.add(key);
    if (thumbGenFailOnce.size > 400) {
      try { thumbGenFailOnce.clear(); } catch (e) { }
    }
    console.warn(`⚠️ thumb gen failed: ${abs} :: ${msg}`);
  } catch (e) { }
}

function drainThumbGenQueueSoon() {
  if (thumbGenTimer) return;
  thumbGenTimer = setTimeout(() => {
    thumbGenTimer = null;
    drainThumbGenQueue();
  }, 150);
}

// Background scanner: auto-enqueue completed downloads that are missing thumbnails
let isAutoEnqueueingThumbs = false;
async function autoEnqueueMissingThumbs() {
  if (isAutoEnqueueingThumbs) return;
  if (thumbGenQueue.length >= Math.max(10, THUMB_GEN_MAX_QUEUE / 2)) return; // Don't overwhelm an already busy queue
  isAutoEnqueueingThumbs = true;
  try {
    // Only fetch a small batch to keep it fast and iterative
    const limit = Math.max(5, THUMB_GEN_MAX_QUEUE - thumbGenQueue.length);
    // Exclude HDD paths (/Volumes/) — they're too slow and cause event loop + DB contention
    const rows = await db.prepare("SELECT filepath FROM downloads WHERE status = 'completed' AND is_thumb_ready = false AND filepath IS NOT NULL AND filepath != '' AND filepath NOT LIKE '/Volumes/%' ORDER BY id DESC LIMIT ?").all(limit);
    if (rows && rows.length > 0) {
      let enqueued = 0;
      for (const row of rows) {
        if (!row.filepath) continue;
        const res = scheduleThumbGeneration(row.filepath);
        if (res === 'enqueued') enqueued++;
      }
      if (enqueued > 0) drainThumbGenQueueSoon();
    }
  } catch (e) {
    // Ignore DB errors during background scan
  } finally {
    isAutoEnqueueingThumbs = false;
  }
}
// Background thumb scanner — generates thumbs for items that don't have one yet.
// Runs every 30s with throttled drain (200ms between jobs) to avoid event loop starvation.
setInterval(() => { autoEnqueueMissingThumbs().catch(() => { }); }, 30000);

function scheduleThumbGeneration(targetPath) {
  try {
    thumbGenScheduleTotal++;
    if (!THUMB_GEN_CONCURRENCY) {
      thumbGenScheduleDenied.no_concurrency++;
      return 'no_concurrency';
    }
    const abs = path.resolve(String(targetPath || ''));
    if (!abs) {
      thumbGenScheduleDenied.empty_path++;
      return 'empty_path';
    }
    // Skip external HDD paths — they cause sync I/O stalls and DB contention
    if (abs.startsWith('/Volumes/')) {
      thumbGenScheduleDenied.hdd_path = (thumbGenScheduleDenied.hdd_path || 0) + 1;
      return 'hdd_path';
    }
    if (!safeIsAllowedExistingPath(abs)) {
      thumbGenScheduleDenied.not_allowed++;
      return 'not_allowed';
    }
    try {
      const until = thumbGenCooldownUntil.has(abs) ? Number(thumbGenCooldownUntil.get(abs) || 0) : 0;
      if (until && Date.now() < until) {
        thumbGenScheduleDenied.cooldown++;
        return 'cooldown';
      }
    } catch (e) { }
    if (thumbGenInflight.has(abs) || thumbGenQueued.has(abs)) {
      thumbGenScheduleDenied.dup++;
      return 'dup';
    }
    if (thumbGenQueue.length >= THUMB_GEN_MAX_QUEUE) {
      thumbGenScheduleDenied.queue_full++;
      return 'queue_full';
    }
    thumbGenQueued.add(abs);
    thumbGenQueue.push(abs);
    thumbGenScheduleEnqueued++;
    drainThumbGenQueueSoon();
    return 'enqueued';
  } catch (e) { }
  return 'error';
}

function drainThumbGenQueue() {
  try {
    // Only start ONE job at a time, with a delay to let the event loop breathe
    if (thumbGenActive >= THUMB_GEN_CONCURRENCY || !thumbGenQueue.length) return;
    const abs = thumbGenQueue.shift();
    if (!abs) { drainThumbGenQueueSoon(); return; }
    thumbGenQueued.delete(abs);
    if (thumbGenInflight.has(abs)) { drainThumbGenQueueSoon(); return; }
    thumbGenInflight.add(abs);
    thumbGenActive++;
    pickOrCreateThumbPath(abs, { allowGenerate: true, throwOnError: true }).
      then(async (out) => {
        if (out) {
          try {
            console.log(`✅ Thumb success for ${abs}, updating DB... (out=${out})`);
            await db.prepare("UPDATE downloads SET is_thumb_ready = true WHERE is_thumb_ready = false AND filepath = ?").run(abs);
            console.log(`✅ DB updated for ${abs}`);
          } catch (e) {
            console.error(`❌ DB thumb update failed for ${abs}: ${e && e.message ? e.message : e}`);
          }
          return;
        }
        // Mark as thumb_ready in DB so it stops being retried
        try {
          logThumbGenFailureOnce(abs, new Error('thumb gen returned null'));
          await db.prepare("UPDATE downloads SET is_thumb_ready = true WHERE is_thumb_ready = false AND filepath = ?").run(abs);
        } catch (e) { }
      }).
      catch(async (e) => {
        try { logThumbGenFailureOnce(abs, e); } catch (e2) { }
        // Mark as thumb_ready in DB so it stops being retried
        try {
          await db.prepare("UPDATE downloads SET is_thumb_ready = true WHERE is_thumb_ready = false AND filepath = ?").run(abs);
        } catch (e2) { }
      }).
      finally(() => {
        thumbGenActive = Math.max(0, thumbGenActive - 1);
        thumbGenInflight.delete(abs);
        // Delay 200ms before starting next job — lets the event loop serve API requests
        setTimeout(() => drainThumbGenQueue(), 200);
      });
  } catch (e) { }
}

async function pickOrCreateThumbPath(targetPath, opts) {
  try {
    if (!targetPath) return null;
    const abs = path.resolve(String(targetPath));
    if (!safeIsAllowedExistingPath(abs)) return null;
    const allowGenerate = !(opts && opts.allowGenerate === false);

    const inflight = pickOrCreateThumbPath._inflight;
    const cache = pickOrCreateThumbPath._cache;
    if (inflight && inflight.has(abs)) {
      try { return await inflight.get(abs); } catch (e) { return null; }
    }

    const p = (async () => {
      const stat = fs.statSync(abs);
      const srcMtimeMs = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0;
      try {
        const cached = cache && cache.get(abs);
        if (cached && cached.srcMtimeMs === srcMtimeMs && cached.thumbPath && fs.existsSync(cached.thumbPath)) {
          return cached.thumbPath;
        }
      } catch (e) { }

      const sniff = (() => {
        try { return sniffMediaKindByMagic(abs); } catch (e) { return null; }
      })();

      if (stat.isFile() && (isVideoPath(abs) || sniff === 'video')) {
        try {
          const dir = path.dirname(abs);
          const base = path.basename(abs, path.extname(abs));
          const sidecarExts = ['.webp', '.jpg', '.jpeg', '.png'];
          for (const ext of sidecarExts) {
            const cand = path.join(dir, base + ext);
            if (!safeIsInsideBaseDir(cand)) continue;
            if (!fs.existsSync(cand)) continue;
            const st = fs.statSync(cand);
            if (st && (st.size || 0) >= 8000) return cand;
          }
        } catch (e) { }

        const out = makeVideoThumbPath(abs);
        if (!out || !safeIsInsideBaseDir(out)) return null;
        if (fs.existsSync(out)) {
          try {
            const st2 = fs.statSync(out);
            if (st2 && (st2.size || 0) >= MIN_THUMB_BYTES) return out;
            try { fs.rmSync(out, { force: true }); } catch (e) { }
          } catch (e) { }
        }
        if (!isStableEnoughForVideoThumb(abs)) return null;
        if (!allowGenerate) return null;
        return await extractVideoThumbnail(abs, out);
      }

      if (stat.isFile && stat.isFile() && sniff === 'image') {
        return abs;
      }

      if (stat.isDirectory()) {
        const pickedShallow = pickThumbnailFileShallow(abs);
        if (pickedShallow) return pickedShallow;
        // Also try recursive scan (e.g., gallery-dl puts files in subdirectories)
        const pickedDeep = pickThumbnailFile(abs);
        if (pickedDeep) return pickedDeep;
        if (!allowGenerate) return null;

        const picked = pickThumbnailFile(abs);
        // If we picked an old auto-generated thumb (likely cropped), prefer generating the v2 video thumb.
        const looksLikeOldAutoThumb = picked && /_thumb(?:_v\d+)?\.(jpg|jpeg)$/i.test(String(picked)) && !/_thumb_v3\.(jpg|jpeg)$/i.test(String(picked));
        if (picked && !looksLikeOldAutoThumb) return picked;

        const firstVideo = findFirstVideoInDirDeep(abs) || findFirstVideoInDir(abs);
        if (firstVideo) {
          if (!isStableEnoughForVideoThumb(firstVideo)) {
            if (picked) return picked;
            return null;
          }
          const out = makeVideoThumbPath(firstVideo);
          if (!out || !safeIsInsideBaseDir(out)) return null;
          if (fs.existsSync(out)) {
            try {
              const st2 = fs.statSync(out);
              if (st2 && (st2.size || 0) >= MIN_THUMB_BYTES) return out;
              try { fs.rmSync(out, { force: true }); } catch (e) { }
            } catch (e) { }
          }
          return await extractVideoThumbnail(firstVideo, out);
        }

        if (picked) return picked;
        return null;
      }

      const picked = pickThumbnailFile(abs);
      if (picked) return picked;

      return null;
    })();

    if (inflight && inflight.set) inflight.set(abs, p);
    let outPath = null;
    try {
      outPath = await p;
      try {
        const st = fs.statSync(abs);
        const srcMtimeMs2 = Number.isFinite(st.mtimeMs) ? st.mtimeMs : 0;
        if (cache && cache.set && outPath) cache.set(abs, { srcMtimeMs: srcMtimeMs2, thumbPath: outPath });
      } catch (e) { }
      return outPath;
    } finally {
      try { if (inflight && inflight.delete) inflight.delete(abs); } catch (e) { }
    }
  } catch (e) {
    if (opts && opts.throwOnError) throw e;
    return null;
  }
}

pickOrCreateThumbPath._cache = new Map();
pickOrCreateThumbPath._inflight = new Map();

function isTikTokPhotoUrl(url) {
  return /tiktok\.com\/@[^\/]+\/photo\//i.test(String(url || ''));
}

function runScreencapture(outputPath) {
  return new Promise((resolve, reject) => {
    exec(`/usr/sbin/screencapture -x -C -t jpg "${outputPath}"`, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function makeRecordingLockCmdFile(updates, cropWidth, cropHeight) {
  const sorted = Array.isArray(updates) ? [...updates] : [];
  sorted.sort((a, b) => (a.t || 0) - (b.t || 0));

  const cleaned = [];
  let last = null;
  for (const u of sorted) {
    if (!u) continue;
    const t = Number.isFinite(u.t) ? Math.max(0, u.t) : 0;
    const x = Number.isFinite(u.x) ? Math.max(0, Math.floor(u.x / 2) * 2) : null;
    const y = Number.isFinite(u.y) ? Math.max(0, Math.floor(u.y / 2) * 2) : null;
    if (x === null || y === null) continue;
    if (last && last.x === x && last.y === y) continue;
    const item = { t, x, y };
    cleaned.push(item);
    last = item;
  }

  if (cleaned.length === 0) {
    cleaned.push({ t: 0, x: 0, y: 0 });
  }

  const lines = [];
  for (const u of cleaned) {
    const start = u.t.toFixed(3);
    lines.push(`${start} crop@lock x ${u.x}, crop@lock y ${u.y};`);
  }
  return lines.join('\n') + '\n';
}

function applyRecordingLockCrop({ rawFilePath, finalFilePath, cmdText, cropWidth, cropHeight, downloadId = null }) {
  return new Promise((resolve, reject) => {
    const cmdFile = path.join(os.tmpdir(), `webdl-lock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.cmd`);
    fs.writeFileSync(cmdFile, cmdText);

    const safeW = Math.max(2, Math.floor(cropWidth / 2) * 2);
    const safeH = Math.max(2, Math.floor(cropHeight / 2) * 2);

    const filterGraph = `[0:v]setpts=PTS-STARTPTS,sendcmd=f=${cmdFile},crop@lock=w=${safeW}:h=${safeH}:x=0:y=0[v]`;

    const args = [
      '-y',
      '-i', rawFilePath,
      '-filter_complex', filterGraph,
      '-map', '[v]',
      '-map', '0:a?',
      '-c:v', VIDEO_CODEC,
      '-b:v', VIDEO_BITRATE,
      '-c:a', 'copy',
      '-pix_fmt', VIDEO_CODEC === 'h264_videotoolbox' ? 'nv12' : 'yuv420p',
      '-movflags', '+faststart',
      finalFilePath];


    if (POSTPROCESS_THREADS) {
      args.splice(args.indexOf('-i') + 2, 0, '-threads', POSTPROCESS_THREADS);
    }

    if (VIDEO_CODEC === 'h264_videotoolbox') {
      args.splice(args.indexOf('-pix_fmt'), 0, '-realtime', '1', '-prio_speed', '1');
    }

    const proc = spawnNice(FFMPEG, args);
    if (Number.isFinite(Number(downloadId)) && Number(downloadId) > 0) {
      try { activeProcesses.set(downloadId, proc); } catch (e) { }
    }

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (Number.isFinite(Number(downloadId)) && Number(downloadId) > 0) {
        try { activeProcesses.delete(downloadId); } catch (e) { }
      }
      try { fs.unlinkSync(cmdFile); } catch (e) { }
      if (code === 0) return resolve();
      reject(new Error(stderr || `ffmpeg exit code ${code}`));
    });

    proc.on('error', (err) => {
      if (Number.isFinite(Number(downloadId)) && Number(downloadId) > 0) {
        try { activeProcesses.delete(downloadId); } catch (e) { }
      }
      try { fs.unlinkSync(cmdFile); } catch (e) { }
      reject(err);
    });
  });
}

function probeVideoSize(filePath) {
  return new Promise((resolve) => {
    const args = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', filePath];
    const proc = spawn(FFPROBE, args);
    let out = '';

    proc.stdout.on('data', (d) => { out += d.toString(); });

    proc.on('close', () => {
      try {
        const data = JSON.parse(out || '{}');
        const s = data && data.streams && data.streams[0] ? data.streams[0] : null;
        const w = s && Number.isFinite(s.width) ? s.width : null;
        const h = s && Number.isFinite(s.height) ? s.height : null;
        resolve(w && h ? { width: w, height: h } : null);
      } catch (e) {
        resolve(null);
      }
    });

    proc.on('error', () => resolve(null));
  });
}

function probeFrameGrayStats(filePath, ssSeconds = 0.5) {
  return new Promise((resolve) => {
    try {
      const fp = String(filePath || '');
      if (!fp) return resolve(null);
      const ss = Math.max(0, Number(ssSeconds) || 0);
      const args = [
        '-hide_banner',
        '-loglevel', 'error',
        '-ss', String(ss),
        '-i', fp,
        '-frames:v', '1',
        '-an',
        '-vf', 'scale=16:16:flags=bilinear,format=gray',
        '-f', 'rawvideo',
        'pipe:1'];

      const proc = spawn(FFMPEG, args);
      const chunks = [];
      let bytes = 0;
      let done = false;

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try { proc.kill('SIGKILL'); } catch (e) { }
        resolve(null);
      }, 7000);

      proc.stdout.on('data', (d) => {
        chunks.push(d);
        bytes += d.length;
        if (bytes >= 16 * 16) {
          try { proc.kill('SIGKILL'); } catch (e) { }
        }
      });

      proc.on('close', () => {
        if (done) return;
        done = true;
        try { clearTimeout(timer); } catch (e) { }
        const buf = Buffer.concat(chunks);
        if (!buf || buf.length < 16 * 16) return resolve(null);
        let sum = 0;
        let min = 255;
        let max = 0;
        for (let i = 0; i < 16 * 16; i++) {
          const v = buf[i];
          sum += v;
          if (v < min) min = v;
          if (v > max) max = v;
        }
        return resolve({ avg: sum / (16 * 16), min, max, n: 16 * 16 });
      });

      proc.on('error', () => {
        if (done) return;
        done = true;
        try { clearTimeout(timer); } catch (e) { }
        resolve(null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

async function diagnoseRecordingVideo(filePath) {
  const fp = String(filePath || '');
  if (!fp) return { ok: false, reason: 'no file' };
  if (!fs.existsSync(fp)) return { ok: false, exists: false };
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(fp).size || 0; } catch (e) { sizeBytes = 0; }
  let durationSec = null;
  try { durationSec = await probeVideoDurationSeconds(fp); } catch (e) { durationSec = null; }
  const dims = await probeVideoSize(fp);
  const s1 = await probeFrameGrayStats(fp, 0.7);
  const s2 = await probeFrameGrayStats(fp, Number.isFinite(durationSec) && durationSec > 6 ? 3 : 0.7);
  const blackLikely = !!(
    (Number.isFinite(durationSec) ? durationSec > 1 : true) && (
      s1 && s1.max <= 8 && s1.avg <= 4 || s2 && s2.max <= 8 && s2.avg <= 4));

  return {
    ok: true,
    exists: true,
    size_bytes: sizeBytes,
    duration_sec: durationSec,
    dimensions: dims,
    frame_gray_0: s1,
    frame_gray_1: s2,
    black_likely: blackLikely
  };
}

async function runRecordingDiagnosticsToLog(filePath, logFile) {
  const diag = await diagnoseRecordingVideo(filePath);
  try {
    const lf = String(logFile || '').trim();
    if (lf) {
      fs.appendFileSync(lf, `\n[WEBDL] RECORDING DIAG: ${JSON.stringify(diag)}\n`);
      if (diag && diag.black_likely) {
        fs.appendFileSync(lf, `[WEBDL] HINT: video is waarschijnlijk zwart. Check macOS Screen Recording permissie voor Terminal/Node, of probeer WEBDL_RECORDING_INPUT_PIXEL_FORMAT=0rgb / nv12 en WEBDL_VIDEO_DEVICE handmatig via /avfoundation-devices.\n`);
      }
    }
  } catch (e) { }
  try {
    if (diag && diag.black_likely) console.warn('Recording diagnostic: black video likely', { file: String(filePath || '') });
  } catch (e) { }
  return diag;
}

function transcodeToFinalCutMov(inputPath, outputPath, downloadId = null) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a?',
      '-c:v', FINALCUT_VIDEO_CODEC,
      '-pix_fmt', 'yuv420p'];

    if (POSTPROCESS_THREADS) {
      args.splice(args.indexOf('-i') + 2, 0, '-threads', POSTPROCESS_THREADS);
    }

    if (FINALCUT_VIDEO_CODEC === 'libx264') {
      args.push('-preset', FINALCUT_X264_PRESET, '-crf', FINALCUT_X264_CRF);
    }

    args.push(
      '-c:a', 'aac',
      '-b:a', FINALCUT_AUDIO_BITRATE,
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      outputPath
    );

    const proc = spawnNice(FFMPEG, args);
    if (Number.isFinite(Number(downloadId)) && Number(downloadId) > 0) {
      try { activeProcesses.set(downloadId, proc); } catch (e) { }
    }
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (Number.isFinite(Number(downloadId)) && Number(downloadId) > 0) {
        try { activeProcesses.delete(downloadId); } catch (e) { }
      }
      if (code === 0) return resolve();
      reject(new Error(stderr || `ffmpeg exit code ${code}`));
    });
    proc.on('error', (err) => {
      if (Number.isFinite(Number(downloadId)) && Number(downloadId) > 0) {
        try { activeProcesses.delete(downloadId); } catch (e) { }
      }
      reject(err);
    });
  });
}

function detectPlatform(url) {
  const u = String(url || '');
  if (/youtube\.com|youtu\.be/i.test(u)) return 'youtube';
  if (/vimeo\.com/i.test(u)) return 'vimeo';
  if (/twitch\.tv/i.test(u)) return 'twitch';
  if (/dailymotion\.com/i.test(u)) return 'dailymotion';
  if (/facebook\.com|fb\.watch/i.test(u)) return 'facebook';
  if (/twitter\.com|x\.com/i.test(u)) return 'twitter';
  if (/instagram\.com/i.test(u)) return 'instagram';
  if (/reddit\.com|redd\.it/i.test(u)) return 'reddit';
  if (/footfetishforum\.com/i.test(u)) return 'footfetishforum';
  if (/onlyfans\.com/i.test(u)) return 'onlyfans';
  if (/rutube\.ru/i.test(u)) return 'rutube';
  if (/wikifeet\.com/i.test(u)) return 'wikifeet';
  if (/wikifeetx\.com/i.test(u)) return 'wikifeetx';
  if (/kinky\.nl/i.test(u)) return 'kinky';
  if (/aznudefeet\.com/i.test(u)) return 'aznudefeet';
  if (/amateurvoyeurforum\.com/i.test(u)) return 'amateurvoyeurforum';
  if (((/t\.me|telegram\.me/i.test(u)) || (/web\.telegram\.org/i.test(u) && /#-?\d+/.test(u))) && !/web\.telegram\.org.*#@/i.test(u)) return 'telegram';
  if (/patreon\.com/i.test(u)) return 'patreon';
  if (/tiktok\.com|tiktokv\.com/i.test(u)) return 'tiktok';
  if (/pornpics\.com/i.test(u)) return 'pornpics';
  if (/elitebabes\.com/i.test(u)) return 'elitebabes';
  if (/erome\.com/i.test(u)) return 'erome';

  try {
    const host = new URL(u).hostname.toLowerCase();
    const cleaned = host.
      replace(/^www\./, '').
      replace(/^m\./, '').
      replace(/^mobile\./, '');
    const parts = cleaned.split('.').filter(Boolean);
    if (parts.length === 0) return 'other';
    if (parts.length === 1) {
      const one = parts[0].replace(/[^a-z0-9_-]+/g, '').slice(0, 30);
      return one || 'other';
    }

    const tld = parts[parts.length - 1];
    const sld = parts[parts.length - 2];
    const secondLevelTlds = new Set(['co', 'com', 'net', 'org', 'gov', 'edu']);
    const base = tld.length === 2 && secondLevelTlds.has(sld) && parts.length >= 3 ?
      parts[parts.length - 3] :
      sld;
    const tag = String(base || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '').slice(0, 30);
    return tag || 'other';
  } catch (e) {
    return 'other';
  }
}

const KNOWN_PLATFORMS = new Set([
  'youtube',
  'vimeo',
  'twitch',
  'dailymotion',
  'facebook',
  'twitter',
  'instagram',
  'reddit',
  'footfetishforum',
  'onlyfans',
  'rutube',
  'wikifeet',
  'wikifeetx',
  'kinky',
  'aznudefeet',
  'amateurvoyeurforum',
  'telegram',
  'tiktok',
  'pornpics',
  'elitebabes',
  'erome',
  '4kdownloader',
  'other']
);

function normalizePlatform(platform, url) {
  const p = typeof platform === 'string' ? platform.trim().toLowerCase() : '';
  const detected = detectPlatform(url);
  if (!p || p === 'unknown' || p === 'other') return detected;
  if (KNOWN_PLATFORMS.has(p)) return p;
  if (/^[a-z0-9_-]{2,30}$/.test(p)) return p;
  return detected;
}

function getDownloadDirChannelOnly(platform, channel) {
  const safePlatform = sanitizeName(platform || 'other');
  const safeChannel = sanitizeName(channel || 'unknown');
  const dir = path.join(BASE_DIR, safePlatform, safeChannel);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function deriveChannelFromUrl(platform, url) {
  if (!url) return null;
  const u = String(url);

  if (platform === 'youtube') {
    return extractYoutubeChannel(u);
  }

  if (platform === 'footfetishforum') {
    const info = parseFootFetishForumThreadInfo(u);
    if (info && info.name) return info.name;
  }

  if (platform === 'amateurvoyeurforum') {
    const info = parseAmateurVoyeurForumUrlInfo(u);
    if (info && info.name) return info.name;
  }

  if (platform === 'reddit') {
    const m = u.match(/reddit\.com\/r\/([^\/\?#]+)/i);
    if (m) return `r_${m[1]}`;
    const um = u.match(/reddit\.com\/(?:user|u)\/([^\/\?#]+)/i);
    if (um) return `u_${um[1]}`;
  }

  if (platform === 'facebook') {
    const m = u.match(/facebook\.com\/([^\/\?#]+)/i);
    if (m) {
      const page = String(m[1] || '').trim();
      if (page && !['watch', 'reel', 'share', 'videos', 'photo', 'groups', 'stories', 'marketplace'].includes(page.toLowerCase())) {
        return page;
      }
    }
    if (/fb\.watch/i.test(u)) return 'fb_watch';
  }

  if (platform === 'instagram') {
    const m = u.match(/instagram\.com\/(stories\/)?([^\/\?#]+)/i);
    if (m) {
      const user = m[2];
      if (user && !['p', 'reel', 'tv', 'explore', 'accounts', 'stories'].includes(user.toLowerCase())) {
        return user;
      }
    }
  }


  if (platform === 'patreon') {
    const m = u.match(/patreon\.com\/([^\/\?#]+)/i);
    if (m && m[1] && m[1].toLowerCase() !== 'posts') return m[1];
  }

  if (platform === 'onlyfans') {
    const m = u.match(/onlyfans\.com\/([^\/\?#]+)/i);
    if (m) {
      const user = m[1];
      if (user && !['posts', 'my', 'home', 'notifications', 'messages', 'bookmarks', 'lists', 'subscriptions', 'settings'].includes(user.toLowerCase())) {
        return user;
      }
    }
  }

  if (platform === 'wikifeet') {
    const m = u.match(/wikifeet\.com\/([^\/\?#]+)/i);
    if (m) return m[1];
  }

  if (platform === 'wikifeetx') {
    const m = u.match(/wikifeetx\.com\/([^\/\?#]+)/i);
    if (m) return m[1];
  }

  if (platform === 'kinky') {
    // /advertenties/1145607-palmy -> palmy
    const m = u.match(/advertenties\/\d+-([\w][\w-]*)/i);
    if (m) return m[1];
    const m2 = u.match(/kinky\.nl\/([^\/\?#]+)/i);
    if (m2) return m2[1];
  }

  if (platform === 'aznudefeet') {
    const m = u.match(/aznudefeet\.com\/view\/[^\/]+\/[^\/]+\/\d+\/([^\/\?#.]+)\.html/i);
    if (m) return m[1];
    const m2 = u.match(/aznudefeet\.com\/([^\/\?#]+)/i);
    if (m2) return m2[1];
  }

  if (platform === 'telegram') {
    try {
      const parsed = new URL(u);
      const parts = String(parsed.pathname || '').split('/').filter(Boolean);
      if (!parts.length) return 'telegram';
      if (parts[0] === 'c' && parts[1]) return `chat_${parts[1]}`;
      if (parts[0].startsWith('+')) return parts[0].slice(1) || 'telegram';
      return parts[0] || 'telegram';
    } catch (e) { }
  }

  if (platform === 'tiktok') {
    const m = u.match(/tiktok\.com\/@([^\/\?#]+)/i);
    if (m) return `@${m[1]}`;
  }

  if (platform === 'chaturbate') {
    const m = u.match(/chaturbate\.com\/([^\/\?#]+)/i);
    if (m) return m[1];
  }

  if (platform === 'pornpics') {
    // URL like: pornpics.com/galleries/masturbating-teen-evelina-darling-takes-selfie-94245654/
    const m = u.match(/pornpics\.com\/galleries\/([^\/?#]+)/i);
    if (m) {
      let slug = String(m[1] || '');
      // Remove trailing gallery ID (digits at the end after last hyphen)
      slug = slug.replace(/-\d{6,}$/, '');
      // Convert slug to readable name
      let name = slug.replace(/[-_]+/g, ' ').trim();
      name = name.split(/\s+/g).filter(Boolean).map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
      if (name) return name;
    }
    // Model page: pornpics.com/pornstars/evelina-darling/
    const m2 = u.match(/pornpics\.com\/pornstars\/([^\/?#]+)/i);
    if (m2) {
      let name = String(m2[1] || '').replace(/[-_]+/g, ' ').trim();
      name = name.split(/\s+/g).filter(Boolean).map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
      if (name) return name;
    }
    // Channel page: pornpics.com/channels/zishy/
    const m3 = u.match(/pornpics\.com\/channels\/([^\/?#]+)/i);
    if (m3) {
      let name = String(m3[1] || '').replace(/[-_]+/g, ' ').trim();
      name = name.split(/\s+/g).filter(Boolean).map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
      if (name) return name;
    }
    // Tag page: pornpics.com/tags/feet/
    const m4 = u.match(/pornpics\.com\/tags\/([^\/?#]+)/i);
    if (m4) {
      let name = String(m4[1] || '').replace(/[-_]+/g, ' ').trim();
      name = name.split(/\s+/g).filter(Boolean).map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
      if (name) return name;
    }
    // Category page: pornpics.com/sandals/ or pornpics.com/big-tits/
    const m5 = u.match(/pornpics\.com\/([a-z][a-z0-9-]+)\/?$/i);
    if (m5 && !/^(galleries|pornstars|channels|tags|search|random|explore)$/i.test(m5[1])) {
      let name = String(m5[1] || '').replace(/[-_]+/g, ' ').trim();
      name = name.split(/\s+/g).filter(Boolean).map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
      if (name) return name;
    }
  }

  if (platform === 'elitebabes') {
    // Model page: elitebabes.com/model/evita-lima/
    const mm = u.match(/elitebabes\.com\/model\/([^\/?#]+)/i);
    if (mm) {
      let name = String(mm[1] || '').replace(/[-_]+/g, ' ').trim();
      name = name.split(/\s+/g).filter(Boolean).map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
      if (name) return name;
    }
    // CDN URL: cdn.elitebabes.com/content/170601/evita-lima-bares-...jpg
    // Gallery page: elitebabes.com/evita-lima-bares-her-..../
    // Can't reliably extract model name from CDN/gallery URLs
  }

  if (platform === 'zishy') {
    // Album: zishy.com/albums/2681-jupiter-stassy-nyam-nyam-vid
    const m = u.match(/zishy\.com\/albums\/\d+-([a-z]+-[a-z]+)/i);
    if (m) {
      let name = String(m[1] || '').replace(/[-_]+/g, ' ').trim();
      name = name.split(/\s+/g).filter(Boolean).map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
      if (name) return name;
    }
  }

  if (platform === 'twitter') {
    // x.com/@username/status/123 or twitter.com/username/status/123 or x.com/username
    const m = u.match(/(?:twitter\.com|x\.com)\/([^\/\?#]+)/i);
    if (m && m[1] && !['i', 'search', 'explore', 'home', 'hashtag', 'settings'].includes(m[1].toLowerCase())) {
      return '@' + m[1].replace(/^@/, '');
    }
  }

  return null;
}

function getDownloadDir(platform, channel, title) {
  const safePlatform = sanitizeName(platform || 'other');
  const safeChannel = sanitizeName(channel || 'unknown');
  const safeTitle = sanitizeName(title || 'untitled');
  const dir = String(platform || '').toLowerCase() === 'footfetishforum' && safeChannel && safeTitle && safeChannel === safeTitle ?
    path.join(BASE_DIR, safePlatform, safeChannel) :
    path.join(BASE_DIR, safePlatform, safeChannel, safeTitle);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function dirHasAnyMediaFiles(rootDir) {
  try {
    if (!rootDir || !fs.existsSync(rootDir)) return false;
    const stack = [rootDir];
    while (stack.length > 0) {
      const cur = stack.pop();
      const entries = fs.readdirSync(cur, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent || !ent.name) continue;
        if (ent.name.startsWith('.')) continue;
        if (ent.isFile()) {
          if (ent.name === '.DS_Store') continue;
          return true;
        }
        if (ent.isDirectory()) stack.push(path.join(cur, ent.name));
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

function normalizeInstagramTarget(url, channelHint) {
  try {
    const raw = String(url || '').trim();
    if (!raw) return null;
    const parsed = new URL(raw);
    const host = String(parsed.hostname || '').toLowerCase();
    if (!host.includes('instagram.com')) return null;

    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && /^(p|reel|tv)$/i.test(parts[0])) {
      const shortcode = String(parts[1] || '').trim();
      if (shortcode) return shortcode;
    }

    if (parts.length >= 1) {
      const user = String(parts[0] || '').trim();
      if (user && !['p', 'reel', 'tv', 'explore', 'accounts', 'stories'].includes(user.toLowerCase())) {
        return user;
      }
    }

    if (channelHint && channelHint !== 'unknown') return String(channelHint).trim();
    return raw;
  } catch (e) {
    return channelHint && channelHint !== 'unknown' ? String(channelHint).trim() : String(url || '').trim();
  }
}

function fetchMetadata(url) {
  return new Promise((resolve, reject) => {
    const cookieArgs = getYtDlpCookieArgs('metadata');
    const args = [
      ...cookieArgs,
      '--dump-json',
      '--no-download',
      String(url || '')];

    const proc = spawnNice(YT_DLP, args);
    let stdoutAll = '';
    let stderrAll = '';

    proc.stdout.on('data', (d) => { stdoutAll += d.toString(); });
    proc.stderr.on('data', (d) => { stderrAll += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(String(stderrAll || '').trim() || `yt-dlp metadata exit code: ${code}`));
      }
      try {
        const meta = JSON.parse(stdoutAll);
        resolve({
          title: meta.title || 'untitled',
          channel: meta.uploader || meta.channel || 'unknown',
          description: (meta.description || '').substring(0, 500),
          duration: meta.duration_string || `${Math.floor((meta.duration || 0) / 60)}:${String((meta.duration || 0) % 60).padStart(2, '0')}`,
          durationSeconds: Number.isFinite(meta.duration) ? meta.duration : 0,
          thumbnail: meta.thumbnail || '',
          format: meta.format || '',
          fullMeta: meta
        });
      } catch (e) {
        reject(e);
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

function fetchMetadataWithTimeout(url, timeoutMs = 20000) {
  const opt = arguments.length >= 3 && arguments[2] && typeof arguments[2] === 'object' ? arguments[2] : {};
  const noCheckCertificates = opt.noCheckCertificates === true;
  const allowRetryNoCheckCertificates = opt.allowRetryNoCheckCertificates !== false;
  return new Promise((resolve, reject) => {
    const cookieArgs = getYtDlpCookieArgs('metadata');
    const args = [
      ...cookieArgs,
      ...(noCheckCertificates ? ['--no-check-certificates'] : []),
      '--dump-json',
      '--no-download',
      String(url || '')];

    const proc = spawnNice(YT_DLP, args);
    let stdoutAll = '';
    let stderrAll = '';
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { proc.kill('SIGTERM'); } catch (e) { }
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) { } }, 2500);
      reject(new Error(`yt-dlp metadata timeout after ${timeoutMs}ms`));
    }, Math.max(1000, Number(timeoutMs) || 20000));

    proc.stdout.on('data', (d) => { stdoutAll += d.toString(); });
    proc.stderr.on('data', (d) => { stderrAll += d.toString(); });

    const finish = (fn) => {
      if (done) return;
      done = true;
      try { clearTimeout(timer); } catch (e) { }
      fn();
    };

    proc.on('close', (code) => finish(() => {
      if (code !== 0) {
        const errMsg = String(stderrAll || '').trim() || `yt-dlp metadata exit code: ${code}`;
        const certFailed = /CERTIFICATE_VERIFY_FAILED|certificate\s+verify\s+failed/i.test(errMsg);
        if (!noCheckCertificates && allowRetryNoCheckCertificates && certFailed) {
          return fetchMetadataWithTimeout(url, timeoutMs, { ...opt, noCheckCertificates: true, allowRetryNoCheckCertificates: false }).
            then(resolve).
            catch(reject);
        }
        return reject(new Error(errMsg));
      }
      try {
        const meta = JSON.parse(stdoutAll);
        resolve({
          title: meta.title || 'untitled',
          channel: meta.uploader || meta.channel || 'unknown',
          description: (meta.description || '').substring(0, 500),
          duration: meta.duration_string || `${Math.floor((meta.duration || 0) / 60)}:${String((meta.duration || 0) % 60).padStart(2, '0')}`,
          durationSeconds: Number.isFinite(meta.duration) ? meta.duration : 0,
          thumbnail: meta.thumbnail || '',
          format: meta.format || '',
          fullMeta: meta
        });
      } catch (e) {
        reject(e);
      }
    }));

    proc.on('error', (err) => finish(() => reject(err)));
  });
}

function extractYoutubeId(url) {
  if (!url) return null;
  const shortsMatch = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/i);
  if (shortsMatch) return shortsMatch[1];
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]+)/i);
  if (watchMatch) return watchMatch[1];
  const shortUrlMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/i);
  if (shortUrlMatch) return shortUrlMatch[1];
  return null;
}

function extractYoutubeChannel(url) {
  if (!url) return null;
  const match = url.match(/youtube\.com\/@([a-zA-Z0-9._-]+)/i);
  return match ? `@${match[1]}` : null;
}

function deriveTitleFromUrl(url) {
  const ytId = extractYoutubeId(url);
  if (ytId) return `video_${ytId}`;
  const fffInfo = parseFootFetishForumThreadInfo(url);
  if (fffInfo && fffInfo.name) return fffInfo.name;
  const avfInfo = parseAmateurVoyeurForumUrlInfo(url);
  if (avfInfo && avfInfo.name) return avfInfo.name;
  // Pornpics: derive clean title from gallery slug
  if (/pornpics\.com\/galleries\//i.test(url)) {
    const m = url.match(/pornpics\.com\/galleries\/([^\/\?#]+)/i);
    if (m) {
      let slug = String(m[1] || '').replace(/-\d{6,}$/, '');
      let name = slug.replace(/[-_]+/g, ' ').trim();
      name = name.split(/\s+/g).filter(Boolean).map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
      if (name) return name;
    }
  }
  if (/pornpics\.com\/pornstars\//i.test(url)) {
    const m = url.match(/pornpics\.com\/pornstars\/([^\/\?#]+)/i);
    if (m) {
      let name = String(m[1] || '').replace(/[-_]+/g, ' ').trim();
      name = name.split(/\s+/g).filter(Boolean).map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
      if (name) return name;
    }
  }
  if (!url) return 'untitled';
  return sanitizeName(url).slice(0, 60) || 'untitled';
}

function isFootfetishforumThreadUrl(input) {
  try {
    const u = new URL(String(input || ''));
    const host = String(u.hostname || '').toLowerCase();
    if (!(host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com'))) return false;
    return /\/threads\/[^\/\?#]*\.(\d+)(?:\/|\?|#|$)/i.test(String(u.pathname || '') + String(u.search || '') + String(u.hash || ''));
  } catch (e) {
    return false;
  }
}

function isAznudefeetViewUrl(input) {
  try {
    const u = new URL(String(input || ''));
    const host = String(u.hostname || '').toLowerCase();
    if (!(host === 'www.aznudefeet.com' || host === 'aznudefeet.com' || host.endsWith('.aznudefeet.com'))) return false;
    return /\/view\/[^\/]+\/[^\/]+\/\d+\/[^\/\?#]+\.html/i.test(String(u.pathname || ''));
  } catch (e) {
    return false;
  }
}

function isTelegramInviteUrl(input) {
  try {
    const u = new URL(String(input || ''));
    const host = String(u.hostname || '').toLowerCase();
    if (!(host === 't.me' || host === 'telegram.me' || host.endsWith('.t.me') || host.endsWith('.telegram.me'))) return false;
    const parts = String(u.pathname || '').split('/').filter(Boolean);
    if (!parts.length) return false;
    if (parts[0].startsWith('+')) return true;
    if (String(parts[0]).toLowerCase() === 'joinchat') return true;
    return false;
  } catch (e) {
    return false;
  }
}

async function resolveMetadata(url, metadata = {}) {
  const resolved = { ...metadata };
  if (url && !resolved.url) resolved.url = url;
  const resolvedUrl = resolved.url || url || '';
  resolved.platform = normalizePlatform(resolved.platform, resolvedUrl);

  const needsFetch = resolvedUrl && (
    !resolved.title || resolved.title === 'untitled' ||
    !resolved.channel || resolved.channel === 'unknown');


  if (needsFetch) {
    try {
      const meta = await fetchMetadataWithTimeout(resolvedUrl, 15000);
      resolved.title = meta.title || resolved.title;
      resolved.channel = meta.channel || resolved.channel;
      resolved.description = meta.description || resolved.description;
      resolved.thumbnail = meta.thumbnail || resolved.thumbnail;
    } catch (e) {

      // ignore, fallback below
    }
  }

  if (!resolved.channel || resolved.channel === 'unknown') {
    resolved.channel = extractYoutubeChannel(resolvedUrl) || resolved.channel || 'unknown';
  }

  if (!resolved.title || resolved.title === 'untitled') {
    resolved.title = deriveTitleFromUrl(resolvedUrl);
  }

  return resolved;
}

// ========================
// ENDPOINTS
// ========================

// Health (lichte probe voor addon/background)
expressApp.get('/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({
    success: true,
    status: 'running',
    serverTime: new Date().toISOString()
  });
});

// Status
expressApp.get('/status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const runtimeActive = await getRuntimeActiveDownloadRows();
  const activeProcIds = new Set(Array.from(activeProcesses.keys()));
  const startingOnlyIds = Array.from(startingJobs).filter((id) => !activeProcIds.has(id));
  const heavyLimit = Math.max(0, HEAVY_DOWNLOAD_CONCURRENCY);
  const lightLimit = Math.max(0, LIGHT_DOWNLOAD_CONCURRENCY);
  const ytLimit = Math.max(0, runtimeYoutubeConfig.concurrency || 0);
  const heavyActive = activeLaneCount('heavy');
  const lightActive = activeLaneCount('light');
  let dbActiveCount = null;
  let dbActiveByStatus = null;
  let dbInProgressCount = null;
  let dbStatusError = null;
  let dbCompletedCount = 0;
  let dbQueuedCount = null;
  let dbPendingCount = null;
  let dbDownloadingCount = null;
  let dbPostprocessingCount = null;
  try {
    const rows = await getActiveDownloads.all();
    dbActiveCount = Array.isArray(rows) ? rows.length : 0;
    const by = await getActiveDownloadStatusCounts.all();
    const m = {};
    for (const r of by || []) {
      try {
        const k = String(r && r.status ? r.status : '');
        if (!k) continue;
        m[k] = Number.isFinite(Number(r && r.n != null ? r.n : 0)) ? Number(r.n) : 0;
      } catch (e) { }
    }
    dbActiveByStatus = m;
    dbQueuedCount = (m && Number.isFinite(Number(m.queued))) ? Number(m.queued) : 0;
    dbPendingCount = (m && Number.isFinite(Number(m.pending))) ? Number(m.pending) : 0;
    dbDownloadingCount = (m && Number.isFinite(Number(m.downloading))) ? Number(m.downloading) : 0;
    dbPostprocessingCount = (m && Number.isFinite(Number(m.postprocessing))) ? Number(m.postprocessing) : 0;
    const ip = await getInProgressDownloadCount.get();
    dbInProgressCount = ip && Number.isFinite(Number(ip.n)) ? Number(ip.n) : 0;

    const cp = await db.prepare("SELECT COUNT(*) as c FROM downloads WHERE status = 'completed' AND url NOT LIKE 'recording:%'").get();
    dbCompletedCount = cp && Number.isFinite(Number(cp.c)) ? Number(cp.c) : 0;
  } catch (e) {
    dbStatusError = (e && e.message) ? e.message : String(e);
  }
  // Build active_items for the gallery's queue bar using real-time context
  const activeDownloadsList = [];
  try {
    for (const [id, ctx] of downloadActivityContextById.entries()) {
      const numId = Number(id);
      if (activeProcIds.has(id) || activeProcIds.has(numId) || startingJobs.has(id) || startingJobs.has(numId) || activePostprocessJobs.has(id) || activePostprocessJobs.has(numId)) {
        activeDownloadsList.push({ id: numId, ...ctx });
      }
    }
  } catch (e) { }

  // Pad with queued AND pending downloads if we have room (skip recordings)
  try {
    if (activeDownloadsList.length < 24 && (dbQueuedCount > 0 || dbPendingCount > 0)) {
      const qrows = await db.prepare("SELECT id, url, thumbnail, platform, channel, title, status FROM downloads WHERE status IN ('queued', 'pending') AND url NOT LIKE 'recording:%' ORDER BY CASE status WHEN 'queued' THEN 0 WHEN 'pending' THEN 1 END, created_at ASC LIMIT 100").all();
      const existingIds = new Set(activeDownloadsList.map(a => Number(a.id)));
      let heavyPad = 0, lightPad = 0;
      for (const qr of qrows || []) {
        if (heavyPad >= 12 && lightPad >= 12) break;
        if (!existingIds.has(Number(qr.id)) && !activeProcIds.has(qr.id) && !startingJobs.has(qr.id)) {
          const lane = detectLane(qr.platform, qr.url);
          if (lane === 'heavy' && heavyPad >= 12) continue;
          if (lane === 'light' && lightPad >= 12) continue;
          if (lane === 'heavy') heavyPad++; else lightPad++;

          activeDownloadsList.push({
            id: qr.id,
            progress: 0,
            status: qr.status || 'queued',
            url: qr.url || '',
            thumbnail: qr.thumbnail || '',
            platform: qr.platform,
            channel: qr.channel,
            title: qr.title,
            lane
          });
        }
      }
    }
  } catch (e) { }
  res.json({
    status: 'running',
    isRecording,
    activeRecordingUrls: Array.from(activeRecordings.keys()),
    activeDownloads: runtimeActive.length,
    active_items: activeDownloadsList,
    queuedDownloads: dbQueuedCount,
    pendingDownloads: dbPendingCount,
    totalActiveDownloads: dbActiveCount,
    orphaned_in_progress: (!!(dbInProgressCount && dbInProgressCount > runtimeActive.length) && !activeProcesses.size),
    runtime_active_downloads: runtimeActive.length,
    db_active_downloads: dbActiveCount,
    db_active_by_status: dbActiveByStatus,
    db_in_progress_downloads: dbInProgressCount,
    db_status_error: dbStatusError,
    thumbs: {
      missing: {
        total: thumbMissingTotal,
        unique: thumbMissingSeen ? thumbMissingSeen.size : null,
        logged: thumbMissingLogged ? thumbMissingLogged.size : null
      },
      gen: {
        concurrency: THUMB_GEN_CONCURRENCY,
        max_queue: THUMB_GEN_MAX_QUEUE,
        active: thumbGenActive,
        queued: thumbGenQueue ? thumbGenQueue.length : null,
        queued_unique: thumbGenQueued ? thumbGenQueued.size : null,
        inflight: thumbGenInflight ? thumbGenInflight.size : null,
        fail_unique: thumbGenFailOnce ? thumbGenFailOnce.size : null,
        schedule: {
          total: thumbGenScheduleTotal,
          enqueued: thumbGenScheduleEnqueued,
          denied: thumbGenScheduleDenied
        }
      }
    },
    queues: {
      heavy: { active: heavyActive, limit: heavyLimit, queued: queuedHeavy.length },
      light: { active: lightActive, limit: lightLimit, queued: queuedLight.length },
      batch: { active: activeLaneCount('batch'), limit: BATCH_DOWNLOAD_CONCURRENCY, queued: queuedBatch.length }
    },
    queue_ids: {
      heavy: queuedHeavy.slice(0, 80),
      light: queuedLight.slice(0, 80)
    },
    processes: {
      active: activeProcesses.size,
      starting: startingOnlyIds.length,
      active_ids: Array.from(activeProcIds.values()).slice(0, 80),
      starting_ids: startingOnlyIds.slice(0, 80)
    },
    recent_download_activity: recentDownloadActivity.slice(-80).reverse(),
    youtube: getYoutubeRuntimeConfig(),
    serverTime: new Date().toISOString(),
    totalSystemDownloads: dbActiveCount,
    queuedDownloads: dbQueuedCount,
    pendingDownloads: dbPendingCount,
    inProgressDownloads: dbInProgressCount,
    completedDownloads: dbCompletedCount,
    videoDevice: VIDEO_DEVICE,
    audioDevice: AUDIO_DEVICE
  });
});

expressApp.get('/api/settings/youtube', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    success: true,
    config: getYoutubeRuntimeConfig(),
    defaults: {
      concurrency: Number.isFinite(initialYoutubeConcurrency) ? Math.max(0, initialYoutubeConcurrency) : 1,
      spacingMs: Number.isFinite(initialYoutubeSpacing) ? Math.max(0, initialYoutubeSpacing) : 0,
      jitterMs: Number.isFinite(initialYoutubeJitter) ? Math.max(0, initialYoutubeJitter) : 0
    }
  });
});

expressApp.post('/api/settings/youtube', (req, res) => {
  const body = req && req.body ? req.body : {};
  const next = {
    concurrency: Number.isFinite(Number(body.concurrency)) ? Number(body.concurrency) : undefined,
    spacingMs: Number.isFinite(Number(body.spacingMs)) ? Number(body.spacingMs) : undefined,
    jitterMs: Number.isFinite(Number(body.jitterMs)) ? Number(body.jitterMs) : undefined
  };
  const updated = setYoutubeRuntimeConfig(next);
  res.json({ success: true, config: updated });
});

expressApp.post('/api/settings/youtube/reset', (req, res) => {
  const updated = resetYoutubeRuntimeConfig();
  res.json({ success: true, config: updated });
});

expressApp.get('/api/settings/lanes', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    success: true,
    heavy: HEAVY_DOWNLOAD_CONCURRENCY,
    light: LIGHT_DOWNLOAD_CONCURRENCY,
    active_heavy: activeLaneCount('heavy'),
    active_light: activeLaneCount('light'),
    queued_heavy: queuedHeavy.length,
    queued_light: queuedLight.length,
  });
});

expressApp.post('/api/settings/lanes', (req, res) => {
  const body = req && req.body ? req.body : {};
  if (Number.isFinite(Number(body.heavy))) HEAVY_DOWNLOAD_CONCURRENCY = Math.max(0, Math.floor(Number(body.heavy)));
  if (Number.isFinite(Number(body.light))) LIGHT_DOWNLOAD_CONCURRENCY = Math.max(0, Math.floor(Number(body.light)));
  runDownloadSchedulerSoon();
  console.log(`⚙️  Lane concurrency bijgewerkt: heavy=${HEAVY_DOWNLOAD_CONCURRENCY}, light=${LIGHT_DOWNLOAD_CONCURRENCY}`);
  res.json({ success: true, heavy: HEAVY_DOWNLOAD_CONCURRENCY, light: LIGHT_DOWNLOAD_CONCURRENCY });
});

function parseSqliteDateMs(s) {
  try {
    const str = String(s || '').trim();
    if (!str) return null;
    // SQLite CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS" without timezone.
    // Treat it as *local time*; do not force UTC ("Z"), otherwise timestamps can appear to be in the future.
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const d = parseInt(m[3], 10);
      const h = parseInt(m[4], 10);
      const mi = parseInt(m[5], 10);
      const se = parseInt(m[6], 10);
      const dt = new Date(y, Math.max(0, mo - 1), d, h, mi, se);
      const ms = dt.getTime();
      return Number.isFinite(ms) ? ms : null;
    }

    const dt = new Date(str);
    const ms = dt.getTime();
    return Number.isFinite(ms) ? ms : null;
  } catch (e) {
    return null;
  }
}

function looksCompleteOnDisk(fpRaw) {
  try {
    const fp = path.resolve(String(fpRaw || '').trim());
    if (!fp) return { ok: false, reason: 'filepath leeg' };
    if (!safeIsInsideBaseDir(fp)) return { ok: false, reason: 'filepath buiten base dir' };
    if (!fs.existsSync(fp)) return { ok: false, reason: 'output ontbreekt op disk' };
    const st = fs.statSync(fp);

    if (st.isFile()) {
      const ext = String(path.extname(fp).toLowerCase() || '');
      if (ext === '.part' || ext === '.tmp') return { ok: false, reason: 'temp file' };
      if ((st.size || 0) < 64 * 1024) return { ok: false, reason: 'file te klein' };
      return { ok: true, reason: 'file bestaat op disk' };
    }

    if (st.isDirectory()) {
      const media = listMediaFilesInDir(fp, 80);
      if (media && media.length) return { ok: true, reason: 'media files gevonden in map' };
      return { ok: false, reason: 'map leeg (geen media files)' };
    }

    return { ok: false, reason: 'onbekend output type' };
  } catch (e) {
    return { ok: false, reason: 'disk check faalde' };
  }
}

async function computeStuckDownloadRepairReport({ minAgeMinutes = 30, max = 400, markError = false, debugLimit = 80, mode = 'in_progress' } = {}) {
  const now = Date.now();
  const minAgeMs = Math.max(0, Number(minAgeMinutes) || 0) * 60 * 1000;

  // Only treat *actually running* items as runtime-active.
  // queuedJobs are DB-derived and can contain many items; we still want to repair them if output exists.
  const runningIds = new Set();
  for (const id of activeProcesses.keys()) runningIds.add(id);
  for (const id of startingJobs) runningIds.add(id);

  const allRows = await getActiveDownloads.all();
  const wantInProgress = String(mode || '').toLowerCase() !== 'all';
  const rows = wantInProgress ?
    allRows.filter((r) => String(r && r.status ? r.status : '') === 'downloading' || String(r && r.status ? r.status : '') === 'postprocessing') :
    allRows;
  const dbActiveByStatus = { pending: 0, queued: 0, downloading: 0, postprocessing: 0 };
  for (const r of allRows) {
    const st = String(r && r.status ? r.status : '');
    if (st === 'pending' || st === 'queued' || st === 'downloading' || st === 'postprocessing') dbActiveByStatus[st] = (dbActiveByStatus[st] || 0) + 1;
  }
  const actions = [];
  const samples = [];
  const skipped = {
    running: 0,
    too_young: 0,
    no_filepath: 0,
    incomplete: 0
  };

  for (const row of rows) {
    const id = Number(row && row.id);
    if (!Number.isFinite(id)) continue;
    if (runningIds.has(id)) {
      skipped.running++;
      continue;
    }

    // Use created_at for age gating; updated_at can be touched by the scheduler when re-queuing.
    const createdMs = parseSqliteDateMs(row.created_at);
    const updatedMs = parseSqliteDateMs(row.updated_at);
    const ageRefMs = createdMs || updatedMs || null;
    if (minAgeMs > 0 && ageRefMs && now - ageRefMs < minAgeMs) {
      skipped.too_young++;
      continue;
    }

    const fpRaw = String(row.filepath || '').trim();
    if (!fpRaw) {
      skipped.no_filepath++;
      if (samples.length < debugLimit) samples.push({ id, status: String(row.status || ''), filepath: '', reason: 'filepath ontbreekt' });
      if (markError) actions.push({ id, from: String(row.status || ''), to: 'error', reason: 'stuck: filepath ontbreekt', filepath: '' });
      if (actions.length >= max) break;
      continue;
    }

    const probe = looksCompleteOnDisk(fpRaw);
    if (probe.ok) {
      actions.push({ id, from: String(row.status || ''), to: 'completed', reason: probe.reason, filepath: fpRaw });
    } else {
      skipped.incomplete++;
      if (samples.length < debugLimit) samples.push({ id, status: String(row.status || ''), filepath: fpRaw, reason: probe.reason });
      if (markError) actions.push({ id, from: String(row.status || ''), to: 'error', reason: `stuck: ${probe.reason}`, filepath: fpRaw });
    }

    if (actions.length >= max) break;
  }

  return {
    success: true,
    dry_run: true,
    stats: {
      db_active_downloads: allRows.length,
      db_active_by_status: dbActiveByStatus,
      scanned_rows: rows.length,
      mode: wantInProgress ? 'in_progress' : 'all',
      running_active_ids: runningIds.size,
      active_processes: activeProcesses.size,
      starting_jobs: startingJobs.size,
      queued_jobs: queuedJobs.size,
      heavy_queue: queuedHeavy.length,
      light_queue: queuedLight.length
    },
    skipped,
    count: actions.length,
    actions,
    sample_non_repaired: samples
  };
}

function computeStuckDownloadRepairs(opts = {}) {
  const r = computeStuckDownloadRepairReport(opts);
  return r.actions || [];
}

function cleanupSchedulerForId(id) {
  try {
    activeProcesses.delete(id);
    startingJobs.delete(id);
    cancelledJobs.delete(id);
    queuedJobs.delete(id);
    removeFromQueue(queuedHeavy, id);
    removeFromQueue(queuedLight, id);
    removeFromQueue(queuedBatch, id);
    removeFromQueue(queuedPostprocess, id);
    postprocessJobs.delete(id);
    activePostprocessJobs.delete(id);
    jobLane.delete(id);
  } catch (e) { }
}

expressApp.get('/api/repair/stuck-downloads', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const minAgeMinutes = parseInt(String(req.query.min_age_minutes || '30'), 10);
  const max = parseInt(String(req.query.max || '400'), 10);
  const markError = String(req.query.mark_error || '0') === '1';
  const mode = String(req.query.mode || 'in_progress');
  const report = computeStuckDownloadRepairReport({
    minAgeMinutes: Number.isFinite(minAgeMinutes) ? minAgeMinutes : 30,
    max: Number.isFinite(max) ? Math.max(1, Math.min(2000, max)) : 400,
    markError,
    mode
  });
  return res.json(report);
});

expressApp.post('/api/repair/stuck-downloads', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const body = req.body || {};
  const minAgeMinutes = parseInt(String(body.minAgeMinutes != null ? body.minAgeMinutes : body.min_age_minutes != null ? body.min_age_minutes : '30'), 10);
  const max = parseInt(String(body.max != null ? body.max : '400'), 10);
  const markError = !!body.markError || String(body.mark_error || '0') === '1';
  const mode = String(body.mode || 'in_progress');
  const apply = String(body.apply != null ? body.apply : '1') !== '0';

  const actions = computeStuckDownloadRepairs({
    minAgeMinutes: Number.isFinite(minAgeMinutes) ? minAgeMinutes : 30,
    max: Number.isFinite(max) ? Math.max(1, Math.min(2000, max)) : 400,
    markError,
    mode
  });

  if (!apply) return res.json({ success: true, dry_run: true, count: actions.length, actions });

  const applied = [];
  for (const a of actions) {
    try {
      if (a.to === 'completed') await updateDownloadStatus.run('completed', 100, null, a.id); else
        if (a.to === 'error') await updateDownloadStatus.run('error', 0, String(a.reason || 'stuck'), a.id);
      cleanupSchedulerForId(a.id);
      applied.push(a);
    } catch (e) { }
  }

  try { runDownloadSchedulerSoon(); } catch (e) { }
  return res.json({ success: true, dry_run: false, count: applied.length, applied });
});

expressApp.get('/repair', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.end(`<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WEBDL Repair</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#05070f;color:#d7e6ff;margin:0;padding:18px}
    .card{max-width:980px;margin:0 auto;background:#0b1020;border:1px solid #152347;border-radius:12px;padding:14px}
    h1{font-size:16px;margin:0 0 10px 0;color:#00d4ff}
    .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:10px 0}
    label{font-size:12px;color:#9aa7d1}
    input[type=number]{width:110px;background:#070a14;border:1px solid #22325c;color:#d7e6ff;border-radius:10px;padding:8px}
    input[type=checkbox]{transform:scale(1.1)}
    button{background:#0f1d3f;border:1px solid #27407a;color:#d7e6ff;border-radius:10px;padding:8px 10px;font-weight:700;cursor:pointer}
    button.primary{background:#0f3b3f;border-color:#1c7f86;color:#bffcff}
    button.danger{background:#3a1515;border-color:#7a2a2a;color:#ffd0d0}
    pre{background:#070a14;border:1px solid #22325c;border-radius:12px;padding:12px;overflow:auto;max-height:60vh;font-size:12px;line-height:1.35}
    .hint{font-size:12px;color:#9aa7d1;margin-top:8px}
  </style>
</head>
<body>
  <div class="card">
    <h1>Repair: stuck downloads (DB vs runtime)</h1>
    <div class="row">
      <label>Min age (min)
        <input id="minAge" type="number" min="0" max="100000" value="30" />
      </label>
      <label>Max actions
        <input id="max" type="number" min="1" max="2000" value="400" />
      </label>
      <label style="display:flex;align-items:center;gap:8px">
        <input id="markError" type="checkbox" />
        Mark error when output missing
      </label>
      <label style="display:flex;align-items:center;gap:8px">
        <input id="modeInProgress" type="checkbox" checked />
        Only downloading/postprocessing
      </label>
      <button id="btnDry">Dry-run</button>
      <button id="btnApply" class="danger">Apply</button>
    </div>
    <div class="hint">Tip: begin met Dry-run. Apply zet alleen downloads om die niet runtime-actief zijn en waar output op disk gevonden is (completed), of optioneel error.</div>
    <pre id="out">Klik Dry-run…</pre>
  </div>
  <script>
    const out = document.getElementById('out');
    const minAge = document.getElementById('minAge');
    const max = document.getElementById('max');
    const markError = document.getElementById('markError');
    const modeInProgress = document.getElementById('modeInProgress');
    const btnDry = document.getElementById('btnDry');
    const btnApply = document.getElementById('btnApply');

    function q() {
      const a = Math.max(0, Number(minAge.value) || 0);
      const m = Math.max(1, Math.min(2000, Number(max.value) || 400));
      const me = markError.checked ? 1 : 0;
      const mode = modeInProgress.checked ? 'in_progress' : 'all';
      return { a, m, me, mode };
    }

    async function dryRun() {
      const { a, m, me, mode } = q();
      out.textContent = 'laden…';
      const url = '/api/repair/stuck-downloads?min_age_minutes=' + encodeURIComponent(String(a))
        + '&max=' + encodeURIComponent(String(m))
        + '&mark_error=' + encodeURIComponent(String(me))
        + '&mode=' + encodeURIComponent(String(mode));
      const r = await fetch(url);
      const j = await r.json();
      out.textContent = JSON.stringify(j, null, 2);
    }

    async function apply() {
      const { a, m, me, mode } = q();
      if (!confirm('Apply repair? Dit verandert statuses in de DB.')) return;
      out.textContent = 'toepassen…';
      const r = await fetch('/api/repair/stuck-downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minAgeMinutes: a, max: m, markError: !!me, mode, apply: 1 })
      });
      const j = await r.json();
      out.textContent = JSON.stringify(j, null, 2);
    }

    btnDry.addEventListener('click', () => { dryRun().catch(e => { out.textContent = String(e && e.message ? e.message : e); }); });
    btnApply.addEventListener('click', () => { apply().catch(e => { out.textContent = String(e && e.message ? e.message : e); }); });
  </script>
</body>
</html>`);
});

expressApp.get('/queue', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.end(`<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WEBDL Queue</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#05070f;color:#d7e6ff;margin:0;padding:18px}
    .card{max-width:980px;margin:0 auto;background:#0b1020;border:1px solid #152347;border-radius:12px;padding:14px}
    h1{font-size:16px;margin:0 0 10px 0;color:#00d4ff}
    .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:10px 0}
    label{font-size:12px;color:#9aa7d1}
    select,input[type=number]{background:#070a14;border:1px solid #22325c;color:#d7e6ff;border-radius:10px;padding:8px}
    input[type=number]{width:130px}
    button{background:#0f1d3f;border:1px solid #27407a;color:#d7e6ff;border-radius:10px;padding:8px 10px;font-weight:700;cursor:pointer}
    button.primary{background:#0f3b3f;border-color:#1c7f86;color:#bffcff}
    pre{background:#070a14;border:1px solid #22325c;border-radius:12px;padding:12px;overflow:auto;max-height:60vh;font-size:12px;line-height:1.35}
    .hint{font-size:12px;color:#9aa7d1;margin-top:8px}
    a{color:#00d4ff}
  </style>
</head>
<body>
  <div class="card">
    <h1>Queue: DB → runtime scheduler</h1>
    <div class="row">
      <label>Mode
        <select id="mode">
          <option value="queued">queued + pending</option>
          <option value="active">downloading + postprocessing</option>
          <option value="all">all</option>
        </select>
      </label>
      <label>Max rows
        <input id="max" type="number" min="1" max="5000" value="500" />
      </label>
      <button id="btnStatus">Status</button>
      <button id="btnResume" class="primary">Resume</button>
      <a href="/repair" style="font-size:12px">Repair stuck…</a>
    </div>
    <div class="hint">Tip: start met mode=queued en max=500. Dit laadt alleen een batch in memory; scheduler start daarna automatisch.</div>
    <pre id="out">Klik Status…</pre>
  </div>
  <script>
    const out = document.getElementById('out');
    const elMode = document.getElementById('mode');
    const elMax = document.getElementById('max');
    const btnStatus = document.getElementById('btnStatus');
    const btnResume = document.getElementById('btnResume');

    async function loadStatus() {
      out.textContent = 'laden…';
      const r = await fetch('/status', { cache: 'no-store' });
      const j = await r.json();
      out.textContent = JSON.stringify(j, null, 2);
    }

    async function resume() {
      const mode = String(elMode.value || 'queued');
      const max = Math.max(1, Math.min(5000, Number(elMax.value) || 500));
      out.textContent = 'resumen…';
      const r = await fetch('/api/queue/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, max })
      });
      const j = await r.json();
      out.textContent = JSON.stringify(j, null, 2);
      setTimeout(() => { loadStatus().catch(() => {}); }, 700);
    }

    btnStatus.addEventListener('click', () => { loadStatus().catch(e => { out.textContent = String(e && e.message ? e.message : e); }); });
    btnResume.addEventListener('click', () => { resume().catch(e => { out.textContent = String(e && e.message ? e.message : e); }); });
    loadStatus().catch(() => {});
  </script>
</body>
</html>`);
});

let addonBuildInFlight = null;

function ensureFirefoxAddonBuilt(options = {}) {
  if (addonBuildInFlight) return addonBuildInFlight;

  addonBuildInFlight = new Promise((resolve, reject) => {
    try {
      const opt = options && typeof options === 'object' ? options : {};
      const force = opt.force === true;
      const manifestPath = path.join(ADDON_SOURCE_DIR, 'manifest.json');
      const toolbarPath = path.join(ADDON_SOURCE_DIR, 'content', 'debug-toolbar.js');
      const backgroundPath = path.join(ADDON_SOURCE_DIR, 'background', 'simple-background.js');
      const outPath = ADDON_PACKAGE_PATH;
      const buildTimeoutMs = Math.max(5000, parseInt(process.env.WEBDL_ADDON_BUILD_TIMEOUT_MS || '25000', 10) || 25000);

      if (!fs.existsSync(manifestPath)) {
        return reject(new Error(`Addon source ontbreekt: ${manifestPath}`));
      }

      const outStat = fs.existsSync(outPath) ? fs.statSync(outPath) : null;
      const outMtime = outStat ? outStat.mtimeMs : 0;
      // Scan ALL source files for newest mtime
      let newest = 0;
      const scanDir = (dir) => {
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { scanDir(full); } 
            else { try { newest = Math.max(newest, fs.statSync(full).mtimeMs); } catch (e) {} }
          }
        } catch (e) {}
      };
      scanDir(ADDON_SOURCE_DIR);

      if (!force && outStat && outMtime >= newest) return resolve();

      const tmpOut = path.join(os.tmpdir(), `webdl-addon-${Date.now()}-${Math.random().toString(36).slice(2)}.xpi`);
      try { fs.rmSync(tmpOut, { force: true }); } catch (e) { }

      const zipProc = spawn('/usr/bin/zip', ['-r', '-q', tmpOut, '.', '-x', '*.DS_Store', '__MACOSX/*'], {
        cwd: ADDON_SOURCE_DIR
      });
      const buildTimeout = setTimeout(() => {
        try { zipProc.kill('SIGKILL'); } catch (e) { }
      }, buildTimeoutMs);
      let stderr = '';
      zipProc.stderr.on('data', (d) => { stderr += d.toString(); });
      zipProc.on('error', (err) => reject(err));
      zipProc.on('close', (code) => {
        clearTimeout(buildTimeout);
        if (code !== 0) {
          try { fs.rmSync(tmpOut, { force: true }); } catch (e) { }
          return reject(new Error(stderr || `zip exit code ${code}`));
        }
        try {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.rmSync(outPath, { force: true });
          moveFileSyncWithFallback(tmpOut, outPath);
          try {
            if (path.resolve(LEGACY_ADDON_PACKAGE_PATH) !== path.resolve(outPath)) {
              fs.mkdirSync(path.dirname(LEGACY_ADDON_PACKAGE_PATH), { recursive: true });
              fs.copyFileSync(outPath, LEGACY_ADDON_PACKAGE_PATH);
            }
          } catch (eMirror) {
            console.warn(`⚠️ Addon legacy mirror mislukt: ${eMirror && eMirror.message ? eMirror.message : eMirror}`);
          }
          resolve();
        } catch (e) {
          try { fs.rmSync(tmpOut, { force: true }); } catch (e2) { }
          reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  }).finally(() => {
    addonBuildInFlight = null;
  });

  return addonBuildInFlight;
}

async function ensureFirefoxAddonUpToDate() {
  const state = getAddonBuildState();
  const needsRebuild = !state.packageExists || state.packageMtimeMs < state.sourceNewestMtimeMs;
  if (!needsRebuild) return { needsRebuild: false, state };
  await ensureFirefoxAddonBuilt({ force: false });
  return { needsRebuild: true, state: getAddonBuildState() };
}

// Download de (laatste) Firefox addon package
function getPreferredAddonPackagePath() {
  if (fs.existsSync(ADDON_PACKAGE_PATH)) return ADDON_PACKAGE_PATH;
  if (fs.existsSync(LEGACY_ADDON_PACKAGE_PATH)) return LEGACY_ADDON_PACKAGE_PATH;
  return ADDON_PACKAGE_PATH;
}

function sendAddonPackageResponse(res, packagePath) {
  const resolved = path.resolve(packagePath || getPreferredAddonPackagePath());
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/x-xpinstall');
  res.setHeader('Content-Disposition', 'attachment; filename="firefox-debug-controller.xpi"');
  return res.sendFile(resolved);
}

expressApp.get('/addon/firefox-debug-controller.xpi', async (req, res) => {
  try {
    await ensureFirefoxAddonUpToDate();
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
  if (!fs.existsSync(getPreferredAddonPackagePath())) {
    return res.status(404).json({ success: false, error: 'Addon package niet gevonden', path: ADDON_PACKAGE_PATH, legacyPath: LEGACY_ADDON_PACKAGE_PATH });
  }

  return sendAddonPackageResponse(res, getPreferredAddonPackagePath());
});

expressApp.get('/addon', (req, res) => {
  res.redirect('/addon/direct/firefox-debug-controller.xpi');
});

expressApp.get('/addon/direct', async (req, res) => {
  try {
    await ensureFirefoxAddonUpToDate();
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, path: ADDON_PACKAGE_PATH });
  }
  const servePath = getPreferredAddonPackagePath();
  if (!fs.existsSync(servePath)) {
    return res.status(404).json({ success: false, error: 'Addon package niet gevonden', path: ADDON_PACKAGE_PATH, legacyPath: LEGACY_ADDON_PACKAGE_PATH });
  }
  return sendAddonPackageResponse(res, servePath);
});

expressApp.get('/addon/direct/firefox-debug-controller.xpi', async (req, res) => {
  try {
    await ensureFirefoxAddonUpToDate();
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, path: ADDON_PACKAGE_PATH });
  }
  const servePath = getPreferredAddonPackagePath();
  if (!fs.existsSync(servePath)) {
    return res.status(404).json({ success: false, error: 'Addon package niet gevonden', path: ADDON_PACKAGE_PATH, legacyPath: LEGACY_ADDON_PACKAGE_PATH });
  }
  return sendAddonPackageResponse(res, servePath);
});

expressApp.get('/addon/check', (req, res) => {
  const state = getAddonBuildState();
  const needsRebuild = !state.packageExists || state.packageMtimeMs < state.sourceNewestMtimeMs;
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    success: true,
    needsRebuild,
    sourceDir: state.sourceDir,
    sourceManifestVersion: state.sourceManifestVersion,
    sourceBuildMarker: state.sourceBuildMarker,
    sourceFileCount: state.sourceFileCount,
    sourceNewestFile: state.sourceNewestFile,
    sourceNewestIso: state.sourceNewestIso,
    packagePath: state.packagePath,
    packageExists: state.packageExists,
    packageSizeBytes: state.packageSizeBytes,
    packageMtimeIso: state.packageMtimeIso
  });
});

// Toon beschikbare avfoundation devices (video + audio)
expressApp.get('/avfoundation-devices', (req, res) => {
  (async () => {
    const devices = await getAvfoundationDeviceListCached(0);
    res.json({ success: true, devices, output: devices && devices.raw ? devices.raw : '' });
  })().catch((err) => {
    res.status(500).json({ success: false, error: err.message });
  });
});

// ========================
// SCREEN RECORDING (OBS-stijl)
// ========================
expressApp.post('/start-recording', async (req, res) => {
  try {
    const body = req.body || {};
    const meta = body && typeof body.metadata === 'object' && body.metadata ? body.metadata : {};
    console.log(`[INGRESS] POST /start-recording url=${String(meta.url || '').slice(0, 200)} platform=${String(meta.platform || '')} channel=${String(meta.channel || '')}`);
  } catch (e) { }

  const { metadata = {}, crop, lock } = req.body || {};
  const recId = String((metadata && metadata.url) || req.body.url || 'default_rec').trim();

  const force = req.body.force === true;

  if (activeRecordings.has(recId)) {
    if (force) {
      console.log(`[MULTI-REC] Force restart requested for ${recId}`);
      // Wait for previous to die if any
      const existing = activeRecordings.get(recId);
      if (existing && existing.recordingProcess) {
        try { existing.recordingProcess.kill('SIGINT'); } catch (e) { }
      }
      activeRecordings.delete(recId);
      broadcastRecordingState();
      await new Promise(r => setTimeout(r, 800));
    } else {
      console.log(`[MULTI-REC] URL already recording, prompting needsForce: ${recId}`);
      return res.json({ success: true, action: 'start-recording', needsForce: true, existingUrl: recId });
    }
  }
  let recordingProcess = null;
  let currentRecordingFile = null;
  let currentRecording = null;
  let currentRecordingMeta = null;

  let resolved = metadata;
  try {
    resolved = await resolveMetadata(metadata.url, metadata);
  } catch (e) {

    // fallback blijft metadata
  } const platform = resolved.platform || 'other';
  const channel = resolved.channel || 'unknown';
  const title = resolved.title || 'untitled';
  const dir = getDownloadDir(platform, channel, title);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeBase = sanitizeName(`${platform}__${channel}__${title}`).replace(/_+/g, '_');
  const baseName = (safeBase || 'recording').slice(0, 100);
  const filename = `recording_${baseName}_${timestamp}.mp4`;
  const filepath = path.join(dir, filename);
  const logFile = path.join(dir, filename.replace(/\.mp4$/, '.log'));
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const lockEnabled = lock === true || lock === 1 || lock === '1';

  const inputPixelFormatRaw = platform === 'chaturbate' ? CHB_RECORDING_INPUT_PIXEL_FORMAT || RECORDING_INPUT_PIXEL_FORMAT : RECORDING_INPUT_PIXEL_FORMAT;
  const inputPixelFormat = String(inputPixelFormatRaw || '').trim();
  const recordingVideoCodec = platform === 'chaturbate' ? CHB_RECORDING_VIDEO_CODEC || VIDEO_CODEC : VIDEO_CODEC;

  const wantsAudio = AUDIO_DEVICE !== 'none';
  let resolvedVideoDevice = String(VIDEO_DEVICE || '').trim();
  let resolvedAudioDevice = wantsAudio ? String(AUDIO_DEVICE || '').trim() : 'none';
  let resolvedVideoName = null;
  let resolvedAudioName = null;

  if (resolvedVideoDevice === 'auto' || resolvedAudioDevice === 'auto') {
    let devices = await getAvfoundationDeviceListCached(60 * 1000);
    if (resolvedVideoDevice === 'auto') {
      let picked = pickAvfoundationScreenVideoDevice(devices);
      if (!picked) {
        devices = await getAvfoundationDeviceListCached(0);
        picked = pickAvfoundationScreenVideoDevice(devices);
      }
      if (!picked) {
        const raw = devices && devices.raw ? String(devices.raw) : '';
        const snippet = raw.length > 1200 ? raw.slice(0, 1200) + '…' : raw;
        return res.status(500).json({
          success: false,
          error: 'Geen avfoundation screen device gevonden. Check Screen Recording permissies.',
          devices,
          output: snippet,
          hint: 'Ga naar macOS Instellingen → Privacy en beveiliging → Schermopname en zet Terminal/iTerm aan. Sluit Terminal volledig en start opnieuw. Je kan ook /avfoundation-devices openen voor debug output. NB: ffmpeg -list_devices eindigt vaak met "Input/output error"; dat is normaal en betekent niet per se dat permissions fout zijn.'
        });
      }
      resolvedVideoDevice = String(picked.index);
      resolvedVideoName = picked.name;
    }
    if (wantsAudio && resolvedAudioDevice === 'auto') {
      const picked = pickAvfoundationDefaultAudioDevice(devices);
      if (picked) {
        resolvedAudioDevice = String(picked.index);
        resolvedAudioName = picked.name;
      } else {
        resolvedAudioDevice = 'none';
      }
    }
  }

  const hasAudio = resolvedAudioDevice !== 'none';

  const inputDevice = `${resolvedVideoDevice}:${hasAudio ? resolvedAudioDevice : 'none'}`;
  const args = [
    '-fflags', '+genpts',
    '-thread_queue_size', FFMPEG_THREAD_QUEUE_SIZE,
    '-rtbufsize', FFMPEG_RTBUFSIZE,
    '-probesize', FFMPEG_PROBESIZE,
    '-analyzeduration', FFMPEG_ANALYZEDURATION,
    '-f', 'avfoundation',
    '-framerate', RECORDING_FPS,
    '-capture_cursor', '0',
    '-drop_late_frames', '0',
    '-i', inputDevice];


  const effectivePixelFormat = (inputPixelFormat && inputPixelFormat.toLowerCase() !== 'auto') ? inputPixelFormat : 'nv12';
  args.splice(args.indexOf('-capture_cursor'), 0, '-pixel_format', effectivePixelFormat);

  const cropOk = !!(crop && Number.isFinite(crop.x) && Number.isFinite(crop.y) && Number.isFinite(crop.width) && Number.isFinite(crop.height));
  const lockMode = lockEnabled && cropOk;

  let recordingFilePath = filepath;
  let finalFilePath = filepath;
  let rawFilePath = filepath;
  let lockCropWidth = null;
  let lockCropHeight = null;

  if (lockMode) {
    rawFilePath = filepath.replace(/\.mp4$/, '_raw.mp4');
    recordingFilePath = rawFilePath;
    finalFilePath = filepath;
    lockCropWidth = Math.max(2, Math.floor(crop.width / 2) * 2);
    lockCropHeight = Math.max(2, Math.floor(crop.height / 2) * 2);
    currentRecording = {
      lock: true,
      startTimeMs: Date.now(),
      rawFilePath,
      finalFilePath,
      cropWidth: lockCropWidth,
      cropHeight: lockCropHeight,
      updates: [{ t: 0, x: crop.x, y: crop.y }],
      logFile
    };
  } else {
    currentRecording = null;
  }

  currentRecordingMeta = {
    recordingUrl: `recording:${timestamp}`,
    pageUrl: String(resolved.url || metadata.url || '').trim(),
    platform,
    channel,
    title,
    dir,
    logFile,
    lock: lockMode
  };

  if (!lockMode && cropOk) {
    const cropWidth = Math.max(2, Math.floor(crop.width / 2) * 2);
    const cropHeight = Math.max(2, Math.floor(crop.height / 2) * 2);
    const cropX = Math.max(0, Math.floor(crop.x));
    const cropY = Math.max(0, Math.floor(crop.y));
    args.push('-filter_complex', `[0:v]crop=${cropWidth}:${cropHeight}:${cropX}:${cropY}[v]`);
    args.push('-map', '[v]');
  } else {
    args.push('-map', '0:v:0');
  }

  if (hasAudio) {
    args.push('-map', '0:a:0');
    args.push('-af', 'aresample=async=1000:min_hard_comp=0.100:first_pts=0,asetpts=N/SR/TB');
    args.push('-ar', '48000', '-ac', '2');
    args.push('-c:a', RECORDING_AUDIO_CODEC, '-b:a', AUDIO_BITRATE);
  }

  if (RECORDING_FPS_MODE === 'cfr') {
    args.push('-fps_mode', 'cfr', '-r', RECORDING_FPS);
  } else {
    args.push('-fps_mode', 'passthrough');
  }

  if (recordingVideoCodec === 'libx264') {
    const preset = platform === 'chaturbate' ? CHB_RECORDING_X264_PRESET || LIBX264_PRESET : LIBX264_PRESET;
    args.push('-c:v', 'libx264', '-preset', preset, '-crf', '20');
  } else {
    args.push('-c:v', recordingVideoCodec, '-b:v', VIDEO_BITRATE);
    if (recordingVideoCodec === 'h264_videotoolbox') {
      args.push('-realtime', '1', '-prio_speed', '1');
    }
  }

  const outputPixFmt = recordingVideoCodec === 'h264_videotoolbox' ? 'nv12' : 'yuv420p';

  args.push(
    '-pix_fmt', outputPixFmt,
    '-max_muxing_queue_size', FFMPEG_MAX_MUXING_QUEUE_SIZE,
    '-movflags', '+faststart',
    '-y',
    recordingFilePath
  );

  try {
    const cmd = ['ffmpeg', ...args].map((a) => JSON.stringify(a)).join(' ');
    logStream.write(`[WEBDL] CMD: ${cmd}\n\n`);
    logStream.write(`[WEBDL] avfoundation input: ${inputDevice}${resolvedVideoName ? ` | video=${resolvedVideoName}` : ''}${resolvedAudioName ? ` | audio=${resolvedAudioName}` : ''}\n\n`);
  } catch (e) {

    // ignore
  }
  recordingProcess = spawn(FFMPEG, args);

  recordingProcess.stderr.on('data', (data) => {
    const msg = data.toString();
    logStream.write(msg);
    if (msg.includes('Error') || msg.includes('error')) console.error(`ffmpeg: ${msg}`);
  });

  recordingProcess.on('close', (code) => {
    console.log(`ffmpeg beëindigd (code ${code})`);
    try { logStream.end(); } catch (e) { }
    const active = activeRecordings.get(recId);
    if (active && active.recordingProcess === recordingProcess) {
      activeRecordings.delete(recId);
    }
    broadcastRecordingState();
  });

  recordingProcess.on('error', (err) => {
    console.error(`ffmpeg fout: ${err.message}`);
    try { logStream.end(); } catch (e) { }
    const active = activeRecordings.get(recId);
    if (active && active.recordingProcess === recordingProcess) {
      activeRecordings.delete(recId);
    }
    broadcastRecordingState();
  });

  currentRecordingFile = recordingFilePath;
  activeRecordings.set(recId, {
    recordingProcess,
    currentRecordingFile,
    currentRecording,
    currentRecordingMeta
  });
  broadcastRecordingState();
  console.log(`🔴 Opname gestart: ${recordingFilePath}`);
  res.json({ success: true, action: 'start-recording', file: filename, dir, meta: resolved, lock: lockMode, rawFile: lockMode ? path.basename(rawFilePath) : undefined, finalFile: path.basename(finalFilePath), input: { device: inputDevice, video_name: resolvedVideoName, audio_name: resolvedAudioName, pixel_format: inputPixelFormat } });
});

expressApp.post('/recording/crop-update', (req, res) => {
  const recId = String((req.body && req.body.url) || 'default_rec').trim();
  let currentRecording = activeRecordings.has(recId) ? activeRecordings.get(recId).currentRecording : null;
  if (!currentRecording && activeRecordings.size > 0) currentRecording = activeRecordings.values().next().value.currentRecording;

  if (!currentRecording || !currentRecording.lock) {
    return res.json({ success: false, error: 'Geen actieve lock-opname' });
  }

  const { crop } = req.body || {};
  if (!crop || !Number.isFinite(crop.x) || !Number.isFinite(crop.y)) {
    return res.status(400).json({ success: false, error: 'Ongeldige crop' });
  }

  const t = (Date.now() - currentRecording.startTimeMs) / 1000;
  currentRecording.updates.push({ t, x: crop.x, y: crop.y });
  res.json({ success: true });
});

expressApp.post('/stop-recording', (req, res) => {
  const reqId = String((req.body && (req.body.id || req.body.tabId || (req.body.metadata && req.body.metadata.url))) || '').trim();
  let session = null;
  let activeRecId = null;

  if (reqId && activeRecordings.has(reqId)) {
    session = activeRecordings.get(reqId);
    activeRecId = reqId;
  } else if (activeRecordings.size > 0) {
    activeRecId = activeRecordings.keys().next().value;
    session = activeRecordings.get(activeRecId);
  }

  if (!session) {
    return res.json({ success: false, error: 'Er loopt geen opname' });
  }

  const recordingProcess = session.recordingProcess;
  const currentRecordingFile = session.currentRecordingFile;
  const currentRecording = session.currentRecording;
  const currentRecordingMeta = session.currentRecordingMeta;

  const proc = recordingProcess;
  const lockJob = currentRecording && currentRecording.lock ? {
    rawFilePath: currentRecording.rawFilePath,
    finalFilePath: currentRecording.finalFilePath,
    cropWidth: currentRecording.cropWidth,
    cropHeight: currentRecording.cropHeight,
    updates: Array.isArray(currentRecording.updates) ? [...currentRecording.updates] : [],
    logFile: currentRecording.logFile,
    meta: currentRecordingMeta
  } : null;

  const file = lockJob ? lockJob.rawFilePath : currentRecordingFile;
  let responded = false;

  const finish = (success, error, extra = {}) => {
    if (responded) return;
    responded = true;
    res.json({ success, action: 'stop-recording', file, error, ...extra });
  };

  const cleanup = () => {
    console.log(`⬛ Opname gestopt: ${currentRecordingFile}`);
    activeRecordings.delete(activeRecId);
    broadcastRecordingState();
  };

  // Guard against duplicate stop handling
  if (session._stopHandled) {
    return res.json({ success: true, action: 'stop-recording', message: 'Stop in uitvoering' });
  }
  session._stopHandled = true;

  // Immediately try graceful stop: write 'q' to ffmpeg stdin
  try {
    if (recordingProcess && recordingProcess.stdin && !recordingProcess.stdin.destroyed) {
      recordingProcess.stdin.write('q');
      console.log('📝 Sent "q" to ffmpeg stdin');
    }
  } catch (e) { }

  // Fallback: SIGINT after 3 seconds if still running
  const softTimeout = setTimeout(() => {
    try {
      if (recordingProcess && !recordingProcess.killed) {
        recordingProcess.kill('SIGINT');
        console.log('⚠️ Sent SIGINT to ffmpeg (3s fallback)');
      }
    } catch (e) { }
  }, 3000);

  // Hard kill after 8 seconds
  const hardTimeout = setTimeout(() => {
    try {
      if (recordingProcess && !recordingProcess.killed) {
        console.warn('ffmpeg stop timeout, force kill');
        recordingProcess.kill('SIGKILL');
        cleanup();
        finish(false, 'Opname stop timeout');
      }
    } catch (e) { }
  }, 8000);

  proc.once('close', async () => {
    clearTimeout(softTimeout);
    clearTimeout(hardTimeout);
    cleanup();

    const meta = lockJob && lockJob.meta ? lockJob.meta : currentRecordingMeta;

    if (lockJob) {
      try {
        runRecordingDiagnosticsToLog(lockJob.rawFilePath, lockJob.logFile).catch(() => { });
      } catch (e) { }

      let dbId = null;
      try {
        const fp = String(lockJob.rawFilePath || '');
        const exists = fp && fs.existsSync(fp);
        const size = exists ? fs.statSync(fp).size : 0;
        const recordMeta = {
          webdl_kind: 'recording',
          webdl_recording: { lock: true, raw: lockJob.rawFilePath, final: lockJob.finalFilePath, log: lockJob.logFile, page_url: meta && meta.pageUrl ? meta.pageUrl : null }
        };
        const ins = await insertCompletedDownload.run(
          String(meta && meta.recordingUrl ? meta.recordingUrl : '').trim() || `recording:${Date.now()}`,
          String(meta && meta.platform ? meta.platform : 'other'),
          String(meta && meta.channel ? meta.channel : 'unknown'),
          String(meta && meta.title ? meta.title : 'recording'),
          path.basename(fp || lockJob.finalFilePath || ''),
          fp,
          size,
          'mp4',
          'queued',
          50,
          JSON.stringify(recordMeta)
        );
        dbId = ins && ins.lastInsertRowid ? ins.lastInsertRowid : null;
      } catch (e) { }

      finish(true, null, { processing: true, rawFile: lockJob.rawFilePath, finalFile: lockJob.finalFilePath, logFile: lockJob.logFile });
      enqueuePostprocessJob(dbId, {
        queuedStatus: 'queued',
        queuedProgress: 50,
        startStatus: 'postprocessing',
        startProgress: 50,
        run: async () => {
          const size = await probeVideoSize(lockJob.rawFilePath);
          let safeW = Math.max(2, Math.floor(lockJob.cropWidth / 2) * 2);
          let safeH = Math.max(2, Math.floor(lockJob.cropHeight / 2) * 2);

          if (size && Number.isFinite(size.width) && Number.isFinite(size.height)) {
            const maxW = Math.max(2, Math.floor(size.width / 2) * 2);
            const maxH = Math.max(2, Math.floor(size.height / 2) * 2);
            safeW = Math.min(safeW, maxW);
            safeH = Math.min(safeH, maxH);
          }

          let updates = lockJob.updates;
          if (size && Number.isFinite(size.width) && Number.isFinite(size.height)) {
            const maxX = Math.floor(Math.max(0, size.width - safeW) / 2) * 2;
            const maxY = Math.floor(Math.max(0, size.height - safeH) / 2) * 2;
            updates = updates.map((u) => {
              const t = Number.isFinite(u.t) ? Math.max(0, u.t) : 0;
              const x = Number.isFinite(u.x) ? Math.max(0, Math.min(maxX, Math.floor(u.x / 2) * 2)) : 0;
              const y = Number.isFinite(u.y) ? Math.max(0, Math.min(maxY, Math.floor(u.y / 2) * 2)) : 0;
              return { t, x, y };
            });
          }

          const cmdText = makeRecordingLockCmdFile(updates, safeW, safeH);
          try {
            fs.appendFileSync(lockJob.logFile, `\n[WEBDL] LOCK CROP updates: ${updates.length}\n`);
          } catch (e) { }

          await applyRecordingLockCrop({
            rawFilePath: lockJob.rawFilePath,
            finalFilePath: lockJob.finalFilePath,
            cmdText,
            cropWidth: safeW,
            cropHeight: safeH,
            downloadId: dbId
          });

          if (dbId) {
            try {
              const fp = String(lockJob.finalFilePath || '');
              const exists = fp && fs.existsSync(fp);
              const finalSize = exists ? fs.statSync(fp).size : 0;
              const recordMeta = {
                webdl_kind: 'recording',
                webdl_recording: { lock: true, raw: lockJob.rawFilePath, final: lockJob.finalFilePath, log: lockJob.logFile, page_url: meta && meta.pageUrl ? meta.pageUrl : null }
              };
              await updateDownload.run('completed', 100, fp, path.basename(fp), finalSize, 'mp4', JSON.stringify(recordMeta), null, dbId);
            } catch (e) { }
          }

          try {
            fs.appendFileSync(lockJob.logFile, `\n[WEBDL] LOCK CROP done: ${lockJob.finalFilePath}\n`);
          } catch (e) { }
        }
      }).catch(async (e) => {
        try {
          fs.appendFileSync(lockJob.logFile, `\n[WEBDL] LOCK CROP queue error: ${e.message}\n`);
        } catch (err) { }
      });
      return;
    }

    try {
      const fp = String(file || '');
      const exists = fp && fs.existsSync(fp);
      const size = exists ? fs.statSync(fp).size : 0;
      const recordMeta = {
        webdl_kind: 'recording',
        webdl_recording: { lock: false, file: fp, log: meta && meta.logFile ? meta.logFile : null, page_url: meta && meta.pageUrl ? meta.pageUrl : null }
      };
      await insertCompletedDownload.run(
        String(meta && meta.recordingUrl ? meta.recordingUrl : '').trim() || `recording:${Date.now()}`,
        String(meta && meta.platform ? meta.platform : 'other'),
        String(meta && meta.channel ? meta.channel : 'unknown'),
        String(meta && meta.title ? meta.title : 'recording'),
        path.basename(fp),
        fp,
        size,
        'mp4',
        'completed',
        100,
        JSON.stringify(recordMeta)
      );
    } catch (e) { }

    try {
      const lf = meta && meta.logFile ? meta.logFile : null;
      runRecordingDiagnosticsToLog(file, lf).catch(() => { });
      finish(true, null, { logFile: lf });
    } catch (e) {
      finish(true);
    }
  });

  proc.once('error', (err) => {
    clearTimeout(softTimeout);
    clearTimeout(hardTimeout);
    cleanup();
    finish(false, err.message);
  });

  try {
    proc.stdin.write('q\n');
    proc.stdin.end();
  } catch (e) {
    console.warn(`ffmpeg stdin stop faalde: ${e.message}`);
    proc.kill('SIGINT');
  }
});

// Download starten via yt-dlp
expressApp.post('/download', async (req, res) => {
  const { url, metadata, force, lane, priority } = req.body || {};
  try {
    console.log(`[INGRESS] POST /download url=${String(url || '').slice(0, 200)} page=${String(metadata && metadata.url || '').slice(0, 200)} force=${force === true ? '1' : '0'}`);
  } catch (e) { }
  if (!url) return res.status(400).json({ success: false, error: 'URL is vereist' });
  const forceDuplicates = force === true;

  const metaPlatform = metadata && typeof metadata.platform === 'string' ? metadata.platform : null;
  let effectiveUrl = String(url || '');
  // Fix broken redd.it preview slug URLs: redd.it/<title>-v0-<id>.ext → i.redd.it/<id>.ext
  try {
    const _ru = new URL(effectiveUrl);
    if (_ru.hostname === 'redd.it' || _ru.hostname.endsWith('.redd.it')) {
      const _rm = _ru.pathname.match(/-v0-([a-z0-9]+\.[a-z]{2,5})$/i);
      if (_rm) effectiveUrl = `https://i.redd.it/${_rm[1]}`;
    }
  } catch (e) {}
  const isOnlyFansProfileUrl = /onlyfans\.com\//i.test(effectiveUrl) && !/onlyfans\.com\/[^\/\?#]+\/posts\//i.test(effectiveUrl);

  const isProfileUrl = (u) => {
    if (u.includes('patreon.com/c/') || u.match(/patreon\.com\/.*\/posts/)) return true;
    if (u.includes('youtube.com/@') || u.includes('youtube.com/channel/') || u.includes('youtube.com/c/')) return true;
    if (u.includes('reddit.com/user/') || u.includes('reddit.com/r/') && !u.includes('/comments/')) return true;
    if (u.includes('onlyfans.com/') && !u.includes('/posts/')) return true;
    return false;
  };
  if (isProfileUrl(effectiveUrl) && !isOnlyFansProfileUrl) {
    return res.status(400).json({ success: false, error: 'Dit is een profiel/kanaal link. Gebruik de BATCH knop in de extensie om het hele kanaal te downloaden.' });
  }


  const pageUrl = metadata && typeof metadata.url === 'string' ? metadata.url.trim() : '';
  const originPlatform = normalizePlatform(metaPlatform, pageUrl || effectiveUrl);
  const pinFffOrigin = !!(
    (originPlatform === 'footfetishforum' && pageUrl && pageUrl !== effectiveUrl && isFootfetishforumThreadUrl(pageUrl)) ||
    (detectPlatform(effectiveUrl) === 'footfetishforum' && /\/attachments\//i.test(effectiveUrl) && pageUrl && isFootfetishforumThreadUrl(pageUrl))
  );
  const pinAznOrigin = !!(originPlatform === 'aznudefeet' && pageUrl && pageUrl !== effectiveUrl && isAznudefeetViewUrl(pageUrl));
  const pinToOrigin = !!(pinFffOrigin || pinAznOrigin);
  const fffThreadInfo = pinFffOrigin ? parseFootFetishForumThreadInfo(pageUrl || effectiveUrl) : null;
  const detectedPlatform = detectPlatform(effectiveUrl);
  const originChannel = pinFffOrigin && fffThreadInfo && fffThreadInfo.name ? fffThreadInfo.name : metadata && metadata.channel && metadata.channel !== 'unknown' ? metadata.channel : deriveChannelFromUrl(originPlatform, pageUrl || effectiveUrl) || 'unknown';
  const originTitle = pinFffOrigin && fffThreadInfo && fffThreadInfo.name ? fffThreadInfo.name : metadata && metadata.title ? metadata.title : deriveTitleFromUrl(pageUrl || effectiveUrl);

  const preferDetectedPlatform = !!(pinFffOrigin && detectedPlatform && detectedPlatform !== 'other' && detectedPlatform !== originPlatform);
  const platform = pinToOrigin ? originPlatform : (preferDetectedPlatform ? detectedPlatform : normalizePlatform(metaPlatform, effectiveUrl));
  const channel = pinToOrigin ?
    originChannel :
    preferDetectedPlatform ?
      deriveChannelFromUrl(platform, effectiveUrl) || originChannel :
      metadata && metadata.channel && metadata.channel !== 'unknown' ? metadata.channel : deriveChannelFromUrl(platform, effectiveUrl) || 'unknown';
  const title = pinToOrigin ?
    originTitle :
    preferDetectedPlatform ?
      deriveTitleFromUrl(effectiveUrl) :
      metadata && metadata.title ? metadata.title : deriveTitleFromUrl(effectiveUrl);

  const allowRedditRerun = platform === 'reddit' && isRedditRollingTargetUrl(effectiveUrl);
  const allowPatreonRerun = platform === 'patreon' && (effectiveUrl.includes('/posts') || effectiveUrl.includes('patreon.com/c/'));
  const allowRerun = allowRedditRerun || allowPatreonRerun;

  let lookupUrl = effectiveUrl;
  if (platform === 'youtube' || /youtube\.com|youtu\.be/i.test(effectiveUrl)) {
    try {
      const parsed = new URL(effectiveUrl);
      const videoId = parsed.searchParams.get('v') || parsed.pathname.split('/').pop();
      if (videoId && parsed.hostname.includes('youtube.com')) {
        lookupUrl = `https://www.youtube.com/watch?v=${videoId}`;
      } else if (videoId && parsed.hostname.includes('youtu.be')) {
        lookupUrl = `https://www.youtube.com/watch?v=${videoId}`;
      }
    } catch (e) { }
  }

  const existing = await findReusableDownloadByUrl.get(lookupUrl);
  let isMissingFile = false;
  if (existing && existing.status === 'completed') {
    const absPath = existing.filepath ? require('path').resolve(BASE_DIR, existing.filepath) : null;
    if (!absPath || !require('fs').existsSync(absPath)) {
      isMissingFile = true;
    }
  }

  if (!forceDuplicates && existing && existing.id && !isMissingFile && !(allowRerun && String(existing.status || '') === 'completed')) {
    try {
      const verification = await getDownload.get(existing.id);
      if (!verification || !verification.id) {
        console.log(`   ⚠️  Duplicate #${existing.id} niet meer in database - behandelen als nieuwe download`);
      } else {
        console.log(`\n♻️  Duplicate gedetecteerd #${existing.id}: ${effectiveUrl}`);
        console.log(`   Status: ${existing.status || 'unknown'} | Bestand: ${existing.filepath || 'geen filepath'}`);
        try {
          if (existing.filepath && fs.existsSync(existing.filepath)) {
            console.log(`   📸 Thumbnail generatie getriggerd voor bestaand bestand`);
            scheduleThumbGeneration(existing.filepath);
          }
        } catch (e) {
          console.log(`   ⚠️  Duplicate handling fout: ${e.message}`);
        }
        return res.json({
          success: true,
          downloadId: Number(existing.id),
          platform: existing.platform || platform,
          channel: existing.channel || channel,
          title: existing.title || title,
          duplicate: true,
          status: existing.status || null,
          message: `Dit bestand is al gedownload (#${existing.id})`
        });
      }
    } catch (e) {
      console.log(`   ⚠️  Duplicate verification fout: ${e.message}`);
    }
  }
  const result = await insertDownload.run(effectiveUrl, platform, channel, title);
  const downloadId = result.lastInsertRowid;

  // Set priority if requested or global priority mode is ON
  const effectivePriority = (priority && Number(priority) > 0) ? Number(priority) : (globalPriorityMode ? 1 : 0);
  if (effectivePriority > 0) {
    try { await db.prepare("UPDATE downloads SET priority = ? WHERE id = ?").run(effectivePriority, downloadId); } catch (e) {}
  }

  try {
    const pageUrl = metadata && typeof metadata.url === 'string' ? metadata.url.trim() : '';
    if (pageUrl && pageUrl !== effectiveUrl) {
      await updateDownloadSourceUrl.run(pageUrl, downloadId);
    }
  } catch (e) { }

  try {
    const thumb = metadata && typeof metadata.thumbnail === 'string' ? metadata.thumbnail.trim() : '';
    if (thumb) await updateDownloadThumbnail.run(thumb, downloadId);
  } catch (e) { }

  console.log(`\n📥 Download gestart #${downloadId}: ${effectiveUrl}`);
  console.log(`   Platform: ${platform} | Kanaal: ${channel} | Titel: ${title}`);

  res.json({ success: true, downloadId, platform, channel, title });

  const jobMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {};
  if (force === true) jobMetadata.webdl_force = true;
  if (!jobMetadata.webdl_direct_hint && jobMetadata.webdl_direct_hints && typeof jobMetadata.webdl_direct_hints === 'object') {
    const directHint = pickDirectHintForUrl(effectiveUrl, jobMetadata.webdl_direct_hints);
    if (typeof directHint === 'string' && directHint.trim()) jobMetadata.webdl_direct_hint = directHint.trim();
  }
  if (pinToOrigin) {
    jobMetadata.webdl_pin_context = true;
    jobMetadata.origin_thread = { url: pageUrl, platform: originPlatform, channel: originChannel, title: originTitle };
    jobMetadata.webdl_media_url = effectiveUrl;
    jobMetadata.webdl_detected_platform = detectedPlatform;
  }
  const laneOverride = lane === 'batch' ? 'batch' : undefined;
  enqueueDownloadJob(downloadId, effectiveUrl, platform, channel, title, jobMetadata, laneOverride);
});

expressApp.post('/reddit/index', async (req, res) => {
  try {
    const body = req.body || {};
    const seedUrl = String(body.url || '').trim();
    try {
      console.log(`[INGRESS] POST /reddit/index url=${seedUrl.slice(0, 200)} maxItems=${String(body.maxItems || '')} maxPages=${String(body.maxPages || '')}`);
    } catch (e) { }
    if (!seedUrl) return res.status(400).json({ success: false, error: 'url is vereist' });
    if (!isRedditFamilyUrl(seedUrl)) return res.status(400).json({ success: false, error: 'Geen Reddit URL' });

    const result = await indexRedditSeedUrl(seedUrl, {
      maxItems: body.maxItems,
      maxPages: body.maxPages
    });
    return res.json({ success: true, ...result });
  } catch (e) {
    const seedUrl = String(req.body && req.body.url || '').trim();
    const msg = String(e && e.message ? e.message : 'reddit index faalde');
    const blocked = /\b403\b|blocked|forbidden|too many requests|cloudflare|aborted|timeout|timed out|network/i.test(msg);
    if (blocked && seedUrl && isRedditFamilyUrl(seedUrl)) {
      return res.json({
        success: true,
        seed: canonicalizeRedditCandidateUrl(seedUrl),
        mode: 'fallback_target',
        urls: [canonicalizeRedditCandidateUrl(seedUrl)],
        scannedPages: 0,
        scannedPosts: 0,
        reachedEnd: false,
        warning: msg
      });
    }
    return res.status(500).json({ success: false, error: msg });
  }
});

// --- Shared gallery crawling helpers ---
const _fetchGalleryPage = async (pageUrl) => {
  const https = require('https');
  const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };
  // For zishy: load Firefox cookies (login required for full content)
  if (/zishy\.com/i.test(pageUrl)) {
    try {
      const cookieStr = await loadCookiesForDomain('zishy.com');
      if (cookieStr) headers['Cookie'] = cookieStr;
    } catch (e) {}
  }
  return new Promise((resolve) => {
    const req = https.get(pageUrl, {
      headers,
      timeout: 15000
    }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) { resolve(''); return; }
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
  });
};

function _extractElitebabesCdn(html, seen) {
  const urls = [];
  // Images from CDN links
  const reImg = /href="(https?:\/\/cdn\.elitebabes\.com\/content\/[^"]+\.(?:jpe?g|png|gif|webp))"/gi;
  let m;
  while ((m = reImg.exec(html)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); }
  }
  // Videos: <source src="...mp4"> or <video src="...mp4"> from media.elitebabes.com
  const reVid = /(?:src|href)=["'](https?:\/\/media\.elitebabes\.com\/videos\/[^"']+\.(?:mp4|webm|mov))["']/gi;
  while ((m = reVid.exec(html)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); }
  }
  // Also check cdn.elitebabes.com for videos
  const reVid2 = /(?:src|href)=["'](https?:\/\/cdn\.elitebabes\.com\/[^"']+\.(?:mp4|webm|mov))["']/gi;
  while ((m = reVid2.exec(html)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); }
  }
  return urls;
}

function _extractPornpicsCdn(html, seen) {
  const urls = [];
  // Full-res links (1280px)
  const re = /href='(https?:\/\/cdni\.pornpics\.com\/1280\/[^']+\.(?:jpe?g|png|webp))'/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); }
  }
  return urls;
}

// Background expansion: crawls model/gallery pages and queues downloads as discovered
// Global dedup: track all CDN URLs queued in this session to prevent race-condition duplicates
const _expandQueuedUrls = new Set();
async function _expandAndQueueBackground(deferredUrls, { originPlatform, originChannel, originTitle, metadata, force, pageUrl }) {
  const seen = new Set();
  const MAX_PAGES = 999;
  const forceDuplicates = force === true;

  for (const { url: u, type, platform: sitePlatform } of deferredUrls) {
    try {
      let cdnUrls = [];

      if (sitePlatform === 'elitebabes' && type === 'model') {
        // Crawl all paginated model pages for gallery links, then each gallery for CDN images
        const baseUrl = u.replace(/\/+$/, '');
        const galleryUrls = [];
        for (let page = 1; page <= MAX_PAGES; page++) {
          const pUrl = page === 1 ? baseUrl + '/' : baseUrl + '/page/' + page + '/';
          const html = await _fetchGalleryPage(pUrl);
          if (!html) break;
          let found = 0;
          const galleryRe = /href="(https?:\/\/(?:www\.)?elitebabes\.com\/[a-z0-9][a-z0-9-]+\/?)"[^>]*class="[^"]*thumb/gi;
          let gm;
          while ((gm = galleryRe.exec(html)) !== null) {
            if (!seen.has(gm[1]) && !/\/model\/|\/tag\/|\/category\//i.test(gm[1])) {
              seen.add(gm[1]); galleryUrls.push(gm[1]); found++;
            }
          }
          if (found === 0) {
            const fbRe = /href="(https?:\/\/(?:www\.)?elitebabes\.com\/[a-z0-9][a-z0-9-]+\/)"/gi;
            while ((gm = fbRe.exec(html)) !== null) {
              if (!seen.has(gm[1]) && !/\/model\/|\/tag\/|\/category\/|\/search\/|\/random\/|\/explore\/|\/page\//i.test(gm[1])) {
                seen.add(gm[1]); galleryUrls.push(gm[1]); found++;
              }
            }
          }
          // Also extract video URLs directly from listing page
          const listingVids = _extractElitebabesCdn(html, seen);
          if (listingVids.length > 0) {
            console.log(`[BG-EXPAND] elitebabes listing page ${page}: ${listingVids.length} videos/images found directly`);
            cdnUrls.push(...listingVids);
          }
          console.log(`[BG-EXPAND] elitebabes model page ${page}: ${found} galleries`);
          if (found === 0 && listingVids.length === 0) break;
        }
        console.log(`[BG-EXPAND] elitebabes model total: ${galleryUrls.length} galleries`);
        for (const gUrl of galleryUrls) {
          try {
            const gHtml = await _fetchGalleryPage(gUrl);
            const imgs = _extractElitebabesCdn(gHtml, seen);
            if (imgs.length > 0) {
              console.log(`[BG-EXPAND] Gallery ${gUrl.split('/').slice(-2, -1)[0]} → ${imgs.length} images`);
              cdnUrls.push(...imgs);
            }
          } catch (e) { console.log(`[BG-EXPAND] Gallery error ${gUrl}: ${e.message}`); }
        }
      } else if (sitePlatform === 'elitebabes' && type === 'gallery') {
        const html = await _fetchGalleryPage(u);
        cdnUrls = _extractElitebabesCdn(html, seen);
        console.log(`[BG-EXPAND] elitebabes gallery ${u.split('/').slice(-2, -1)[0]} → ${cdnUrls.length} images`);
      } else if (sitePlatform === 'pornpics' && type === 'model') {
        // Crawl pornpics model page for gallery links, then each gallery for CDN images
        const baseUrl = u.replace(/\/+$/, '');
        const galleryUrls = [];
        for (let page = 1; page <= MAX_PAGES; page++) {
          const pUrl = page === 1 ? baseUrl + '/' : baseUrl + '/?page=' + page;
          const html = await _fetchGalleryPage(pUrl);
          if (!html) break;
          let found = 0;
          const galleryRe = /href='(https?:\/\/(?:www\.)?pornpics\.com\/galleries\/[^']+)'/gi;
          let gm;
          while ((gm = galleryRe.exec(html)) !== null) {
            if (!seen.has(gm[1])) { seen.add(gm[1]); galleryUrls.push(gm[1]); found++; }
          }
          // Also try double-quote variant
          const galleryRe2 = /href="(https?:\/\/(?:www\.)?pornpics\.com\/galleries\/[^"]+)"/gi;
          while ((gm = galleryRe2.exec(html)) !== null) {
            if (!seen.has(gm[1])) { seen.add(gm[1]); galleryUrls.push(gm[1]); found++; }
          }
          console.log(`[BG-EXPAND] pornpics model page ${page}: ${found} galleries`);
          if (found === 0) break;
        }
        console.log(`[BG-EXPAND] pornpics model total: ${galleryUrls.length} galleries`);
        for (const gUrl of galleryUrls) {
          try {
            const gHtml = await _fetchGalleryPage(gUrl);
            const imgs = _extractPornpicsCdn(gHtml, seen);
            if (imgs.length > 0) {
              console.log(`[BG-EXPAND] Gallery ${gUrl.split('/').slice(-2, -1)[0]} → ${imgs.length} images`);
              cdnUrls.push(...imgs);
            }
          } catch (e) { console.log(`[BG-EXPAND] Gallery error ${gUrl}: ${e.message}`); }
        }
      } else if (sitePlatform === 'pornpics' && type === 'gallery') {
        const html = await _fetchGalleryPage(u);
        cdnUrls = _extractPornpicsCdn(html, seen);
        console.log(`[BG-EXPAND] pornpics gallery → ${cdnUrls.length} images`);
      } else if (sitePlatform === 'zishy') {
        // Zishy album: extract full-res images + video
        const html = await _fetchGalleryPage(u);
        if (html) {
          // Full-res images: href="/uploads/full/..."
          const imgRe = /href=["'](\/uploads\/full\/[^"']+\.(?:jpe?g|png|gif|webp))["']/gi;
          let m;
          while ((m = imgRe.exec(html)) !== null) {
            const imgUrl = 'https://www.zishy.com' + m[1].replace(/ /g, '%20');
            if (!seen.has(imgUrl)) { seen.add(imgUrl); cdnUrls.push(imgUrl); }
          }
          // Video: <video> or <source> src
          const vidRe = /(?:src)=["']((?:https?:\/\/[^"']*|\/[^"']*?)\.(?:mp4|webm|m4v))["']/gi;
          while ((m = vidRe.exec(html)) !== null) {
            let vidUrl = m[1];
            if (vidUrl.startsWith('/')) vidUrl = 'https://www.zishy.com' + vidUrl;
            if (!seen.has(vidUrl) && !/poster|thumb|preview/i.test(vidUrl)) {
              seen.add(vidUrl); cdnUrls.push(vidUrl);
            }
          }
          console.log(`[BG-EXPAND] zishy album → ${cdnUrls.length} items (images + videos)`);
        }
      }

      // Queue each discovered CDN URL
      const channel = originChannel !== 'unknown' ? originChannel : deriveChannelFromUrl(sitePlatform, u) || 'unknown';
      const title = originTitle || metadata && metadata.title || deriveTitleFromUrl(u);
      let queuedCount = 0;
      let skippedCount = 0;
      for (const cdnUrl of cdnUrls) {
        try {
          // In-memory dedup: prevent race-condition duplicates across concurrent expand runs
          if (!forceDuplicates && _expandQueuedUrls.has(cdnUrl)) { skippedCount++; continue; }
          const existing = await findReusableDownloadByUrl.get(cdnUrl);
          if (!forceDuplicates && existing && existing.id) { skippedCount++; continue; }
          _expandQueuedUrls.add(cdnUrl);
          // Cap set size to prevent unbounded memory growth
          if (_expandQueuedUrls.size > 200000) {
            const iter = _expandQueuedUrls.values();
            for (let i = 0; i < 50000; i++) { const v = iter.next(); if (v.done) break; _expandQueuedUrls.delete(v.value); }
          }
          const result = await insertDownload.run(cdnUrl, sitePlatform, channel, title);
          const downloadId = result.lastInsertRowid;
          try {
            if (pageUrl && pageUrl !== cdnUrl) await updateDownloadSourceUrl.run(pageUrl, downloadId);
          } catch (e) {}
          const jobMeta = { ...(metadata || {}), tool: 'curl', platform: sitePlatform, channel, title };
          enqueueDownloadJob(downloadId, cdnUrl, sitePlatform, channel, title, jobMeta);
          queuedCount++;
        } catch (e) {
          console.log(`[BG-EXPAND] Queue error for ${cdnUrl.slice(-40)}: ${e.message}`);
        }
      }
      console.log(`[BG-EXPAND] ${sitePlatform} ${type} done: ${queuedCount} queued, ${skippedCount} skipped (dedup) from ${u.slice(0, 80)}`);
    } catch (e) {
      console.log(`[BG-EXPAND] Error expanding ${u}: ${e.message}`);
    }
  }
}

expressApp.post('/download/batch', async (req, res) => {
  const { urls, metadata, force, priority } = req.body || {};
  try {
    const n = Array.isArray(urls) ? urls.length : 0;
    console.log(`[INGRESS] POST /download/batch count=${n} page=${String(metadata && metadata.url || '').slice(0, 200)} force=${force === true ? '1' : '0'}`);
  } catch (e) { }
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ success: false, error: 'urls is vereist' });
  }
  const forceDuplicates = force === true;

  const metaPlatform = metadata && typeof metadata.platform === 'string' ? metadata.platform : null;
  const pageUrl = metadata && typeof metadata.url === 'string' ? metadata.url.trim() : '';
  const originPlatform = normalizePlatform(metaPlatform, pageUrl || '');
  const pinFffOrigin = !!(originPlatform === 'footfetishforum' && pageUrl && isFootfetishforumThreadUrl(pageUrl));
  const pinAznOrigin = !!(originPlatform === 'aznudefeet' && pageUrl && isAznudefeetViewUrl(pageUrl));
  const fffThreadInfo = pinFffOrigin ? parseFootFetishForumThreadInfo(pageUrl) : null;
  const originChannel = pinFffOrigin && fffThreadInfo && fffThreadInfo.name ? fffThreadInfo.name : metadata && metadata.channel && metadata.channel !== 'unknown' ? metadata.channel : deriveChannelFromUrl(originPlatform, pageUrl) || 'unknown';
  const originTitle = pinFffOrigin && fffThreadInfo && fffThreadInfo.name ? fffThreadInfo.name : metadata && metadata.title ? metadata.title : deriveTitleFromUrl(pageUrl);

  const unique = [];
  const seen = new Set();
  const BATCH_SKIP_RE = /(?:^|[/])(?:apple-touch-icon|favicon|site-logo|browserconfig|manifest\.json)(?:\.\w+)?(?:\?|$)/i;
  for (const u of urls) {
    const raw = typeof u === 'string' ? u.trim() : '';
    const s = isRedditFamilyUrl(raw) ? canonicalizeRedditCandidateUrl(raw) : raw;
    if (!s) continue;
    if (seen.has(s)) continue;
    if (BATCH_SKIP_RE.test(s)) continue;
    seen.add(s);
    unique.push(s);
  }

  // --- Classify URLs: immediate vs needs-expansion ---
  const immediate = [];
  const deferred = [];
  for (const u of unique) {
    // Elitebabes model/gallery detection
    const isElitebabes = /^https?:\/\/(www\.)?elitebabes\.com\//i.test(u) &&
      !/\.(jpe?g|png|gif|webp|mp4|webm)(\?|$)/i.test(u) &&
      !/cdn\.elitebabes\.com/i.test(u);
    if (isElitebabes) {
      const isModel = /\/model\/[a-z0-9][a-z0-9-]+/i.test(u);
      const isGallery = !isModel && /^https?:\/\/(www\.)?elitebabes\.com\/[a-z0-9][a-z0-9-]+\/?$/i.test(u) &&
        !/\/(model-tag|tag|category|search|random|explore|faves|history)\b/i.test(u);
      if (isModel) { deferred.push({ url: u, type: 'model', platform: 'elitebabes' }); continue; }
      if (isGallery) { deferred.push({ url: u, type: 'gallery', platform: 'elitebabes' }); continue; }
      // Any other elitebabes page (tag, category, etc.) → treat as listing page (same crawl as model)
      deferred.push({ url: u, type: 'model', platform: 'elitebabes' }); continue;
    }
    // Pornpics model/gallery detection
    const isPornpics = /^https?:\/\/(www\.)?pornpics\.com\//i.test(u) &&
      !/cdni\.pornpics\.com/i.test(u) &&
      !/\.(jpe?g|png|gif|webp)(\?|$)/i.test(u);
    if (isPornpics) {
      const isGallery = /\/galleries\/[a-z0-9][a-z0-9-]+/i.test(u);
      if (isGallery) { deferred.push({ url: u, type: 'gallery', platform: 'pornpics' }); continue; }
      // Any other pornpics page (pornstars, tags, categories, etc.) → treat as listing page
      deferred.push({ url: u, type: 'model', platform: 'pornpics' }); continue;
    }
    // Zishy album detection
    const isZishy = /^https?:\/\/(www\.)?zishy\.com\//i.test(u) &&
      !/\.(jpe?g|png|gif|webp|mp4|webm)(\?|$)/i.test(u);
    if (isZishy) {
      const isAlbum = /\/albums\/\d+/i.test(u);
      if (isAlbum) { deferred.push({ url: u, type: 'gallery', platform: 'zishy' }); continue; }
      // Any other zishy page → treat as listing
      deferred.push({ url: u, type: 'model', platform: 'zishy' }); continue;
    }
    immediate.push(u);
  }

  // Process immediate URLs synchronously (fast)
  const created = [];
  for (const u of immediate) {
    const pinToOrigin = !!((pinFffOrigin || pinAznOrigin) && pageUrl && pageUrl !== u);
    const detectedPlatform = detectPlatform(u);
    const preferDetectedPlatform = !!(pinFffOrigin && pinToOrigin && detectedPlatform && detectedPlatform !== 'other' && detectedPlatform !== originPlatform);
    const platform = pinToOrigin ? originPlatform : (preferDetectedPlatform ? detectedPlatform : normalizePlatform(metaPlatform, u));
    const isElitebabesCdn = originPlatform === 'elitebabes' && /cdn\.elitebabes\.com/i.test(u);
    const isPornpicsCdn = originPlatform === 'pornpics' && /cdni\.pornpics\.com/i.test(u);
    const channel = pinToOrigin ? originChannel : (isElitebabesCdn || isPornpicsCdn) ? (originChannel !== 'unknown' ? originChannel : metadata && metadata.channel || 'unknown') : preferDetectedPlatform ? deriveChannelFromUrl(platform, u) || originChannel : metadata && metadata.channel && metadata.channel !== 'unknown' ? metadata.channel : deriveChannelFromUrl(platform, u) || 'unknown';
    const title = pinToOrigin ? originTitle : (isElitebabesCdn || isPornpicsCdn) ? (originTitle || metadata && metadata.title || deriveTitleFromUrl(u)) : preferDetectedPlatform ? deriveTitleFromUrl(u) : metadata && metadata.title ? metadata.title : deriveTitleFromUrl(u);
    const allowRedditRerun = platform === 'reddit' && isRedditRollingTargetUrl(u);
    const allowPatreonRerun = platform === 'patreon' && (u.includes('/posts') || u.includes('patreon.com/c/'));
    const allowRerun = allowRedditRerun || allowPatreonRerun;

    const existing = await findReusableDownloadByUrl.get(u);
    let isMissingFile = false;
    if (existing && existing.status === 'completed') {
      const absPath = existing.filepath ? require('path').resolve(BASE_DIR, existing.filepath) : null;
      if (!absPath || !require('fs').existsSync(absPath)) {
        isMissingFile = true;
      }
    }
    if (!forceDuplicates && existing && existing.id && !isMissingFile && !(allowRerun && String(existing.status || '') === 'completed')) {
      created.push({
        downloadId: existing.id,
        url: u,
        platform: existing.platform || platform,
        channel: existing.channel || channel,
        title: existing.title || title,
        duplicate: true,
        status: existing.status || null
      });
      continue;
    }
    const result = await insertDownload.run(u, platform, channel, title);
    const downloadId = result.lastInsertRowid;
    if (priority && Number(priority) > 0) {
      try { await db.prepare("UPDATE downloads SET priority = ? WHERE id = ?").run(Number(priority), downloadId); } catch (e) {}
    }

    try {
      const pageUrl = metadata && typeof metadata.url === 'string' ? metadata.url.trim() : '';
      if (pageUrl && pageUrl !== u) {
        await updateDownloadSourceUrl.run(pageUrl, downloadId);
      }
    } catch (e) { }

    created.push({ downloadId, url: u, platform, channel, title });
    const jobMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {};
    if (force === true) jobMetadata.webdl_force = true;
    if (!jobMetadata.webdl_direct_hint && jobMetadata.webdl_direct_hints && typeof jobMetadata.webdl_direct_hints === 'object') {
      const directHint = pickDirectHintForUrl(u, jobMetadata.webdl_direct_hints);
      if (typeof directHint === 'string' && directHint.trim()) jobMetadata.webdl_direct_hint = directHint.trim();
    }
    if (pinToOrigin) {
      jobMetadata.webdl_pin_context = true;
      jobMetadata.origin_thread = { url: pageUrl, platform: originPlatform, channel: originChannel, title: originTitle };
      jobMetadata.webdl_media_url = u;
      jobMetadata.webdl_detected_platform = detectedPlatform;
    }
    enqueueDownloadJob(downloadId, u, platform, channel, title, jobMetadata);
  }

  // Quick probe: fetch first page of each deferred URL concurrently to estimate gallery count (strict timeout to prevent addon blocking)
  let estimatedGalleries = 0;
  const expandInfo = [];
  
  if (deferred.length > 0) {
    await Promise.all(deferred.map(async (d) => {
      try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('probe timeout')), 800));
        const fetchPromise = _fetchGalleryPage(d.url);
        const html = await Promise.race([fetchPromise, timeoutPromise]);
        
        if (!html) { expandInfo.push({ ...d, estimated: 0 }); return; }
        
        let galCount = 0;
        if (d.platform === 'elitebabes') {
          const re = /href="(https?:\/\/(?:www\.)?elitebabes\.com\/[a-z0-9][a-z0-9-]+\/?)"[^>]*class="[^"]*thumb/gi;
          const fbRe = /href="(https?:\/\/(?:www\.)?elitebabes\.com\/[a-z0-9][a-z0-9-]+\/)"/gi;
          let m; while ((m = re.exec(html)) !== null) { if (!/\/model\/|\/tag\/|\/category\//i.test(m[1])) galCount++; }
          if (galCount === 0) { while ((m = fbRe.exec(html)) !== null) { if (!/\/model\/|\/tag\/|\/category\/|\/search\/|\/random\/|\/explore\/|\/page\//i.test(m[1])) galCount++; } }
          const pageMatch = html.match(/\/page\/(\d+)\//g);
          const maxPage = pageMatch ? Math.max(...pageMatch.map(p => parseInt(p.match(/\d+/)[0]))) : 1;
          galCount = galCount * Math.max(1, maxPage);
        } else if (d.platform === 'pornpics') {
          const re1 = /href=['"]https?:\/\/(?:www\.)?pornpics\.com\/galleries\/[^'"]+['"]/gi;
          let m; while ((m = re1.exec(html)) !== null) galCount++;
          const pMaxMatch = html.match(/var\s+P_MAX\s*=\s*(\d+)/);
          const maxPage = pMaxMatch ? parseInt(pMaxMatch[1]) : 1;
          galCount = galCount * Math.max(1, maxPage);
        }
        expandInfo.push({ ...d, estimated: galCount });
        estimatedGalleries += galCount;
      } catch (e) {
        expandInfo.push({ ...d, estimated: 0 });
      }
    }));
  }

  // Respond immediately with estimate
  if (deferred.length > 0) {
    console.log(`[BATCH] Responding immediately, ${deferred.length} URLs expanding in background, ~${estimatedGalleries} galleries estimated`);
  }
  res.json({ success: true, downloads: created, expanding: deferred.length, estimatedGalleries });

  // Fire-and-forget: expand deferred URLs in background
  if (deferred.length > 0) {
    _expandAndQueueBackground(deferred, { originPlatform, originChannel, originTitle, metadata, force, pageUrl })
      .catch(e => console.log(`[BG-EXPAND] Fatal error: ${e.message}`));
  }

});

async function startDownload(downloadId, url, platform, channel, title, metadata) {
  const abort = abortKind(downloadId);
  if (abort) {
    applyAbortStatus(downloadId, abort);
    return;
  }

  let driver = 'yt-dlp';
  if (platform === 'onlyfans') driver = 'ofscraper'; else
    if (platform === 'instagram') driver = 'instaloader'; else
      if (platform === 'reddit') driver = 'reddit-dl'; else
        if (platform === 'telegram') driver = 'tdl'; else
          if (
            platform === 'wikifeet' ||
            platform === 'wikifeetx' ||
            platform === 'kinky' ||
            platform === 'pornpics' ||
            platform === 'erome' ||
            platform === 'twitter' ||
            platform === 'aznudefeet' && !looksLikeDirectFileUrl(url) ||
            platform === 'tiktok' && isTikTokPhotoUrl(url)
          ) driver = 'gallery-dl'; else
            if (isKnownHtmlWrapperUrl(url) || looksLikeDirectFileUrl(url)) driver = 'direct';
  setDownloadActivityContext(downloadId, { url, platform, channel, title, lane: jobLane.get(downloadId) || '', driver });
  emitDownloadEventActivity('dispatch', downloadId, { url, platform, channel, title, lane: jobLane.get(downloadId) || '', driver }).catch(() => { });

  const forceDuplicates = !!(metadata && typeof metadata === 'object' && !Array.isArray(metadata) && (metadata.webdl_force === true || metadata.force === true));

  try {
    const allowRedditRerun = platform === 'reddit' && isRedditRollingTargetUrl(url);
    const allowPatreonRerun = platform === 'patreon' && (url.includes('/posts') || url.includes('patreon.com/c/'));
    const allowRerun = allowRedditRerun || allowPatreonRerun;
    const reusable = await findReusableDownloadByUrlExcludingId.get(url, downloadId);
    if (!forceDuplicates && reusable && reusable.id) {
      if (allowRerun && String(reusable.status || '') === 'completed') {

        // Voor r/<subreddit> en u/<user> willen we herhaalde scans toestaan.
      } else {
        if (reusable.status === 'completed' && reusable.filepath) {
          await updateDownload.run(
            'completed',
            100,
            reusable.filepath || null,
            reusable.filename || null,
            Number.isFinite(Number(reusable.filesize)) ? Number(reusable.filesize) : 0,
            reusable.format || '',
            reusable.metadata || null,
            null,
            downloadId
          );
        } else {
          await updateDownloadStatus.run('cancelled', 0, `Duplicate URL; al actief als #${reusable.id}`, downloadId);
        }
        return;
      }
    }
  } catch (e) { }

  if (platform === 'onlyfans') {
    return startOfscraperDownload(downloadId, url, platform, channel, title, metadata);
  }

  if (platform === 'youtube') {
    // Route YouTube downloads through 4K Video Downloader+ app
    try {
      const { execSync } = require('child_process');
      const safeUrl = url.replace(/'/g, "'\\''");
      execSync(`open 'fourkvd://${safeUrl}'`, { timeout: 5000 });
      console.log(`[DL #${downloadId}] → 4K Video Downloader: ${url.slice(0, 80)}`);
      await updateDownloadStatus.run('superseded', 0, '4K Video Downloader', downloadId);
      emitDownloadEventActivity('completed', downloadId, { url, platform, channel, title, note: 'Handed off to 4K Video Downloader' }).catch(() => {});
    } catch (e) {
      console.log(`[DL #${downloadId}] 4K Downloader failed, falling back to yt-dlp: ${e.message}`);
      return startYtDlpDownload(downloadId, url, platform, channel, title, metadata);
    }
    return;
  }

  if (platform === 'instagram') {
    return startInstaloaderDownload(downloadId, url, platform, channel, title, metadata);
  }

  if (platform === 'reddit') {
    return startRedditDlDownload(downloadId, url, platform, channel, title, metadata);
  }

  if (platform === 'telegram') {
    return startTdlDownload(downloadId, url, platform, channel, title, metadata);
  }

  if (platform === 'kinky') {
    return startKinkyNlDownload(downloadId, url, platform, channel, title, metadata);
  }

  if (
    platform === 'twitter' ||
    platform === 'wikifeet' ||
    platform === 'wikifeetx' ||
    platform === 'pornpics' ||
    (platform === 'aznudefeet' && !looksLikeDirectFileUrl(url)) ||
    platform === 'tiktok' && isTikTokPhotoUrl(url)
  ) {
    return startGalleryDlDownload(downloadId, url, platform, channel, title, metadata);
  }

  if (isKnownHtmlWrapperUrl(url)) {
    try {
      const wrapperReferer = String(
        metadata && typeof metadata === 'object' && metadata.origin_thread && metadata.origin_thread.url ? metadata.origin_thread.url :
          metadata && typeof metadata === 'object' && metadata.url && metadata.url !== url ? metadata.url :
            ''
      ).trim();
      const resolved = await resolveHtmlWrapperToDirectMediaUrl(url, 15000, wrapperReferer);
      if (resolved && resolved !== url) {
        try { await updateDownloadUrl.run(resolved, downloadId); } catch (e) { }
        const nextMeta = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {};
        if (!nextMeta.webdl_input_url) nextMeta.webdl_input_url = url;
        nextMeta.webdl_resolved_url = resolved;
        return startDirectFileDownload(downloadId, resolved, platform, channel, title, nextMeta);
      }
    } catch (e) { }
    return startDirectFileDownload(downloadId, url, platform, channel, title, metadata);
  }

  if (looksLikeDirectFileUrl(url)) {
    return startDirectFileDownload(downloadId, url, platform, channel, title, metadata);
  }

  return startYtDlpDownload(downloadId, url, platform, channel, title, metadata);
}

async function startRedditDlDownload(downloadId, url, platform, channel, title, metadata) {
  try {
    if (isCancelled(downloadId)) {
      clearCancelled(downloadId);
      jobLane.delete(downloadId);
      await updateDownloadStatus.run('cancelled', 0, null, downloadId);
      return;
    }

    const target = toRedditDlTarget(url);
    if (!target) {
      await updateDownloadStatus.run('error', 0, 'Reddit URL wordt niet ondersteund', downloadId);
      return;
    }

    if (!REDDIT_DL || REDDIT_DL.includes('/') && !fs.existsSync(REDDIT_DL)) {
      await updateDownloadStatus.run('error', 0, `reddit-dl niet gevonden: ${REDDIT_DL}`, downloadId);
      return;
    }

    const outChannel = channel && channel !== 'unknown' ? channel : deriveChannelFromUrl('reddit', url) || 'unknown';
    const dir = getDownloadDirChannelOnly('reddit', outChannel);
    try { await updateDownloadFilepath.run(dir, downloadId); } catch (e) { }
    await updateDownloadStatus.run('downloading', 0, null, downloadId);

    let authFilePath = '';
    let createdAuthFile = false;
    if (REDDIT_DL_AUTH_FILE && fs.existsSync(REDDIT_DL_AUTH_FILE)) {
      authFilePath = REDDIT_DL_AUTH_FILE;
    } else if (REDDIT_DL_CLIENT_ID && REDDIT_DL_CLIENT_SECRET && REDDIT_DL_USERNAME && REDDIT_DL_PASSWORD) {
      authFilePath = path.join(os.tmpdir(), `webdl-reddit-auth-${process.pid}-${downloadId}.conf`);
      fs.writeFileSync(authFilePath, [
        `client.id = ${REDDIT_DL_CLIENT_ID}`,
        `client.secret = ${REDDIT_DL_CLIENT_SECRET}`,
        `username = ${REDDIT_DL_USERNAME}`,
        `password = ${REDDIT_DL_PASSWORD}`].
        join('\n') + '\n', 'utf8');
      createdAuthFile = true;
    }

    const args = [
      '--no-prompt',
      '--ffmpeg', resolveUsableFfmpegPath(),
      '--log-level', 'warn',
      '-o', dir];

    if (authFilePath) args.push('-x', authFilePath);
    args.push(target);

    const result = await new Promise((resolve) => {
      const proc = spawnNice(REDDIT_DL, args);
      activeProcesses.set(downloadId, proc);
      try { startingJobs.delete(downloadId); } catch (e) { }
      let stderr = '';
      let stdout = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      const finish = (code) => {
        activeProcesses.delete(downloadId);
        if (createdAuthFile) {
          try { fs.unlinkSync(authFilePath); } catch (e) { }
        }
        resolve({ code, stderr, stdout });
      };
      proc.on('close', finish);
      proc.on('error', (err) => {
        stderr += String(err && err.message ? err.message : err);
        finish(-1);
      });
    });

    const mediaSummary = summarizeMediaDir(dir, 12000);
    const mediaCount = Number(mediaSummary && mediaSummary.count);
    const totalBytes = Number(mediaSummary && mediaSummary.totalBytes);
    const safeCount = Number.isFinite(mediaCount) ? Math.max(0, mediaCount) : 0;
    const safeTotalBytes = Number.isFinite(totalBytes) ? Math.max(0, totalBytes) : 0;

    if (result.code === 0 && safeCount > 0) {
      const filenameLabel = `(multiple: ${safeCount} files)`;
      const metaObj = {
        tool: 'reddit-dl',
        implementation: REDDIT_DL,
        platform: 'reddit',
        channel: outChannel,
        title,
        url,
        target,
        outputDir: dir,
        media_count: safeCount,
        media_bytes: safeTotalBytes
      };
      await indexDownloadDirImmediately(downloadId);
      await updateDownload.run('completed', 100, dir, filenameLabel, safeTotalBytes, '', JSON.stringify(metaObj), null, downloadId);
      return;
    }

    if (result.code === 0 && safeCount === 0) {
      const stderrMsg = stripAnsiCodes(result.stderr).trim();
      const stdoutMsg = stripAnsiCodes(result.stdout).trim();
      const details = stderrMsg || stdoutMsg || 'reddit-dl afgerond maar geen media-bestanden gevonden';
      const blocked = /\b403\b\s*-\s*blocked|about\.json\?raw_json=1|failed to fetch user|failed to fetch subreddit/i.test(details);
      if (blocked) {
        const authHint = 'Reddit blokkeert anonieme requests. Configureer WEBDL_REDDIT_AUTH_FILE (auth.conf) of WEBDL_REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD.';
        await updateDownloadStatus.run('error', 0, `Reddit auth vereist: ${authHint}`.slice(0, 1200), downloadId);
      } else {
        await updateDownloadStatus.run('error', 0, `Reddit: geen media gevonden in output (${dir}). ${details}`.slice(0, 1200), downloadId);
      }
      return;
    }

    const stderrMsg = stripAnsiCodes(result.stderr).trim();
    const stdoutMsg = stripAnsiCodes(result.stdout).trim();
    const details = stderrMsg || stdoutMsg || `reddit-dl exit code: ${result.code}`;
    const blocked = /\b403\b\s*-\s*blocked|about\.json\?raw_json=1|failed to fetch user|failed to fetch subreddit/i.test(details);
    if (blocked) {
      const authHint = 'Reddit blokkeert anonieme requests. Configureer WEBDL_REDDIT_AUTH_FILE (auth.conf) of WEBDL_REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD.';
      await updateDownloadStatus.run('error', 0, `Reddit auth vereist: ${authHint}`.slice(0, 1200), downloadId);
    } else {
      await updateDownloadStatus.run('error', 0, details.slice(0, 1200), downloadId);
    }
  } catch (err) {
    await updateDownloadStatus.run('error', 0, err.message, downloadId);
  }
}

function looksLikeDirectFileUrl(url) {
  try {
    const u = new URL(String(url || ''));
    const host = String(u.hostname || '').toLowerCase();

    if (host.includes('tiktokcdn.com') || host.includes('ttwstatic.com')) return true;
    if (host.includes('cdninstagram.com') || host.includes('fbcdn.net')) return true;

    const p = (u.pathname || '').toLowerCase();
    const m = p.match(/\.([a-z0-9]{1,8})($|\?|#)/i); // Added query/hash support
    if (!m) {
      const suffix = p.match(/[-_](zip|rar|7z|tar|gz|jpg|jpeg|png|gif|webp|bmp|mp4|mov|m4v|webm|mkv|mp3|m4a|wav|flac|pdf)($|\?|#)/i);
      return !!suffix;
    }
    const ext = m[1];
    const direct = new Set([
      'zip', 'rar', '7z', 'tar', 'gz',
      'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
      'mp4', 'mov', 'm4v', 'webm', 'mkv',
      'mp3', 'm4a', 'wav', 'flac',
      'pdf']
    );
    return direct.has(ext);
  } catch (e) {
    return false;
  }
}

function isKnownExternalMediaWrapperHost(hostname) {
  try {
    const host = String(hostname || '').toLowerCase();
    if (!host) return false;
    if (/^(?:www\.)?(?:pixhost\.to|postimages\.org|postimg\.cc|imagebam\.com|imgvb\.com|ibb\.co|imgbox\.com|imagevenue\.com|imgchest\.com|turboimagehost\.com|imx\.to|vipr\.im|pixeldrain\.com|cyberfile\.me|jpg\.pet|gofile\.io|img\.kiwi)$/.test(host)) return true;
    if (/^(?:www\.)?bunkr\.(?:si|ru|is|ph)$/.test(host)) return true;
    return false;
  } catch (e) {
    return false;
  }
}

function isKnownHtmlWrapperUrl(url) {
  try {
    const u = new URL(String(url || ''));
    const host = String(u.hostname || '').toLowerCase();
    const p = String(u.pathname || '');
    if (host === 'upload.footfetishforum.com' && p.startsWith('/image/')) return true;
    if (host.endsWith('pixhost.to') && p.startsWith('/show/')) return true;
    if (host === 'jpg.pet' && /^\/img\//i.test(p)) return true;
    if (host === 'pixeldrain.com' && /^\/u\//i.test(p)) return true;
    if (isKnownExternalMediaWrapperHost(host)) return true;
    return false;
  } catch (e) {
    return false;
  }
}

async function fetchTextWithTimeout(url, timeoutMs = 15000, referer = '') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try { ctrl.abort(); } catch (e) { }
  }, Math.max(1000, timeoutMs));
  try {
    const res = await fetch(String(url || ''), {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(referer ? { 'Referer': referer } : {})
      },
      signal: ctrl.signal
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, contentType: String(res.headers.get('content-type') || ''), finalUrl: String(res.url || url || '') };
  } finally {
    clearTimeout(timer);
  }
}

function buildUrlLookupVariants(rawUrl) {
  try {
    const input = String(rawUrl || '').trim();
    if (!input) return [];
    const out = new Set([input]);
    try {
      const u = new URL(input);
      u.hash = '';
      out.add(u.toString());
      const noQuery = new URL(u.toString());
      noQuery.search = '';
      out.add(noQuery.toString());
      if (u.pathname && !u.pathname.endsWith('/')) {
        const withSlash = new URL(u.toString());
        withSlash.pathname = `${withSlash.pathname}/`;
        out.add(withSlash.toString());
      }
      if (u.pathname && u.pathname !== '/') {
        const withoutSlash = new URL(u.toString());
        withoutSlash.pathname = withoutSlash.pathname.replace(/\/+$/, '') || '/';
        out.add(withoutSlash.toString());
      }
    } catch (e) { }
    return Array.from(out).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function pickDirectHintForUrl(rawUrl, directHints) {
  try {
    if (!directHints || typeof directHints !== 'object') return '';
    for (const key of buildUrlLookupVariants(rawUrl)) {
      const hint = directHints[key];
      if (typeof hint === 'string' && hint.trim()) return hint.trim();
    }
    return '';
  } catch (e) {
    return '';
  }
}

function decodeHtmlEscapedUrlText(raw) {
  try {
    return String(raw || '')
      .replace(/&amp;/gi, '&')
      .replace(/&#x2f;/gi, '/')
      .replace(/&#47;/gi, '/')
      .replace(/\\u002f/gi, '/')
      .replace(/\\u0026/gi, '&')
      .replace(/\\x2f/gi, '/')
      .replace(/\\x26/gi, '&')
      .replace(/\\\//g, '/');
  } catch (e) {
    return String(raw || '');
  }
}

function normalizeHtmlExtractedUrl(raw, baseUrl) {
  const s = decodeHtmlEscapedUrlText(raw).trim();
  if (!s) return '';
  const decoded = ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) ? s.slice(1, -1).trim() : s;
  try {
    return new URL(decoded, baseUrl).toString();
  } catch (e) {
    return '';
  }
}

function extractOpenGraphMediaUrl(html, baseUrl) {
  try {
    const h = String(html || '');
    const decodedHtml = decodeHtmlEscapedUrlText(h);
    const variants = decodedHtml && decodedHtml !== h ? [h, decodedHtml] : [h];
    const patterns = [
      /<meta\s+[^>]*(?:property|name)=["']og:video:url["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<meta\s+[^>]*(?:property|name)=["']og:video["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<meta\s+[^>]*(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<meta\s+[^>]*(?:property|name)=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i];

    for (const variant of variants) {
      for (const re of patterns) {
        const m = variant.match(re);
        if (m && m[1]) {
          const u = normalizeHtmlExtractedUrl(m[1], baseUrl);
          if (u) return u;
        }
      }
    }

    const urls = [];
    for (const variant of variants) {
      for (const m of variant.matchAll(/https?:\/\/[^"'\s<>]+/gi)) {
        if (m && m[0]) urls.push(m[0]);
      }
    }
    for (const raw of urls) {
      const u = normalizeHtmlExtractedUrl(raw, baseUrl);
      if (u && looksLikeDirectFileUrl(u)) return u;
    }
    return '';
  } catch (e) {
    return '';
  }
}

function upgradeKnownLowQualityMediaUrl(rawUrl) {
  try {
    const input = String(rawUrl || '').trim();
    if (!input) return '';
    let out = input
      .replace(/\.md\.(jpg|jpeg|png|gif|webp)(?:$|[?#])/i, '.$1')
      .replace(/\.th\.(jpg|jpeg|png|gif|webp)(?:$|[?#])/i, '.$1');
    try {
      const u = new URL(out);
      const host = String(u.hostname || '').toLowerCase();
      const p = String(u.pathname || '');
      // Fix broken redd.it preview slug URLs: redd.it/<title>-v0-<id>.ext → i.redd.it/<id>.ext
      if (host === 'redd.it' || host.endsWith('.redd.it')) {
        const rm = p.match(/-v0-([a-z0-9]+\.[a-z]{2,5})$/i);
        if (rm) {
          out = `https://i.redd.it/${rm[1]}`;
          return out;
        }
      }
      if ((host === 'upload.footfetishforum.com' || host.endsWith('.footfetishforum.com')) && /\/images\//i.test(p)) {
        u.pathname = p
          .replace(/\.md\.(jpg|jpeg|png|gif|webp)(?:$|[?#])/i, '.$1')
          .replace(/\.th\.(jpg|jpeg|png|gif|webp)(?:$|[?#])/i, '.$1');
        out = u.toString();
      }
      if (host.endsWith('pixhost.to')) {
        u.pathname = p.replace(/\/thumbs\//i, '/images/');
        out = u.toString();
      }
    } catch (e) { }
    return out;
  } catch (e) {
    return String(rawUrl || '').trim();
  }
}

function scoreDirectMediaCandidate(url, baseUrl = '') {
  try {
    const s = upgradeKnownLowQualityMediaUrl(url);
    if (!s || !looksLikeDirectFileUrl(s)) return -1000;
    let score = 0;
    const baseAttachment = parseFootFetishForumAttachmentInfo(baseUrl);
    const candidateAttachment = parseFootFetishForumAttachmentInfo(s);
    if (/\.(mp4|mov|m4v|webm|mkv)(?:$|[?#])/i.test(s)) score += 120;
    else if (/\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|avif|heic|heif)(?:$|[?#])/i.test(s)) score += 80;
    if (/upload\.footfetishforum\.com\/images\//i.test(s)) score += 40;
    if (/pixhost\.to\/images\//i.test(s)) score += 35;
    if (baseAttachment && baseAttachment.kind === 'page' && baseAttachment.id) {
      if (candidateAttachment && candidateAttachment.id) {
        if (candidateAttachment.id === baseAttachment.id) score += 1200;
        else score -= 1600;
      }
      if (baseAttachment.slug && s.toLowerCase().includes(baseAttachment.slug)) score += 180;
    }
    // STRONGLY PENALIZE THUMBNAILS AND UI IMAGES
    if (/\.(?:th|md)\.(jpg|jpeg|png|gif|webp)(?:$|[?#])/i.test(s)) score -= 5000;
    if (/\/thumbs?\//i.test(s)) score -= 5000;
    if (/(?:^|[^a-z])(thumb|thumbnail|preview|poster|cover|small|icon|favicon|apple-touch-icon|logo|banner|avatar)(?:[^a-z]|$)/i.test(s)) score -= 5000;
    if (/data\/attachments\/\d+\/\d+-.*\.jpg/i.test(s)) {
      // Asset url, high confidence
      score += 1500;
    }
    return score;
  } catch (e) {
    return -1000;
  }
}

function extractDirectMediaCandidates(html, baseUrl) {
  try {
    const h = String(html || '');
    const decodedHtml = decodeHtmlEscapedUrlText(h);
    const variants = decodedHtml && decodedHtml !== h ? [h, decodedHtml] : [h];
    const out = [];
    const seen = new Set();
    const pushUrl = (raw) => {
      const normalized = upgradeKnownLowQualityMediaUrl(normalizeHtmlExtractedUrl(raw, baseUrl));
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    };

    const metaPatterns = [
      /<meta\s+[^>]*(?:property|name)=["']og:video:url["'][^>]*content=["']([^"']+)["'][^>]*>/ig,
      /<meta\s+[^>]*(?:property|name)=["']og:video["'][^>]*content=["']([^"']+)["'][^>]*>/ig,
      /<meta\s+[^>]*(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/ig,
      /<meta\s+[^>]*(?:property|name)=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["'][^>]*>/ig
    ];
    for (const variant of variants) {
      for (const re of metaPatterns) {
        for (const m of variant.matchAll(re)) {
          if (m && m[1]) pushUrl(m[1]);
        }
      }
    }

    for (const variant of variants) {
      for (const m of variant.matchAll(/<(?:a|img|source|video|meta|link)\b[^>]+(?:href|src|data-src|data-url|data-image|data-full-url|content)=["']([^"']+)["'][^>]*>/ig)) {
        if (m && m[1]) pushUrl(m[1]);
      }
    }

    for (const variant of variants) {
      for (const m of variant.matchAll(/https?:\/\/[^"'\s<>]+/gi)) {
        if (m && m[0]) pushUrl(m[0]);
      }
      for (const m of variant.matchAll(/url\((["']?)(https?:\/\/[^)'"\s]+)\1\)/ig)) {
        if (m && m[2]) pushUrl(m[2]);
      }
    }

    return out
      .filter((u) => looksLikeDirectFileUrl(u))
      .sort((a, b) => scoreDirectMediaCandidate(b, baseUrl) - scoreDirectMediaCandidate(a, baseUrl));
  } catch (e) {
    return [];
  }
}

async function resolveHtmlWrapperToDirectMediaUrl(url, timeoutMs = 15000, referer = '') {
  try {
    const u0 = String(url || '').trim();
    if (!u0) return '';
    const r = await fetchTextWithTimeout(u0, timeoutMs, referer);
    if (!r) return '';
    if (r.contentType && r.contentType.toLowerCase().startsWith('image/')) return upgradeKnownLowQualityMediaUrl(String(r.finalUrl || u0));
    if (r.contentType && r.contentType.toLowerCase().startsWith('video/')) return upgradeKnownLowQualityMediaUrl(String(r.finalUrl || u0));
    if (!r.text) return '';
    const candidates = extractDirectMediaCandidates(r.text, u0);
    if (candidates && candidates.length) return candidates[0];
    const og = upgradeKnownLowQualityMediaUrl(extractOpenGraphMediaUrl(r.text, u0));
    if (!og) return '';
    if (!looksLikeDirectFileUrl(og)) return '';
    return og;
  } catch (e) {
    return '';
  }
}

function uniqueFilePath(filepath, suffix) {
  try {
    if (!fs.existsSync(filepath)) return filepath;
    const dir = path.dirname(filepath);
    const ext = path.extname(filepath);
    const base = path.basename(filepath, ext);
    const alt = path.join(dir, `${base}_${suffix}${ext || ''}`);
    if (!fs.existsSync(alt)) return alt;
    return path.join(dir, `${base}_${suffix}_${Date.now()}${ext || ''}`);
  } catch (e) {
    return filepath;
  }
}

function filenameFromUrl(url, fallback = 'download.bin') {
  try {
    const u = new URL(String(url || ''));
    if (String(u.pathname || '').toLowerCase() === '/attachment.php') {
      const attachmentId = String(u.searchParams.get('attachmentid') || '').trim();
      if (attachmentId) {
        const safeAttachment = sanitizeName(`attachment_${attachmentId}`);
        return safeAttachment || fallback;
      }
    }
    const base = path.basename(u.pathname || '');
    const name = base && base !== '/' && base !== '.' && base !== '..' ? base : '';
    const safe = sanitizeName(name);
    return safe || fallback;
  } catch (e) {
    const safe = sanitizeName(String(url || ''));
    return safe ? safe.slice(0, 60) : fallback;
  }
}

function parseLastHttpHeaders(rawHeaders) {
  try {
    const text = String(rawHeaders || '');
    if (!text) return {};
    const blocks = text.split(/\r?\n\r?\n/g).map((block) => String(block || '').trim()).filter(Boolean);
    for (let i = blocks.length - 1; i >= 0; i--) {
      const lines = blocks[i].split(/\r?\n/g).filter(Boolean);
      if (!lines.length || !/^HTTP\//i.test(lines[0])) continue;
      const headers = {};
      for (const line of lines.slice(1)) {
        const idx = line.indexOf(':');
        if (idx <= 0) continue;
        const key = String(line.slice(0, idx) || '').trim().toLowerCase();
        const value = String(line.slice(idx + 1) || '').trim();
        if (key) headers[key] = value;
      }
      if (Object.keys(headers).length) return headers;
    }
    return {};
  } catch (e) {
    return {};
  }
}

function extensionFromContentType(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!type) return '';
  const map = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
    ['image/bmp', 'bmp'],
    ['image/svg+xml', 'svg'],
    ['image/avif', 'avif'],
    ['image/heic', 'heic'],
    ['image/heif', 'heif'],
    ['video/mp4', 'mp4'],
    ['video/quicktime', 'mov'],
    ['video/webm', 'webm'],
    ['video/x-matroska', 'mkv'],
    ['audio/mpeg', 'mp3'],
    ['audio/mp4', 'm4a'],
    ['audio/x-m4a', 'm4a'],
    ['audio/wav', 'wav'],
    ['audio/flac', 'flac'],
    ['application/zip', 'zip'],
    ['application/x-rar-compressed', 'rar'],
    ['application/pdf', 'pdf']
  ]);
  return map.get(type) || '';
}

function filenameFromContentDisposition(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let match = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (match && match[1]) {
    try {
      return sanitizeName(path.basename(decodeURIComponent(String(match[1] || '').trim())));
    } catch (e) { }
  }
  match = raw.match(/filename="([^"]+)"/i);
  if (match && match[1]) return sanitizeName(path.basename(String(match[1] || '').trim()));
  match = raw.match(/filename=([^;]+)/i);
  if (match && match[1]) return sanitizeName(path.basename(String(match[1] || '').trim().replace(/^"|"$/g, '')));
  return '';
}

function resolveDirectDownloadFilename(url, fallback, rawHeaders) {
  const headers = parseLastHttpHeaders(rawHeaders);
  const hinted = filenameFromContentDisposition(headers['content-disposition']);
  let filename = hinted || filenameFromUrl(url, fallback);
  const ext = String(path.extname(filename || '') || '').replace('.', '').toLowerCase();
  const contentExt = extensionFromContentType(headers['content-type']);
  if ((!ext || ext === 'php' || ext === 'bin') && contentExt) {
    const stem = sanitizeName(path.basename(filename || fallback, path.extname(filename || fallback)) || `download_${Date.now()}`);
    filename = `${stem}.${contentExt}`;
  }
  const safe = sanitizeName(filename || '');
  return safe || fallback;
}

async function startDirectFileDownload(downloadId, url, platform, channel, title, metadata) {
  try {
    if (isCancelled(downloadId)) {
      clearCancelled(downloadId);
      jobLane.delete(downloadId);
      await updateDownloadStatus.run('cancelled', 0, null, downloadId);
      return;
    }

    // Probeer lage resolutie links van footfetishforum te upgraden
    url = upgradeKnownLowQualityMediaUrl(url);

    // Skip site infrastructure files (favicons, apple-touch-icons, etc.)
    if (/(?:^|[/])(?:apple-touch-icon|favicon|browserconfig)(?:[_.]|\.\w+$)/i.test(url)) {
      console.log(`[DL #${downloadId}] SKIP infrastructure URL: ${url}`);
      await updateDownloadStatus.run('cancelled', 0, null, downloadId);
      jobLane.delete(downloadId);
      return;
    }

    const pinContext = !!(metadata && typeof metadata === 'object' && !Array.isArray(metadata) && metadata.webdl_pin_context === true);
    const originThread = metadata && typeof metadata === 'object' && metadata.origin_thread && typeof metadata.origin_thread === 'object' ? metadata.origin_thread : null;
    const pinnedPlatform = String(originThread && originThread.platform ? originThread.platform : platform || '').toLowerCase();
    if (isKnownHtmlWrapperUrl(url)) {
      const directHint = upgradeKnownLowQualityMediaUrl(String(metadata && typeof metadata === 'object' && metadata.webdl_direct_hint ? metadata.webdl_direct_hint : '').trim());
      if (directHint && looksLikeDirectFileUrl(directHint) && directHint !== url) {
        try { await updateDownloadUrl.run(directHint, downloadId); } catch (e) { }
        url = directHint;
      }
    }
    if (isKnownHtmlWrapperUrl(url)) {
      const wrapperReferer = String(
        originThread && originThread.url ? originThread.url :
          metadata && typeof metadata === 'object' && metadata.url && metadata.url !== url ? metadata.url :
            ''
      ).trim();
      try {
        const resolved = await resolveHtmlWrapperToDirectMediaUrl(url, 15000, wrapperReferer);
        if (resolved && resolved !== url) {
          try { await updateDownloadUrl.run(resolved, downloadId); } catch (e) { }
          url = upgradeKnownLowQualityMediaUrl(resolved);
        }
      } catch (e) { }
      if (isKnownHtmlWrapperUrl(url)) {
        await updateDownloadStatus.run('error', 0, 'Kon wrapper media URL niet resolven naar een direct bestand', downloadId);
        return;
      }
    }

    await updateDownloadStatus.run('downloading', 0, null, downloadId);

    let dir = pinContext && pinnedPlatform === 'aznudefeet' ? getDownloadDirChannelOnly(platform, channel) : getDownloadDir(platform, channel, title);
    let meta = {};
    try {
      meta = await fetchMetadataWithTimeout(url, YTDLP_METADATA_TIMEOUT_MS);
      if (isCancelled(downloadId)) {
        clearCancelled(downloadId);
        jobLane.delete(downloadId);
        await updateDownloadStatus.run('cancelled', 0, null, downloadId);
        return;
      }
      const finalTitle = pinContext ? title : meta.title || title;
      // Keep original channel if it's already a meaningful value — yt-dlp returns
      // garbage for CDN image URLs (e.g., 'cdn.elitebabes.com' or empty)
      const metaChannel = meta.channel && meta.channel !== 'unknown' && !meta.channel.includes('cdn.') ? meta.channel : null;
      const finalChannel = pinContext ? channel : (channel && channel !== 'unknown' ? channel : metaChannel || channel);
      await updateDownloadMeta.run(finalTitle, finalChannel, meta.description, meta.duration, meta.thumbnail, JSON.stringify(meta.fullMeta), downloadId);
      title = finalTitle;
      channel = finalChannel;
      console.log(`   [#${downloadId}] ✅ Metadata: "${title}" door ${channel} (${meta.duration})`);
    } catch (e) {
      console.log(`   [#${downloadId}] ⚠️ Metadata ophalen mislukt: ${e.message}`);
    }

    dir = pinContext && pinnedPlatform === 'aznudefeet' ? getDownloadDirChannelOnly(platform, channel) : getDownloadDir(platform, channel, title);
    try { await updateDownloadFilepath.run(dir, downloadId); } catch (e) { }

    // Sla metadata op als JSON
    const metaFile = path.join(dir, 'metadata.json');
    fs.writeFileSync(metaFile, JSON.stringify({
      url,
      source_url: originThread && originThread.url ? originThread.url : metadata && metadata.url && metadata.url !== url ? metadata.url : null,
      platform,
      channel,
      title,
      description: meta.description || metadata?.description,
      duration: meta.duration,
      thumbnail: meta.thumbnail,
      origin_thread: originThread && originThread.url ? originThread : null,
      webdl_pin_context: pinContext,
      webdl_media_url: metadata && metadata.webdl_media_url ? metadata.webdl_media_url : url,
      webdl_detected_platform: metadata && metadata.webdl_detected_platform ? metadata.webdl_detected_platform : detectPlatform(url),
      downloadedAt: new Date().toISOString()
    }, null, 2));

    // Start yt-dlp download
    const abort2 = abortKind(downloadId);
    if (abort2) {
      applyAbortStatus(downloadId, abort2);
      return;
    }
    await updateDownloadStatus.run('downloading', 0, null, downloadId);

    const provisionalFilename = filenameFromUrl(url, `download_${downloadId}.bin`);
    const tmpFilepath = uniqueFilePath(path.join(dir, `${provisionalFilename}.part`), downloadId);
    const headerFilepath = uniqueFilePath(path.join(dir, `${provisionalFilename}.headers.txt`), downloadId);
    let referer = String(
      originThread && originThread.url ? originThread.url :
        metadata && typeof metadata === 'object' && metadata.url && metadata.url !== url ? metadata.url :
          ''
    ).trim();
    // Auto-referer for platforms that require it
    if (!referer && platform === 'elitebabes') referer = 'https://www.elitebabes.com/';
    if (!referer && platform === 'erome') referer = 'https://www.erome.com/';
    if (!referer && platform === 'zishy') referer = 'https://www.zishy.com/';
    const curlArgs = [
      '-L',
      '--fail',
      '--silent',
      '--show-error',
      '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    ];
    // For zishy: use Firefox cookies (user is logged in)
    if (platform === 'zishy') {
      try {
        const cookieStr = await loadCookiesForDomain('zishy.com');
        if (cookieStr) curlArgs.push('-b', cookieStr);
      } catch (e) {}
    }
    if (referer) curlArgs.push('-e', referer);
    curlArgs.push('-D', headerFilepath);
    curlArgs.push('-o', tmpFilepath, url);
    const proc = spawnNice('/usr/bin/curl', curlArgs);

    activeProcesses.set(downloadId, proc);
    try { startingJobs.delete(downloadId); } catch (e) { }
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.stdout.on('data', () => { });

    proc.on('close', async (code) => {
      activeProcesses.delete(downloadId);
      try {
        if (code === 0 && fs.existsSync(tmpFilepath)) {
          const rawHeaders = fs.existsSync(headerFilepath) ? fs.readFileSync(headerFilepath, 'utf8') : '';
          const filename = resolveDirectDownloadFilename(url, provisionalFilename, rawHeaders);
          const filepath = uniqueFilePath(path.join(dir, filename), downloadId);
          try {
            if (fs.existsSync(filepath)) {
              try { fs.rmSync(filepath, { force: true }); } catch (e) { }
            }
            fs.renameSync(tmpFilepath, filepath);
          } catch (e) {
            await updateDownloadStatus.run('error', 0, e.message, downloadId);
            return;
          }
          const size = fs.existsSync(filepath) ? fs.statSync(filepath).size : 0;
          const ext = (path.extname(filename).replace('.', '') || '').toLowerCase();
          const metaObj = { tool: 'curl', platform, channel, title, url, outputDir: dir };
          if (pinContext) {
            metaObj.webdl_pin_context = true;
            metaObj.origin_thread = originThread && originThread.url ? originThread : null;
            metaObj.webdl_media_url = metadata && metadata.webdl_media_url ? metadata.webdl_media_url : url;
            metaObj.webdl_detected_platform = metadata && metadata.webdl_detected_platform ? metadata.webdl_detected_platform : detectPlatform(url);
            if (originThread && originThread.url) metaObj.source_url = originThread.url;
          }

          const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
          if (isImage) {
            try {
              await updateDownloadThumbnail.run(`/download/${downloadId}/thumb`, downloadId);
              // Image files serve as their own thumbnail - mark ready immediately
              await db.prepare("UPDATE downloads SET is_thumb_ready = true WHERE id = ?").run(downloadId);
            } catch (e) { }
          }

          try {
            const relPath = path.relative(BASE_DIR, filepath);
            if (relPath && !relPath.startsWith('..')) {
              const indexedAt = new Date().toISOString();
              await upsertDownloadFile.run(downloadId, relPath, size, Math.floor(fs.statSync(filepath).mtimeMs), indexedAt, indexedAt);
            }
          } catch (e) { }

          await updateDownload.run('completed', 100, filepath, filename, size, ext || '', JSON.stringify(metaObj), null, downloadId);
        } else {
          await updateDownloadStatus.run('error', 0, stderr || `curl exit code: ${code}`, downloadId);
        }
      } finally {
        try { if (fs.existsSync(headerFilepath)) fs.rmSync(headerFilepath, { force: true }); } catch (e) { }
        try { recentFilesTopCache.clear(); } catch (e) { }
        try { runDownloadSchedulerSoon(); } catch (e) { }
        try { syncRuntimeActiveState().catch(() => { }); } catch (e) { }
      }
    });

    proc.on('error', async (err) => {
      activeProcesses.delete(downloadId);
      try {
        await updateDownloadStatus.run('error', 0, err.message, downloadId);
      } finally {
        try { runDownloadSchedulerSoon(); } catch (e) { }
        try { syncRuntimeActiveState().catch(() => { }); } catch (e) { }
      }
    });
  } catch (err) {
    await updateDownloadStatus.run('error', 0, err.message, downloadId);
  }
}

async function startTdlDownload(downloadId, url, platform, channel, title, metadata) {
  try {
    if (isCancelled(downloadId)) {
      clearCancelled(downloadId);
      jobLane.delete(downloadId);
      await updateDownloadStatus.run('cancelled', 0, null, downloadId);
      return;
    }
    const outChannel = channel && channel !== 'unknown' ? channel : deriveChannelFromUrl('telegram', url) || 'telegram';
    const dir = getDownloadDirChannelOnly('telegram', outChannel);
    try { await updateDownloadFilepath.run(dir, downloadId); } catch (e) { }
    await updateDownloadStatus.run('downloading', 0, null, downloadId);

    if (isTelegramInviteUrl(url)) {
      await updateDownloadStatus.run('error', 0, 'Telegram invite-links zoals t.me/+... of /joinchat/... worden niet ondersteund. Open een concrete kanaal-, chat- of berichtlink en probeer opnieuw.', downloadId);
      return;
    }

    const scriptPath = path.join(__dirname, '../../telegram-channel-download.py');
    if (!fs.existsSync(scriptPath)) {
      await updateDownloadStatus.run('error', 0, `Telegram downloader script niet gevonden: ${scriptPath}`, downloadId);
      return;
    }

    let chatId = '';
    try {
      const match = url.match(/t\.me\/c\/(\d+)|#(-?\d+)/);
      if (match) {
        chatId = match[1] || match[2];
      }
    } catch (e) { }

    if (!chatId) {
      await updateDownloadStatus.run('error', 0, 'Kon chat ID niet afleiden uit URL. Gebruik t.me/c/123456 formaat of web.telegram.org/#-123456', downloadId);
      return;
    }

    const args = [scriptPath, chatId, dir];
    const proc = spawn('python3', args, { env: { ...process.env, TELEGRAM_PHONE: process.env.TELEGRAM_PHONE || '' } });
    activeProcesses.set(downloadId, proc);
    try { startingJobs.delete(downloadId); } catch (e) { }
    let stderr = '';
    let stdout = '';
    proc.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-200000); });
    proc.stdout.on('data', (d) => {
      stdout = (stdout + d.toString()).slice(-200000);
      const lines = d.toString().split('\n');
      for (const line of lines) {
        if (line.includes('✅ [') && line.includes('] Downloaded:')) {
          const match = line.match(/\[(\d+)\]/);
          if (match) {
            const count = parseInt(match[1], 10);
            updateDownloadStatus.run('downloading', Math.min(99, count * 5), null, downloadId).catch(() => { });
          }
        }
      }
    });

    proc.on('close', async (code) => {
      activeProcesses.delete(downloadId);
      const hasFiles = dirHasAnyMediaFiles(dir);
      if (code === 0 && hasFiles) {
        const mediaSummary = summarizeMediaDir(dir, 12000);
        const safeCount = Number.isFinite(Number(mediaSummary && mediaSummary.count)) ? Math.max(0, Number(mediaSummary.count)) : 0;
        const safeBytes = Number.isFinite(Number(mediaSummary && mediaSummary.totalBytes)) ? Math.max(0, Number(mediaSummary.totalBytes)) : 0;

        try {
          const files = fs.readdirSync(dir);
          let _yieldIdx = 0;
          for (const file of files) {
            try {
              const fullPath = path.join(dir, file);
              const st = fs.statSync(fullPath);
              // Skip gallery-dl downloaded thumbnails/logos (not server-generated ones)
              if (file.endsWith('_thumb.jpg') || file.endsWith('_thumb.png') || file.endsWith('_logo.jpg') || file.endsWith('_logo.png')) continue;
              if (st.isFile() && /\.(mp4|webm|mkv|avi|mov|jpg|jpeg|png|gif|webp)$/i.test(file)) {
                const relPath = path.relative(BASE_DIR, fullPath);
                if (relPath && !relPath.startsWith('..')) {
                  const indexedAt = new Date().toISOString();
                  await upsertDownloadFile.run(downloadId, relPath, st.size, Math.floor(st.mtimeMs), indexedAt, indexedAt);
                }
              }
            } catch (e) { }
            if (++_yieldIdx % 10 === 0) await yieldEventLoop();
          }
          console.log(`   📂 Geïndexeerd: ${safeCount} files voor download #${downloadId}`);
        } catch (e) {
          console.log(`   ⚠️  Indexing fout: ${e.message}`);
        }

        const metaObj = {
          tool: 'telegram_telethon',
          platform: 'telegram',
          channel: outChannel,
          title,
          url,
          outputDir: dir,
          media_count: safeCount,
          media_bytes: safeBytes
        };
        await updateDownload.run('completed', 100, dir, safeCount > 1 ? `(multiple: ${safeCount} files)` : '(multiple)', safeBytes, '', JSON.stringify(metaObj), null, downloadId);
        recentFilesTopCache.clear();
        try { runDownloadSchedulerSoon(); } catch (e) { }
        try { syncRuntimeActiveState().catch(() => { }); } catch (e) { }
        return;
      }
      const msg = String(stderr || stdout || `telegram-channel-download exit code: ${code}`).trim();
      await updateDownloadStatus.run('error', 0, msg.slice(0, 4000), downloadId);
      try { runDownloadSchedulerSoon(); } catch (e) { }
      try { syncRuntimeActiveState().catch(() => { }); } catch (e) { }
    });

    proc.on('error', async (err) => {
      activeProcesses.delete(downloadId);
      await updateDownloadStatus.run('error', 0, err.message, downloadId);
      try { runDownloadSchedulerSoon(); } catch (e) { }
      try { syncRuntimeActiveState().catch(() => { }); } catch (e) { }
    });
  } catch (err) {
    await updateDownloadStatus.run('error', 0, err.message, downloadId);
  }
}

async function startOfscraperDownload(downloadId, url, platform, channel, title, metadata) {
  try {
    if (isCancelled(downloadId)) {
      clearCancelled(downloadId);
      jobLane.delete(downloadId);
      await updateDownloadStatus.run('cancelled', 0, null, downloadId);
      return;
    }
    const user = channel && channel !== 'unknown' ? channel : deriveChannelFromUrl('onlyfans', url);
    if (!user) {
      await updateDownloadStatus.run('error', 0, 'OnlyFans: kon geen model/username afleiden uit URL. Open de modelpagina (onlyfans.com/<username>) en probeer opnieuw.', downloadId);
      return;
    }
    const outChannel = user || 'unknown';
    const dir = getDownloadDirChannelOnly('onlyfans', outChannel);

    try { await updateDownloadFilepath.run(dir, downloadId); } catch (e) { }

    await updateDownloadStatus.run('downloading', 0, null, downloadId);

    try {
      if (!fs.existsSync(OFSCRAPER)) {
        await updateDownloadStatus.run('error', 0, `ofscraper niet gevonden: ${OFSCRAPER}`, downloadId);
        return;
      }
    } catch (e) {
      await updateDownloadStatus.run('error', 0, `ofscraper niet gevonden: ${OFSCRAPER}`, downloadId);
      return;
    }

    const cfgDir = path.join(os.tmpdir(), `webdl-ofscraper-${downloadId}-${Date.now()}`);
    if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });
    const cfgPath = path.join(cfgDir, 'config.json');

    try {
      if (OFSCRAPER_CONFIG_DIR && fs.existsSync(OFSCRAPER_CONFIG_DIR)) {
        for (const name of fs.readdirSync(OFSCRAPER_CONFIG_DIR)) {
          const src = path.join(OFSCRAPER_CONFIG_DIR, name);
          const dst = path.join(cfgDir, name);
          fs.cpSync(src, dst, { recursive: true, force: true });
        }
      }
    } catch (e) { }

    const normalizeAuthJsonInPlace = (authPath) => {
      try {
        if (!fs.existsSync(authPath)) return false;
        const raw = fs.readFileSync(authPath, 'utf8') || '';
        if (!raw.trim()) return false;

        try {
          JSON.parse(raw);
          return true;
        } catch (e) { }

        if (!raw.startsWith('{\\rtf')) return false;

        const first = raw.indexOf('\\{');
        const last = raw.lastIndexOf('\\}');
        if (first === -1 || last === -1 || last <= first) return false;

        let jsonish = raw.slice(first, last + 2);
        jsonish = jsonish.replace(/\\\r?\n/g, '');
        jsonish = jsonish.replace(/\\([{}])/g, '$1');
        jsonish = jsonish.replace(/\\$/gm, '');
        const obj = JSON.parse(jsonish);
        fs.writeFileSync(authPath, JSON.stringify(obj, null, 2));
        return true;
      } catch (e) {
        return false;
      }
    };

    try {
      const authPath = path.join(cfgDir, 'auth.json');
      normalizeAuthJsonInPlace(authPath);
      if (!fs.existsSync(authPath)) {
        await updateDownloadStatus.run('error', 0, 'OnlyFans: ofscraper auth ontbreekt (auth.json). Run ofscraper één keer handmatig om auth aan te maken, of zet WEBDL_OFSCRAPER_CONFIG_DIR naar je ofscraper config map.', downloadId);
        try {
          if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
        } catch (e) { }
        return;
      }

      try {
        const raw = fs.readFileSync(authPath, 'utf8') || '';
        const parsed = JSON.parse(raw);

        let cookieStr = '';
        try {
          if (parsed && typeof parsed === 'object' && parsed.auth && typeof parsed.auth === 'object') {
            cookieStr = String(parsed.auth.cookie || '');
          }
        } catch (e) { cookieStr = ''; }

        const hasSess = /(?:^|;\s*)sess=([^;]+)/i.test(cookieStr);
        if (!hasSess) {
          await updateDownloadStatus.run('error', 0, 'OnlyFans: auth.json cookie export lijkt incompleet/verkeerd (sess ontbreekt). Exporteer cookies opnieuw (bijv. OnlyFans Cookie Helper) en zorg dat auth.json als *platte JSON* is opgeslagen (geen TextEdit/RTF).', downloadId);
          try {
            if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
          } catch (e) { }
          return;
        }

        try {
          const profileAuthPath = path.join(cfgDir, 'main_profile', 'auth.json');
          fs.mkdirSync(path.dirname(profileAuthPath), { recursive: true });
          fs.writeFileSync(profileAuthPath, JSON.stringify(parsed, null, 2));
        } catch (e) { }
      } catch (e) {
        await updateDownloadStatus.run('error', 0, 'OnlyFans: je ofscraper auth.json is geen geldige JSON (lijkt als RTF/TextEdit opgeslagen). Fix auth.json (exporteer opnieuw cookies) en probeer opnieuw.', downloadId);
        try {
          if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
        } catch (e) { }
        return;
      }
    } catch (e) { }

    try {
      let cfg = {};
      try {
        if (fs.existsSync(cfgPath)) {
          const raw = fs.readFileSync(cfgPath, 'utf8');
          cfg = raw && raw.trim() ? JSON.parse(raw) : {};
        }
      } catch (e) {
        cfg = {};
      }
      if (!cfg || typeof cfg !== 'object') cfg = {};
      if (!cfg.file_options || typeof cfg.file_options !== 'object') cfg.file_options = {};
      cfg.file_options.save_location = dir;

      const sems = parseInt(process.env.WEBDL_OFSCRAPER_DOWNLOAD_SEMS || '1', 10);
      if (!cfg.performance_options || typeof cfg.performance_options !== 'object') cfg.performance_options = {};
      cfg.performance_options.download_sems = Number.isFinite(sems) && sems > 0 ? sems : 1;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    } catch (e) { }

    const proc = spawnNice(OFSCRAPER, [
      '-cg', cfgDir,
      '-p', 'stats',
      '--action', 'download',
      '--download-area', 'all',
      '--usernames', user,
      '--auth-quit']
    );

    activeProcesses.set(downloadId, proc);
    try { startingJobs.delete(downloadId); } catch (e) { }

    const CAPTURE_LIMIT = 200000;
    let stderr = '';
    let stdout = '';
    proc.stderr.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-CAPTURE_LIMIT);
    });
    proc.stdout.on('data', (d) => {
      stdout = (stdout + d.toString()).slice(-CAPTURE_LIMIT);
    });

    const getInternalLogTail = () => {
      try {
        const root = path.join(cfgDir, 'logging');
        if (!fs.existsSync(root)) return '';
        const stack = [root];
        let newest = null;
        let newestMtime = 0;
        while (stack.length) {
          const cur = stack.pop();
          let entries = [];
          try {
            entries = fs.readdirSync(cur, { withFileTypes: true });
          } catch (e) {
            entries = [];
          }
          for (const ent of entries) {
            const full = path.join(cur, ent.name);
            if (ent.isDirectory()) {
              stack.push(full);
              continue;
            }
            if (!ent.isFile()) continue;
            if (!ent.name.endsWith('.log')) continue;
            let st = null;
            try { st = fs.statSync(full); } catch (e) { st = null; }
            const m = st ? st.mtimeMs : 0;
            if (m >= newestMtime) {
              newestMtime = m;
              newest = full;
            }
          }
        }
        if (!newest) return '';
        const st = fs.statSync(newest);
        const start = Math.max(0, st.size - 50000);
        const fd = fs.openSync(newest, 'r');
        try {
          const buf = Buffer.alloc(st.size - start);
          fs.readSync(fd, buf, 0, buf.length, start);
          return buf.toString('utf8');
        } finally {
          try { fs.closeSync(fd); } catch (e) { }
        }
      } catch (e) {
        return '';
      }
    };

    const safeWriteLog = (exitCodeLabel) => {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const logPath = path.join(dir, `_ofscraper_${downloadId}.log`);
        const internal = getInternalLogTail();
        const combined = `exit_code=${exitCodeLabel}\n\n--- stdout ---\n${stdout}\n\n--- stderr ---\n${stderr}\n\n--- ofscraper_log ---\n${internal}\n`;
        fs.writeFileSync(logPath, combined.slice(-200000));
        return logPath;
      } catch (e) {
        return null;
      }
    };

    const startMs = Date.now();
    const timeoutMs = parseInt(process.env.WEBDL_OFSCRAPER_TIMEOUT_MS || String(2 * 60 * 60 * 1000), 10);
    let aborted = false;
    const timeoutTimer = setTimeout(async () => {
      if (aborted) return;
      aborted = true;

      const logPath = safeWriteLog(`timeout_${timeoutMs}ms`);
      const internal = getInternalLogTail();
      const tail = (stderr || stdout || internal || '').toString().slice(-2000);

      const combined = `${stdout}\n${stderr}\n${internal}`;
      const m = combined.match(/\(?\s*(\d+)\s+downloads\s+total\s*\[\s*(\d+)\s+videos\s*,\s*(\d+)\s+audios\s*,\s*(\d+)\s+photos\s*\]\s*,\s*(\d+)\s+skipped\s*,\s*(\d+)\s+failed\s*\)?/i);
      const summary = m ? `Stand: ${m[1]} items totaal [${m[2]} videos, ${m[4]} fotos], ${m[5]} skipped, ${m[6]} failed.` : '';

      const dirHasAnyFiles = () => {
        try {
          if (!fs.existsSync(dir)) return false;
          const stack = [dir];
          while (stack.length) {
            const cur = stack.pop();
            const entries = fs.readdirSync(cur, { withFileTypes: true });
            for (const ent of entries) {
              if (ent.name.startsWith('.')) continue;
              if (ent.isFile() && ent.name.startsWith('_ofscraper_') && ent.name.endsWith('.log')) continue;
              if (ent.isFile() && ent.name === '.DS_Store') continue;
              const full = path.join(cur, ent.name);
              if (ent.isFile()) return true;
              if (ent.isDirectory()) stack.push(full);
            }
          }
          return false;
        } catch (e) {
          return false;
        }
      };

      const hasFiles = dirHasAnyFiles();
      const resumeHint = hasFiles ? ' Er staan al bestanden in de output map. Druk nogmaals op Download om verder te gaan (of verhoog timeout).' : '';
      await updateDownloadStatus.run('error', 0, `OnlyFans: ofscraper timeout na ${Math.round((Date.now() - startMs) / 1000)}s. ${summary}${resumeHint} Log: ${logPath || 'n/a'}${tail ? `\n\n${tail}` : ''}`.trim(), downloadId);

      try {
        proc.kill('SIGTERM');
        setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch (e) { }
        }, 5000);
      } catch (e) { }

      try {
        activeProcesses.delete(downloadId);
        jobLane.delete(downloadId);
        runDownloadSchedulerSoon();
      } catch (e) { }
    }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20 * 60 * 1000);

    proc.on('close', async (code) => {
      activeProcesses.delete(downloadId);

      try { clearTimeout(timeoutTimer); } catch (e) { }
      if (aborted) {
        try {
          if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
        } catch (e) { }
        try { runDownloadSchedulerSoon(); } catch (e) { }
        try { syncRuntimeActiveState().catch(() => { }); } catch (e) { }
        return;
      }

      const dirHasAnyFiles = () => {
        try {
          if (!fs.existsSync(dir)) return false;
          const stack = [dir];
          while (stack.length) {
            const cur = stack.pop();
            const entries = fs.readdirSync(cur, { withFileTypes: true });
            for (const ent of entries) {
              if (ent.name.startsWith('.')) continue;
              if (ent.isFile() && ent.name.startsWith('_ofscraper_') && ent.name.endsWith('.log')) continue;
              if (ent.isFile() && ent.name === '.DS_Store') continue;
              const full = path.join(cur, ent.name);
              if (ent.isFile()) return true;
              if (ent.isDirectory()) stack.push(full);
            }
          }
          return false;
        } catch (e) {
          return false;
        }
      };

      if (code === 0) {
        const hasFiles = dirHasAnyFiles();
        if (!hasFiles) {
          const logPath = safeWriteLog(String(code));
          const internal = getInternalLogTail();
          const tail = (stderr || stdout || internal || '').toString().slice(-2000);
          const combined = `${stdout}\n${stderr}\n${internal}`.toLowerCase();
          const isAuthIssue = combined.includes('auth failed') || combined.includes('auth.json') || combined.includes('checking auth status');
          const msg = isAuthIssue ?
            `OnlyFans: inloggen/auth mislukt (auth.json ontbreekt/ongeldig/verlopen of geen toegang). Log: ${logPath || '(kon log niet schrijven)'}${tail ? `\n\n${tail}` : ''}` :
            `OnlyFans: ofscraper klaar maar output map is leeg. Oorzaken: geen toegang/subscription, geen media, alles locked, ofscraper config mismatch. Log: ${logPath || '(kon log niet schrijven)'}${tail ? `\n\n${tail}` : ''}`;
          await updateDownloadStatus.run('error', 0, msg, downloadId);
          try {
            if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
          } catch (e) { }
          try { runDownloadSchedulerSoon(); } catch (e) { }
          try { syncRuntimeActiveState().catch(() => { }); } catch (e) { }
          return;
        }
        const metaObj = { tool: 'ofscraper', platform: 'onlyfans', channel: outChannel, title, url, outputDir: dir };
        await indexDownloadDirImmediately(downloadId);
        await updateDownload.run('completed', 100, dir, '(multiple)', 0, '', JSON.stringify(metaObj), null, downloadId);
      } else {
        const hasFiles = dirHasAnyFiles();
        const logPath = safeWriteLog(String(code));
        const internal = getInternalLogTail();
        const tail = (stderr || stdout || internal || '').toString().slice(-2000);

        if (hasFiles) {
          const metaObj = {
            tool: 'ofscraper',
            platform: 'onlyfans',
            channel: outChannel,
            title,
            url,
            outputDir: dir,
            warning: {
              exitCode: code,
              tail: tail || null,
              logPath: logPath || null
            }
          };
          await indexDownloadDirImmediately(downloadId);
          await updateDownload.run('completed', 100, dir, '(multiple)', 0, '', JSON.stringify(metaObj), null, downloadId);
        } else {
          await updateDownloadStatus.run('error', 0, tail || `ofscraper exit code: ${code} (log: ${logPath || 'n/a'})`, downloadId);
        }
      }

      try {
        if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
      } catch (e) { }
      try { runDownloadSchedulerSoon(); } catch (e) { }
      try { syncRuntimeActiveState().catch(() => { }); } catch (e) { }
    });

    proc.on('error', async (err) => {
      activeProcesses.delete(downloadId);
      try {
        if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
      } catch (e) { }
      await updateDownloadStatus.run('error', 0, err.message, downloadId);
      try { runDownloadSchedulerSoon(); } catch (e) { }
      try { syncRuntimeActiveState().catch(() => { }); } catch (e) { }
    });
  } catch (err) {
    await updateDownloadStatus.run('error', 0, err.message, downloadId);
  }
}

async function startGalleryDlDownload(downloadId, url, platform, channel, title, metadata) {
  try {
    if (isCancelled(downloadId)) {
      clearCancelled(downloadId);
      jobLane.delete(downloadId);
      await updateDownloadStatus.run('cancelled', 0, null, downloadId);
      return;
    }

    const outChannel = channel && channel !== 'unknown' ? channel : deriveChannelFromUrl(platform, url) || 'unknown';
    const outTitle = title && !title.startsWith('https_') && title !== 'untitled' ? title : deriveTitleFromUrl(url) || title;
    const dir = getDownloadDirChannelOnly(platform, outChannel);

    try { await updateDownloadFilepath.run(dir, downloadId); } catch (e) { }
    // Update channel + title in DB if we derived better values
    try {
      if (outChannel !== channel || outTitle !== title) {
        await db.prepare(
          db.isPostgres
            ? 'UPDATE downloads SET channel = $1, title = $2 WHERE id = $3'
            : 'UPDATE downloads SET channel = ?, title = ? WHERE id = ?'
        ).run(outChannel, outTitle, downloadId);
      }
    } catch (e) { }

    await updateDownloadStatus.run('downloading', 0, null, downloadId);

    try {
      if (!fs.existsSync(GALLERY_DL)) {
        await updateDownloadStatus.run('error', 0, `gallery-dl niet gevonden: ${GALLERY_DL}`, downloadId);
        return;
      }
    } catch (e) {
      await updateDownloadStatus.run('error', 0, `gallery-dl niet gevonden: ${GALLERY_DL}`, downloadId);
      return;
    }

    const gdlArgs = [url];
    // For Twitter/X: download entire conversation thread (all replies with media)
    // Needs Firefox cookies for authenticated timeline access (conversations API)
    if (platform === 'twitter') {
      gdlArgs.unshift('--cookies-from-browser', 'firefox', '-o', 'conversations=true', '-o', 'replies=true');
    }
    const proc = spawnNice(GALLERY_DL, gdlArgs, { cwd: dir });
    activeProcesses.set(downloadId, proc);
    try { startingJobs.delete(downloadId); } catch (e) { }

    // Timeout: kill gallery-dl after 5 minutes to prevent hanging on blocked sites
    const gdlTimeout = setTimeout(() => {
      try {
        console.log(`⏰ [DL #${downloadId}] gallery-dl timeout (5min), killing process`);
        proc.kill('SIGTERM');
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) {} }, 3000);
      } catch (e) {}
    }, 5 * 60 * 1000);

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.stdout.on('data', () => { });

    proc.on('close', async (code) => {
      activeProcesses.delete(downloadId);
      if (code === 0) {
        // Index all downloaded files
        try {
          const files = listMediaFilesInDir(dir);
          let indexed = 0;
          for (const fullPath of files) {
            try {
              const file = path.basename(fullPath);
              const st = fs.statSync(fullPath);
              // Skip gallery-dl downloaded thumbnails/logos (not server-generated ones)
              if (file.endsWith('_thumb.jpg') || file.endsWith('_thumb.png') || file.endsWith('_logo.jpg') || file.endsWith('_logo.png')) continue;
              if (st.isFile()) {
                const relPath = path.relative(BASE_DIR, fullPath);
                if (relPath && !relPath.startsWith('..')) {
                  const indexedAt = new Date().toISOString();
                  await upsertDownloadFile.run(downloadId, relPath, st.size, Math.floor(st.mtimeMs), indexedAt, indexedAt);
                  indexed++;
                }
              }
            } catch (e) { }
            if (indexed % 10 === 0) await yieldEventLoop();
          }
          console.log(`   📂 Geïndexeerd: ${indexed} files voor download #${downloadId}`);
          recentFilesTopCache.clear();

          // Post-download channel derivation: if channel is still 'unknown', try to derive from gallery-dl output
          if (!outChannel || outChannel === 'unknown') {
            try {
              let betterChannel = null;
              for (const fullPath of files) {
                const relFromDir = path.relative(dir, fullPath);
                // gallery-dl/pornpics/94245654 Gallery Title/file.jpg
                const gdMatch = relFromDir.match(/gallery-dl\/pornpics\/(?:\d+\s+)?([^\/]+)\//i);
                if (gdMatch && gdMatch[1]) {
                  betterChannel = gdMatch[1];
                  break;
                }
              }
              if (betterChannel) {
                await db.prepare(
                  db.isPostgres
                    ? 'UPDATE downloads SET channel = $1 WHERE id = $2'
                    : 'UPDATE downloads SET channel = ? WHERE id = ?'
                ).run(betterChannel, downloadId);
                console.log(`   📝 Channel afgeleid: "${betterChannel}" voor download #${downloadId}`);
              }
            } catch (e) { }
          }
        } catch (e) {
          console.log(`   ⚠️  Indexing fout: ${e.message}`);
        }

        const metaObj = { tool: 'gallery-dl', platform, channel: outChannel, title, url, outputDir: dir };
        await updateDownload.run('completed', 100, dir, '(multiple)', 0, '', JSON.stringify(metaObj), null, downloadId);
        try { runDownloadSchedulerSoon(); } catch (e) { }
        try { syncRuntimeActiveState().catch(() => { }); } catch (e) { }
      } else {
        await updateDownloadStatus.run('error', 0, stderr || `gallery-dl exit code: ${code}`, downloadId);
        try { runDownloadSchedulerSoon(); } catch (e) { }
        try { syncRuntimeActiveState().catch(() => { }); } catch (e) { }
      }
    });

    proc.on('error', async (err) => {
      activeProcesses.delete(downloadId);
      await updateDownloadStatus.run('error', 0, err.message, downloadId);
      try { runDownloadSchedulerSoon(); } catch (e) { }
      try { syncRuntimeActiveState().catch(() => { }); } catch (e) { }
    });
  } catch (err) {
    await updateDownloadStatus.run('error', 0, err.message, downloadId);
  }
}

// ─── Kinky.nl custom scraper ────────────────────────────────────────────────
async function startKinkyNlDownload(downloadId, url, platform, channel, title, metadata) {
  try {
    if (isCancelled(downloadId)) {
      clearCancelled(downloadId);
      jobLane.delete(downloadId);
      await updateDownloadStatus.run('cancelled', 0, null, downloadId);
      return;
    }

    // Derive model name from URL: /advertenties/1145607-palmy -> palmy
    const urlMatch = String(url).match(/advertenties\/\d+-(\w[\w-]*)/i);
    const modelName = urlMatch ? urlMatch[1] : (channel || 'unknown');
    const outChannel = modelName;
    const dir = getDownloadDirChannelOnly(platform, outChannel);

    try { await updateDownloadFilepath.run(dir, downloadId); } catch (e) { }
    try {
      await db.prepare(
        db.isPostgres
          ? 'UPDATE downloads SET channel = $1, title = $2 WHERE id = $3'
          : 'UPDATE downloads SET channel = ?, title = ? WHERE id = ?'
      ).run(outChannel, modelName, downloadId);
    } catch (e) { }
    await updateDownloadStatus.run('downloading', 0, null, downloadId);

    console.log(`[DL #${downloadId}] KINKY.NL scraper voor "${modelName}" → ${dir}`);

    // Fetch the profile page HTML
    const https = require('https');
    const http = require('http');
    const fetchPage = (pageUrl) => new Promise((resolve, reject) => {
      const mod = pageUrl.startsWith('https') ? https : http;
      const req = mod.get(pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchPage(res.headers.location).then(resolve).catch(reject);
        }
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => resolve(body));
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    });

    // Clean URL: strip #photos fragment
    const cleanUrl = String(url).replace(/#.*$/, '');
    let html;
    try {
      html = await fetchPage(cleanUrl);
    } catch (e) {
      await updateDownloadStatus.run('error', 0, `Kon kinky.nl pagina niet laden: ${e.message}`, downloadId);
      try { runDownloadSchedulerSoon(); } catch (e) { }
      return;
    }

    // Extract profilePhotos JSON from page
    const photosMatch = html.match(/profilePhotos\s*=\s*`(\[.*?\])`/s);
    if (!photosMatch) {
      await updateDownloadStatus.run('error', 0, 'Geen foto data gevonden op kinky.nl pagina', downloadId);
      try { runDownloadSchedulerSoon(); } catch (e) { }
      return;
    }

    let photos;
    try {
      photos = JSON.parse(photosMatch[1]);
    } catch (e) {
      await updateDownloadStatus.run('error', 0, `Foto JSON parse fout: ${e.message}`, downloadId);
      try { runDownloadSchedulerSoon(); } catch (e) { }
      return;
    }

    if (!photos.length) {
      await updateDownloadStatus.run('error', 0, 'Geen fotos gevonden', downloadId);
      try { runDownloadSchedulerSoon(); } catch (e) { }
      return;
    }

    // Extract userId from photo source (e.g. /i/1827260/profile/...)
    const uidMatch = photos[0].source.match(/\/i\/(\d+)\//);
    const userId = uidMatch ? uidMatch[1] : null;
    if (!userId) {
      await updateDownloadStatus.run('error', 0, 'Kon userId niet bepalen', downloadId);
      try { runDownloadSchedulerSoon(); } catch (e) { }
      return;
    }

    // Extract version param from source
    const verMatch = photos[0].source.match(/[?&]v=([^&]+)/);
    const version = verMatch ? verMatch[1] : '';

    console.log(`   📸 ${photos.length} foto's gevonden voor ${modelName} (userId=${userId})`);

    // Also check for video thumbnails
    const videoHashes = [];
    const videoThumbMatches = html.matchAll(/\/i\/\d+\/profile\/([a-f0-9-]+)_thumb60_01\.webp/g);
    for (const vm of videoThumbMatches) {
      if (!videoHashes.includes(vm[1])) videoHashes.push(vm[1]);
    }
    if (videoHashes.length) {
      console.log(`   🎬 ${videoHashes.length} video thumbnail(s) gevonden`);
    }

    // Download all photos
    const downloadFile = (fileUrl, dest) => new Promise((resolve, reject) => {
      const mod = fileUrl.startsWith('https') ? https : http;
      const req = mod.get(fileUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': cleanUrl } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const ws = fs.createWriteStream(dest);
        res.pipe(ws);
        ws.on('finish', () => resolve(dest));
        ws.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    });

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let downloaded = 0;
    let errors = 0;
    const totalItems = photos.length;

    for (let i = 0; i < photos.length; i++) {
      if (isCancelled(downloadId)) {
        clearCancelled(downloadId);
        await updateDownloadStatus.run('cancelled', 0, null, downloadId);
        return;
      }

      const photo = photos[i];
      const hash = photo.hash;
      const baseUrl = `https://www.kinky.nl/i/${userId}/profile/${hash}`;
      // Try _profile.webp first (full-size), fallback to _thumb_420.webp
      const fullUrl = `${baseUrl}_profile.webp${version ? '?v=' + version : ''}`;
      const filename = `${modelName}_${i + 1}_${hash}.webp`;
      const dest = path.join(dir, filename);

      if (fs.existsSync(dest)) {
        downloaded++;
        const pct = Math.round((downloaded / totalItems) * 100);
        try { await updateDownloadStatus.run('downloading', pct, null, downloadId); } catch (e) { }
        continue;
      }

      try {
        await downloadFile(fullUrl, dest);
        downloaded++;
        const pct = Math.round((downloaded / totalItems) * 100);
        try { await updateDownloadStatus.run('downloading', pct, null, downloadId); } catch (e) { }
        console.log(`   ✅ [${downloaded}/${totalItems}] ${filename}`);
      } catch (e) {
        errors++;
        console.log(`   ❌ [${i + 1}/${totalItems}] ${filename}: ${e.message}`);
      }

      // Small delay to be polite
      await new Promise(r => setTimeout(r, 200));
    }

    // Index downloaded files
    try {
      const entries = fs.readdirSync(dir).filter(f => /\.(webp|jpg|jpeg|png|gif|mp4|mkv)$/i.test(f));
      const now = Date.now();
      for (const entry of entries) {
        const fp = path.join(dir, entry);
        try {
          const st = fs.statSync(fp);
          const relpath = path.relative(path.resolve(BASE_DIR), fp);
          await upsertDownloadFile.run(downloadId, relpath, st.size || 0, Math.round(st.mtimeMs || now), now, now);
        } catch (e) { }
        if (entries.indexOf(entry) % 10 === 9) await yieldEventLoop();
      }
      console.log(`   📂 Geïndexeerd: ${entries.length} files voor download #${downloadId}`);
    } catch (e) {
      console.log(`   ⚠️  Indexing fout: ${e.message}`);
    }

    if (downloaded > 0) {
      const metaObj = { tool: 'kinky-scraper', platform, channel: outChannel, modelName, title, url, photoCount: photos.length, downloaded, errors, outputDir: dir };
      await updateDownload.run('completed', 100, dir, '(multiple)', 0, '', JSON.stringify(metaObj), null, downloadId);
      // Set source_url so SOURCE button appears in gallery
      try {
        await db.prepare(
          db.isPostgres
            ? 'UPDATE downloads SET source_url = $1 WHERE id = $2'
            : 'UPDATE downloads SET source_url = ? WHERE id = ?'
        ).run(url, downloadId);
      } catch (e) { }
      console.log(`[DL #${downloadId}] COMPLETED kinky/${modelName} | ${downloaded} foto's | ${errors} fouten`);
    } else {
      await updateDownloadStatus.run('error', 0, `Geen fotos gedownload (${errors} fouten)`, downloadId);
    }
    try { runDownloadSchedulerSoon(); } catch (e) { }
    try { syncRuntimeActiveState().catch(() => { }); } catch (e) { }
  } catch (err) {
    await updateDownloadStatus.run('error', 0, err.message, downloadId);
    try { runDownloadSchedulerSoon(); } catch (e) { }
  }
}

async function startInstaloaderDownload(downloadId, url, platform, channel, title, metadata) {
  try {
    if (isCancelled(downloadId)) {
      clearCancelled(downloadId);
      jobLane.delete(downloadId);
      await updateDownloadStatus.run('cancelled', 0, null, downloadId);
      return;
    }

    const outChannel = channel && channel !== 'unknown' ? channel : deriveChannelFromUrl('instagram', url) || 'unknown';
    const dir = getDownloadDirChannelOnly('instagram', outChannel);
    try { await updateDownloadFilepath.run(dir, downloadId); } catch (e) { }
    await updateDownloadStatus.run('downloading', 0, null, downloadId);

    try {
      if (!fs.existsSync(INSTALOADER)) {
        console.warn(`[#${downloadId}] instaloader niet gevonden, fallback naar yt-dlp: ${INSTALOADER}`);
        return startYtDlpDownload(downloadId, url, platform, channel, title, metadata);
      }
    } catch (e) {
      console.warn(`[#${downloadId}] instaloader check mislukt, fallback naar yt-dlp: ${e.message}`);
      return startYtDlpDownload(downloadId, url, platform, channel, title, metadata);
    }

    const igTarget = normalizeInstagramTarget(url, outChannel) || url;
    const baseArgs = [
      '--dirname-pattern', dir,
      '--filename-pattern', '{profile}_{shortcode}_{date_utc:%Y-%m-%d_%H-%M-%S}',
      '--no-compress-json',
      '--no-profile-pic'];

    const argCandidates = [];
    argCandidates.push([...baseArgs, '--', igTarget]);
    if (String(igTarget) !== String(url)) argCandidates.push([...baseArgs, '--', String(url)]);

    const runAttempt = (args) => new Promise((resolve) => {
      const proc = spawnNice(INSTALOADER, args);
      activeProcesses.set(downloadId, proc);
      try { startingJobs.delete(downloadId); } catch (e) { }

      let stderr = '';
      let stdout = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.on('close', (code) => {
        activeProcesses.delete(downloadId);
        resolve({ code, stderr, stdout, args });
      });
      proc.on('error', (err) => {
        activeProcesses.delete(downloadId);
        resolve({ code: -1, stderr: err.message, stdout: '', args });
      });
    });

    let last = { code: -1, stderr: '', stdout: '', args: [] };
    for (const args of argCandidates) {
      last = await runAttempt(args);
      if (last.code === 0 && dirHasAnyMediaFiles(dir)) break;
    }

    if (last.code === 0 && dirHasAnyMediaFiles(dir)) {
      const metaObj = { tool: 'instaloader', platform: 'instagram', channel: outChannel, title, url, target: igTarget, outputDir: dir };
      await indexDownloadDirImmediately(downloadId);
      await updateDownload.run('completed', 100, dir, '(multiple)', 0, '', JSON.stringify(metaObj), null, downloadId);
      return;
    }
    console.warn(`[#${downloadId}] instaloader gaf geen media, fallback naar yt-dlp`);
    return startYtDlpDownload(downloadId, url, platform, channel, title, metadata);
  } catch (err) {
    await updateDownloadStatus.run('error', 0, err.message, downloadId);
  }
}

async function startYtDlpDownload(downloadId, url, platform, channel, title, metadata) {
  try {
    const abort0 = abortKind(downloadId);
    if (abort0) {
      applyAbortStatus(downloadId, abort0);
      return;
    }
    const forceDuplicates = !!(metadata && typeof metadata === 'object' && !Array.isArray(metadata) && (metadata.webdl_force === true || metadata.force === true));
    const pinContext = !!(metadata && typeof metadata === 'object' && !Array.isArray(metadata) && metadata.webdl_pin_context === true);
    const originThread = metadata && typeof metadata === 'object' && metadata.origin_thread && typeof metadata.origin_thread === 'object' ? metadata.origin_thread : null;
    const skipMetadataFetch = shouldSkipMetadataFetchForUrl(url, platform);
    // Haal metadata op als we die nog niet hebben
    if (!skipMetadataFetch) console.log(`   [#${downloadId}] Metadata ophalen...`);
    let meta = {};
    if (!skipMetadataFetch) {
      try {
        meta = await fetchMetadataWithTimeout(url, YTDLP_METADATA_TIMEOUT_MS);
        const abort1 = abortKind(downloadId);
        if (abort1) {
          applyAbortStatus(downloadId, abort1);
          return;
        }
        // For footfetishforum, always keep original channel/title from extension — yt-dlp returns 'unknown' for FFF attachments
        const keepOriginal = pinContext || platform === 'footfetishforum';
        const finalTitle = keepOriginal ? title : meta.title || title;
        const finalChannel = keepOriginal ? channel : meta.channel || channel;
        await updateDownloadMeta.run(finalTitle, finalChannel, meta.description, meta.duration, meta.thumbnail, JSON.stringify(meta.fullMeta), downloadId);
        title = finalTitle;
        channel = finalChannel;
        console.log(`   [#${downloadId}] ✅ Metadata: "${title}" door ${channel} (${meta.duration})`);
      } catch (e) {
        console.log(`   [#${downloadId}] ⚠️ Metadata ophalen mislukt: ${e.message}`);
      }
    } else {
      console.log(`   [#${downloadId}] Metadata-scan overgeslagen voor dit domein/platform (anti-403/rate-limit)`);
    }

    const dir = getDownloadDir(platform, channel, title);
    try { await updateDownloadFilepath.run(dir, downloadId); } catch (e) { }

    // Sla metadata op als JSON
    const metaFile = path.join(dir, 'metadata.json');
    fs.writeFileSync(metaFile, JSON.stringify({
      url,
      source_url: originThread && originThread.url ? originThread.url : metadata && metadata.url && metadata.url !== url ? metadata.url : null,
      platform,
      channel,
      title,
      description: meta.description || metadata?.description,
      duration: meta.duration,
      thumbnail: meta.thumbnail,
      origin_thread: originThread && originThread.url ? originThread : null,
      webdl_pin_context: pinContext,
      webdl_media_url: metadata && metadata.webdl_media_url ? metadata.webdl_media_url : url,
      webdl_detected_platform: metadata && metadata.webdl_detected_platform ? metadata.webdl_detected_platform : detectPlatform(url),
      downloadedAt: new Date().toISOString()
    }, null, 2));

    // Start yt-dlp download
    if (isCancelled(downloadId)) {
      clearCancelled(downloadId);
      jobLane.delete(downloadId);
      await updateDownloadStatus.run('cancelled', 0, null, downloadId);
      return;
    }
    await updateDownloadStatus.run('downloading', 0, null, downloadId);

    const forceOverwrite = !!(metadata && typeof metadata === 'object' && !Array.isArray(metadata) && metadata.webdl_force === true);
    const outputTemplate = path.join(dir, '%(title).120B [%(id)s].%(ext)s');
    const baseArgs = [
      '--concurrent-fragments', YTDLP_CONCURRENT_FRAGMENTS,
      '--socket-timeout', '30',
      '--ffmpeg-location', path.dirname(FFMPEG),
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--write-thumbnail',
      '--write-info-json'];
    if (!forceOverwrite) {
      baseArgs.push('--no-overwrites');
    } else {
      baseArgs.push('--force-overwrites');
    }
    baseArgs.push('--progress', '--newline', '-o', outputTemplate, url);


    if (platform === 'youtube') {
      const insertAt = baseArgs.indexOf('-o');
      const ytSaferArgs = [];

      if (Number.isFinite(YTDLP_YT_SLEEP_REQUESTS) && YTDLP_YT_SLEEP_REQUESTS > 0) {
        ytSaferArgs.push('--sleep-requests', String(YTDLP_YT_SLEEP_REQUESTS));
      }
      if (YTDLP_YT_LIMIT_RATE) {
        ytSaferArgs.push('--limit-rate', YTDLP_YT_LIMIT_RATE);
      }
      ytSaferArgs.push('--retries', '10', '--fragment-retries', '10', '--extractor-retries', '5');

      if (ytSaferArgs.length) {
        baseArgs.splice(insertAt, 0, ...ytSaferArgs);
      }

      if (Number.isFinite(YTDLP_YT_SLEEP_INTERVAL) && YTDLP_YT_SLEEP_INTERVAL > 0) {
        baseArgs.splice(baseArgs.indexOf('-o'), 0, '--sleep-interval', String(YTDLP_YT_SLEEP_INTERVAL));
        if (Number.isFinite(YTDLP_YT_MAX_SLEEP_INTERVAL) && YTDLP_YT_MAX_SLEEP_INTERVAL >= YTDLP_YT_SLEEP_INTERVAL) {
          baseArgs.splice(baseArgs.indexOf('-o'), 0, '--max-sleep-interval', String(YTDLP_YT_MAX_SLEEP_INTERVAL));
        }
      }
    }

    let cookieArgs = getYtDlpCookieArgs('download');
    if (platform === 'youtube' || platform === 'youtube-shorts') {
      cookieArgs = [];
    }

    const runOnce = (attemptCookieArgs, allowRetryNoCookies, attemptExtraArgs = [], allowRetryNoCheckCertificates = true) => {
      return new Promise((resolve) => {
        const extra = Array.isArray(attemptExtraArgs) ? attemptExtraArgs : [];
        const proc = spawnNice(YT_DLP, [...attemptCookieArgs, ...extra, ...baseArgs]);
        activeProcesses.set(downloadId, proc);
        try { startingJobs.delete(downloadId); } catch (e) { }

        let lastFile = '';
        let markedPostprocessing = false;
        let stderrAll = '';

        let playlistStr = null;

        proc.stdout.on('data', async (data) => {
          const line = data.toString().trim();

          if (line.includes('[download]') && line.includes('Downloading item')) {
            const m = line.match(/Downloading item (\d+) of (\d+)/);
            if (m) {
              playlistStr = `Playlist: ${m[1]}/${m[2]}`;
              console.log(`   [#${downloadId}] ${playlistStr}`);
            }
          }

          if (line.includes('[download]') && line.includes('%')) {
            const match = line.match(/([\d.]+)%/);
            if (match) {
              const pct = Math.round(parseFloat(match[1]));
              if (!markedPostprocessing) await updateDownloadStatus.run('downloading', pct, playlistStr, downloadId);
            }
          }
          if (line.includes('Destination:')) {
            const rawDest = line.split('Destination:')[1]?.trim() || '';
            // Remove any ANSI color codes yt-dlp might have added
            lastFile = rawDest.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
            console.log(`   [#${downloadId}] lastFile set: ${lastFile}`);
          }
          if (line.includes('[Merger]') || line.includes('has already been downloaded')) {
            if (!markedPostprocessing && (line.includes('[Merger]') || line.includes('Merging formats into'))) {
              markedPostprocessing = true;
              await updateDownloadStatus.run('postprocessing', 100, null, downloadId);
            }
            const mergeMatch = line.match(/Merging formats into "(.+)"/);
            if (mergeMatch) lastFile = mergeMatch[1].replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

            if (line.includes('has already been downloaded')) {
              // Extract filename from: [download] /path/to/file has already been downloaded
              const alreadyMatch = line.match(/\[download\]\s+(.+?)\s+has already been downloaded/);
              if (alreadyMatch) {
                lastFile = alreadyMatch[1].replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
                console.log(`   [#${downloadId}] skipped existing: ${lastFile}`);
              }
            }
          }
        });

        proc.stderr.on('data', (data) => {
          const msg = data.toString();
          stderrAll += msg;
          const trimmed = msg.trim();
          if (trimmed) console.log(`   yt-dlp stderr: ${trimmed}`);
        });

        proc.on('close', async (code) => {
          activeProcesses.delete(downloadId);
          const aborted = abortKind(downloadId);
          if (aborted) {
            applyAbortStatus(downloadId, aborted);
            return resolve({ success: false, aborted, code, lastFile, stderrAll });
          }
          if (code === 0) {
            return resolve({ success: true, code, lastFile, stderrAll });
          }

          const msg = String(stderrAll || '').trim();
          const certFailed = /CERTIFICATE_VERIFY_FAILED|certificate\s+verify\s+failed/i.test(msg);
          if (allowRetryNoCheckCertificates && certFailed && !extra.includes('--no-check-certificates')) {
            console.log(`   ↩️ SSL cert verify failed; retry met --no-check-certificates`);
            const retryResult = await runOnce(attemptCookieArgs, allowRetryNoCookies, ['--no-check-certificates', ...extra], false);
            return resolve(retryResult);
          }
          const cookieInvalid = /cookies?\s+are\s+no\s+longer\s+valid/i.test(msg);
          if (allowRetryNoCookies && attemptCookieArgs && attemptCookieArgs.length && cookieInvalid) {
            console.log(`   ↩️ Cookies ongeldig/geroteerd; retry zonder cookies`);
            const retryResult = await runOnce([], false, extra, allowRetryNoCheckCertificates);
            return resolve(retryResult);
          }

          if (lastFile) {
            const candidate = lastFile.startsWith('/') ? lastFile : path.join(dir, lastFile);
            if (fs.existsSync(candidate)) {
              const ext = path.extname(candidate).toLowerCase();
              const isImage = ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp';
              // Do NOT treat as success if it errored out and only managed to download the image thumbnail
              if (!isImage || platform !== 'youtube') {
                console.log(`   [#${downloadId}] yt-dlp exited with code ${code}, but video file exists. Treating as success.`);
                return resolve({ success: true, code, lastFile, stderrAll });
              }
            }
          }

          return resolve({ success: false, code, lastFile, stderrAll });
        });

        proc.on('error', (err) => {
          activeProcesses.delete(downloadId);
          const aborted = abortKind(downloadId);
          if (aborted) {
            applyAbortStatus(downloadId, aborted);
            return resolve({ success: false, aborted, code: -1, lastFile, stderrAll: '' });
          }
          resolve({ success: false, code: -1, lastFile, stderrAll: String(err && err.message ? err.message : err) });
        });
      });
    };

    const result = await runOnce(cookieArgs, true);

    if (result && result.aborted) {
      return;
    }

    if (result && result.success) {
      (async () => {
        // Give yt-dlp a moment to flush file renames (e.g. from .part) to disk
        await new Promise(r => setTimeout(r, 400));

        let lastFile = result.lastFile || '';
        let mainPath = '';
        if (lastFile) {
          const candidate = lastFile.startsWith('/') ? lastFile : path.join(dir, lastFile);
          if (fs.existsSync(candidate)) mainPath = candidate;
        }

        if (!mainPath) {
          const files = fs.readdirSync(dir).filter((f) =>
            f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.webm') ||
            f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png') ||
            f.endsWith('.gif') || f.endsWith('.webp') || f.endsWith('.unknown_video')
          );
          files.sort((a, b) => {
            try {
              const statA = fs.statSync(path.join(dir, a));
              const statB = fs.statSync(path.join(dir, b));
              return statB.mtimeMs - statA.mtimeMs;
            } catch (e) {
              return 0;
            }
          });
          const mainFileGuess = files[0] || '';
          mainPath = mainFileGuess ? path.join(dir, mainFileGuess) : '';
        }

        if (mainPath && mainPath.endsWith('.unknown_video')) {
          try {
            const { execSync } = require('child_process');
            const output = execSync(`file -b "${mainPath}"`).toString().toLowerCase();
            let newExt = '';
            if (output.includes('jpeg image')) newExt = '.jpg';
            else if (output.includes('png image')) newExt = '.png';
            else if (output.includes('gif image')) newExt = '.gif';
            else if (output.includes('webm')) newExt = '.webm';
            else if (output.includes('mp4') || output.includes('isom')) newExt = '.mp4';

            if (newExt) {
              const newPath = mainPath.replace('.unknown_video', newExt);
              fs.renameSync(mainPath, newPath);
              mainPath = newPath;
              console.log(`   [#${downloadId}] Hernoemd unknown_video naar ${path.basename(mainPath)}`);
            }
          } catch (e) {
            console.log(`   [#${downloadId}] Fout bij scannen unknown_video: ${e.message}`);
          }
        }

        const mainFile = mainPath ? path.basename(mainPath) : '';
        const mainSize = mainPath && fs.existsSync(mainPath) ? fs.statSync(mainPath).size : 0;

        let finalPath = mainPath;
        let finalFile = mainFile;
        let finalSize = mainSize;
        let finalFormat = path.extname(finalFile || '').replace('.', '') || 'mp4';

        const doFinalCut = FINALCUT_ENABLED;
        const metaObj = meta.fullMeta && typeof meta.fullMeta === 'object' ? meta.fullMeta : {};
        if (pinContext) {
          metaObj.webdl_pin_context = true;
          metaObj.origin_thread = originThread && originThread.url ? originThread : null;
          metaObj.webdl_media_url = metadata && metadata.webdl_media_url ? metadata.webdl_media_url : url;
          metaObj.webdl_detected_platform = metadata && metadata.webdl_detected_platform ? metadata.webdl_detected_platform : detectPlatform(url);
          if (originThread && originThread.url) metaObj.source_url = originThread.url;
        }

        if (doFinalCut && mainPath && fs.existsSync(mainPath)) {
          await updateDownloadStatus.run('queued', 100, null, downloadId);
          const base = path.basename(mainPath, path.extname(mainPath));
          const movFile = `${base}.mov`;
          const movPath = path.join(dir, movFile);
          const finalCutCompleted = await enqueuePostprocessJob(downloadId, {
            queuedStatus: 'queued',
            queuedProgress: 100,
            startStatus: 'postprocessing',
            startProgress: 100,
            run: async () => {
              try {
                console.log(`   🎞️ Transcode Final Cut: ${movFile}`);
                await transcodeToFinalCutMov(mainPath, movPath, downloadId);
                if (fs.existsSync(movPath)) {
                  finalPath = movPath;
                  finalFile = movFile;
                  finalSize = fs.statSync(movPath).size;
                  finalFormat = 'mov';
                  metaObj.webdl_finalcut = { source: mainPath, output: movPath };
                  console.log(`   ✅ Final Cut MOV klaar: ${movPath}`);
                }
              } catch (e) {
                metaObj.webdl_finalcut_error = e.message;
                console.log(`   ⚠️ Final Cut transcode mislukt: ${e.message}`);
              }
            }
          });
          if (!finalCutCompleted) return;
        }

        try {
          if (finalPath && fs.existsSync(finalPath)) {
            const st = fs.statSync(finalPath);
            const relPath = path.relative(BASE_DIR, finalPath);
            if (relPath && !relPath.startsWith('..')) {
              const indexedAt = new Date().toISOString();
              await upsertDownloadFile.run(downloadId, relPath, st.size, Math.floor(st.mtimeMs), indexedAt, indexedAt);
            }
          }
        } catch (e) { }

        // Read info.json to get the real channel/uploader (especially for playlist downloads)
        let realChannel = channel;
        let realTitle = title;
        try {
          const infoJson = fs.readdirSync(dir).find(f => f.endsWith('.info.json'));
          if (infoJson) {
            const info = JSON.parse(fs.readFileSync(path.join(dir, infoJson), 'utf8'));
            // For playlist downloads, the channel was set to the playlist URL's channel,
            // but the actual video may be from a different creator
            const infoChannel = String(info.channel || info.uploader || info.uploader_id || '').trim();
            if (infoChannel && infoChannel !== 'unknown') realChannel = infoChannel;
            const infoTitle = String(info.title || info.fulltitle || '').trim();
            if (infoTitle && infoTitle !== 'untitled') realTitle = infoTitle;
            // Store source_url from info.json
            if (info.webpage_url || info.original_url) {
              metaObj.source_url = info.webpage_url || info.original_url;
            }
          }
        } catch (e) {}

        // Update channel/title if they were enriched from info.json
        if (realChannel !== channel || realTitle !== title) {
          try {
            await updateDownloadBasics.run(platform, realChannel, realTitle, downloadId);
            console.log(`   📝 Channel/title bijgewerkt: ${channel} → ${realChannel}`);
            // Move to correct channel directory if channel changed
            if (realChannel !== channel) {
              const newDir = getDownloadDir(platform, realChannel, realTitle);
              if (newDir !== dir && !fs.existsSync(newDir)) {
                try {
                  fs.mkdirSync(newDir, { recursive: true });
                  // Move all files to new dir
                  for (const f of fs.readdirSync(dir)) {
                    const src = path.join(dir, f);
                    const dst = path.join(newDir, f);
                    fs.renameSync(src, dst);
                  }
                  // Update paths
                  if (finalPath) finalPath = path.join(newDir, path.basename(finalPath));
                  if (mainPath) mainPath = path.join(newDir, path.basename(mainPath));
                  // Remove old empty dir
                  try { fs.rmdirSync(dir); } catch (e) {}
                  console.log(`   📁 Verplaatst naar: ${newDir}`);
                } catch (e) {
                  console.warn(`   ⚠️ Dir verplaatsing mislukt: ${e.message}`);
                }
              }
            }
          } catch (e) {}
        }

        await updateDownload.run('completed', 100, finalPath, finalFile, finalSize, finalFormat, JSON.stringify(metaObj), null, downloadId);
        try {
          const thumbPath = pickThumbnailFile(dir);
          if (thumbPath) await updateDownloadThumbnail.run(`/download/${downloadId}/thumb`, downloadId);
        } catch (e) { }
        console.log(`   ✅ Download voltooid: ${finalPath} (${(finalSize / 1024 / 1024).toFixed(1)} MB)`);
        try { io.emit('download-completed', { downloadId, platform, channel: realChannel || channel, title: realTitle || title }); } catch (e) {}
      })().catch(async (e) => {
        await updateDownloadStatus.run('error', 0, e.message, downloadId);
        console.log(`   ❌ Postprocess fout: ${e.message}`);
      });
    } else {
      const msg = String(result && result.stderrAll ? result.stderrAll : '').trim();
      if (msg.includes('Unsupported URL') && looksLikeDirectFileUrl(url)) {
        console.log(`   ↩️ Fallback naar direct download (unsupported url)`);
        startDirectFileDownload(downloadId, url, platform, channel, title, metadata).catch(() => { });
        return;
      }
      await updateDownloadStatus.run('error', 0, msg || `yt-dlp exit code: ${result && result.code != null ? result.code : '?'}`, downloadId);
      console.log(`   ❌ Download mislukt (code ${result && result.code != null ? result.code : '?'})`);
    }

  } catch (err) {
    await updateDownloadStatus.run('error', 0, err.message, downloadId);
    console.error(`   ❌ Download fout: ${err.message}`);
  }
}

// Video opname uploaden (van browser MediaRecorder)
expressApp.post('/upload-recording', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'Geen video bestand ontvangen' });

  let metadata = {};
  try { metadata = JSON.parse(req.body.metadata || '{}'); } catch (e) { }

  let resolved = metadata;
  try {
    resolved = await resolveMetadata(metadata.url, metadata);
  } catch (e) {

    // fallback blijft metadata
  }
  const platform = resolved.platform || detectPlatform(resolved.url || '');
  const channel = resolved.channel || 'unknown';
  const title = resolved.title || 'untitled';
  const dir = getDownloadDir(platform, channel, title);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `recording_${timestamp}.webm`;
  const filepath = path.join(dir, filename);

  // Verplaats upload naar juiste map
  moveFileSync(req.file.path, filepath);
  const size = fs.statSync(filepath).size;

  // Sla metadata op
  const metaFile = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metaFile)) {
    fs.writeFileSync(metaFile, JSON.stringify({
      url: resolved.url || metadata.url, platform, channel, title,
      recordedAt: new Date().toISOString()
    }, null, 2));
  }

  console.log(`🎬 Opname opgeslagen: ${filepath} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  try {
    const recordMeta = { webdl_kind: 'recording', webdl_recording: { lock: false, uploaded: true } };
    await insertCompletedDownload.run(
      `recording:${Date.now()}`,
      platform,
      channel,
      title,
      filename,
      filepath,
      size,
      path.extname(filename || '').replace('.', '') || 'webm',
      'completed',
      100,
      JSON.stringify(recordMeta)
    );
  } catch (e) { }
  res.json({ success: true, file: filename, path: filepath, size, meta: resolved });
});

// Re-index recordings from disk into the DB so they show up in the dashboard/viewer.
// This is safe to call multiple times; it will skip files already present in the DB.
expressApp.post('/import/recordings/reindex', async (req, res) => {
  try {
    const inserted = [];
    const skipped = [];
    const errors = [];

    const walk = async (dir, depth = 0) => {
      if (!dir || !fs.existsSync(dir)) return;
      if (depth > 6) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry || !entry.name) continue;
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (!safeIsInsideBaseDir(fullPath)) continue;
        if (entry.isDirectory()) {
          await walk(fullPath, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!/^recording_.*\.(mp4|mov|m4v|webm|mkv)$/i.test(entry.name)) continue;
        if (/_raw\.(mp4|mov|m4v|webm|mkv)$/i.test(entry.name)) continue;

        try {
          const fp = path.resolve(fullPath);
          const existing = await getDownloadIdByFilepath.get(fp);
          if (existing && existing.id) {
            skipped.push(fp);
            continue;
          }

          const rel = path.relative(path.resolve(BASE_DIR), fp);
          const parts = rel.split(path.sep).filter(Boolean);
          const platform = parts[0] || 'other';
          const channel = parts[1] || 'unknown';
          const title = parts[2] || 'recording';
          const st = fs.statSync(fp);
          const size = st && Number.isFinite(st.size) ? st.size : 0;
          const format = path.extname(fp).replace('.', '') || 'mp4';
          const recordMeta = { webdl_kind: 'recording', webdl_recording: { reindexed: true } };

          const url = `recording:${entry.name}`;
          await insertCompletedDownload.run(url, platform, channel, title, entry.name, fp, size, format, 'completed', 100, JSON.stringify(recordMeta));
          inserted.push(fp);
        } catch (e) {
          errors.push({ file: fullPath, error: e.message });
        }
      }
    };

    await walk(BASE_DIR);
    res.json({ success: true, base: BASE_DIR, inserted: inserted.length, skipped: skipped.length, errors, insertedFiles: inserted.slice(0, 50) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Import existing video files from disk (e.g. Video DownloadHelper downloads) into DB.
// Safe to rerun: existing filepaths are skipped.
async function importExistingVideosFromDisk(options = {}) {
  const requestedRoot = String(options.rootDir || options.dir || '').trim();
  const rootDir = requestedRoot ? path.resolve(requestedRoot) : path.resolve(path.join(os.homedir(), 'Downloads'));
  const maxDepthRaw = Number(options.maxDepth);
  const maxDepth = Number.isFinite(maxDepthRaw) ? Math.max(0, Math.min(12, Math.floor(maxDepthRaw))) : 6;
  const dryRun = !!options.dryRun;
  const flattenToWebdl = options.flattenToWebdl == null ? AUTO_IMPORT_FLATTEN_TO_WEBDL : !!options.flattenToWebdl;
  const moveSource = options.moveSource == null ? AUTO_IMPORT_MOVE_SOURCE : !!options.moveSource;
  const minFileAgeMsRaw = Number(options.minFileAgeMs);
  const minFileAgeMs = Number.isFinite(minFileAgeMsRaw) ? Math.max(0, Math.floor(minFileAgeMsRaw)) : AUTO_IMPORT_MIN_FILE_AGE_MS;
  const maxInsertsRaw = Number(options.maxInserts);
  const maxInserts = Number.isFinite(maxInsertsRaw) && maxInsertsRaw > 0 ? Math.floor(maxInsertsRaw) : 0; // 0 = unlimited
  const requestedTargetDir = String(options.targetDir || '').trim();
  const targetDir = path.resolve(requestedTargetDir || DEFAULT_VDH_IMPORT_DIR);

  if (!fs.existsSync(rootDir)) {
    return { success: false, error: `Map bestaat niet: ${rootDir}`, rootDir, maxDepth, dryRun, targetDir, flattenToWebdl, moveSource };
  }

  if (flattenToWebdl && !dryRun) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const inserted = [];
  const relocated = [];
  const skipped = [];
  const errors = [];

  const walk = async (dir, depth = 0) => {
    if (!dir || !fs.existsSync(dir)) return;
    if (depth > maxDepth) return;
    if (maxInserts > 0 && inserted.length >= maxInserts) return; // throttle
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (maxInserts > 0 && inserted.length >= maxInserts) break; // throttle mid-dir
      if (!entry || !entry.name) continue;
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (flattenToWebdl && path.resolve(fullPath) === targetDir) continue;
        await walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name || '').toLowerCase();
      if (!IMPORTABLE_VIDEO_EXTS.has(ext)) continue;
      if (/\.(part|tmp)$/i.test(entry.name)) continue;
      if (/_raw\.(mp4|mov|m4v|webm|mkv)$/i.test(entry.name)) continue;

      try {
        const fp = path.resolve(fullPath);
        try {
          const stAge = fs.statSync(fp);
          const mtimeMs = stAge && Number.isFinite(stAge.mtimeMs) ? stAge.mtimeMs : 0;
          if (mtimeMs && minFileAgeMs > 0 && Date.now() - mtimeMs < minFileAgeMs) {
            skipped.push({ file: fp, reason: 'too_new' });
            continue;
          }
        } catch (e) { }
        const existing = await getDownloadIdByFilepath.get(fp);
        if (existing && existing.id) {
          if (flattenToWebdl && moveSource && !dryRun) {
            try {
              const relocatePath = buildVdhImportTargetPath(fp, targetDir);
              const row = await getDownload.get(existing.id);
              const rowPath = row && row.filepath ? path.resolve(row.filepath) : fp;
              if (fp !== relocatePath && fs.existsSync(fp)) {
                if (rowPath === fp) {
                  if (!fs.existsSync(relocatePath)) {
                    moveFileSyncWithFallback(fp, relocatePath);
                    try { await updateDownloadFilepath.run(relocatePath, existing.id); } catch (e) { }
                    relocated.push({ id: existing.id, from: fp, to: relocatePath });
                    continue;
                  }
                  fs.unlinkSync(fp);
                  try { await updateDownloadFilepath.run(relocatePath, existing.id); } catch (e) { }
                  relocated.push({ id: existing.id, from: fp, to: relocatePath, cleanupOnly: true, relinked: true });
                  continue;
                }

                if (rowPath === relocatePath && fs.existsSync(relocatePath)) {
                  fs.unlinkSync(fp);
                  relocated.push({ id: existing.id, from: fp, to: relocatePath, cleanupOnly: true });
                  continue;
                }
              }
            } catch (e) {
              errors.push({ file: fp, error: `Relocate bestaand item mislukt: ${e.message}` });
              continue;
            }
          }
          skipped.push({ file: fp, reason: 'exists' });
          continue;
        }

        const targetPath = flattenToWebdl ? buildVdhImportTargetPath(fp, targetDir) : fp;
        const existingTarget = await getDownloadIdByFilepath.get(targetPath);
        if (existingTarget && existingTarget.id) {
          if (flattenToWebdl && moveSource && !dryRun && fp !== targetPath && fs.existsSync(fp)) {
            try {
              if (fs.existsSync(targetPath)) {
                fs.unlinkSync(fp);
                relocated.push({ id: existingTarget.id, from: fp, to: targetPath, cleanupOnly: true });
              } else {
                moveFileSyncWithFallback(fp, targetPath);
                try { await updateDownloadFilepath.run(targetPath, existingTarget.id); } catch (e) { }
                relocated.push({ id: existingTarget.id, from: fp, to: targetPath });
              }
              continue;
            } catch (e) {
              errors.push({ file: fp, error: `Opschonen bestaande target mislukt: ${e.message}` });
              continue;
            }
          }
          skipped.push({ file: fp, storedAs: targetPath, reason: 'exists_target' });
          continue;
        }

        const st = fs.statSync(fp);
        const size = st && Number.isFinite(st.size) ? st.size : 0;
        if (!size || size <= 0) {
          skipped.push({ file: fp, reason: 'empty' });
          continue;
        }

        const sidecar = readImportSidecarMetadata(fp);
        const sourceUrl = String(sidecar.sourceUrl || '').trim();
        const platform = inferPlatformFromImportedFile(fp, sourceUrl);
        const fallbackTitle = path.basename(fp, ext) || path.basename(fp) || 'imported-video';
        const title = String(sidecar.title || '').trim() || fallbackTitle;

        // For 4K Downloader imports: use parent directory as channel name
        // Structure: _4KDownloader/ChannelName/VideoTitle.mkv
        let channelFromPath = '';
        if (fp.includes('_4KDownloader') || fp.includes('_4kdownloader')) {
          const rel4k = fp.split(/_4[Kk][Dd]ownloader[\/\\]/)[1] || '';
          const pathParts = rel4k.split(/[\/\\]/).filter(Boolean);
          if (pathParts.length >= 2) {
            channelFromPath = pathParts[0]; // Parent dir = channel name
          }
        }

        const channelFromUrl = sourceUrl ? deriveChannelFromUrl(platform, sourceUrl) || '' : '';
        const channel = String(sidecar.channel || '').trim() || channelFromPath || channelFromUrl || 'imported';
        const canonicalSource = sourceUrl ? sourceUrl : `file://${fp}`;
        if (sourceUrl) {
          const existingSource = await findReusableDownloadBySourceRef.get(canonicalSource, sourceUrl);
          if (existingSource && existingSource.id) {
            skipped.push({ file: fp, sourceUrl, reason: 'exists_source', id: existingSource.id });
            continue;
          }
        }
        let storedPath = targetPath;

        if (flattenToWebdl && !dryRun && fp !== targetPath && !fs.existsSync(targetPath)) {
          if (moveSource) {
            moveFileSyncWithFallback(fp, targetPath);
          } else {
            fs.copyFileSync(fp, targetPath);
          }
        }

        if (!flattenToWebdl) storedPath = fp;
        if (flattenToWebdl && dryRun) storedPath = targetPath;

        const stStored = !dryRun && fs.existsSync(storedPath) ? fs.statSync(storedPath) : st;
        const storedSize = stStored && Number.isFinite(stStored.size) ? stStored.size : size;
        const storedExt = path.extname(storedPath).replace('.', '').toLowerCase() || ext.replace('.', '') || 'mp4';

        const importMeta = {
          webdl_kind: 'imported_video',
          imported: true,
          importer: 'filesystem',
          source: 'external',
          source_url: sourceUrl || null,
          source_filepath: fp,
          stored_filepath: storedPath,
          consolidated_in_webdl: flattenToWebdl,
          root_dir: rootDir,
          sidecar: sidecar.sidecarPath || null
        };

        if (!dryRun) {
          const info = await insertCompletedDownload.run(
            canonicalSource,
            platform,
            channel,
            title,
            path.basename(storedPath),
            storedPath,
            storedSize,
            storedExt,
            'completed',
            100,
            JSON.stringify(importMeta)
          );
          const newId = Number(info && info.lastInsertRowid);
          if (Number.isFinite(newId) && sourceUrl && sourceUrl !== canonicalSource) {
            try { await updateDownloadSourceUrl.run(sourceUrl, newId); } catch (e) { }
          }
        }

        inserted.push({ file: storedPath, originalFile: fp, platform, channel, title, sourceUrl: sourceUrl || null });
      } catch (e) {
        errors.push({ file: fullPath, error: e.message });
      }
    }
  };

  await walk(rootDir, 0);
  return {
    success: true,
    dryRun,
    rootDir,
    targetDir,
    flattenToWebdl,
    moveSource,
    minFileAgeMs,
    maxDepth,
    inserted: inserted.length,
    relocated: relocated.length,
    skipped: skipped.length,
    errors,
    insertedFiles: inserted.slice(0, 100),
    relocatedFiles: relocated.slice(0, 100),
    skippedFiles: skipped.slice(0, 100)
  };
}

expressApp.post('/downloads/import', async (req, res) => {
  try {
    const result = await importExistingVideosFromDisk(req.body || {});
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

expressApp.post('/downloads/reindex-gallery', async (req, res) => {
  try {
    console.log('🔍 Re-indexing gallery-dl downloads...');

    const downloads = await db.prepare(`
      SELECT id, filepath, platform, channel
      FROM downloads
      WHERE (metadata LIKE '%gallery-dl%' 
             OR platform IN ('aznudefeet', 'wikifeet', 'wikifeetx', 'kinky'))
        AND status = 'completed'
        AND filepath IS NOT NULL
      ORDER BY id DESC
    `).all();

    let totalIndexed = 0;
    let processedDownloads = 0;

    for (const download of downloads || []) {
      const { id, filepath, platform } = download;

      if (!fs.existsSync(filepath)) continue;

      // For AZNUDEFEET, scan parent directory since real files are there
      const scanDir = (platform === 'aznudefeet' || platform === 'wikifeet' || platform === 'wikifeetx' || platform === 'kinky') ? path.dirname(filepath) : filepath;

      if (!fs.existsSync(scanDir)) continue;

      const files = fs.readdirSync(scanDir);
      let indexed = 0;

      for (const file of files) {
        try {
          const fullPath = path.join(scanDir, file);
          const st = fs.statSync(fullPath);

          // Skip directories, gallery-dl thumbnails/logos, metadata
          if (st.isDirectory()) continue;
          if (file.endsWith('_thumb.jpg') || file.endsWith('_thumb.png')) continue;
          if (file.endsWith('_logo.jpg') || file.endsWith('_logo.png')) continue;
          if (file === 'metadata.json') continue;

          if (st.isFile() && /\.(mp4|webm|mkv|avi|mov|jpg|jpeg|png|gif|webp)$/i.test(file)) {
            const relPath = path.relative(BASE_DIR, fullPath);
            if (relPath && !relPath.startsWith('..')) {
              const indexedAt = new Date().toISOString();
              await upsertDownloadFile.run(id, relPath, st.size, Math.floor(st.mtimeMs), indexedAt, indexedAt);
              indexed++;
            }
          }
        } catch (e) { }
      }

      if (indexed > 0) {
        processedDownloads++;
        totalIndexed += indexed;
        console.log(`   ✅ #${id}: ${indexed} files`);
      }
    }

    // Cleanup gallery-dl thumbnails/logos (not server-generated ones in .thumbs/)
    const cleanup = await db.prepare(`
      DELETE FROM download_files
      WHERE relpath LIKE '%_thumb.jpg'
         OR relpath LIKE '%_thumb.png'
         OR relpath LIKE '%_logo.jpg'
         OR relpath LIKE '%_logo.png'
         OR filesize < 20000
    `).run();

    const deleted = cleanup && cleanup.changes ? cleanup.changes : 0;

    recentFilesTopCache.clear();

    console.log(`✅ Re-indexed: ${totalIndexed} files in ${processedDownloads} downloads`);
    console.log(`🗑️  Deleted: ${deleted} thumbnail entries`);

    res.json({
      success: true,
      indexed: totalIndexed,
      downloads: processedDownloads,
      thumbnailsDeleted: deleted
    });
  } catch (err) {
    console.error('❌ Re-index error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

expressApp.get('/import', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const defaultRoot = String(AUTO_IMPORT_ROOT_DIR || '').trim() || '/Volumes/HDD - One Touch/WEBDL/_Downloads';
  const defaultTarget = String(DEFAULT_VDH_IMPORT_DIR || '').trim();
  const defaultDepth = String(getAutoImportMaxDepth());
  const defaultMinAge = String(AUTO_IMPORT_MIN_FILE_AGE_MS);
  const defaultFlatten = AUTO_IMPORT_FLATTEN_TO_WEBDL ? 'true' : 'false';
  const defaultMove = AUTO_IMPORT_MOVE_SOURCE ? 'true' : 'false';

  return res.send(`<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WEBDL Import</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;background:#0b0f14;color:#e5e7eb;margin:0;padding:18px}
    .card{max-width:980px;margin:0 auto;background:#101826;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px}
    h1{font-size:18px;margin:0 0 12px 0}
    label{display:block;font-size:12px;color:#9aa4b2;margin-top:10px}
    input,select{width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:#0b1220;color:#e5e7eb}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .btn{margin-top:14px;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.14);background:#0ea5e9;color:#041018;font-weight:700;cursor:pointer}
    .btn:disabled{opacity:.6;cursor:not-allowed}
    pre{white-space:pre-wrap;word-break:break-word;background:#0b1220;border:1px solid rgba(255,255,255,0.10);border-radius:10px;padding:10px;margin-top:12px;max-height:55vh;overflow:auto}
    a{color:#38bdf8}
  </style>
</head>
<body>
  <div class="card">
    <h1>Importeer videobestanden in WEBDL database</h1>
    <div class="row">
      <div>
        <label>Root map (waar je bestanden staan)</label>
        <input id="rootDir" value="${defaultRoot.replace(/"/g, '&quot;')}" />
      </div>
      <div>
        <label>Max depth</label>
        <input id="maxDepth" type="number" min="0" max="12" value="${defaultDepth.replace(/"/g, '&quot;')}" />
      </div>
    </div>
    <div class="row">
      <div>
        <label>Minimum file age (ms) (skip files die nog aan het downloaden zijn)</label>
        <input id="minFileAgeMs" type="number" min="0" value="${defaultMinAge.replace(/"/g, '&quot;')}" />
      </div>
      <div>
        <label>Target map (alleen relevant als je flattenToWebdl=true)</label>
        <input id="targetDir" value="${defaultTarget.replace(/"/g, '&quot;')}" />
      </div>
    </div>
    <div class="row">
      <div>
        <label>flattenToWebdl (kopieer/verplaats naar targetDir)</label>
        <select id="flattenToWebdl">
          <option value="false" ${defaultFlatten === 'false' ? 'selected' : ''}>false (aanbevolen voor externe schijf)</option>
          <option value="true" ${defaultFlatten === 'true' ? 'selected' : ''}>true</option>
        </select>
      </div>
      <div>
        <label>moveSource (alleen als flattenToWebdl=true)</label>
        <select id="moveSource">
          <option value="false" ${defaultMove === 'false' ? 'selected' : ''}>false (kopieer)</option>
          <option value="true" ${defaultMove === 'true' ? 'selected' : ''}>true (verplaats)</option>
        </select>
      </div>
    </div>
    <button id="btn" class="btn">Import starten</button>
    <pre id="out">Ready. Tip: open daarna <a href="/gallery" target="_blank">/gallery</a>.</pre>
  </div>

  <script>
    const el = (id) => document.getElementById(id);
    const btn = el('btn');
    const out = el('out');
    const toBool = (v) => String(v||'').trim().toLowerCase() === 'true';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      out.textContent = 'Import bezig…';
      try {
        const payload = {
          rootDir: el('rootDir').value,
          maxDepth: Number(el('maxDepth').value || 0),
          minFileAgeMs: Number(el('minFileAgeMs').value || 0),
          targetDir: el('targetDir').value,
          flattenToWebdl: toBool(el('flattenToWebdl').value),
          moveSource: toBool(el('moveSource').value),
          dryRun: false
        };
        const resp = await fetch('/downloads/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok) throw new Error((data && data.error) ? data.error : ('HTTP ' + resp.status));
        out.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        out.textContent = 'Fout: ' + ((e && e.message) ? e.message : String(e));
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`);
});

// Screenshot opslaan (base64 van browser)
expressApp.post('/screenshot', upload.single('image'), async (req, res) => {
  const { imageData, url, metadata } = req.body;
  try {
    console.log(`[INGRESS] POST /screenshot url=${String(url || (metadata && metadata.url) || '').slice(0, 200)} hasFile=${req && req.file ? '1' : '0'} hasImageData=${imageData ? '1' : '0'}`);
  } catch (e) { }
  let metaPayload = metadata || {};
  if (typeof metaPayload === 'string') {
    try { metaPayload = JSON.parse(metaPayload); } catch (e) { metaPayload = {}; }
  }

  const resolvedUrl = typeof url === 'string' && url ? url : metaPayload.url || '';
  let resolved = metaPayload;
  try {
    resolved = await resolveMetadata(resolvedUrl, metaPayload);
  } catch (e) {

    // fallback blijft metadata
  }
  const platform = resolved.platform || detectPlatform(resolvedUrl || '');
  const channel = resolved.channel || 'unknown';
  const title = resolved.title || 'untitled';
  const dir = getDownloadDir(platform, channel, title);

  const filename = makeScreenshotFilename();
  const filepath = path.join(dir, filename);
  const baseName = filename.replace(/\.jpg$/, '');

  try {
    if (req.file && req.file.path) {
      const mime = (req.file.mimetype || '').toLowerCase();
      let ext = path.extname(req.file.originalname || '').replace('.', '').toLowerCase();
      if (!ext) {
        if (mime.includes('jpeg')) ext = 'jpg'; else
          if (mime.includes('png')) ext = 'png';
      }
      if (ext === 'jpeg') ext = 'jpg';

      if (ext === 'jpg') {
        moveFileSync(req.file.path, filepath);
      } else {
        await convertToJpg(req.file.path, filepath);
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      }
    } else if (imageData) {
      const match = imageData.match(/^data:image\/([^;]+);base64,/i);
      const mimeExt = match ? match[1].toLowerCase() : 'jpeg';
      const ext = mimeExt === 'jpeg' ? 'jpg' : mimeExt;
      const base64Data = match ?
        imageData.replace(/^data:image\/[^;]+;base64,/i, '') :
        imageData.replace(/^data:image\/.+;base64,/i, '');

      if (ext === 'jpg') {
        fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));
      } else {
        const tmpPath = path.join(dir, `${baseName}.${ext || 'png'}`);
        fs.writeFileSync(tmpPath, Buffer.from(base64Data, 'base64'));
        await convertToJpg(tmpPath, filepath);
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      }
    } else {
      await runScreencapture(filepath);
    }
  } catch (e) {
    console.error(`Screenshot opslag/conversie mislukt: ${e.message}`);
    return res.status(500).json({ success: false, error: `Screenshot opslag mislukt: ${e.message}` });
  }

  const size = fs.existsSync(filepath) ? fs.statSync(filepath).size : 0;
  if (!size || size < MIN_SCREENSHOT_BYTES) {
    try {
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    } catch (e) { }
    return res.status(500).json({ success: false, error: `Screenshot te klein (${size} bytes)` });
  }

  try {
    const info = await insertScreenshot.run(resolvedUrl || '', platform, channel, title, filename, filepath, size);
    const newId = info && info.lastInsertRowid != null ? Number(info.lastInsertRowid) : null;
    console.log(`📷 Screenshot DB: id=${newId} path=${filepath}`);
    return res.json({ success: true, id: newId, file: filename, path: filepath, meta: resolved });
  } catch (e) {
    return res.status(500).json({ success: false, error: `DB insert screenshot mislukt: ${e.message}` });
  }
});

// Alle downloads ophalen
expressApp.get('/downloads', async (req, res) => {
  const downloads = await db.prepare(`SELECT * FROM downloads ORDER BY updated_at DESC, created_at DESC LIMIT 500`).all();
  res.json({ success: true, downloads });
});

// Alle screenshots ophalen
expressApp.get('/screenshots', async (req, res) => {
  const screenshots = await db.prepare(`SELECT * FROM screenshots ORDER BY created_at DESC LIMIT 500`).all();
  res.json({ success: true, screenshots });
});

// Download status ophalen
expressApp.get('/download/:id', async (req, res) => {
  const download = await getDownload.get(req.params.id);
  if (!download) return res.status(404).json({ success: false, error: 'Download niet gevonden' });
  res.json({ success: true, download });
});

expressApp.get('/download/:id/thumb', async (req, res) => {
  const id = parseInt(req.params.id);
  const download = await getDownload.get(id);
  if (!download) return res.status(404).end();

  const st = String(download.status || '').toLowerCase();
  if (!isReadyDownloadStatus(st)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, `/media/pending-thumb.svg?kind=d&id=${encodeURIComponent(String(id))}`);
  }

  const fp = String(download.filepath || '').trim();
  if (!fp || !safeIsAllowedExistingPath(fp)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, `/media/pending-thumb.svg?kind=d&id=${encodeURIComponent(String(id))}`);
  }

  try {
    // Prefer de per-download geïndexeerde specifieke file boven de (mogelijk
    // gedeelde) download.filepath. Dit voorkomt dat meerdere downloads met
    // dezelfde channel-dir (bv. gallery-dl/pornpics) dezelfde thumb krijgen.
    const specificAbs = await getFirstDownloadFileAbs(id);
    const thumbSrc = specificAbs || fp;
    const thumbPath = await pickOrCreateThumbPath(thumbSrc, { allowGenerate: false });
    if (!thumbPath) {
      let sched = 'error';
      try { sched = scheduleThumbGeneration(fp) || 'error'; } catch (e) { }
      logMissingThumbOnce('download-thumb', id, sched);
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(302, `/media/pending-thumb.svg?kind=d&id=${encodeURIComponent(String(id))}`);
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(thumbPath, (err) => {
      if (!err) return;
      if (err && (err.code === 'ECONNABORTED' || /aborted/i.test(String(err.message || '')))) return;
      if (res.headersSent) return;
      const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
      if (status === 404) return res.status(404).end();
      console.warn(`thumb sendFile failed: ${err.message}`);
      return res.status(500).end();
    });
  } catch (e) {
    res.status(500).end();
  }
});

expressApp.get('/media/thumb', (req, res) => {
  (async () => {
    const kind = String(req.query.kind || '').toLowerCase();
    const id = parseInt(req.query.id, 10);
    if (!Number.isFinite(id)) return res.status(400).end();

    try {
      if (kind === 'd') {
        const download = await getDownload.get(id);
        if (!download) return res.status(404).end();

        const st = String(download.status || '').toLowerCase();
        if (!isReadyDownloadStatus(st)) {
          res.setHeader('Cache-Control', 'no-store');
          return res.redirect(302, `/media/pending-thumb.svg?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(String(id))}`);
        }

        const fp = String(download.filepath || '').trim();
        if (!fp || !safeIsAllowedExistingPath(fp)) {
          res.setHeader('Cache-Control', 'no-store');
          return res.redirect(302, `/media/pending-thumb.svg?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(String(id))}`);
        }
        // Prefer per-download geïndexeerde specifieke file (zie toelichting in
        // /download/:id/thumb endpoint).
        const specificAbs = await getFirstDownloadFileAbs(id);
        const thumbSrc = specificAbs || fp;
        const thumbPath = await pickOrCreateThumbPath(thumbSrc, { allowGenerate: false });
        if (!thumbPath) {
          let sched = 'error';
          try { sched = scheduleThumbGeneration(fp) || 'error'; } catch (e) { }
          logMissingThumbOnce('media-thumb', id, sched);
          res.setHeader('Cache-Control', 'no-store');
          return res.redirect(302, `/media/pending-thumb.svg?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(String(id))}`);
        }
        res.setHeader('Cache-Control', 'public, max-age=86400');
        try {
          const ext = String(path.extname(thumbPath || '')).toLowerCase();
          const known = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif', '.heic', '.heif']);
          if (!known.has(ext)) {
            const mime = sniffMediaMimeByMagic(thumbPath);
            if (mime) res.setHeader('Content-Type', mime);
          }
        } catch (e) { }
        return res.sendFile(thumbPath, (err) => {
          if (!err) return;
          if (err && (err.code === 'ECONNABORTED' || /aborted/i.test(String(err.message || '')))) return;
          if (res.headersSent) return;
          const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
          if (status === 404) return res.status(404).end();
          console.warn(`media thumb sendFile failed: ${err.message}`);
          return res.status(500).end();
        });
      }

      if (kind === 's') {
        const row = await db.prepare(`SELECT * FROM screenshots WHERE id=?`).get(id);
        if (!row) return res.status(404).end();
        const fp = String(row.filepath || '').trim();

        if (row.platform === 'patreon') {
          console.log(`[DEBUG-PATREON-EXPAND] Processing id=${row.id}, fp=${fp}, isAllowed=${safeIsAllowedExistingPath(path.resolve(fp))}`);
        }

        if (!fp || !safeIsAllowedExistingPath(fp)) return res.status(404).end();
        res.setHeader('Cache-Control', 'no-store');
        return res.sendFile(fp, (err) => {
          if (!err) return;
          if (err && (err.code === 'ECONNABORTED' || /aborted/i.test(String(err.message || '')))) return;
          if (res.headersSent) return;
          const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
          if (status === 404) return res.status(404).end();
          console.warn(`screenshot thumb sendFile failed: ${err.message}`);
          return res.status(500).end();
        });
      }

      return res.status(400).end();
    } catch (e) {
      return res.status(500).end();
    }
  })();
});

// Download annuleren
expressApp.post('/download/:id/cancel', async (req, res) => {
  const id = parseInt(req.params.id);
  const proc = activeProcesses.get(id);
  if (proc) {
    cancelledJobs.add(id);
    try { proc.kill('SIGTERM'); } catch (e) { }
    activeProcesses.delete(id);
    jobLane.delete(id);
    await updateDownloadStatus.run('cancelled', 0, null, id);
    console.log(`⏹️ Download #${id} geannuleerd`);
    runDownloadSchedulerSoon();
    return res.json({ success: true });
  }

  if (startingJobs.has(id)) {
    cancelledJobs.add(id);
    startingJobs.delete(id);
    jobLane.delete(id);
    await updateDownloadStatus.run('cancelled', 0, null, id);
    console.log(`⏹️ Download #${id} geannuleerd (starting)`);
    runDownloadSchedulerSoon();
    return res.json({ success: true });
  }

  if (isQueued(id)) {
    queuedJobs.delete(id);
    removeFromQueue(queuedHeavy, id);
    removeFromQueue(queuedLight, id);
    removeFromQueue(queuedBatch, id);
    jobLane.delete(id);
    await updateDownloadStatus.run('cancelled', 0, null, id);
    console.log(`⏹️ Download #${id} geannuleerd (queue)`);
    runDownloadSchedulerSoon();
    return res.json({ success: true });
  }

  return res.json({ success: false, error: 'Download niet actief' });
});

// Download naar voren plaatsen (bump)
expressApp.post('/api/queue/bump/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isQueued(id)) {
    if (queuedLight.includes(id)) {
      removeFromQueue(queuedLight, id);
      queuedLight.unshift(id);
      console.log(`⬆️ Download #${id} gebumpt in Light queue`);
    } else if (queuedHeavy.includes(id)) {
      removeFromQueue(queuedHeavy, id);
      queuedHeavy.unshift(id);
      console.log(`⬆️ Download #${id} gebumpt in Heavy queue`);
    } else if (queuedBatch.includes(id)) {
      removeFromQueue(queuedBatch, id);
      queuedBatch.unshift(id);
      console.log(`⬆️ Download #${id} gebumpt in Batch queue`);
    }
    return res.json({ success: true });
  }
  return res.json({ success: false, error: 'Download niet in wachtrij' });
});

// Download herstarten (retry)
expressApp.post('/download/:id/retry', async (req, res) => {
  const id = parseInt(req.params.id);
  const proc = activeProcesses.get(id);
  if (proc) {
    try { proc.kill('SIGTERM'); } catch (e) { }
    activeProcesses.delete(id);
  }
  if (startingJobs.has(id)) startingJobs.delete(id);

  jobLane.delete(id);
  queuedJobs.delete(id);
  removeFromQueue(queuedHeavy, id);
  removeFromQueue(queuedLight, id);
  removeFromQueue(queuedBatch, id);

  // Set back to pending in DB so it rehydrates automatically
  await updateDownloadStatus.run('pending', 0, null, id);
  console.log(`🔄 Download #${id} herstart via retry`);
  try { await rehydrateDownloadQueueWithMode('all', 0); } catch (e) { }

  return res.json({ success: true });
});

let _directoryTreeCache = null;
let _directoryTreeCacheTime = 0;
let _directoryTreeInflight = null; // mutex: only one query at a time
expressApp.get('/api/media/directories/tree', async (req, res) => {
  console.log('[TREE] Request received');
  try {
    const now = Date.now();
    if (_directoryTreeCache && (now - _directoryTreeCacheTime) < 120000) {
      console.log('[TREE] Serving from cache');
      return res.json({ success: true, tree: _directoryTreeCache });
    }
    console.log('[TREE] Scanning filesystem at', BASE_DIR);
    const tree = {};
    let platforms = [];
    try { platforms = await fs.promises.readdir(BASE_DIR, { withFileTypes: true }); }
    catch(e) { console.error('[TREE] Cannot read BASE_DIR:', e.message); }
    console.log('[TREE] Found', platforms.length, 'entries in BASE_DIR');
    const platDirs = platforms.filter(e => e.isDirectory() && !e.name.startsWith('.'));
    const results = await Promise.allSettled(platDirs.map(async (pEnt) => {
      const p = pEnt.name;
      const entry = { count: 0, fileCount: 0, screenshotCount: 0, channels: [] };
      let channels = [];
      try { channels = await fs.promises.readdir(require('path').join(BASE_DIR, p), { withFileTypes: true }); }
      catch(e) { return { name: p, entry }; }
      let platFileCount = 0;
      for (const cEnt of channels) {
        if (!cEnt.isDirectory() || cEnt.name.startsWith('.')) {
          if (/\.(mp4|webm|mkv|mov|avi|jpg|jpeg|png)$/i.test(cEnt.name)) platFileCount++;
          continue;
        }
        const c = cEnt.name;
        let d_name = c;
        if (/^thread_\d+$/i.test(c)) d_name = 'Thread ' + c.replace(/^thread_/i, '');
        entry.channels.push({ name: c, displayName: d_name, count: 0, fileCount: 0, screenshotCount: 0 });
      }
      entry.count = platFileCount + entry.channels.length;
      return { name: p, entry };
    }));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) tree[r.value.name] = r.value.entry;
    }
    _directoryTreeCache = tree;
    _directoryTreeCacheTime = Date.now();
    _directoryTreeInflight = null;
    console.log('[TREE] Done! Platforms:', Object.keys(tree).length);
    return res.json({ success: true, tree });
  } catch (e) {
    _directoryTreeInflight = null;
    console.error('[TREE] Error:', e.message);
    return res.status(500).json({ success: false, error: String(e.message || e) });
  }
});

// ========================
// DASHBOARD UI
// ========================
expressApp.get('/dashboard', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const runtimeActiveRows = await getRuntimeActiveDownloadRows();
  const runtimeActiveIds = new Set((runtimeActiveRows || []).map((row) => Number(row && row.id)).filter((id) => Number.isFinite(id)));
  const queuedRows = (await db.prepare(`
    SELECT * FROM downloads
    WHERE status IN ('queued', 'pending', 'postprocessing')
    ORDER BY
      CASE status
        WHEN 'postprocessing' THEN 0
        WHEN 'queued' THEN 1
        WHEN 'pending' THEN 2
        ELSE 9
      END,
      COALESCE(updated_at, created_at) DESC,
      created_at DESC
    LIMIT 200
  `).all()).filter((row) => !runtimeActiveIds.has(Number(row && row.id)));
  const completedRows = await db.prepare(`
    SELECT * FROM downloads 
    WHERE status NOT IN ('queued', 'pending', 'downloading', 'postprocessing')
    ORDER BY COALESCE(finished_at, updated_at) DESC, created_at DESC 
    LIMIT 350
  `).all();

  const allDownloads = [...runtimeActiveRows, ...queuedRows, ...completedRows];
  const seen = new Set();
  const uniqueDownloads = [];
  for (const d of allDownloads) {
    if (!d || !d.id) continue;
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    uniqueDownloads.push(d);
  }

  const screenshots = await db.prepare(`SELECT * FROM screenshots ORDER BY created_at DESC LIMIT 200`).all();
  const recentBatchFiles = await getRecentDashboardBatchFiles.all(240);
  res.send(getDashboardHTML(uniqueDownloads, screenshots, recentBatchFiles, BASE_DIR, makeIndexedMediaItem));
});

expressApp.get('/media/file', async (req, res) => {
  const kind = String(req.query.kind || '').toLowerCase();
  const id = parseInt(req.query.id, 10);
  try {
    console.log(`[GET /media/file] kind=${kind} id=${id} ua=${String(req.headers['user-agent'] || '').slice(0, 60)}`);
  } catch (e) { }
  if (!Number.isFinite(id)) return res.status(400).end();

  try {
    // Use filepath cache to avoid DB hit on every Range request
    const cacheKey = `${kind}:${id}`;
    let fp = mediaFileCache.get(cacheKey);
    let row = null;
    if (!fp) {
      if (kind === 'd') row = await getDownload.get(id); else
        if (kind === 's') row = await db.prepare(`SELECT * FROM screenshots WHERE id=?`).get(id); else
          return res.status(400).end();

      if (!row) return res.status(404).end();
      fp = String(row.filepath || '').trim();
      if (fp) mediaFileCache.set(cacheKey, fp);
    }

    if (row && row.platform === 'patreon') {
      console.log(`[DEBUG-PATREON-EXPAND] Processing id=${row && row.id}, fp=${fp}, isAllowed=${safeIsAllowedExistingPath(path.resolve(fp))}`);
    }

    if (!fp || !safeIsAllowedExistingPath(fp)) return res.status(404).end();
    res.setHeader('Cache-Control', 'private, max-age=3600, must-revalidate');
    try {
      const st = fs.statSync(fp);
      if (st && st.isDirectory && st.isDirectory()) {
        const t = inferMediaType(fp);
        if (t === 'video') {
          const v = findFirstVideoInDirDeep(fp) || findFirstVideoInDir(fp);
          if (v && safeIsAllowedExistingPath(v)) {
            return res.sendFile(v, (err) => {
              if (!err) return;
              if (res.headersSent) return;
              const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
              if (status === 404) return res.status(404).end();
              console.warn(`media file sendFile failed: ${err.message}`);
              return res.status(500).end();
            });
          }
        }

        // Gebruik eerst de per-download geïndexeerde specifieke file; dit
        // zorgt dat meerdere downloads die dezelfde channel-dir delen (bv.
        // gallery-dl/pornpics) elk hun eigen afbeelding tonen die matcht met
        // de card-thumbnail. Fallback op pickThumbnailFileShallow/Primary.
        let img = null;
        if (kind === 'd') {
          try { img = await getFirstDownloadFileAbs(id); } catch (e) { img = null; }
        }
        if (!img) img = pickThumbnailFileShallow(fp);
        if (!img) {
          const imgData = pickPrimaryMediaFile(fp);
          img = imgData ? imgData.path : null;
        }
        if (img && safeIsAllowedExistingPath(img)) {
          return res.sendFile(img, (err) => {
            if (!err) return;
            if (res.headersSent) return;
            const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
            if (status === 404) return res.status(404).end();
            console.warn(`media file sendFile failed: ${err.message}`);
            return res.status(500).end();
          });
        }

        return res.status(404).end();
      }
    } catch (e) { }

    // For MKV/AVI: stream as fragmented MP4 via ffmpeg pipe (instant playback, no re-encoding)
    const fileExt = path.extname(fp).toLowerCase();
    const needsRemux = fileExt === '.mkv' || fileExt === '.avi';
    if (needsRemux) {
      try {
        const ffmpegPath = resolveUsableFfmpegPath();
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        // frag_keyframe+empty_moov: produces fragmented MP4 that streams immediately
        const args = [
          '-hide_banner', '-loglevel', 'error',
          '-i', fp,
          '-c', 'copy',
          '-movflags', 'frag_keyframe+empty_moov',
          '-f', 'mp4',
          'pipe:1'
        ];
        const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        proc.stdout.pipe(res);
        proc.stderr.on('data', () => {}); // silence stderr
        proc.on('error', (e) => {
          if (!res.headersSent) res.status(500).end();
        });
        res.on('close', () => {
          try { proc.kill('SIGKILL'); } catch (e) {}
        });
        return;
      } catch (e) {
        // Fallback to raw sendFile if ffmpeg fails
        console.warn(`fMP4 stream failed for ${fp}: ${e.message}, falling back to sendFile`);
      }
    }
    // Native formats: MP4/MOV/M4V/WebM — serve directly
    if (fileExt === '.mov' || fileExt === '.m4v') res.setHeader('Content-Type', 'video/mp4');
    res.sendFile(fp, (err) => {
      if (!err) return;
      if (res.headersSent) return;
      const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
      if (status === 404) return res.status(404).end();
      console.warn(`media file sendFile failed: ${err.message}`);
      return res.status(500).end();
    });
  } catch (e) {
    res.status(500).end();
  }
});

// On-the-fly remux MKV/AVI/etc to MP4 for browser playback (no re-encoding)
expressApp.get('/media/stream', async (req, res) => {
  const kind = String(req.query.kind || '').toLowerCase();
  const id = parseInt(req.query.id, 10);
  if (!Number.isFinite(id)) return res.status(400).end();

  try {
    let row = null;
    if (kind === 'd') row = await getDownload.get(id); else
      if (kind === 's') row = await db.prepare(`SELECT * FROM screenshots WHERE id=?`).get(id); else
        return res.status(400).end();
    if (!row) return res.status(404).end();

    const fp = String(row.filepath || '').trim();
    if (!fp || !safeIsAllowedExistingPath(fp)) return res.status(404).end();

    // If it's already MP4/WebM/MOV/MKV, just serve directly
    const ext = path.extname(fp).toLowerCase();
    if (ext === '.mp4' || ext === '.webm' || ext === '.m4v' || ext === '.mov' || ext === '.mkv') {
      // Force video/mp4 for containers browsers can't handle by MIME
      if (ext === '.mov' || ext === '.m4v' || ext === '.mkv') res.setHeader('Content-Type', 'video/mp4');
      return res.sendFile(fp, (err) => {
        if (!err) return;
        if (res.headersSent) return;
        res.status(err.code === 'ENOENT' ? 404 : 500).end();
      });
    }

    // For directories, find the first video file
    let videoPath = fp;
    try {
      const st = fs.statSync(fp);
      if (st && st.isDirectory && st.isDirectory()) {
        const v = findFirstVideoInDirDeep(fp) || findFirstVideoInDir(fp);
        if (v && safeIsAllowedExistingPath(v)) videoPath = v;
        else return res.status(404).end();
      }
    } catch (e) { }

    // Check for cached .stream.mp4 next to the source file
    const cachedMp4 = videoPath.replace(/\.[^.]+$/, '.stream.mp4');
    try {
      const cacheStat = fs.statSync(cachedMp4);
      if (cacheStat && cacheStat.size > 1000) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.sendFile(cachedMp4, (err) => {
          if (!err) return;
          if (res.headersSent) return;
          res.status(err.code === 'ENOENT' ? 404 : 500).end();
        });
      }
    } catch (e) { /* no cache yet */ }

    // Remux to cached MP4 file (no re-encoding, container conversion only)
    const ffmpegPath = resolveUsableFfmpegPath();
    const tmpOut = cachedMp4 + '.tmp';
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-y',
      '-i', videoPath,
      '-c', 'copy',                // No re-encoding
      '-movflags', '+faststart',   // Move moov atom to front for fast seek
      '-f', 'mp4',
      tmpOut
    ];

    try {
      await new Promise((resolve, reject) => {
        const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(stderr || `ffmpeg exit ${code}`));
        });
        proc.on('error', reject);
        
        // Abort if client disconnects during remux
        let aborted = false;
        res.on('close', () => {
          if (!aborted) {
            aborted = true;
            try { proc.kill('SIGKILL'); } catch (e) { }
          }
        });
      });

      // Rename temp to final cache
      fs.renameSync(tmpOut, cachedMp4);
      
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.sendFile(cachedMp4, (err) => {
        if (!err) return;
        if (res.headersSent) return;
        res.status(err.code === 'ENOENT' ? 404 : 500).end();
      });
    } catch (e) {
      // Clean up temp file
      try { fs.unlinkSync(tmpOut); } catch (e2) { }
      console.warn(`[stream] remux failed for ${path.basename(videoPath)}: ${e.message}`);
      
      // Fallback: stream pipe (no seeking but at least plays)
      const pipeArgs = [
        '-hide_banner', '-loglevel', 'error',
        '-i', videoPath,
        '-c', 'copy',
        '-movflags', 'frag_keyframe+empty_moov',
        '-f', 'mp4',
        'pipe:1'
      ];
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Cache-Control', 'no-store');
      const proc2 = spawn(ffmpegPath, pipeArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      proc2.stdout.pipe(res);
      proc2.on('error', () => { if (!res.headersSent) res.status(500).end(); });
      res.on('close', () => { try { proc2.kill('SIGKILL'); } catch (e) { } });
    }
  } catch (e) {
    if (!res.headersSent) res.status(500).end();
  }
});

function inferMediaType(fp) {
  const p = String(fp || '').trim();
  if (!p) return 'file';

  // Fast path: check extension first (no disk I/O needed)
  const ext = String(path.extname(p).toLowerCase() || '');
  if (['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.flv', '.ts', '.m3u8'].includes(ext)) return 'video';
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif', '.heic', '.heif'].includes(ext)) return 'image';

  // No extension = likely a directory (gallery-dl download)
  // Return 'image' without any disk I/O — data comes from DB and is reliable
  if (!ext) return 'image';

  return 'file';
}

function normalizeThumbValue(v) {
  try {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (s.startsWith('data:image/')) return s;
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    if (s.startsWith('/')) {
      const ok =
        s.startsWith('/download/') ||
        s.startsWith('/media/') ||
        s.startsWith('/addon/');

      return ok ? s : '';
    }
    return '';
  } catch (e) {
    return '';
  }
}

function makeMediaItem(row) {
  const sourceUrl = row.source_url || '';
  const fp = String(row.filepath || '').trim();

  // Patreon debug log removed — safeIsAllowedExistingPath does sync I/O

  if (fp && isAuxiliaryMediaPath(fp)) return null;
  const t = inferMediaType(fp);

  let fileRel = '';
  try {
    if (fp) {
      const abs = path.resolve(fp);
      if (isInsidePrimaryBaseDir(abs)) {
        fileRel = relPathFromBaseDir(abs);
      }
    }
  } catch (e) {
    fileRel = '';
  }

  let dedupeKey = '';
  try {
    if (fp) {
      dedupeKey = path.resolve(fp);
    }
  } catch (e) {
    dedupeKey = fp || '';
  }

  const safeDecode = (v) => {
    try {
      const s = String(v == null ? '' : v);
      return /%[0-9a-f]{2}/i.test(s) ? decodeURIComponent(s) : s;
    } catch (e) {
      return String(v == null ? '' : v);
    }
  };

  const preferredThumb = row && row.kind === 'd' ? normalizeThumbValue(row.thumbnail) : '';

  let channel = safeDecode(row.channel);
  let title = safeDecode(row.title);
  let channelDisplay = '';
  let titleDisplay = '';

  // Derive channel from filepath when it's 'unknown'
  if ((!channel || channel === 'unknown') && fp) {
    try {
      const parts = fp.split(path.sep).filter(Boolean);
      // Look for the segment after the platform name in the path
      // e.g., /Users/jurgen/Downloads/WEBDL/pornpics/Feet → 'Feet'
      const platLower = String(row.platform || '').toLowerCase();
      const platIdx = parts.findIndex(p => p.toLowerCase() === platLower);
      if (platIdx >= 0 && platIdx < parts.length - 1) {
        channel = parts[platIdx + 1];
      } else if (parts.length >= 2) {
        // Fallback: use the last meaningful directory name
        const last = parts[parts.length - 1];
        const secondLast = parts[parts.length - 2];
        channel = path.extname(last) ? secondLast : last;
      }
    } catch (e) {}
  }
  try {
    const plat = String(row && row.platform ? row.platform : '').toLowerCase();
    if (plat === 'footfetishforum') {
      const info = parseFootFetishForumThreadInfo(row && (row.source_url || row.url) ? (row.source_url || row.url) : '');
      if (info && info.name) channelDisplay = info.name;
      else if (/^thread_\d+$/i.test(channel)) channelDisplay = 'Thread ' + channel.replace(/^thread_/i, '');
      if (info && info.name && (!title || title === 'untitled')) title = info.name;
    }
  } catch (e) { }
  if (!channelDisplay) channelDisplay = channel;
  if (channelDisplay) titleDisplay = title ? `${channelDisplay} • ${title}` : channelDisplay;

  const src = `/media/file?kind=${encodeURIComponent(row.kind)}&id=${encodeURIComponent(row.id)}`;
  const preferredThumbFinal = preferredThumb ? (preferredThumb.includes('?') ? `${preferredThumb}&v=6` : `${preferredThumb}?v=6`) : '';
  // For image files: serve the file itself as thumbnail via static path (no DB lookup needed)
  let thumb;
  const firstFileRel = row.first_file || null;
  if (t === 'image' && firstFileRel) {
    // Use the first indexed file from download_files (for gallery-dl/directory downloads)
    thumb = '/webdl-static/' + firstFileRel.split('/').map(encodeURIComponent).join('/');
  } else if (t === 'image' && fileRel && /\.(jpe?g|png|webp|gif)$/i.test(fileRel)) {
    // Single image file download
    thumb = '/webdl-static/' + fileRel.split(path.sep).map(encodeURIComponent).join('/');
  } else if (row.kind === 's' && t === 'image' && src) {
    thumb = src;
  } else {
    thumb = preferredThumbFinal || `/media/thumb?kind=${encodeURIComponent(row.kind)}&id=${encodeURIComponent(row.id)}&v=6`;
  }

  return {
    kind: row.kind,
    id: row.id,
    platform: row.platform,
    channel,
    title,
    channel_display: channelDisplay || null,
    title_display: titleDisplay || null,
    created_at: row.created_at,
    ts: typeof row.ts === 'number' ? row.ts : parseInt(String(row.ts || '0'), 10),
    type: t,
    rating: (row && row.rating != null && row.rating !== '') ? Number(row.rating) : null,
    rating_kind: row.kind,
    rating_id: row.id,
    url: row.url || null,
    source_url: row.source_url || null,
    dedupe_key: dedupeKey || null,
    file_rel: fileRel || null,
    ready: true,
    src,
    thumb,
    open: { kind: row.kind, id: row.id }
  };
}

function makePendingThumbDataUrl(label) {
  try {
    const t = String(label || '').slice(0, 80);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="100%" height="100%" fill="#000"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#00d4ff" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="22">${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  } catch (e) {
    return '';
  }
}

function makeActiveDownloadItem(row) {
  try {
    const fp = String(row && row.filepath ? row.filepath : '').trim();
    if (fp && isAuxiliaryMediaPath(fp)) return null;
  } catch (e) { }
  const safeDecode = (v) => {
    try {
      const s = String(v == null ? '' : v);
      return /%[0-9a-f]{2}/i.test(s) ? decodeURIComponent(s) : s;
    } catch (e) {
      return String(v == null ? '' : v);
    }
  };

  const status = String(row && row.status ? row.status : 'queued');
  const progress = Number.isFinite(Number(row && row.progress != null ? row.progress : 0)) ? Number(row.progress) : 0;
  const label = status === 'queued' ? 'queued' : status === 'postprocessing' ? 'post' : 'dl';
  const fp = String(row && row.filepath ? row.filepath : '').trim();
  const rawUrl = String(row && row.url ? row.url : '').trim();
  const preferredThumb = normalizeThumbValue(row && row.thumbnail ? row.thumbnail : '');
  let type = inferMediaType(fp);
  if (type !== 'image' && type !== 'video') {
    try {
      if (rawUrl) {
        const parsed = new URL(rawUrl);
        type = inferMediaType(parsed.pathname || rawUrl);
      }
    } catch (e) { }
  }
  if (type !== 'image' && type !== 'video') type = 'file';
  let thumb = preferredThumb;
  if (!thumb && rawUrl && type === 'image' && looksLikeDirectFileUrl(rawUrl)) {
    thumb = rawUrl;
  }
  if (!thumb && row && row.id != null) {
    const v = row.updated_at ? `&t=${encodeURIComponent(String(row.updated_at))}` : '';
    thumb = `/download/${encodeURIComponent(String(row.id))}/thumb?v=active${v}`;
  }
  if (!thumb) {
    thumb = makePendingThumbDataUrl(`${label} ${Math.max(0, Math.min(100, progress))}%`);
  }

  return {
    kind: 'd',
    id: row.id,
    platform: String(row.platform || 'unknown'),
    channel: safeDecode(row.channel) || 'unknown',
    title: safeDecode(row.title) || '(download)',
    created_at: row.created_at || row.updated_at || '',
    type,
    url: row.url || null,
    source_url: row.source_url || null,
    ready: false,
    status,
    progress: Math.max(0, Math.min(100, progress)),
    src: '',
    thumb,
    open: { kind: 'd', id: row.id }
  };
}

function encodeCursor(obj) {
  try {
    return Buffer.from(JSON.stringify(obj || {}), 'utf8').toString('base64');
  } catch (e) {
    return '';
  }
}

function decodeCursor(str) {
  try {
    const s = String(str || '').trim();
    if (!s) return { activeOffset: 0, rowOffset: 0, dir: '', fileIndex: 0 };
    const raw = Buffer.from(s, 'base64').toString('utf8');
    const obj = JSON.parse(raw);
    const activeOffset = obj.activeOffset === -1 ? -1 : Math.max(0, parseInt(obj.activeOffset || 0, 10) || 0);
    const rowOffset = Math.max(0, parseInt(obj.rowOffset || 0, 10) || 0);
    const dir = String(obj.dir || '');
    const fileIndex = Math.max(0, parseInt(obj.fileIndex || 0, 10) || 0);
    return { activeOffset, rowOffset, dir, fileIndex };
  } catch (e) {
    return { activeOffset: 0, rowOffset: 0, dir: '', fileIndex: 0 };
  }
}

function isAuxiliaryMediaPath(inputPath) {
  try {
    const base = String(path.basename(String(inputPath || '')) || '').toLowerCase();
    if (!base) return false;
    if (base === 'metadata.json') return true;
    if (base.endsWith('.webp')) return true;
    if (/_thumb_v[0-9]+\.(jpe?g|png|gif)$/i.test(base)) return true;
    if (/[_\-.](?:thumb|thumbnail|logo|poster|preview|cover)(?:[_\-.][a-z0-9]+)?\.(?:jpe?g|png|gif|webp|bmp|svg|avif|heic|heif)$/i.test(base)) return true;
    if (/(?:^|[_\-.])(?:thumb|thumbnail|logo|poster|preview|cover)(?:[_\-.][a-z0-9]+)?$/i.test(path.basename(base, path.extname(base)))) return true;
  } catch (e) { }
  return false;
}

function listMediaFilesInDir(rootDirAbs, maxFiles = 8000) {
  const out = [];
  try {
    const root = path.resolve(String(rootDirAbs || ''));
    if (!root || !safeIsInsideBaseDir(root) || !fs.existsSync(root)) return out;
    const st = fs.statSync(root);
    if (!st.isDirectory()) return out;

    const queue = [{ d: root, depth: 0 }];
    const seenDirs = new Set();
    const MAX_DEPTH = 8;
    const MAX_FILES = Math.max(1, Math.min(8000, parseInt(maxFiles || 8000, 10) || 8000));
    const MAX_DIRS = Math.max(60, Math.min(900, MAX_FILES * 20));
    const mediaExts = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif', '.heic', '.heif']);

    while (queue.length) {
      const cur = queue.shift();
      if (!cur || !cur.d) continue;
      if (cur.depth > MAX_DEPTH) continue;
      const dirPath = path.resolve(cur.d);
      if (!safeIsInsideBaseDir(dirPath)) continue;
      if (seenDirs.has(dirPath)) continue;
      seenDirs.add(dirPath);
      if (seenDirs.size > MAX_DIRS) break;

      let entries = [];
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch (e) {
        continue;
      }

      for (const entry of entries) {
        if (!entry || !entry.name) continue;
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dirPath, entry.name);
        if (!safeIsInsideBaseDir(fullPath)) continue;

        if (entry.isDirectory()) {
          if (entry.name === '.thumbs' || entry.name === '__MACOSX') continue;
          queue.push({ d: fullPath, depth: cur.depth + 1 });
          continue;
        }

        if (!entry.isFile()) continue;
        const ext = String(path.extname(entry.name || '').toLowerCase() || '');
        if (!mediaExts.has(ext)) continue;
        if (isAuxiliaryMediaPath(entry.name)) continue;
        out.push(path.resolve(fullPath));
        if (out.length >= MAX_FILES) break;
      }

      if (out.length >= MAX_FILES) break;
    }
  } catch (e) { }

  out.sort((a, b) => a.localeCompare(b));
  return dedupeVideoThumbnailPairs(out);
}

function dedupeVideoThumbnailPairs(files) {
  try {
    if (!Array.isArray(files) || files.length === 0) return files || [];
    const videoExts = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);
    const imageExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif', '.heic', '.heif']);
    const groups = new Map();

    for (const file of files) {
      const ext = String(path.extname(file || '').toLowerCase() || '');
      if (!videoExts.has(ext) && !imageExts.has(ext)) continue;
      const baseKey = path.join(path.dirname(file), path.basename(file, ext));
      let entry = groups.get(baseKey);
      if (!entry) {
        entry = { videos: [], images: [] };
        groups.set(baseKey, entry);
      }
      if (videoExts.has(ext)) entry.videos.push(file); else
        entry.images.push(file);
    }

    const emittedGroups = new Set();
    const result = [];
    for (const file of files) {
      const ext = String(path.extname(file || '').toLowerCase() || '');
      if (videoExts.has(ext) || imageExts.has(ext)) {
        const baseKey = path.join(path.dirname(file), path.basename(file, ext));
        if (emittedGroups.has(baseKey)) continue;
        emittedGroups.add(baseKey);
        const entry = groups.get(baseKey);
        if (!entry) {
          result.push(file);
          continue;
        }
        if (entry.videos.length) {
          for (const v of entry.videos) result.push(v);
        } else {
          for (const img of entry.images) result.push(img);
        }
      } else {
        result.push(file);
      }
    }
    return result;
  } catch (e) {
    return files;
  }
}

function makePathMediaItem({ relPath, platform, channel, title, created_at, thumbTs, url, source_url, rating, rating_kind, rating_id }) {
  const absPath = path.resolve(BASE_DIR, relPath);
  if (isAuxiliaryMediaPath(absPath)) return null;
  const type = inferMediaType(absPath);
  const base = path.basename(relPath);

  let channelDisplay = channel || '';
  try {
    const plat = String(platform || '').toLowerCase();
    if (plat === 'footfetishforum') {
      const info = parseFootFetishForumThreadInfo(source_url || url || '');
      if (info && info.name) channelDisplay = info.name;
      else if (/^thread_\d+$/i.test(channelDisplay)) channelDisplay = 'Thread ' + channelDisplay.replace(/^thread_/i, '');
    }
    // For 'unknown' channel, try to derive from relPath directory structure
    if (!channelDisplay || channelDisplay.toLowerCase() === 'unknown') {
      // relPath like: pornpics/Gallery Name/gallery-dl/pornpics/ID Title/file.jpg
      const parts = relPath.split('/');
      if (parts.length >= 2 && parts[0].toLowerCase() === plat && parts[1] && parts[1].toLowerCase() !== 'unknown') {
        channelDisplay = parts[1];
      }
      // Also try gallery-dl subpath: pornpics/unknown/gallery-dl/pornpics/94245654 Title/file.jpg
      if ((!channelDisplay || channelDisplay.toLowerCase() === 'unknown') && relPath.includes('gallery-dl/pornpics/')) {
        const gdMatch = relPath.match(/gallery-dl\/pornpics\/(?:\d+\s+)?([^\/]+)\//i);
        if (gdMatch && gdMatch[1]) channelDisplay = gdMatch[1];
      }
    }
    // Strip gallery-dl numeric ID prefix from channel names (e.g. "94245654 Title" → "Title")
    if (channelDisplay && /^\d{6,}\s+/.test(channelDisplay)) {
      channelDisplay = channelDisplay.replace(/^\d+\s+/, '');
    }
  } catch (e) { }

  // For individual files, show just the filename — not the parent download's title
  const isUnknown = !channelDisplay || channelDisplay.toLowerCase() === 'unknown';
  const combinedTitle = !isUnknown ? `${channelDisplay} • ${base}` : (title && title !== base ? `${title} • ${base}` : base);
  let titleDisplay = combinedTitle;

  const dedupeKey = absPath;
  return {
    kind: 'p',
    id: relPath,
    platform,
    channel: channelDisplay || channel,
    channel_display: channelDisplay,
    title: combinedTitle,
    title_display: titleDisplay,
    created_at,
    ts: thumbTs > 0 ? thumbTs : (created_at ? new Date(created_at).getTime() : 0),
    type,
    rating: (rating != null && rating !== '') ? Number(rating) : null,
    rating_kind: rating_kind || 'd',
    rating_id: rating_id != null ? rating_id : null,
    url: url || null,
    source_url: source_url || null,
    dedupe_key: dedupeKey,
    file_rel: relPath,
    src: `/media/path?path=${encodeURIComponent(relPath)}`,
    thumb: `/media/path-thumb?path=${encodeURIComponent(relPath)}&v=5${thumbTs ? '&t=' + encodeURIComponent(String(thumbTs)) : ''}`,
    open: { path: relPath }
  };
}

function makeIndexedMediaItem(row) {
  const sourceUrl = row.source_url || '';
  if (!row || typeof row !== 'object') return null;
  const kind = String(row.kind || '').toLowerCase();
  if (kind === 'p') {
    const relPath = String(row.id || '').trim();
    if (!relPath) return null;
    let thumbTs = 0;
    try {
      const absPath = path.resolve(BASE_DIR, relPath);
      if (safeIsAllowedExistingPath(absPath)) {
        const st = fs.statSync(absPath);
        thumbTs = st && st.mtimeMs ? st.mtimeMs : 0;
      }
    } catch (e) { }
    return makePathMediaItem({
      relPath,
      platform: row.platform,
      channel: row.channel,
      title: row.title,
      created_at: row.created_at,
      thumbTs,
      url: row.url,
      source_url: row.source_url,
      rating: row.rating,
      rating_kind: row.rating_kind,
      rating_id: row.rating_id
    });
  }
  return makeMediaItem(row);
}

function mediaItemKey(item) {
  if (!item || typeof item !== 'object') return null;
  // Normalize path: strip varying base dirs to get canonical WEBDL-relative path
  // e.g. /Users/.../WEBDL/_4K/file.mkv and /Volumes/HDD/WEBDL/_4K/file.mkv → _4K/file.mkv
  const normalizePath = (p) => {
    const s = String(p || '');
    const m = s.match(/[\/\\]WEBDL[\/\\](.+)$/i);
    return m ? m[1] : s;
  };
  try {
    const dk = item.dedupe_key ? String(item.dedupe_key) : '';
    if (dk) {
      return `dedupe:${normalizePath(dk)}`;
    }
  } catch (e) { }
  try {
    const rel = item.file_rel ? String(item.file_rel) : '';
    if (rel) {
      return `dedupe:${normalizePath(path.resolve(BASE_DIR, rel))}`;
    }
  } catch (e) { }
  if (item.kind && item.id != null) {
    return `${item.kind}:${item.id}`;
  }
  if (item.open && item.open.path) {
    return `path:${item.open.path}`;
  }
  if (item.src) {
    return `src:${item.src}`;
  }
  return null;
}

function mediaItemPriority(item) {
  if (!item || typeof item !== 'object') return 0;
  const kind = String(item.kind || '').toLowerCase();
  let base = 0;
  if (kind === 'd') base = 3;
  else if (kind === 's') base = 2;
  else if (kind === 'p') base = 1;
  // Prefer local disk over HDD (faster for streaming/thumbnails)
  const dk = item.dedupe_key || '';
  if (dk && /^\/Users\//i.test(dk)) base += 0.5;
  return base;
}

function pushUniqueMediaItem({
  bucket,
  item,
  seen,
  typeFilter
}) {
  if (!item || !bucket || !seen) return false;
  const type = String(typeFilter || 'all');
  const isMedia = item.type === 'video' || item.type === 'image';
  if (type === 'media' && !isMedia) return false;
  if (type === 'video_only' && item.type !== 'video') return false;
  if (type === 'image_only' && item.type !== 'image') return false;
  if (type !== 'all' && type !== 'media' && type !== 'video_only' && type !== 'image_only' && item.type !== type) return false;
  const key = mediaItemKey(item);
  if (key && seen.has(key)) {
    const prevIndex = Number(seen.get(key));
    if (!Number.isFinite(prevIndex) || prevIndex < 0 || prevIndex >= bucket.length) return false;
    const prevItem = bucket[prevIndex];
    if (mediaItemPriority(item) <= mediaItemPriority(prevItem)) return false;
    bucket[prevIndex] = item;
    return true;
  }
  bucket.push(item);
  if (key) seen.set(key, bucket.length - 1);
  return true;
}

function expandRowToMediaItems(row, cursorFileIndex = 0, maxItems = 500) {
  const items = [];
  const fp = String(row.filepath || '').trim();

  if (row.platform === 'patreon') {
    console.log(`[DEBUG-PATREON-EXPAND] Processing id=${row.id}, fp=${fp}, isAllowed=${safeIsAllowedExistingPath(path.resolve(fp))}`);
  }

  if (!fp) return { items, nextFileIndex: 0, done: true };

  try {
    const abs = path.resolve(fp);
    if (!safeIsAllowedExistingPath(abs)) return { items, nextFileIndex: 0, done: true };
    // Fast path: if filepath has an extension, it's a file — skip expensive disk I/O
    const ext = path.extname(abs);
    if (ext && ext.length > 1 && ext.length < 8) {
      items.push(makeMediaItem(row));
      return { items, nextFileIndex: 0, done: true };
    }
    // Only stat for directory-like paths (no extension)
    const st = fs.existsSync(abs) ? fs.statSync(abs) : null;
    if (!st) return { items, nextFileIndex: 0, done: true };
    if (!st.isDirectory()) {
      items.push(makeMediaItem(row));
      return { items, nextFileIndex: 0, done: true };
    }

    const cap = Math.max(1, Math.min(500, parseInt(maxItems || 500, 10) || 500));
    const startIndex = Math.max(0, parseInt(cursorFileIndex || 0, 10) || 0);
    const scanLimit = Math.max(600, Math.min(8000, startIndex + Math.max(cap * 4, 600)));
    const files = listMediaFilesInDir(abs, scanLimit);
    if (files && files.length) {
      let i = startIndex;
      for (; i < files.length && items.length < cap; i++) {
        const absFile = files[i];
        if (!absFile || !safeIsAllowedExistingPath(absFile)) continue;
        const rel = path.relative(path.resolve(BASE_DIR), absFile);
        let thumbTs = 0;
        try {
          const st2 = fs.statSync(absFile);
          thumbTs = st2 && st2.mtimeMs ? st2.mtimeMs : 0;
        } catch (e) { }
        const it = makePathMediaItem({
          relPath: rel,
          platform: row.platform,
          channel: row.channel,
          title: row.title,
          created_at: row.created_at,
          thumbTs,
          url: row.url,
          source_url: row.source_url,
          rating: row.rating,
          rating_kind: row.kind,
          rating_id: row.id
        });
        if (it && (it.type === 'image' || it.type === 'video')) items.push(it);
      }
      return { items, nextFileIndex: i, done: i >= files.length };
    }

    const primary = pickPrimaryMediaFile(abs);
    if (primary && primary.path) {
      if (isInsidePrimaryBaseDir(primary.path)) {
        const rel = path.relative(path.resolve(BASE_DIR), primary.path);
        const it = makePathMediaItem({
          relPath: rel,
          platform: row.platform,
          channel: row.channel,
          title: row.title,
          created_at: row.created_at,
          thumbTs: primary.mtime || 0,
          url: row.url,
          source_url: row.source_url,
          rating: row.rating,
          rating_kind: row.kind,
          rating_id: row.id
        });
        if (it) {
          try {
            const preferred = row && row.kind === 'd' ? normalizeThumbValue(row.thumbnail) : '';
            if (preferred) it.thumb = preferred;
          } catch (e) { }
          if (it.type === 'image' || it.type === 'video') items.push(it);
        }
      } else {
        items.push(makeMediaItem(row));
      }
    } else {
      items.push(makeMediaItem(row));
    }
    return { items, nextFileIndex: 0, done: true };
  } catch (e) {
    return { items, nextFileIndex: 0, done: true };
  }
}
async function getDynamicHybridBatch(stmt, typeFilter, ...args) {
  // Extract optional platformFilter from last args if it's an object with _platformFilter key
  let platformFilter = null;
  if (args.length > 0 && args[args.length - 1] && typeof args[args.length - 1] === 'object' && args[args.length - 1]._platformFilter) {
    platformFilter = args.pop();
  }
  // Extract optional searchFilter from last args
  let searchFilter = null;
  if (args.length > 0 && args[args.length - 1] && typeof args[args.length - 1] === 'object' && args[args.length - 1]._searchFilter) {
    searchFilter = args.pop();
  }

  const needsTypeFilter = (typeFilter === 'video_only' || typeFilter === 'image_only');
  const needsPlatformFilter = platformFilter && platformFilter.platforms && platformFilter.platforms.length > 0;
  const needsSearchFilter = searchFilter && searchFilter.query;

  if (!needsTypeFilter && !needsPlatformFilter && !needsSearchFilter) {
    return await stmt.all(...args);
  }

  let sql = stmt.source || '';
  if (!sql) return await stmt.all(...args);

  // Search filter: add ILIKE clauses and remove ID-window limits to search full DB
  if (needsSearchFilter) {
    const q = String(searchFilter.query).replace(/'/g, "''").replace(/%/g, '');
    const searchLike = `%${q}%`;
    // Remove ID-window limits so we search the full database
    sql = sql.replace(/AND\s+d\.id\s*>\s*\(SELECT\s+MAX\(id\)\s*-\s*\d+\s+FROM\s+downloads\)/gi, '');
    // Add search ILIKE as outer filter wrapping the whole query
    const orderMatch = sql.match(/(ORDER\s+BY\s+ts\s+(?:DESC|ASC)\s*(?:NULLS\s+(?:FIRST|LAST)\s*)?LIMIT\s+\?\s*OFFSET\s+\?)\s*$/is);
    if (orderMatch) {
      const orderClause = orderMatch[1];
      const baseQuery = sql.slice(0, sql.length - orderMatch[0].length).trimEnd();
      sql = `SELECT * FROM (${baseQuery}) _srch WHERE (LOWER(COALESCE(platform,'') || ' ' || COALESCE(channel,'') || ' ' || COALESCE(title,'') || ' ' || COALESCE(filepath,'')) LIKE LOWER('${searchLike}')) ${orderClause}`;
    }
  }

  // Platform filter: replace ID-window with platform IN() directly in each subquery
  if (needsPlatformFilter) {
    const plats = platformFilter.platforms.map(p => `'${String(p).replace(/'/g, "''")}'`).join(',');
    const platClause = `AND d.platform IN (${plats})`;
    // Replace "AND d.id > (SELECT MAX(id) - N FROM downloads)" with platform filter
    sql = sql.replace(/AND\s+d\.id\s*>\s*\(SELECT\s+MAX\(id\)\s*-\s*\d+\s+FROM\s+downloads\)/gi, platClause);
    // Also filter the screenshots subquery (uses s. prefix)
    sql = sql.replace(/(FROM\s+screenshots\s+s\s+WHERE)/gi, `$1 s.platform IN (${plats}) AND`);
  }

  // Type filter: wrap as outer subquery (this is fine since it's a simple extension filter)
  if (needsTypeFilter) {
    const ext = typeFilter === 'video_only'
      ? "(filepath ILIKE '%.mp4' OR filepath ILIKE '%.webm' OR filepath ILIKE '%.mov' OR filepath ILIKE '%.mkv' OR filepath ILIKE '%.MP4' OR filepath ILIKE '%.MOV')"
      : "(filepath ILIKE '%.jpg' OR filepath ILIKE '%.jpeg' OR filepath ILIKE '%.png' OR filepath ILIKE '%.gif' OR filepath ILIKE '%.webp' OR filepath ILIKE '%.avif')";

    const orderMatch = sql.match(/(ORDER\s+BY\s+ts\s+(?:DESC|ASC)\s*(?:NULLS\s+(?:FIRST|LAST)\s*)?LIMIT\s+\?\s*OFFSET\s+\?)\s*$/is);
    if (orderMatch) {
      const orderClause = orderMatch[1];
      const baseQuery = sql.slice(0, sql.length - orderMatch[0].length).trimEnd();
      sql = `SELECT * FROM (${baseQuery}) _typed WHERE ${ext} ${orderClause}`;
    } else {
      sql = `SELECT * FROM (${sql}) _typed_fb WHERE ${ext}`;
    }
  }

  const dynamicStmt = db.prepare(sql);
  return await dynamicStmt.all(...args);
}


// ═══ RAW FILESYSTEM BROWSER FALLBACK ═══
async function performRawFilesystemScan(enabledDirs, searchQuery, typeFilter, sort, limit, cur, db) {
  async function scanDirRec(dir, depth, maxDepth) {
    if (depth > maxDepth) return [];
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch(e) { return []; }
    let results = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = require('path').join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await scanDirRec(fullPath, depth + 1, maxDepth);
        for (let i = 0; i < sub.length; i++) results.push(sub[i]);
      } else {
        const isVid = /\.(mp4|webm|mov|mkv|avi)$/i.test(entry.name);
        const isImg = /\.(jpg|jpeg|png|webp|gif)$/i.test(entry.name);
        if (typeFilter === 'video_only' && !isVid) continue;
        if (typeFilter === 'image_only' && !isImg) continue;
        if (!isVid && !isImg) continue;
        results.push(fullPath);
      }
    }
    return results;
  }

  let allRawPaths = [];
  for (const dirObj of enabledDirs) {
    if (!dirObj || typeof dirObj !== 'object') {
      const fp = require('path').join(BASE_DIR, String(dirObj).trim());
      allRawPaths.push(...(await scanDirRec(fp, 0, 3)));
    } else {
      const dPlat = String(dirObj.platform || '').trim();
      if (dPlat.startsWith('/')) continue;
      if (Array.isArray(dirObj.channels) && dirObj.channels.length > 0) {
        for (const c of dirObj.channels) {
          allRawPaths.push(...(await scanDirRec(require('path').join(BASE_DIR, dPlat, String(c).trim()), 0, 3)));
        }
      } else {
        allRawPaths.push(...(await scanDirRec(require('path').join(BASE_DIR, dPlat), 0, 3)));
      }
    }
  }

  if (searchQuery) {
    const qWords = searchQuery.split(',').map(function(s){return s.trim();}).filter(Boolean);
    allRawPaths = allRawPaths.filter(function(fp) {
      const pLow = fp.toLowerCase();
      for (const w of qWords) {
        const ands = w.split(/[\s+*-]+/).filter(Boolean);
        let ok = true;
        for (const a of ands) { if (!pLow.includes(a)) { ok = false; break; } }
        if (ok) return true;
      }
      return false;
    });
  }

  const fileStats = [];
  for (const fp of allRawPaths) {
    try { 
      const st = await fs.promises.stat(fp); 
      // Use birthtime (creation) if possible, fallback to mtime
      fileStats.push({ fp: fp, ts: st.birthtimeMs || st.mtimeMs }); 
    } catch(e) {}
  }
  fileStats.sort(function(a, b) { 
    const diff = sort === 'oldest' ? a.ts - b.ts : b.ts - a.ts;
    if (diff !== 0) return diff;
    // Fallback to alphabetical sort if timestamps are completely identical
    // so oldest vs newest always correctly reverses the results
    return sort === 'oldest' ? a.fp.localeCompare(b.fp) : b.fp.localeCompare(a.fp);
  });

  const pageOffset = cur ? (cur.rowOffset || 0) : 0;
  const pageSlice = fileStats.slice(pageOffset, pageOffset + limit);

  const rawItems = [];
  for (const p of pageSlice) {
    const relPath = require('path').relative(BASE_DIR, p.fp);
    const isVid = /\.(mp4|webm|mov|mkv|avi)$/i.test(p.fp);
    const mediaType = isVid ? 'video' : 'image';
    rawItems.push({
      kind: 'p',
      id: relPath,
      platform: require('path').dirname(relPath).split(require('path').sep)[0] || 'raw',
      channel: require('path').dirname(relPath).split(require('path').sep)[1] || 'folder',
      channel_display: require('path').dirname(relPath).split(require('path').sep)[1] || 'folder',
      title: require('path').basename(p.fp),
      title_display: require('path').basename(p.fp, require('path').extname(p.fp)),
      filepath: p.fp,
      type: mediaType,
      src: '/media/path?path=' + encodeURIComponent(relPath),
      thumb: '/media/path-thumb?path=' + encodeURIComponent(relPath) + '&v=5',
      open: { path: relPath },
      dedupe_key: p.fp,
      file_rel: relPath,
      url: null,
      source_url: null,
      created_at: new Date(p.ts).toISOString(),
      ts: p.ts,
      rating: null,
    });
  }

  if (pageSlice.length > 0 && db && db.isPostgres) {
    try {
      const sqlPaths = pageSlice.map(function(x) { return x.fp; });
      const binds = [];
      const pms = [];
      for (let i = 0; i < sqlPaths.length; i++) { pms.push('$' + (i + 1)); binds.push(sqlPaths[i]); }
      const qRes = await (db.readPool || db.pool).query('SELECT * FROM downloads WHERE filepath IN (' + pms.join(', ') + ')', binds);
      const map = new Map();
      for (const r of qRes.rows) map.set(r.filepath, r);
      for (const item of rawItems) {
        const matched = map.get(item.filepath);
        if (matched) {
          item.id = String(matched.id);
          item.kind = 'd';
          item.platform = matched.platform || item.platform;
          item.channel = matched.channel || item.channel;
          item.channel_display = matched.channel || item.channel_display;
          item.title = matched.title || item.title;
          item.title_display = matched.title || item.title_display;
          item.rating = matched.rating;
          item.rating_kind = 'd';
          item.rating_id = matched.id;
          item.source_url = matched.source_url || matched.url || null;
          if (matched.thumbnail) {
            item.thumb = '/download/' + matched.id + '/thumb';
          }
        }
      }
    } catch(e) { /* DB enrichment failed, raw items still usable */ }
  }

  return { items: rawItems, nextOffset: pageOffset + rawItems.length, hitLimit: rawItems.length >= limit };
}

// ═══ DEDICATED SEARCH API (fast, bypasses heavy hybrid query) ═══
expressApp.get('/api/media/search', async (req, res) => {
  const reqStart = Date.now();
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q || q.length < 2) return res.json({ success: true, items: [], done: true });
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || '60', 10) || 60));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  const type = String(req.query.type || 'all').toLowerCase();
  const sort = String(req.query.sort || 'recent').toLowerCase();
  const hasSpecificChannelsSearch = enabledDirs && enabledDirs.length > 0 &&
    enabledDirs.some(function(d) { return d && Array.isArray(d.channels) && d.channels.length > 0; });
  if (hasSpecificChannelsSearch) {
    try {
      const rawRes = await performRawFilesystemScan(enabledDirs, q, type, sort, limit, { rowOffset: offset }, db);
      const reqTime = Date.now() - reqStart;
      console.log('[DIR FALLBACK] /api/media/search - ' + rawRes.items.length + ' items in ' + reqTime + 'ms');
      return res.json({
        success: true, items: rawRes.items, done: !rawRes.hitLimit,
        next_cursor: rawRes.hitLimit ? encodeCursor({ rowOffset: rawRes.nextOffset, activeOffset: 0 }) : ''
      });
    } catch(err) {
      console.error('[Search DIR FALLBACK error]', err.message);
    }
  }

  try {
    const orGroups = q.split(',').map(g => g.trim()).filter(Boolean);
    if (orGroups.length === 0) orGroups.push(q);
    
    const conditions = [];
    const bindings = [];
    
    for (const group of orGroups) {
      const andWords = group.split(/[\s*\-+]+/).filter(w => w.trim().length > 0);
      if (andWords.length === 0) continue;
      
      const andConditions = [];
      for (const w of andWords) {
        andConditions.push(`(d.channel ILIKE $${bindings.length + 1} OR d.title ILIKE $${bindings.length + 1} OR d.platform ILIKE $${bindings.length + 1})`);
        bindings.push('%' + w + '%');
      }
      if (andConditions.length > 0) {
        conditions.push(`(${andConditions.join(' AND ')})`);
      }
    }
    
    bindings.push(limit + 40, offset);

    // Direct PG pool query — no db.prepare wrapper, no event loop blocking
    const orderBy = sort === 'oldest' ? 'ts ASC NULLS LAST' 
      : sort === 'rating_desc' ? 'rating DESC NULLS LAST, ts DESC NULLS LAST'
      : sort === 'rating_asc' ? 'rating ASC NULLS FIRST, ts DESC NULLS LAST'
      : sort === 'name_asc' ? 'channel ASC, ts DESC NULLS LAST'
      : 'ts DESC NULLS LAST';
    
    // Type filter
    let typeClause = '';
    if (type === 'video_only') typeClause = "AND (d.filepath ILIKE '%.mp4' OR d.filepath ILIKE '%.webm' OR d.filepath ILIKE '%.mov' OR d.filepath ILIKE '%.mkv')";
    else if (type === 'image_only') typeClause = "AND (d.filepath ILIKE '%.jpg' OR d.filepath ILIKE '%.jpeg' OR d.filepath ILIKE '%.png' OR d.filepath ILIKE '%.gif' OR d.filepath ILIKE '%.webp')";

    const pgResult = await (db.readPool || db.pool).query(`
      SELECT 
        'd' AS kind,
        d.id::text AS id,
        d.platform, d.channel, d.title, d.filepath,
        d.created_at::text AS created_at,
        EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at))::bigint * 1000 AS ts,
        d.thumbnail, d.url, d.source_url, d.rating,
        'd' AS rating_kind, d.id AS rating_id
      FROM downloads d
      WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
        AND d.filepath IS NOT NULL AND d.filepath != ''
        ${conditions.length > 0 ? 'AND (' + conditions.join(' OR ') + ')' : ''}
        ${typeClause}
      ORDER BY ${orderBy}
      LIMIT $${bindings.length - 1} OFFSET $${bindings.length}
    `, bindings);

    const items = [];
    for (const row of pgResult.rows) {
      if (!row || !row.filepath) continue;
      // File-exist check
      const fp = String(row.filepath).trim();
      if (fp && !fileExistsCache(fp)) continue;
      const it = makeMediaItem(row);
      if (it) items.push(it);
      if (items.length >= limit) break;
    }

    const reqTime = Date.now() - reqStart;
    console.log(`📤 [${new Date().toISOString().substr(11, 8)}] /api/media/search q="${q}" - ${items.length} items in ${reqTime}ms`);
    res.json({ 
      success: true, items, done: items.length < limit,
      next_cursor: items.length >= limit ? encodeCursor({ rowOffset: offset + limit, activeOffset: 0 }) : ''
    });
  } catch (e) {
    console.error('[Search API error]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.get('/api/media/recent-files', async (req, res) => {
  const reqStartTime = Date.now();
  console.log(`📥 [${new Date().toISOString().substr(11, 8)}] GET /api/media/recent-files - limit=${req.query.limit || '120'}, type=${req.query.type || 'all'}, cursor=${req.query.cursor ? 'yes' : 'no'}, dirs=${req.query.dirs ? 'yes' : 'no'}`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '120', 10) || 120));
  const type = String(req.query.type || 'all').toLowerCase();
  const tagFilter = String(req.query.tag || '').trim();
  const sort = String(req.query.sort || 'recent').toLowerCase();
  const searchQuery = String(req.query.q || '').trim().toLowerCase();
  const cursorRaw = String(req.query.cursor || '').trim();
  const cur = decodeCursor(cursorRaw);
  const includeActive = String(req.query.include_active || '0') !== '0';
  const includeActiveFiles = String(req.query.include_active_files || '0') !== '0';
  let enabledDirs = null;
  try {
    const dirsParam = String(req.query.dirs || '').trim();
    if (dirsParam) enabledDirs = JSON.parse(dirsParam);
  } catch (e) { }
  if (!enabledDirs) enabledDirs = loadDirectoryFilter();

  // Only use filesystem fallback for specific channel selections (small targeted scans)
  // Platform-level filters are handled efficiently by the fast-path DB query below
  const hasSpecificChannels = enabledDirs && enabledDirs.length > 0 &&
    enabledDirs.some(function(d) { return d && Array.isArray(d.channels) && d.channels.length > 0; });
  if (hasSpecificChannels) {
    try {
      const rawRes = await performRawFilesystemScan(enabledDirs, searchQuery, type, sort, limit, cur, db);
      const reqTime = Date.now() - reqStartTime;
      console.log('[DIR FALLBACK] /api/media/recent-files - ' + rawRes.items.length + ' items in ' + reqTime + 'ms');
      return res.json({
        success: true, items: rawRes.items, done: !rawRes.hitLimit,
        next_cursor: rawRes.hitLimit ? encodeCursor({ rowOffset: rawRes.nextOffset, activeOffset: 0 }) : ''
      });
    } catch(err) {
      console.error('[Recent-Files DIR FALLBACK error]', err.message);
    }
  }

  // Date range filter
  const dateFrom = String(req.query.date_from || '').trim();
  const dateTo = String(req.query.date_to || '').trim();

  // ═══ FAST PATH: Gallery load — direct simple query (initial + scroll) ═══
  // Extract platform filter from enabledDirs (e.g. [{platform:'pornpics'}])
  let fastPathPlatforms = null;
  if (enabledDirs && enabledDirs.length > 0 && enabledDirs.some(d => d && typeof d === 'object' && d.platform)) {
    fastPathPlatforms = enabledDirs
      .filter(d => d && typeof d === 'object' && d.platform)
      .map(d => String(d.platform).toLowerCase().trim())
      .filter(Boolean);
    if (fastPathPlatforms.length === 0) fastPathPlatforms = null;
  }

  const canUseFastPath = !searchQuery && !includeActive && !includeActiveFiles 
    && (sort === 'recent' || sort === 'oldest' || sort === 'group_channel' || sort === 'random')
    && (!enabledDirs || enabledDirs.length === 0 || fastPathPlatforms)
    && (!cursorRaw || (cur && !cur.dir && cur.fileIndex === 0));
  
  if (canUseFastPath) {
    // Cache to avoid re-running expensive query during heavy write load
    const platKey = fastPathPlatforms ? fastPathPlatforms.sort().join(',') : '_all';
    const cacheKey = `fp_${type||'media'}_${sort||'newest'}_${limit}_${cursorRaw||''}_${dateFrom}_${dateTo}_${platKey}`;
    const cached = galleryFastPathCache && galleryFastPathCache.key === cacheKey && (Date.now() - galleryFastPathCache.ts) < 3000
      ? galleryFastPathCache.data : null;
    if (cached) {
      return res.json(cached);
    }
    try {
      const orderBy = sort === 'oldest' ? 'ts ASC NULLS LAST' : (sort === 'random' ? 'RANDOM()' : 'ts DESC NULLS LAST');
      // inferMediaType no longer does sync I/O for directories (fast heuristic),
      // so we can safely include directory-based downloads (pornpics, gallery-dl)
      let typeClause = '';
      if (type === 'video_only' || type === 'video') typeClause = "AND (d.filepath ILIKE '%.mp4' OR d.filepath ILIKE '%.webm' OR d.filepath ILIKE '%.mov' OR d.filepath ILIKE '%.mkv' OR d.filepath ILIKE '%.avi' OR d.filepath ILIKE '%.flv')";
      else if (type === 'image_only' || type === 'image') typeClause = "AND (d.filepath ILIKE '%.jpg' OR d.filepath ILIKE '%.jpeg' OR d.filepath ILIKE '%.png' OR d.filepath ILIKE '%.gif' OR d.filepath ILIKE '%.webp')";
      
      // Platform filter clause: when a specific platform is selected, filter by it
      // and remove the ID window since we want ALL items for that platform
      let platformClause = '';
      let idWindowClause = 'AND d.id > (SELECT MAX(id) - 50000 FROM downloads)';
      if (fastPathPlatforms && fastPathPlatforms.length > 0) {
        const safePlats = fastPathPlatforms.map(p => `'${p.replace(/'/g, "''")}'`).join(',');
        platformClause = `AND d.platform IN (${safePlats})`;
        // Remove the ID window when filtering by platform — platform scoping
        // already limits the result set, and the ID window would miss older items
        idWindowClause = '';
      }
      // If we specifically requested the oldest items, or random items, disable the ID limitation.
      // TABLESAMPLE handles random scan speed optimizations natively across the entire table.
      if (sort === 'oldest' || sort === 'random') { idWindowClause = ''; }

      const sqlStart = Date.now();
      // For random, we always pull a fresh page 0 because TABLESAMPLE dynamically shuffles.
      // E.g. OFFSET 15000 on a 10% sample of a 100k DB would yield 0 rows on page 2!
      const rowOffset = sort === 'random' ? 0 : (cur.rowOffset || 0);
      // Fast query using idx_downloads_gallery_ts index (~9ms)
      const stmtName = `gallery_fast_${type || 'media'}_${sort || 'newest'}_${platKey}_${dateFrom}_${dateTo}${rowOffset > 0 ? '_paged' : ''}`;
      
      const targetTableClause = sort === 'random' ? 'downloads d TABLESAMPLE SYSTEM(10)' : 'downloads d';

      // When platform-filtering, use UNION ALL to show individual files (kind='p')
      // from download_files alongside download-level items (kind='d').
      // This ensures platforms like pornpics show every individual image as a separate card.
      // Skip UNION for video_only — videos live in downloads.filepath, not download_files
      const useUnion = fastPathPlatforms && type !== 'video_only' && type !== 'video';
      const sqlText = useUnion ? `
        SELECT * FROM (
          SELECT
            'd' AS kind,
            d.id::text AS id,
            d.platform, d.channel, d.title, d.filepath,
            d.created_at::text AS created_at,
            EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at))::bigint * 1000 AS ts,
            d.thumbnail, d.url, d.source_url, d.rating,
            'd' AS rating_kind, d.id AS rating_id,
            (SELECT df2.relpath FROM download_files df2 WHERE df2.download_id = d.id ORDER BY df2.relpath LIMIT 1) AS first_file
          FROM ${targetTableClause}
          WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
            AND d.filepath IS NOT NULL AND d.filepath != ''
            AND d.is_thumb_ready = true
            ${platformClause}
            ${typeClause}
            ${dateFrom ? `AND COALESCE(d.finished_at, d.updated_at, d.created_at) >= '${dateFrom.replace(/[^0-9-]/g,'')}'::date` : ''}
            ${dateTo ? `AND COALESCE(d.finished_at, d.updated_at, d.created_at) < ('${dateTo.replace(/[^0-9-]/g,'')}'::date + INTERVAL '1 day')` : ''}
            AND NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)
          UNION ALL
          SELECT
            'p' AS kind,
            df.relpath AS id,
            d.platform, d.channel, d.title, d.filepath,
            d.created_at::text AS created_at,
            (COALESCE(df.mtime_ms, EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at))::bigint * 1000)) AS ts,
            d.thumbnail, d.url, d.source_url, d.rating,
            'd' AS rating_kind, d.id AS rating_id,
            df.relpath AS first_file
          FROM download_files df
          JOIN ${targetTableClause} ON d.id = df.download_id
          WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
            AND d.filepath IS NOT NULL AND d.filepath != ''
            ${platformClause}
            ${type === 'video_only' || type === 'video' ? "AND (df.relpath ILIKE '%.mp4' OR df.relpath ILIKE '%.webm' OR df.relpath ILIKE '%.mov' OR df.relpath ILIKE '%.mkv' OR df.relpath ILIKE '%.avi' OR df.relpath ILIKE '%.flv')" : ''}
            ${type === 'image_only' || type === 'image' ? "AND (df.relpath ILIKE '%.jpg' OR df.relpath ILIKE '%.jpeg' OR df.relpath ILIKE '%.png' OR df.relpath ILIKE '%.gif' OR df.relpath ILIKE '%.webp')" : ''}
            ${dateFrom ? `AND COALESCE(d.finished_at, d.updated_at, d.created_at) >= '${dateFrom.replace(/[^0-9-]/g,'')}'::date` : ''}
            ${dateTo ? `AND COALESCE(d.finished_at, d.updated_at, d.created_at) < ('${dateTo.replace(/[^0-9-]/g,'')}'::date + INTERVAL '1 day')` : ''}
        ) s
        ORDER BY ${orderBy}
                  LIMIT ${Math.max(limit * 50, 15000)} OFFSET ${rowOffset}
      ` : `
          SELECT
            'd' AS kind,
            d.id::text AS id,
            d.platform, d.channel, d.title, d.filepath,
            d.created_at::text AS created_at,
            EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at))::bigint * 1000 AS ts,
            d.thumbnail, d.url, d.source_url, d.rating,
            'd' AS rating_kind, d.id AS rating_id,
            (SELECT df.relpath FROM download_files df WHERE df.download_id = d.id ORDER BY df.relpath LIMIT 1) AS first_file
          FROM ${targetTableClause}
          WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
            AND d.filepath IS NOT NULL AND d.filepath != ''
            AND d.is_thumb_ready = true
            ${idWindowClause}
            ${platformClause}
            ${typeClause}
            ${dateFrom ? `AND COALESCE(d.finished_at, d.updated_at, d.created_at) >= '${dateFrom.replace(/[^0-9-]/g,'')}'::date` : ''}
            ${dateTo ? `AND COALESCE(d.finished_at, d.updated_at, d.created_at) < ('${dateTo.replace(/[^0-9-]/g,'')}'::date + INTERVAL '1 day')` : ''}
          ORDER BY ${orderBy}
          LIMIT ${Math.max(limit * 50, 15000)} OFFSET ${rowOffset}
      `;

      const pgResult = await (db.readPool || db.pool).query({
        name: stmtName,
        text: sqlText,
        values: []
      });
      const sqlMs = Date.now() - sqlStart;

      const jsStart = Date.now();
      const items = [];
      const seenPaths = new Set();
      const seenKeys = new Map();
      // Chronological order with soft platform cap to prevent one platform
      // from dominating the entire page. Items stay in timestamp order,
      // but once a platform has enough representation, its remaining items are skipped.
      const platformCount = new Map();
      const SOFT_CAP = fastPathPlatforms ? Infinity : Math.max(30, Math.ceil(limit * 0.3));
      for (const row of pgResult.rows) {
        if (items.length >= limit) break;
        if (!row || !row.id) continue;
        const dedupId = String(row.id).trim();
        if (!dedupId) continue;
        if (seenPaths.has(dedupId)) continue;
        seenPaths.add(dedupId);
        // Soft cap: skip if this platform already has enough items
        const plat = String(row.platform || '').toLowerCase();
        const pc = platformCount.get(plat) || 0;
        if (pc >= SOFT_CAP) continue;
        const it = makeIndexedMediaItem(row);
        if (!it) continue;
        if (pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type })) {
          platformCount.set(plat, pc + 1);
        }
      }
      const jsMs = Date.now() - jsStart;

      const reqTime = Date.now() - reqStartTime;
      console.log(`📤 [${new Date().toISOString().substr(11, 8)}] Response /api/media/recent-files (fast-path${fastPathPlatforms ? ' plat=' + platKey : ''}) - ${items.length} items in ${reqTime}ms (sql=${sqlMs}ms, js=${jsMs}ms, rows=${pgResult.rows.length}, offset=${rowOffset}, unique=${seenPaths.size})`);
      // Advance cursor past ALL scanned rows (including dupes) so the next
      // page's OFFSET jumps past the entire duplicate cluster.
      const nextRowOffset = rowOffset + pgResult.rows.length;
      const payload = {
        success: true,
        items,
        next_cursor: items.length >= limit ? encodeCursor({ rowOffset: nextRowOffset, activeOffset: 0 }) : '',
        done: items.length < limit,
      };
      // Cache it
      try {
        const st = await getStatsRowCached();
        const marker = buildRecentFilesCacheMarker(st);
        const dirFilterKey = platKey;
        const key = `recent|${type}|${limit}|${sort}||${tagFilter}|${dirFilterKey}`;
        recentFilesTopCache.set(key, { at: Date.now(), marker, payload });
      } catch (e) {}
      // Fast time-based cache (3s TTL) to avoid re-running during heavy write load
      galleryFastPathCache = { key: cacheKey, ts: Date.now(), data: payload };
      return res.json(payload);
    } catch (fastErr) {
      console.error('[Gallery fast-path error]', fastErr.message);
      // Fall through to normal path
    }
  }

  try {
    const isTopCursor = !cursorRaw ||
      cur && cur.activeOffset === 0 && cur.rowOffset === 0 && !cur.dir && cur.fileIndex === 0;

    if (!includeActive && !includeActiveFiles && isTopCursor) {
      try {
        const now = Date.now();
        const st = await getStatsRowCached();
        const marker = buildRecentFilesCacheMarker(st);
        const dirFilterKey = enabledDirs && enabledDirs.length ? [...enabledDirs].sort().join(',') : '_all';
        const key = `recent|${type}|${limit}|${sort}|${searchQuery}|${tagFilter}|${dirFilterKey}`;
        const cached = recentFilesTopCache.get(key);
        if (cached && cached.marker === marker && now - (cached.at || 0) < RECENT_FILES_TOP_CACHE_MS) {
          return res.json(cached.payload);
        }
        if (now - recentFilesTopCacheAt > RECENT_FILES_TOP_CACHE_MS * 8) {
          recentFilesTopCacheAt = now;
          recentFilesTopCache = new Map();
        }
      } catch (e) { }
    }

    const items = [];
    const seenKeys = new Map();

    const isTopRequest = !cursorRaw || (cur && cur.activeOffset === 0 && cur.rowOffset === 0 && !cur.dir && cur.fileIndex === 0);
    if (includeActive && isTopRequest) {
      try {
        const cap = Math.min(28, Math.max(8, Math.floor(limit / 2)));
        const rows = runtimeActiveRows;
        for (const r of rows || []) {
          if (!r) continue;
          const it = makeActiveDownloadItem(r);
          pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type });
          if (items.length >= limit || items.length >= cap) break;
        }
      } catch (e) { }
    }
    const nextActiveOffset = -1;
    let rowOffset = cur.rowOffset;
    const hasDirectoryFilter = enabledDirs && enabledDirs.length > 0 && enabledDirs.length < 10;
    const hasSearchQuery = !!searchQuery;
    const maxRowsPerCall = hasSearchQuery ? 500 : (hasDirectoryFilter ? 2000 : 260);
    const getBatch = (sort === 'rating_asc') ? getRecentHybridMediaByRatingAsc : (sort === 'rating_desc') ? getRecentHybridMediaByRatingDesc : (sort === 'oldest') ? getRecentHybridMediaByOldest : (sort === 'name_asc') ? getRecentHybridMediaByNameAsc : (sort === 'name_desc') ? getRecentHybridMediaByNameDesc : (includeActiveFiles ? getRecentHybridMediaWithActiveFiles : getRecentHybridMedia);
    
    // Build SQL-level search filter
    let sqlSearchFilter = null;
    if (hasSearchQuery) {
      sqlSearchFilter = { _searchFilter: true, query: searchQuery };
    }

    // Build SQL-level platform filter when enabledDirs contains platform objects
    let sqlPlatformFilter = null;
    if (hasDirectoryFilter && enabledDirs.some(d => d && typeof d === 'object' && d.platform)) {
      const platforms = enabledDirs.filter(d => d && typeof d === 'object' && d.platform).map(d => String(d.platform).toLowerCase().trim());
      if (platforms.length > 0 && platforms.length <= 10) {
        sqlPlatformFilter = { _platformFilter: true, platforms };
      }
    }
    
    // ═══ FAST PATH: Direct SQL search (bypasses slow UNION ALL hybrid query) ═══
    if (hasSearchQuery) {
      try {
        const orGroups = searchQuery.split(',').map(g => g.trim()).filter(Boolean);
        if (orGroups.length === 0) orGroups.push(searchQuery.replace(/%/g, ''));

        const conditions = [];
        const bindings = [];

        for (const group of orGroups) {
          const andWords = group.split(/[\s*\-+]+/).filter(w => w.trim().length > 0);
          if (andWords.length === 0) continue;
          
          const andConditions = [];
          for (const w of andWords) {
            andConditions.push(`(d.channel ILIKE ? OR d.title ILIKE ? OR d.platform ILIKE ?)`);
            const likeTerm = '%' + w + '%';
            bindings.push(likeTerm, likeTerm, likeTerm);
          }
          if (andConditions.length > 0) {
            conditions.push(`(${andConditions.join(' AND ')})`);
          }
        }
        
        bindings.push(Math.max(limit * 50, 15000), rowOffset);

        const searchRows = await db.prepare(`
          WITH matched_downloads AS (
            SELECT * FROM downloads d
            WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
              AND d.filepath IS NOT NULL AND d.filepath != ''
              ${conditions.length > 0 ? 'AND (' + conditions.join(' OR ') + ')' : ''}
          )
          SELECT * FROM (
            SELECT 
              'd' AS kind,
              CAST(d.id AS TEXT) AS id,
              d.platform, d.channel, d.title, d.filepath,
              d.created_at::text AS created_at,
              CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
              d.thumbnail, d.url, d.source_url, d.rating,
              'd' AS rating_kind, d.id AS rating_id,
              (SELECT df2.relpath FROM download_files df2 WHERE df2.download_id = d.id ORDER BY df2.relpath LIMIT 1) AS first_file
            FROM matched_downloads d
            WHERE NOT EXISTS (SELECT 1 FROM download_files f2 WHERE f2.download_id = d.id)
            UNION ALL
            SELECT
              'p' AS kind,
              df.relpath AS id,
              d.platform, d.channel, d.title, d.filepath,
              d.created_at::text AS created_at,
              (COALESCE(df.mtime_ms, CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT))) AS ts,
              d.thumbnail, d.url, d.source_url, d.rating,
              'd' AS rating_kind, d.id AS rating_id,
              df.relpath AS first_file
            FROM matched_downloads d
            JOIN download_files df ON df.download_id = d.id
          ) s
          ORDER BY ${sort === 'oldest' ? 'ts ASC NULLS LAST' : sort === 'rating_desc' ? 'COALESCE(rating, 0) DESC, ts DESC' : sort === 'rating_asc' ? 'COALESCE(rating, 0) ASC, ts DESC' : 'ts DESC NULLS LAST'}
          LIMIT ? OFFSET ?
        `).all(...bindings);

        for (const row of searchRows) {
          if (!row || !row.id) continue;
          if (enabledDirs && !shouldIncludeRow(row, enabledDirs)) continue;
          if (row.filepath && String(row.kind || '') !== 'p') {
            const fp = String(row.filepath).trim();
            if (fp && !fileExistsCache(fp)) continue;
          }

          const preDedupeVal = String(row.kind || '') === 'p' ? String(row.id || '').trim() : String(row.filepath || '').trim();
          const preDedupeKey = preDedupeVal ? path.resolve(BASE_DIR, preDedupeVal) : null;
          if (preDedupeKey && seenKeys.has(preDedupeKey)) {
            continue;
          }

          const it = makeIndexedMediaItem(row);
          if (!it) continue;
          pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type });
          if (items.length >= limit) break;
        }

        const reqTime = Date.now() - reqStartTime;
        console.log(`📤 [${new Date().toISOString().substr(11, 8)}] Response /api/media/recent-files (search fast-path) - ${items.length} items in ${reqTime}ms`);
        return res.json({
          success: true,
          items,
          next_cursor: items.length >= limit ? encodeCursor({ rowOffset: rowOffset + limit * 2, activeOffset: 0 }) : '',
          done: items.length < limit,
        });
      } catch (searchErr) {
        console.error('[Search fast-path error]', searchErr.message);
        // Fall through to normal path
      }
    }

    let loopDone = false;
    let safetyLimit = 0;
    const maxSafety = hasSearchQuery ? 8 : (hasDirectoryFilter ? 60 : 15);
    while (items.length < limit && !loopDone && safetyLimit < maxSafety) {
      safetyLimit++;
      // Build args: [limit, offset, ...optional filters popped from end]
      // getDynamicHybridBatch pops _searchFilter first, then _platformFilter
      const batchArgs = [maxRowsPerCall, rowOffset];
      if (sqlSearchFilter) batchArgs.push(sqlSearchFilter);
      if (sqlPlatformFilter) batchArgs.push(sqlPlatformFilter);
      const batch = await getDynamicHybridBatch(getBatch, type, ...batchArgs);
      if (!batch || batch.length === 0) {
        loopDone = true;
        break;
      }

      for (const row of batch || []) {
        if (row && row.platform === 'patreon') {
          console.log(`[DEBUG-PATREON-API] Found DB row: id=${row.id}, kind=${row.kind}, filepath=${row.filepath}, includeActiveFiles=${includeActiveFiles}`);
        }

        if (!row) { rowOffset += 1; continue; }

        // Apply directory filter
        if (enabledDirs && !shouldIncludeRow(row, enabledDirs)) {
          rowOffset += 1;
          continue;
        }

        // Apply search query filter
        if (searchQuery) {
          const haystack = [row.platform, row.channel, row.title, row.filepath, row.id].filter(Boolean).join(' ').toLowerCase();
          if (!haystack.includes(searchQuery)) {
            rowOffset += 1;
            continue;
          }
        }

        // Skip items whose files no longer exist on disk (cached check)
        if (row.filepath && String(row.kind || '') !== 'p') {
          const fp = String(row.filepath).trim();
          if (fp && !fileExistsCache(fp)) {
            rowOffset += 1;
            continue;
          }
        }

        if (includeActiveFiles && String(row.kind || '') === 'p' && row.rating_kind === 'd' && row.rating_id != null) {
          const idNum = Number(row.rating_id);
          if (Number.isFinite(idNum) && !runtimeActiveIdSet.has(idNum)) {
            try {
              const dr = await getDownload.get(idNum);
              const st = String(dr && dr.status ? dr.status : '').toLowerCase();
              if (st === 'downloading' || st === 'postprocessing' || st === 'queued' || st === 'pending') {
                rowOffset += 1;
                continue;
              }
            } catch (e) { }
          }
        }

        const it = makeIndexedMediaItem(row);
        pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type });
        rowOffset += 1;
        if (items.length >= limit) break;
      }

      if (batch.length < maxRowsPerCall) {
        loopDone = true;
      }
    }

    const nextCursor = encodeCursor({ activeOffset: nextActiveOffset, rowOffset, dir: '', fileIndex: 0 });
    const done = loopDone;
    const payload = { success: true, items, next_cursor: nextCursor, done };
    const reqTime = Date.now() - reqStartTime;
    console.log(`📤 [${new Date().toISOString().substr(11, 8)}] Response /api/media/recent-files - ${items.length} items in ${reqTime}ms`);

    if (!includeActive && !includeActiveFiles && (!cursorRaw || cur && cur.activeOffset === 0 && cur.rowOffset === 0 && !cur.dir && cur.fileIndex === 0)) {
      try {
        const st = await getStatsRowCached();
        const marker = buildRecentFilesCacheMarker(st);
        const dirFilterKey = enabledDirs && enabledDirs.length ? enabledDirs.sort().join(',') : '_all';
        const key = `recent|${type}|${limit}|${sort}|${dirFilterKey}`;
        recentFilesTopCache.set(key, { at: Date.now(), marker, payload });
        if (recentFilesTopCache.size > 80) {
          const keys = Array.from(recentFilesTopCache.keys()).slice(0, Math.max(1, recentFilesTopCache.size - 60));
          for (const k of keys) recentFilesTopCache.delete(k);
        }
      } catch (e) { }
    }

    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.get('/api/media/channel-files', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const platform = String(req.query.platform || '').trim();
  const channel = String(req.query.channel || '').trim();
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '120', 10) || 120));
  const type = String(req.query.type || 'all').toLowerCase();
  const sort = String(req.query.sort || 'recent').toLowerCase();
  const cursorRaw = String(req.query.cursor || '').trim();
  const cur = decodeCursor(cursorRaw);
  const includeActive = String(req.query.include_active || '0') !== '0';
  const includeActiveFiles = String(req.query.include_active_files || '0') !== '0';
  let enabledDirs = null;
  try {
    const dirsParam = String(req.query.dirs || '').trim();
    if (dirsParam) enabledDirs = JSON.parse(dirsParam);
  } catch (e) { }
  if (!enabledDirs) enabledDirs = loadDirectoryFilter();

  if (!platform || !channel) return res.status(400).json({ success: false, error: 'platform en channel zijn vereist' });


  try {
    const isTopCursor = !cursorRaw ||
      cur && cur.activeOffset === 0 && cur.rowOffset === 0 && !cur.dir && cur.fileIndex === 0;

    if (!includeActive && !includeActiveFiles && isTopCursor) {
      try {
        const now = Date.now();
        const st = await getStatsRowCached();
        const marker = buildRecentFilesCacheMarker(st);
        const dirFilterKey = enabledDirs && enabledDirs.length ? [...enabledDirs].sort().join(',') : '_all';
        const key = `channel|${platform}|${channel}|${type}|${limit}|${sort}|${dirFilterKey}`;
        const cached = recentFilesTopCache.get(key);
        if (cached && cached.marker === marker && now - (cached.at || 0) < RECENT_FILES_TOP_CACHE_MS) {
          return res.json(cached.payload);
        }
        if (now - recentFilesTopCacheAt > RECENT_FILES_TOP_CACHE_MS * 8) {
          recentFilesTopCacheAt = now;
          recentFilesTopCache = new Map();
        }
      } catch (e) { }
    }

    const items = [];
    const seenKeys = new Map();

    const isTopRequest = !cursorRaw || (cur && cur.activeOffset === 0 && cur.rowOffset === 0 && !cur.dir && cur.fileIndex === 0);
    if (includeActive && isTopRequest) {
      try {
        const cap = Math.min(28, Math.max(8, Math.floor(limit / 2)));
        const rows = runtimeActiveRows;
        for (const r of rows || []) {
          if (!r) continue;
          if (String(r.platform || '') !== String(platform || '')) continue;
          if (String(r.channel || '') !== String(channel || '')) continue;
          const it = makeActiveDownloadItem(r);
          pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type });
          if (items.length >= limit || items.length >= cap) break;
        }
      } catch (e) { }
    }
    const nextActiveOffset = -1;
    let rowOffset = cur.rowOffset;
    const hasDirectoryFilter = enabledDirs && enabledDirs.length > 0 && enabledDirs.length < 10;
    const maxRowsPerCall = hasDirectoryFilter ? 800 : 260;
    const getBatch = (sort === 'rating_asc') ? getHybridMediaByChannelByRatingAsc : (sort === 'rating_desc') ? getHybridMediaByChannelByRatingDesc : (sort === 'oldest') ? getHybridMediaByChannelByOldest : (sort === 'name_asc') ? getHybridMediaByChannelByNameAsc : (sort === 'name_desc') ? getHybridMediaByChannelByNameDesc : (includeActiveFiles ? getHybridMediaByChannelWithActiveFiles : getHybridMediaByChannel);
    let loopDone = false;
    let safetyLimit = 0;
    while (items.length < limit && !loopDone && safetyLimit < 15) {
      safetyLimit++;
      const batch = await getDynamicHybridBatch(getBatch, type, platform, channel, platform, channel, platform, channel, maxRowsPerCall, rowOffset);
      if (!batch || batch.length === 0) {
        loopDone = true;
        break;
      }

      for (const row of batch || []) {
        if (row && row.platform === 'patreon') {
          console.log(`[DEBUG-PATREON-API] Found DB row: id=${row.id}, kind=${row.kind}, filepath=${row.filepath}, includeActiveFiles=${includeActiveFiles}`);
        }

        if (!row) { rowOffset += 1; continue; }

        if (enabledDirs && !shouldIncludeRow(row, enabledDirs)) {
          rowOffset += 1;
          continue;
        }

        // Skip items whose files no longer exist on disk (cached check)
        if (row.filepath && String(row.kind || '') !== 'p') {
          const fp = String(row.filepath).trim();
          if (fp && !fileExistsCache(fp)) {
            rowOffset += 1;
            continue;
          }
        }

        if (includeActiveFiles && String(row.kind || '') === 'p' && row.rating_kind === 'd' && row.rating_id != null) {
          const idNum = Number(row.rating_id);
          if (Number.isFinite(idNum) && !runtimeActiveIdSet.has(idNum)) {
            try {
              const dr = await getDownload.get(idNum);
              const st = String(dr && dr.status ? dr.status : '').toLowerCase();
              if (st === 'downloading' || st === 'postprocessing' || st === 'queued' || st === 'pending') {
                rowOffset += 1;
                continue;
              }
            } catch (e) { }
          }
        }

        const preDedupeVal = String(row.kind || '') === 'p' ? String(row.id || '').trim() : String(row.filepath || '').trim();
        const preDedupeKey = preDedupeVal ? path.resolve(BASE_DIR, preDedupeVal) : null;
        if (preDedupeKey && seenKeys.has(preDedupeKey)) {
          rowOffset += 1;
          continue;
        }

        const it = makeIndexedMediaItem(row);
        if (!it) { rowOffset += 1; continue; }
        pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type });
        rowOffset += 1;
        if (items.length >= limit) break;
      }

      if (batch.length < maxRowsPerCall) {
        loopDone = true;
      }
    }

    const nextCursor = encodeCursor({ activeOffset: nextActiveOffset, rowOffset, dir: '', fileIndex: 0 });
    const done = loopDone;
    const payload = { success: true, items, next_cursor: nextCursor, done };

    if (!includeActive && !includeActiveFiles && (!cursorRaw || cur && cur.activeOffset === 0 && cur.rowOffset === 0 && !cur.dir && cur.fileIndex === 0)) {
      try {
        const st = await getStatsRowCached();
        const marker = buildRecentFilesCacheMarker(st);
        const dirFilterKey = enabledDirs && enabledDirs.length ? enabledDirs.sort().join(',') : '_all';
        const key = `channel|${platform}|${channel}|${type}|${limit}|${sort}|${dirFilterKey}`;
        recentFilesTopCache.set(key, { at: Date.now(), marker, payload });
        if (recentFilesTopCache.size > 80) {
          const keys = Array.from(recentFilesTopCache.keys()).slice(0, Math.max(1, recentFilesTopCache.size - 60));
          for (const k of keys) recentFilesTopCache.delete(k);
        }
      } catch (e) { }
    }

    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.get('/api/media/recent', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '120', 10) || 120));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  const type = String(req.query.type || 'all').toLowerCase();

  try {
    const rows = await getRecentMedia.all(limit, offset);
    const items = [];
    const seenKeys = new Map();
    for (const row of rows || []) {
      const it = makeMediaItem(row);
      pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type });
    }
    res.json({ success: true, items });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.get('/api/stats', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const now = Date.now();
    if (statsCache && now - statsCacheAt < STATS_CACHE_MS) {
      return res.json(statsCache);
    }
    const stats = await getStatsRowCached();
    const payload = {
      success: true,
      stats: {
        downloads: stats.downloads_count,
        screenshots: stats.screenshots_count,
        download_files: stats.download_files_count,
        downloads_created_last: stats.downloads_created_last,
        downloads_finished_last: stats.downloads_finished_last,
        downloads_last: stats.downloads_last,
        screenshots_last: stats.screenshots_last,
        download_files_last: stats.download_files_last
      },
      db_path: db && db.isPostgres ? DATABASE_URL : DB_PATH,
      base_dir: BASE_DIR
    };
    statsCache = payload;
    statsCacheAt = now;
    return res.json(payload);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.get('/api/media/channels', async (req, res) => {
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '200', 10) || 200));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  const platform = String(req.query.platform || '').trim();

  try {
    let rows = await getMediaChannels.all(limit, offset);
    if (platform) rows = rows.filter((r) => String(r.platform) === platform);
    res.json({ success: true, channels: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- Search Suggestions (autocomplete) ---
let suggestCache = { at: 0, channels: [], platforms: [] };
const SUGGEST_CACHE_MS = 10000;

expressApp.get('/api/media/search-suggest', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();

  try {
    const now = Date.now();
    // Refresh base data every 10s
    if (now - suggestCache.at > SUGGEST_CACHE_MS) {
      const [chRes, plRes] = await Promise.all([
        db.prepare(`
          SELECT DISTINCT platform, channel, COUNT(*) as cnt
          FROM downloads WHERE status = 'completed' AND channel IS NOT NULL AND channel != ''
          GROUP BY platform, channel ORDER BY cnt DESC LIMIT 500
        `).all(),
        db.prepare(`
          SELECT DISTINCT platform, COUNT(*) as cnt
          FROM downloads WHERE status = 'completed'
          GROUP BY platform ORDER BY cnt DESC
        `).all(),
      ]);
      suggestCache = { at: now, channels: chRes || [], platforms: plRes || [] };
    }

    // Empty query = show popular channels
    if (q.length < 2) {
      const popular = suggestCache.channels.slice(0, 12).map(ch => ({
        type: 'channel',
        label: ch.channel,
        sublabel: ch.platform,
        count: ch.cnt,
        value: ch.channel,
        platform: ch.platform
      }));
      return res.json({ success: true, suggestions: popular });
    }

    const suggestions = [];
    const seen = new Set();

    // Match platforms
    for (const p of suggestCache.platforms) {
      if (String(p.platform || '').toLowerCase().includes(q)) {
        const key = `platform:${p.platform}`;
        if (!seen.has(key)) {
          seen.add(key);
          suggestions.push({ type: 'platform', label: p.platform, count: p.cnt, value: p.platform });
        }
      }
    }

    // Match channels
    for (const ch of suggestCache.channels) {
      const chName = String(ch.channel || '').toLowerCase();
      const plat = String(ch.platform || '').toLowerCase();
      if (chName.includes(q) || plat.includes(q)) {
        const key = `channel:${ch.platform}/${ch.channel}`;
        if (!seen.has(key)) {
          seen.add(key);
          suggestions.push({
            type: 'channel',
            label: `${ch.channel}`,
            sublabel: ch.platform,
            count: ch.cnt,
            value: ch.channel,
            platform: ch.platform
          });
        }
      }
      if (suggestions.length >= 12) break;
    }

    // If few results, also search titles in DB
    if (suggestions.length < 8 && q.length >= 3) {
      try {
        const titleRows = await db.prepare(`
          SELECT DISTINCT title, platform, channel
          FROM downloads
          WHERE status = 'completed' AND title ILIKE $1
          ORDER BY created_at DESC LIMIT 8
        `).all(`%${q}%`);
        for (const r of titleRows || []) {
          const key = `title:${r.title}`;
          if (!seen.has(key) && suggestions.length < 12) {
            seen.add(key);
            suggestions.push({
              type: 'title',
              label: r.title,
              sublabel: `${r.platform}/${r.channel}`,
              value: r.title
            });
          }
        }
      } catch (e) {}
    }

    res.json({ success: true, suggestions: suggestions.slice(0, 12) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.get('/api/media/channel', async (req, res) => {
  const platform = String(req.query.platform || '').trim();
  const channel = String(req.query.channel || '').trim();
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '300', 10) || 300));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  const type = String(req.query.type || 'media').toLowerCase();

  if (!platform || !channel) return res.status(400).json({ success: false, error: 'platform en channel zijn vereist' });

  try {
    const rows = await getMediaByChannel.all(platform, channel, limit, offset);
    const items = [];
    const seenKeys = new Map();
    for (const row of rows || []) {
      const it = makeMediaItem(row);
      pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type });
    }
    res.json({ success: true, items });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.get('/viewer', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(getViewerHTML());
});
expressApp.get('/gallery-dl', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(require('path').join(__dirname, 'public', 'gallery-dl.html'));
});


expressApp.get('/gallery', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(require('path').join(__dirname, 'public', 'gallery.html'));
});

expressApp.get('/check-cam-girls-db.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html');
  const filePath = path.join(__dirname, '..', '..', 'check-cam-girls-db.html');
  res.sendFile(filePath);
});

expressApp.get('/api/directories', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const directories = [];
    const entries = await fs.promises.readdir(BASE_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        directories.push(entry.name);
      }
    }

    directories.sort();

    const directoriesInfo = [];
    try {
      if (typeof db !== 'undefined' && db && db.isPostgres) {
        const regex = '^' + BASE_DIR.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '/(.*)/[^/]+$';
        const sql = `
          SELECT dir, SUM(c) as c FROM (
            SELECT substring(filepath, ?) as dir, COUNT(*) as c
            FROM downloads WHERE status != 'error' AND filepath IS NOT NULL AND filepath != ''
            GROUP BY 1
            UNION ALL
            SELECT substring(f.relpath, '^(.*)/[^/]+$') as dir, COUNT(*) as c
            FROM download_files f JOIN downloads d ON d.id = f.download_id WHERE d.status != 'error' 
            GROUP BY 1
            UNION ALL
            SELECT substring(filepath, ?) as dir, COUNT(*) as c
            FROM screenshots WHERE filepath IS NOT NULL AND filepath != ''
            GROUP BY 1
          ) sub WHERE dir IS NOT NULL AND dir != '' AND dir NOT LIKE '/%'
          GROUP BY dir
        `;
        const rows = await db.prepare(sql).all(regex, regex);
        for (const row of rows) {
          directoriesInfo.push({ path: row.dir, count: parseInt(row.c, 10) });
        }
      }
    } catch (e) { console.error('Error fetching directory counts:', e); }

    const enabledDirs = loadDirectoryFilter() || directories.slice();

    res.json({
      success: true,
      directories: directories,
      directoriesInfo: directoriesInfo,
      enabled: enabledDirs,
      baseDir: BASE_DIR
    });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e.message || e) });
  }
});

expressApp.post('/api/viewer/navigate', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const body = req.body || {};
    const direction = String(body.direction || 'next');
    const currentKind = String(body.currentKind || '');
    const currentId = parseInt(body.currentId, 10);
    const mode = String(body.mode || 'recent');
    const filter = String(body.filter || 'media');
    const sort = String(body.sort || 'recent');
    const platform = String(body.platform || '');
    const channel = String(body.channel || '');

    let enabledDirs = null;
    if (body.dirs) {
      try {
        enabledDirs = body.dirs;
        if (typeof enabledDirs === 'string') enabledDirs = JSON.parse(enabledDirs);
      } catch (e) { }
    }
    if (!enabledDirs) enabledDirs = loadDirectoryFilter();

    const includeActiveFiles = filter === 'all';

    let query;
    let params;

    if (mode === 'channel' && platform && channel) {
      query = (sort === 'rating_asc') ? getHybridMediaByChannelByRatingAsc : (sort === 'rating_desc') ? getHybridMediaByChannelByRatingDesc : (sort === 'oldest') ? getHybridMediaByChannelByOldest : (sort === 'name_asc') ? getHybridMediaByChannelByNameAsc : (sort === 'name_desc') ? getHybridMediaByChannelByNameDesc : (includeActiveFiles ? getHybridMediaByChannelWithActiveFiles : getHybridMediaByChannel);
      params = [platform, channel, platform, channel, platform, channel, 200, 0];
    } else {
      query = (sort === 'rating_asc') ? getRecentHybridMediaByRatingAsc : (sort === 'rating_desc') ? getRecentHybridMediaByRatingDesc : (sort === 'oldest') ? getRecentHybridMediaByOldest : (sort === 'name_asc') ? getRecentHybridMediaByNameAsc : (sort === 'name_desc') ? getRecentHybridMediaByNameDesc : (includeActiveFiles ? getRecentHybridMediaWithActiveFiles : getRecentHybridMedia);
      params = [200, 0];
    }

    const dynamicFilter = filter === 'video' ? 'video_only' : filter === 'image' ? 'image_only' : filter;
    const batch = await getDynamicHybridBatch(query, dynamicFilter, ...params);
    const items = [];

    for (const row of batch || []) {
      if (row && row.platform === 'patreon') {
        console.log(`[DEBUG-PATREON-API] Found DB row: id=${row.id}, kind=${row.kind}, filepath=${row.filepath}, includeActiveFiles=${includeActiveFiles}`);
      }

      if (!row) continue;
      const relPath = row.kind === 'p' ? row.id : (row.filepath ? path.relative(BASE_DIR, row.filepath) : '');
      if (enabledDirs && !shouldIncludeRow(row, enabledDirs)) continue;

      const filterType = row.kind === 'p' ? 'active' : (row.filepath && /\.(mp4|webm|mov|avi|mkv)$/i.test(row.filepath)) ? 'video' : 'image';
      if (filter === 'video' && filterType !== 'video') continue;
      if (filter === 'image' && filterType !== 'image') continue;
      if (filter === 'media' && filterType !== 'video' && filterType !== 'image') continue;

      items.push(row);
    }

    let currentIndex = -1;
    if (Number.isFinite(currentId) && currentKind) {
      currentIndex = items.findIndex(it => it.kind === currentKind && it.id === currentId);
    }

    const targetIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;

    if (targetIndex >= 0 && targetIndex < items.length) {
      const item = items[targetIndex];
      return res.json({
        success: true,
        item: {
          kind: item.kind,
          id: item.id,
          platform: item.platform,
          channel: item.channel,
          title: item.title,
          filepath: item.filepath,
          url: item.url,
          rating: item.rating
        },
        hasNext: targetIndex < items.length - 1,
        hasPrev: targetIndex > 0
      });
    }

    res.json({ success: false, error: 'no more items' });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e.message || e) });
  }
});

expressApp.get('/api/check-cam-girls', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const movedDirs = [
      'Chatroulette',
      'motherless',
      'omegleporn',
      'rutube',
      'test-examples',
      'videodownloadhelper',
      'xvideos',
      '_Downloads te importeren'
    ];

    const result = {
      withPrefix: 0,
      withoutPrefix: {},
      total: 0,
      totalDownloads: 0
    };

    // Total downloads in database
    const totalResult = await db.query(`SELECT COUNT(*) as count FROM downloads`);
    result.totalDownloads = parseInt(totalResult.rows?.[0]?.count || 0);

    // Count items WITH CAM-GIRLS prefix
    const withPrefixResult = await db.query(
      `SELECT COUNT(*) as count FROM downloads WHERE filepath LIKE 'CAM-GIRLS/%'`
    );
    result.withPrefix = parseInt(withPrefixResult.rows?.[0]?.count || 0);

    // Count items WITHOUT CAM-GIRLS prefix per directory
    for (const dir of movedDirs) {
      const withoutPrefixResult = await db.query(
        `SELECT COUNT(*) as count FROM downloads 
         WHERE filepath LIKE $1 || '/%' 
           AND filepath NOT LIKE 'CAM-GIRLS/%'`,
        [dir]
      );
      const count = parseInt(withoutPrefixResult.rows?.[0]?.count || 0);
      result.withoutPrefix[dir] = count;
      result.total += count;
    }

    // Sample paths with CAM-GIRLS
    const sampleWithPrefix = await db.query(
      `SELECT filepath, platform, channel FROM downloads WHERE filepath LIKE 'CAM-GIRLS/%' LIMIT 5`
    );

    // Sample paths without CAM-GIRLS  
    const sampleWithoutPrefix = await db.query(
      `SELECT filepath, platform, channel FROM downloads 
       WHERE (filepath LIKE 'Chatroulette/%' OR filepath LIKE 'motherless/%' OR filepath LIKE 'xvideos/%' OR filepath LIKE 'rutube/%')
         AND filepath NOT LIKE 'CAM-GIRLS/%' 
       LIMIT 5`
    );

    // Get recent imports
    const recentImports = await db.query(
      `SELECT filepath, platform, channel, created_at 
       FROM downloads 
       ORDER BY created_at DESC 
       LIMIT 10`
    );

    result.samplesWithPrefix = (sampleWithPrefix.rows || []);
    result.samplesWithoutPrefix = (sampleWithoutPrefix.rows || []);
    result.recentImports = (recentImports.rows || []);

    res.json({ success: true, result });
  } catch (e) {
    console.error('❌ Check error:', e);
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

expressApp.post('/api/migrate-cam-girls', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    console.log('🔄 Starting CAM-GIRLS migration...');

    const movedDirs = [
      'Chatroulette',
      'motherless',
      'omegleporn',
      'rutube',
      'test-examples',
      'videodownloadhelper',
      'xvideos',
      '_Downloads te importeren'
    ];

    let totalDownloads = 0;
    let totalScreenshots = 0;

    for (const dir of movedDirs) {
      const downloadResult = await db.query(
        `UPDATE downloads 
         SET filepath = 'CAM-GIRLS/' || filepath
         WHERE filepath LIKE $1 || '/%'
           AND filepath NOT LIKE 'CAM-GIRLS/%'`,
        [dir]
      );
      totalDownloads += downloadResult.rowCount;
      console.log(`  Downloads ${dir}: ${downloadResult.rowCount} rows updated`);

      const screenshotResult = await db.query(
        `UPDATE screenshots
         SET filepath = 'CAM-GIRLS/' || filepath
         WHERE filepath LIKE $1 || '/%'
           AND filepath NOT LIKE 'CAM-GIRLS/%'`,
        [dir]
      );
      totalScreenshots += screenshotResult.rowCount;
      console.log(`  Screenshots ${dir}: ${screenshotResult.rowCount} rows updated`);
    }

    console.log(`✅ Migration complete: ${totalDownloads} downloads, ${totalScreenshots} screenshots`);

    res.json({
      success: true,
      downloads: totalDownloads,
      screenshots: totalScreenshots,
      message: `Updated ${totalDownloads} downloads and ${totalScreenshots} screenshots`
    });
  } catch (e) {
    console.error('❌ Migration error:', e);
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

expressApp.post('/api/rating', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const body = req && req.body ? req.body : {};
    const kind = String(body.kind || '').toLowerCase();
    const id = parseInt(body.id, 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ success: false, error: 'id is vereist' });
    const hasRating = Object.prototype.hasOwnProperty.call(body, 'rating');
    if (!hasRating) return res.status(400).json({ success: false, error: 'rating is vereist' });
    let rating = null;
    if (body.rating !== null && body.rating !== '') {
      const ratingRaw = Number(body.rating);
      if (!Number.isFinite(ratingRaw)) return res.status(400).json({ success: false, error: 'rating is ongeldig' });
      rating = Math.max(0, Math.min(5, Math.round(ratingRaw * 2) / 2));
    }
    if (kind === 'd') {
      await updateDownloadRating.run(rating, id);
      return res.json({ success: true, kind, id, rating });
    }
    if (kind === 's') {
      await updateScreenshotRating.run(rating, id);
      return res.json({ success: true, kind, id, rating });
    }
    return res.status(400).json({ success: false, error: 'unsupported kind' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

// getDashboardHTML → extracted to ./views/dashboard.js

// ========================
// SERVER STARTEN
// ========================

async function scanExistingTagsOnStartup() {
  try {
    const existingTagsScan = String(process.env.WEBDL_SCAN_EXISTING_TAGS || '1').trim();
    if (existingTagsScan !== '0') {
      console.log('Scanning existing media for #tags in titles and filenames...');
      const limitScan = 5000;
      let scanned = 0;

      const updateTags = async (kind, id, text) => {
        if (!text) return;
        const matches = [...(text.match(/#([a-zA-Z0-9_]+)/g) || []), ...(text.match(/\[([^\]]+)\]/g) || []).map(t => t.slice(1, -1).replace(/\s+/g, '_'))];
        for (const m of matches) {
          const t = m.startsWith('#') ? m.slice(1).toLowerCase() : m.toLowerCase();
          if (!t) continue;
          try {
            if (db.isPostgres) {
              await db.prepare('INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING').run(t);
              const tagRow = await db.prepare('SELECT id FROM tags WHERE name = $1').get(t);
              if (tagRow) await db.prepare('INSERT INTO media_tags (kind, media_id, tag_id) VALUES ($1, $2, $3) ON CONFLICT ON CONSTRAINT media_tags_pkey DO NOTHING').run(kind, String(id), tagRow.id);
            } else {
              db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(t);
              const tagRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(t);
              if (tagRow) db.prepare('INSERT OR IGNORE INTO media_tags (kind, media_id, tag_id) VALUES (?, ?, ?)').run(kind, String(id), tagRow.id);
            }
          } catch (e) { }
        }
      };

      const dlRows = await db.prepare('SELECT id, title, filename, filepath FROM downloads ORDER BY id DESC LIMIT ' + limitScan).all();
      for (const r of dlRows) {
        await updateTags('d', r.id, r.title + ' ' + (r.filename || '') + ' ' + (r.filepath || ''));
        scanned++;
      }
      const scRows = await db.prepare('SELECT id, title, filename, filepath FROM screenshots ORDER BY id DESC LIMIT ' + limitScan).all();
      for (const r of scRows) {
        await updateTags('s', r.id, r.title + ' ' + (r.filename || '') + ' ' + (r.filepath || ''));
        scanned++;
      }
      console.log(`Finished scanning ${scanned} media items for tags.`);
    }
  } catch (e) {
    console.error('Error scanning existing tags:', e.message);
  }
}

async function startServer() {
  try {
    await ensurePostgresSchemaReady();
    // Tag scan disabled by default — set WEBDL_SCAN_EXISTING_TAGS=1 in .env to enable
    // It scans 10k records at startup which blocks the event loop
    if (String(process.env.WEBDL_SCAN_EXISTING_TAGS || '0').trim() === '1') {
      await scanExistingTagsOnStartup();
    }
  } catch (e) { }

  // Clean up thumbnail files from download_files — deferred to avoid blocking startup
  // Previously ran synchronously and took 75s+ on large tables
  setTimeout(async () => {
    try {
      const result = await db.prepare(`
        DELETE FROM download_files WHERE id IN (
          SELECT id FROM download_files
          WHERE relpath LIKE '%_thumb.jpg' OR relpath LIKE '%_thumb.png'
             OR relpath LIKE '%_logo.jpg' OR relpath LIKE '%_logo.png'
          LIMIT 5000
        )
      `).run();
      const deleted = result && result.changes ? result.changes : 0;
      if (deleted > 0) {
        console.log(`🧹 Verwijderd: ${deleted} thumbnail entries uit gallery (batch)`);
        recentFilesTopCache.clear();
      }
    } catch (e) {
      console.log(`⚠️  Thumbnail cleanup fout: ${e.message}`);
    }
  }, 60000); // Run 60s after startup

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️  Poort ${PORT} is bezet, probeer oude server te stoppen...`);
      try {
        const { execSync } = require('child_process');
        execSync(`lsof -ti :${PORT} | xargs kill -9 2>/dev/null || true`, { timeout: 5000 });
      } catch (e) { }
      setTimeout(() => {
        server.listen(PORT, () => {
          console.log(`\n🟢 WEBDL Server draait op http://localhost:${PORT} (na herstart)`);
        });
      }, 1500);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(PORT, () => {
    console.log(`\n🟢 WEBDL Server draait op http://localhost:${PORT}`);
    console.log(`📁 Bestanden: ${BASE_DIR}`);
    console.log(`🗄️  DB engine: ${db && db.engine ? db.engine : 'unknown'}`);
    console.log(`🗄️  DB target: ${db && db.isPostgres ? DATABASE_URL : DB_PATH}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  /status          - Server status`);
    console.log(`  GET  /dashboard       - Web dashboard`);
    console.log(`  POST /download        - Video downloaden (url + metadata)`);
    console.log(`  POST /screenshot      - Screenshot opslaan`);
    console.log(`  GET  /downloads       - Alle downloads`);
    console.log(`  GET  /screenshots     - Alle screenshots`);
    console.log(`  GET  /tree            - Mappenstructuur`);
    console.log(`  GET  /download/:id    - Download details`);
    console.log(`  POST /download/:id/cancel - Download stoppen`);
    console.log(`\n🌐 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`\nKlaar voor gebruik!\n`);

    setTimeout(() => {
      try {
        rehydrateDownloadQueue();
        runDownloadSchedulerSoon();
        syncRuntimeActiveState().catch(() => { });
        console.log('🔁 Queue rehydrate gestart na startup');
        recentFilesTopCache.clear();
      } catch (e) {
        console.warn(`⚠️ Queue rehydrate mislukt: ${e && e.message ? e.message : e}`);
      }
    }, STARTUP_REHYDRATE_DELAY_MS);

    setInterval(() => {
      syncRuntimeActiveState().catch(() => { });
    }, 2500);

    if (ADDON_AUTO_BUILD_ON_START || ADDON_FORCE_REBUILD_ON_START) {
      ensureFirefoxAddonBuilt({ force: ADDON_FORCE_REBUILD_ON_START }).
        then((result) => {
          const st = result && result.state ? result.state : getAddonBuildState();
          const marker = st && st.sourceBuildMarker ? st.sourceBuildMarker : 'unknown';
          if (result && result.rebuilt) {
            console.log(`🧩 Addon auto-build: rebuilt (${result.reason}) marker=${marker}`);
          } else {
            console.log(`🧩 Addon auto-build: up-to-date marker=${marker}`);
          }
        }).
        catch((err) => {
          console.warn(`⚠️ Addon auto-build mislukt: ${err && err.message ? err.message : err}`);
        });
    } else {
      console.log('🧩 Addon auto-build bij startup uitgeschakeld (WEBDL_ADDON_AUTO_BUILD_ON_START=0 en WEBDL_ADDON_FORCE_REBUILD_ON_START=0)');
    }

    let autoImportInProgress = false;
    if (AUTO_IMPORT_ON_START) {
      setTimeout(async () => {
        try {
          if (autoImportInProgress) return;
          autoImportInProgress = true;
          const result = await importExistingVideosFromDisk({
            rootDir: AUTO_IMPORT_ROOT_DIR,
            maxDepth: getAutoImportMaxDepth(),
            dryRun: false,
            minFileAgeMs: AUTO_IMPORT_MIN_FILE_AGE_MS,
            flattenToWebdl: AUTO_IMPORT_FLATTEN_TO_WEBDL,
            moveSource: AUTO_IMPORT_MOVE_SOURCE,
            maxInserts: 15
          });
          if (result && result.success) {
            console.log(`📥 Auto-import: inserted=${result.inserted} skipped=${result.skipped} errors=${Array.isArray(result.errors) ? result.errors.length : 0} root=${result.rootDir}`);
          } else {
            console.warn(`⚠️ Auto-import overgeslagen: ${result && result.error ? result.error : 'onbekende fout'}`);
          }
        } catch (e) {
          console.warn(`⚠️ Auto-import mislukt: ${e && e.message ? e.message : e}`);
        } finally {
          autoImportInProgress = false;
        }
      }, 500);
    }

    if (AUTO_IMPORT_ON_START && AUTO_IMPORT_POLL_MS > 0) {
      setTimeout(() => {
        try {
          console.log(`📥 Auto-import watcher: polling elke ${AUTO_IMPORT_POLL_MS}ms (root=${AUTO_IMPORT_ROOT_DIR})`);
        } catch (e) { }

        setInterval(async () => {
          try {
            if (autoImportInProgress) return;
            autoImportInProgress = true;
            const result = await importExistingVideosFromDisk({
              rootDir: AUTO_IMPORT_ROOT_DIR,
              maxDepth: getAutoImportMaxDepth(),
              dryRun: false,
              minFileAgeMs: AUTO_IMPORT_MIN_FILE_AGE_MS,
              flattenToWebdl: AUTO_IMPORT_FLATTEN_TO_WEBDL,
              moveSource: AUTO_IMPORT_MOVE_SOURCE,
              maxInserts: 15
            });
            if (result && result.success) {
              if (result.inserted > 0 || result.relocated > 0) {
                console.log(`📥 Auto-import watcher: inserted=${result.inserted} relocated=${result.relocated} skipped=${result.skipped} root=${result.rootDir}`);
              }
            }
          } catch (e) {
            console.warn(`⚠️ Auto-import watcher fout: ${e && e.message ? e.message : e}`);
          } finally {
            autoImportInProgress = false;
          }
        }, AUTO_IMPORT_POLL_MS);
      }, 1100);
    }

    try {
      setTimeout(() => { maybeAutoIndexDownloadFiles().catch(() => { }); }, 1800);
      setInterval(() => { maybeAutoIndexDownloadFiles().catch(() => { }); }, DOWNLOAD_FILES_AUTO_INDEX_MS);
    } catch (e) { }

    // ── 4K Downloader auto-index watcher ──────────────────────────────
    // Watches _4KDownloader dirs for new files and auto-indexes them.
    const _4K_WATCH_DIRS = [
      path.join(BASE_DIR, '_4KDownloader'),
      path.join(BASE_DIR, 'Videodownloadhelper'),
      '/Volumes/HDD - One Touch/WEBDL/_4KDownloader',
    ];
    const _4K_VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v']);
    const _4K_MIN_AGE_MS = 10000; // wait 10s after last write before indexing
    const _4K_DEBOUNCE_MS = 8000;
    const _4K_STABLE_CHECK_MS = 5000; // re-check file size after 5s
    let _4kIndexTimer = null;
    const _4kPendingFiles = new Set();
    const _4kFileSizes = new Map(); // track file sizes for stabilization

    // 4K Video Downloader internal DB for source URL lookups
    const _4K_VD_DB_PATH = path.join(
      process.env.HOME || '/Users/jurgen',
      'Library', 'Application Support', '4kdownload.com',
      '4K Video Downloader+', '4K Video Downloader+',
      '704ce5ed-b79a-488e-ab46-e282931f50d0.sqlite'
    );
    let _4kVdDb = null;
    let _4kVdLookup = null;
    let _4kVdLookupByBasename = null;
    function get4kSourceUrl(filePath) {
      try {
        if (!_4kVdDb) {
          if (!fs.existsSync(_4K_VD_DB_PATH)) return null;
          const BetterSqlite3 = require('better-sqlite3');
          _4kVdDb = new BetterSqlite3(_4K_VD_DB_PATH, { readonly: true });
          _4kVdLookup = _4kVdDb.prepare(
            'SELECT u.url FROM download_item d ' +
            'JOIN media_item_description m ON m.download_item_id = d.id ' +
            'JOIN url_description u ON u.media_item_description_id = m.id ' +
            'WHERE d.filename = ? AND u.url IS NOT NULL LIMIT 1'
          );
          _4kVdLookupByBasename = _4kVdDb.prepare(
            'SELECT u.url FROM download_item d ' +
            'JOIN media_item_description m ON m.download_item_id = d.id ' +
            'JOIN url_description u ON u.media_item_description_id = m.id ' +
            'WHERE d.filename LIKE ? AND u.url IS NOT NULL LIMIT 1'
          );
        }
        // Try exact path
        let row = _4kVdLookup.get(filePath);
        if (row) return row.url;
        // Try alternate drive prefix (SSD ↔ HDD)
        const altPath = filePath.startsWith('/Volumes/')
          ? filePath.replace('/Volumes/HDD - One Touch/WEBDL/', '/Users/jurgen/Downloads/WEBDL/')
          : filePath.replace('/Users/jurgen/Downloads/WEBDL/', '/Volumes/HDD - One Touch/WEBDL/');
        if (altPath !== filePath) {
          row = _4kVdLookup.get(altPath);
          if (row) return row.url;
        }
        // Try basename match (last resort)
        const bn = path.basename(filePath);
        if (bn && _4kVdLookupByBasename) {
          row = _4kVdLookupByBasename.get('%/' + bn);
          if (row) return row.url;
        }
        return null;
      } catch (e) { return null; }
    }
    function detectSourcePlatform(url) {
      if (!url) return null;
      const u = String(url).toLowerCase();
      if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
      if (u.includes('tiktok.com')) return 'tiktok';
      if (u.includes('instagram.com')) return 'instagram';
      if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
      if (u.includes('reddit.com')) return 'reddit';
      if (u.includes('vimeo.com')) return 'vimeo';
      if (u.includes('twitch.tv')) return 'twitch';
      return null;
    }
    async function index4kFile(absPath) {
      try {
        if (!fs.existsSync(absPath)) return;
        const ext = path.extname(absPath).toLowerCase();
        if (!_4K_VIDEO_EXTS.has(ext)) return;
        const st = fs.statSync(absPath);
        if (!st.isFile() || st.size < 1024) return;
        if (Date.now() - (st.mtimeMs || 0) < _4K_MIN_AGE_MS) return;

        // Look up source URL from 4K Video Downloader's internal database
        const sourceUrl = get4kSourceUrl(absPath) || '';
        const realPlatform = detectSourcePlatform(sourceUrl);

        // Check if already in DB
        const existing = await getDownloadIdByFilepath.get(absPath);
        if (existing && existing.id) {
          // Back-fill source_url and real platform if missing
          try {
            const row = await getDownload.get(existing.id);
            if (row && sourceUrl && (!row.source_url || row.source_url === '')) {
              const q = db.isPostgres
                ? 'UPDATE downloads SET source_url = $1 WHERE id = $2'
                : 'UPDATE downloads SET source_url = ? WHERE id = ?';
              await db.prepare(q).run(sourceUrl, existing.id);
            }
            if (row && realPlatform && row.platform === '4kdownloader') {
              const q = db.isPostgres
                ? 'UPDATE downloads SET platform = $1 WHERE id = $2'
                : 'UPDATE downloads SET platform = ? WHERE id = ?';
              await db.prepare(q).run(realPlatform, existing.id);
              console.log(`🔗 [4K-Watcher] Platform: #${existing.id} → ${realPlatform} (${sourceUrl})`);
            }
          } catch (e) {}
          return;
        }

        // Derive channel from parent dir name
        const isVDH = absPath.includes('Videodownloadhelper');
        const relPath = isVDH
          ? absPath.split('Videodownloadhelper')[1]
          : absPath.includes('_4KDownloader') ? absPath.split('_4KDownloader')[1] : '';
        const relParts = relPath.split(path.sep).filter(Boolean);
        const channel = relParts.length >= 2 ? relParts[0] : (isVDH ? 'Videodownloadhelper' : '4KDownloader');
        const title = path.basename(absPath, ext).replace(/_/g, ' ').trim() || 'imported';
        const platform = realPlatform || (isVDH ? 'videodownloadhelper' : '4kdownloader');

        await insertCompletedDownload.run(
          sourceUrl || ('file://' + absPath),
          platform,
          channel,
          title,
          path.basename(absPath),
          absPath,
          st.size || 0,
          ext.replace('.', ''),
          'completed',
          100,
          JSON.stringify({ webdl_kind: 'imported_video', importer: '4k-watcher', source_platform: realPlatform, source_url: sourceUrl || null })
        );

        // Use file mtime as timestamp so imports don't flood the gallery with today's date
        try {
          const ins = await getDownloadIdByFilepath.get(absPath);
          if (ins && ins.id) {
            const fileMtime = new Date(st.mtimeMs || Date.now()).toISOString();
            const tsQ = db.isPostgres
              ? 'UPDATE downloads SET created_at = $1, updated_at = $1, finished_at = $1 WHERE id = $2'
              : 'UPDATE downloads SET created_at = ?, updated_at = ?, finished_at = ? WHERE id = ?';
            if (db.isPostgres) {
              await db.prepare(tsQ).run(fileMtime, ins.id);
            } else {
              await db.prepare(tsQ).run(fileMtime, fileMtime, fileMtime, ins.id);
            }
            // Set source_url
            if (sourceUrl) {
              const srcQ = db.isPostgres
                ? 'UPDATE downloads SET source_url = $1 WHERE id = $2'
                : 'UPDATE downloads SET source_url = ? WHERE id = ?';
              await db.prepare(srcQ).run(sourceUrl, ins.id);
            }
          }
        } catch (e) {}

        console.log(`📥 [4K-Watcher] ${platform}/${channel}/${path.basename(absPath)}${sourceUrl ? ' ← ' + sourceUrl : ''}`);
        recentFilesTopCache.clear();
        try { scheduleThumbGeneration(absPath); } catch (e) {}
      } catch (e) {
        if (e && e.message && !e.message.includes('duplicate')) {
          console.warn(`⚠️ [4K-Watcher] Index fout: ${e.message}`);
        }
      }
    }

    async function flush4kPending() {
      const batch = [..._4kPendingFiles];
      _4kPendingFiles.clear();
      if (!batch.length) return;

      for (const fp of batch) {
        try {
          if (!fs.existsSync(fp)) continue;
          const size1 = fs.statSync(fp).size;
          const prevSize = _4kFileSizes.get(fp);
          _4kFileSizes.set(fp, size1);

          // File size still changing → re-queue for later
          if (prevSize !== undefined && prevSize !== size1) {
            _4kPendingFiles.add(fp);
            continue;
          }
          // First time seeing this file → check again after delay
          if (prevSize === undefined) {
            _4kPendingFiles.add(fp);
            continue;
          }

          // Size stable → index it
          _4kFileSizes.delete(fp);
          await index4kFile(fp);

          // Push gallery refresh via socket.io
          try { io.emit('download-completed', { source: '4k-watcher', file: path.basename(fp) }); } catch (e) {}
        } catch (e) {}
      }

      // Re-schedule if there are files still pending stabilization
      if (_4kPendingFiles.size > 0) {
        if (_4kIndexTimer) clearTimeout(_4kIndexTimer);
        _4kIndexTimer = setTimeout(flush4kPending, _4K_STABLE_CHECK_MS);
      }
    }

    for (const watchDir of _4K_WATCH_DIRS) {
      if (!fs.existsSync(watchDir)) {
        console.log(`📂 [4K-Watcher] Map niet gevonden: ${watchDir} (overgeslagen)`);
        continue;
      }
      try {
        fs.watch(watchDir, { recursive: true }, (eventType, filename) => {
          if (!filename) return;
          const ext = path.extname(filename).toLowerCase();
          if (!_4K_VIDEO_EXTS.has(ext)) return;
          const absPath = path.join(watchDir, filename);
          _4kPendingFiles.add(absPath);
          if (_4kIndexTimer) clearTimeout(_4kIndexTimer);
          _4kIndexTimer = setTimeout(flush4kPending, _4K_DEBOUNCE_MS);
        });
        console.log(`👁️  [4K-Watcher] Bewaakt: ${watchDir}`);
      } catch (e) {
        console.warn(`⚠️ [4K-Watcher] Watch mislukt: ${watchDir}: ${e.message}`);
      }
    }
    // Startup scan: index any existing unindexed files retroactively
    setTimeout(async () => {
      let startupIndexed = 0;
      for (const watchDir of _4K_WATCH_DIRS) {
        if (!fs.existsSync(watchDir)) continue;
        try {
          const scanDir = (dir, depth = 0) => {
            if (depth > 4) return [];
            const results = [];
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
              if (e.name.startsWith('.')) continue;
              const full = path.join(dir, e.name);
              if (e.isDirectory()) results.push(...scanDir(full, depth + 1));
              else if (e.isFile() && _4K_VIDEO_EXTS.has(path.extname(e.name).toLowerCase())) {
                results.push(full);
              }
            }
            return results;
          };
          const allFiles = scanDir(watchDir);
          for (const fp of allFiles) {
            await index4kFile(fp);
            startupIndexed++;
          }
        } catch (e) { }
      }
      if (startupIndexed > 0) console.log(`📥 [4K-Watcher] Startup scan: ${startupIndexed} bestanden gecontroleerd`);
    }, 3000);
    // ── einde 4K Downloader watcher ───────────────────────────────────

  });

}

startServer();

let isShuttingDown = false;

function shutdownGracefully(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\nServer wordt afgesloten... (${signal})`);

  const stopRecordings = () => {
    const promises = [];
    for (const session of activeRecordings.values()) {
      promises.push(new Promise((resolve) => {
        try {
          const proc = session.recordingProcess;
          if (!proc || proc.killed) return resolve();

          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };

          proc.once('close', finish);
          proc.once('error', finish);

          try {
            proc.stdin.write('q\n');
            proc.stdin.end();
          } catch (e) {
            try { proc.kill('SIGINT'); } catch (err) { }
          }

          setTimeout(() => {
            if (done) return;
            try { proc.kill('SIGINT'); } catch (e) { }
            setTimeout(() => {
              if (done) return;
              try { proc.kill('SIGKILL'); } catch (e) { }
              finish();
            }, 2500);
          }, 4000);
        } catch (e) {
          resolve();
        }
      }));
    }
    return Promise.all(promises);
  };

  stopRecordingIfAny().finally(() => {
    for (const [id, proc] of activeProcesses) {
      try { proc.kill('SIGTERM'); } catch (e) { }
      console.log(`  Download #${id} gestopt`);
    }
    try { db.close(); } catch (e) { }
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdownGracefully('SIGINT'));

// Tags API
expressApp.get('/api/tags', async (req, res) => {
  try {
    const rows = await db.prepare('SELECT * FROM tags ORDER BY name ASC').all();
    res.json({ success: true, tags: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.post('/api/tags', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().toLowerCase();
    if (!name) throw new Error('Name required');
    if (db.isPostgres) await db.prepare('INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING').run(name); else await db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name);
    const tag = await db.prepare(db.isPostgres ? 'SELECT * FROM tags WHERE name = $1' : 'SELECT * FROM tags WHERE name = ?').get(name);
    res.json({ success: true, tag });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.delete('/api/tags/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.prepare(db.isPostgres ? 'DELETE FROM tags WHERE id = $1' : 'DELETE FROM tags WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.get('/api/media/:kind/:id/tags', async (req, res) => {
  try {
    const { kind, id } = req.params;
    const rows = await db.prepare(db.isPostgres ? 'SELECT t.* FROM tags t JOIN media_tags mt ON t.id = mt.tag_id WHERE mt.kind = $1 AND mt.media_id = $2' : 'SELECT t.* FROM tags t JOIN media_tags mt ON t.id = mt.tag_id WHERE mt.kind = ? AND mt.media_id = ?').all(kind, id);
    res.json({ success: true, tags: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.post('/api/media/:kind/:id/tags', async (req, res) => {
  try {
    const { kind, id } = req.params;
    const tagId = parseInt(req.body.tag_id, 10);
    if (!tagId) throw new Error('Tag ID required');
    if (db.isPostgres) await db.prepare('INSERT INTO media_tags (kind, media_id, tag_id) VALUES ($1, $2, $3) ON CONFLICT ON CONSTRAINT media_tags_pkey DO NOTHING').run(kind, id, tagId); else await db.prepare('INSERT OR IGNORE INTO media_tags (kind, media_id, tag_id) VALUES (?, ?, ?)').run(kind, id, tagId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.delete('/api/media/:kind/:id/tags/:tagId', async (req, res) => {
  try {
    const { kind, id, tagId } = req.params;
    await db.prepare(db.isPostgres ? 'DELETE FROM media_tags WHERE kind = $1 AND media_id = $2 AND tag_id = $3' : 'DELETE FROM media_tags WHERE kind = ? AND media_id = ? AND tag_id = ?').run(kind, id, parseInt(tagId, 10));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


async function extractAndSaveTags(kind, media_id, text) {
  if (!text) return;
  const tags = [];
  const hashMatches = text.match(/#([a-zA-Z0-9_]+)/g);
  if (hashMatches) tags.push(...hashMatches.map(t => t.slice(1).toLowerCase()));

  const bracketMatches = text.match(/\[([^\]]+)\]/g);
  if (bracketMatches) tags.push(...bracketMatches.map(t => t.slice(1, -1).toLowerCase().replace(/\s+/g, '_')));

  for (const tag of tags) {
    if (!tag) continue;
    try {
      if (db.isPostgres) {
        await db.prepare('INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING').run(tag);
        const tagRow = await db.prepare('SELECT id FROM tags WHERE name = $1').get(tag);
        if (tagRow) {
          await db.prepare('INSERT INTO media_tags (kind, media_id, tag_id) VALUES ($1, $2, $3) ON CONFLICT ON CONSTRAINT media_tags_pkey DO NOTHING').run(kind, media_id, tagRow.id);
        }
      } else {
        await db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(tag);
        const tagRow = await db.prepare('SELECT id FROM tags WHERE name = ?').get(tag);
        if (tagRow) {
          await db.prepare('INSERT OR IGNORE INTO media_tags (kind, media_id, tag_id) VALUES (?, ?, ?)').run(kind, media_id, tagRow.id);
        }
      }
    } catch (e) { console.error('Error auto-tagging:', e); }
  }
}


// ========================
// 4K VIDEO DOWNLOADER+ FILESYSTEM SCANNER
// ========================
const FOURK_DOWNLOADER_DIR = process.env.WEBDL_4K_DOWNLOADER_DIR || '/Volumes/HDD - One Touch/WEBDL/_4KDownloader';
const FOURK_SCAN_INTERVAL_MS = parseInt(process.env.WEBDL_4K_SCAN_INTERVAL_MS || '60000', 10);
const fourKIndexedSet = new Set(); // Track files already indexed this session
let fourKScanRunning = false;

async function scan4KDownloaderDir() {
  if (fourKScanRunning) return;
  fourKScanRunning = true;
  try {
    if (!fs.existsSync(FOURK_DOWNLOADER_DIR)) {
      // External drive not mounted, skip silently
      return;
    }

    const videoExts = new Set(['mkv', 'mp4', 'webm', 'mov', 'm4v', 'avi']);
    const files = [];

    function walkDir(dir) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith('.')) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            walkDir(full);
          } else if (e.isFile()) {
            const ext = path.extname(e.name).slice(1).toLowerCase();
            if (videoExts.has(ext)) {
              files.push(full);
            }
          }
        }
      } catch (e) { }
    }
    walkDir(FOURK_DOWNLOADER_DIR);

    let newCount = 0;
    let batchCount = 0;
    const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve));
    for (const filePath of files) {
      if (fourKIndexedSet.has(filePath)) continue;

      // Yield every 10 files to let API requests through
      batchCount++;
      if (batchCount % 10 === 0) await yieldToEventLoop();

      // Check if already in DB by filepath
      try {
        const existing = await db.prepare(
          db.isPostgres
            ? "SELECT id FROM downloads WHERE filepath = $1 LIMIT 1"
            : "SELECT id FROM downloads WHERE filepath = ? LIMIT 1"
        ).get(filePath);
        if (existing && existing.id) {
          fourKIndexedSet.add(filePath);
          continue;
        }
      } catch (e) { }

      // New file — index it
      try {
        const stat = fs.statSync(filePath);
        if (stat.size < 1024) continue; // Skip tiny/incomplete files
        const ext = path.extname(filePath).slice(1).toLowerCase();
        const basename = path.basename(filePath, '.' + ext);
        const parentDir = path.basename(path.dirname(filePath));
        const channel = parentDir === '_4KDownloader' ? '4K Downloader' : parentDir;
        const title = basename;

        const ins = await insertCompletedDownload.run(
          'youtube:4k:' + basename.slice(0, 100),
          'youtube',
          channel,
          title,
          path.basename(filePath),
          filePath,
          stat.size,
          ext,
          'completed',
          100,
          JSON.stringify({ tool: '4k-video-downloader', indexed_at: new Date().toISOString(), mtime: stat.mtimeMs })
        );
        const newId = ins && ins.lastInsertRowid ? ins.lastInsertRowid : null;
        if (newId) {
          console.log(`[4K-SCAN] Indexed #${newId}: ${title} (${channel})`);
          // Queue thumbnail generation
          try {
            scheduleThumbGeneration(filePath);
          } catch (e) { }
        }
        fourKIndexedSet.add(filePath);
        newCount++;
      } catch (e) {
        console.warn(`[4K-SCAN] Error indexing ${filePath}: ${e.message}`);
      }
    }

    if (newCount > 0) {
      console.log(`[4K-SCAN] Indexed ${newCount} new files from 4K Video Downloader`);
      try { recentFilesTopCache.clear(); } catch (e) { }
    }
  } catch (e) {
    console.warn(`[4K-SCAN] Error: ${e.message}`);
  } finally {
    fourKScanRunning = false;
  }
}

// Periodic 4K filesystem scan DISABLED — downloads are tracked via DB, no need to brute-force scan the HDD
// To re-enable: uncomment the lines below or set WEBDL_4K_SCAN_ENABLED=1 in .env
// setTimeout(() => scan4KDownloaderDir(), 10000);
// setInterval(() => scan4KDownloaderDir(), FOURK_SCAN_INTERVAL_MS);

// ========================
// 4K VIDEO DOWNLOADER TRIGGER ENDPOINT
// ========================
expressApp.post('/api/4k-trigger', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ success: false, error: 'URL is vereist' });

    // Extract YouTube video ID for the 4kvd:// scheme
    let videoId = '';
    try {
      const u = new URL(url);
      if (u.hostname.includes('youtube.com') && u.searchParams.has('v')) {
        videoId = u.searchParams.get('v');
      } else if (u.hostname.includes('youtu.be')) {
        videoId = u.pathname.substring(1);
      } else if (u.hostname.includes('youtube.com') && u.pathname.startsWith('/shorts/')) {
        videoId = u.pathname.split('/')[2];
      }
    } catch (e) { }

    if (!videoId) {
      return res.status(400).json({ success: false, error: 'Geen geldig YouTube URL' });
    }

    // Open 4K Video Downloader via URL scheme
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const { exec } = require('child_process');
    exec(`open "4kvd://${ytUrl}"`, (error) => {
      if (error) {
        console.warn(`[4K-TRIGGER] Error opening 4kvd://: ${error.message}`);
        return res.json({ success: false, error: '4K Video Downloader kon niet geopend worden' });
      }
      console.log(`[4K-TRIGGER] Triggered 4K download for: ${ytUrl}`);
      res.json({ success: true, videoId, message: '4K Video Downloader geopend' });
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));