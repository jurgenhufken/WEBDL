const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const os = require('os');
const { exec, spawn } = require('child_process');
const Database = require('better-sqlite3');
const multer = require('multer');
const upload = multer({ dest: path.join(os.tmpdir(), 'webdl-uploads') });

// ========================
// CONFIGURATIE
// ========================
const PORT = 35729;
const BASE_DIR = path.join(os.homedir(), 'Downloads', 'WEBDL');
const DB_PATH = path.join(BASE_DIR, 'webdl.db');
const YT_DLP = '/opt/homebrew/bin/yt-dlp';
const FFMPEG = process.env.WEBDL_FFMPEG || '/opt/homebrew/bin/ffmpeg';
const FFPROBE = process.env.WEBDL_FFPROBE || '/opt/homebrew/bin/ffprobe';
const OFSCRAPER = process.env.WEBDL_OFSCRAPER || path.join(os.homedir(), '.local', 'bin', 'ofscraper');
const OFSCRAPER_CONFIG_DIR = process.env.WEBDL_OFSCRAPER_CONFIG_DIR || path.join(os.homedir(), '.config', 'ofscraper');
const GALLERY_DL = process.env.WEBDL_GALLERY_DL || path.join(os.homedir(), '.local', 'bin', 'gallery-dl');
const INSTALOADER = process.env.WEBDL_INSTALOADER || path.join(os.homedir(), '.local', 'bin', 'instaloader');
const REDDIT_DL = process.env.WEBDL_REDDIT_DL || path.join(os.homedir(), '.local', 'bin', 'reddit-dl');
const REDDIT_DL_CLIENT_ID = String(process.env.WEBDL_REDDIT_CLIENT_ID || '').trim();
const REDDIT_DL_CLIENT_SECRET = String(process.env.WEBDL_REDDIT_CLIENT_SECRET || '').trim();
const REDDIT_DL_USERNAME = String(process.env.WEBDL_REDDIT_USERNAME || '').trim();
const REDDIT_DL_PASSWORD = String(process.env.WEBDL_REDDIT_PASSWORD || '').trim();
const REDDIT_DL_AUTH_FILE = String(process.env.WEBDL_REDDIT_AUTH_FILE || '').trim();
const REDDIT_INDEX_MAX_ITEMS = Math.max(1, parseInt(process.env.WEBDL_REDDIT_INDEX_MAX_ITEMS || '5000', 10) || 5000);
const REDDIT_INDEX_MAX_PAGES = Math.max(1, parseInt(process.env.WEBDL_REDDIT_INDEX_MAX_PAGES || '120', 10) || 120);
const VIDEO_DEVICE = process.env.WEBDL_VIDEO_DEVICE || 'auto';
const AUDIO_DEVICE = process.env.WEBDL_AUDIO_DEVICE || 'none';
const RECORDING_FPS = process.env.WEBDL_RECORDING_FPS || '30';
const VIDEO_CODEC = process.env.WEBDL_VIDEO_CODEC || 'h264_videotoolbox';
const VIDEO_BITRATE = process.env.WEBDL_VIDEO_BITRATE || '6000k';
const LIBX264_PRESET = process.env.WEBDL_X264_PRESET || 'veryfast';
const AUDIO_BITRATE = process.env.WEBDL_AUDIO_BITRATE || '192k';
const RECORDING_AUDIO_CODEC = process.env.WEBDL_RECORDING_AUDIO_CODEC || 'aac_at';
const RECORDING_INPUT_PIXEL_FORMAT = String(process.env.WEBDL_RECORDING_INPUT_PIXEL_FORMAT || 'auto').trim();
const FFMPEG_PROBESIZE = process.env.WEBDL_FFMPEG_PROBESIZE || '50M';
const FFMPEG_ANALYZEDURATION = process.env.WEBDL_FFMPEG_ANALYZEDURATION || '50M';
const METADATA_BLOCKED_DOMAIN_SUFFIXES = [
  'motherless.com',
  'pornzog.com',
  'txxx.com',
  'omegleporn.to',
  'tnaflix.com',
  'thisvid.com',
  'pornone.com',
  'pornhex.com',
  'xxxi.porn',
  'cums.net',
  'gig.sex'
];
const DEFAULT_RECORDING_FPS_MODE = VIDEO_CODEC === 'h264_videotoolbox' ? 'cfr' : 'passthrough';
const RECORDING_FPS_MODE = String(process.env.WEBDL_RECORDING_FPS_MODE || DEFAULT_RECORDING_FPS_MODE).toLowerCase();
const FFMPEG_THREAD_QUEUE_SIZE = process.env.WEBDL_FFMPEG_THREAD_QUEUE_SIZE || '8192';
const FFMPEG_RTBUFSIZE = process.env.WEBDL_FFMPEG_RTBUFSIZE || '1500M';
const FFMPEG_MAX_MUXING_QUEUE_SIZE = process.env.WEBDL_FFMPEG_MAX_MUXING_QUEUE_SIZE || '4096';
const MIN_SCREENSHOT_BYTES = parseInt(process.env.WEBDL_MIN_SCREENSHOT_BYTES || '12000', 10);
const FINALCUT_ENABLED = String(process.env.WEBDL_FINALCUT_OUTPUT || '0') === '1';
const FINALCUT_VIDEO_CODEC = process.env.WEBDL_FINALCUT_VIDEO_CODEC || 'libx264';
const FINALCUT_X264_PRESET = process.env.WEBDL_FINALCUT_X264_PRESET || 'fast';
const FINALCUT_X264_CRF = process.env.WEBDL_FINALCUT_X264_CRF || '18';
const FINALCUT_AUDIO_BITRATE = process.env.WEBDL_FINALCUT_AUDIO_BITRATE || AUDIO_BITRATE;
const ADDON_PACKAGE_PATH = process.env.WEBDL_ADDON_PACKAGE_PATH || path.join(BASE_DIR, 'firefox-debug-controller.xpi');
const LEGACY_ADDON_PACKAGE_PATH = path.join(os.homedir(), 'WEBDL', 'firefox-debug-controller.xpi');

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
      if (mode === 'video') out.video.push({ index: idx, name });
      else if (mode === 'audio') out.audio.push({ index: idx, name });
    }
    return out;
  } catch (e) {
    return { video: [], audio: [], raw: String(text || '') };
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
  '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.wmv', '.flv', '.ts', '.m2ts'
]);
const DEFAULT_VDH_IMPORT_DIR = path.resolve(process.env.WEBDL_IMPORT_VDH_DIR || path.join(BASE_DIR, 'imports', 'videodownloadhelper'));
const ADDON_AUTO_BUILD_ON_START = String(process.env.WEBDL_ADDON_AUTO_BUILD_ON_START || '0').trim() !== '0';
const ADDON_FORCE_REBUILD_ON_START = String(process.env.WEBDL_ADDON_FORCE_REBUILD_ON_START || '1').trim() !== '0';
const AUTO_IMPORT_ON_START = String(process.env.WEBDL_AUTO_IMPORT_ON_START || '1').trim() !== '0';
const DEFAULT_AUTO_IMPORT_ROOT_DIR = (() => {
  try {
    const base = path.join(os.homedir(), 'Downloads');
    const candidates = [
      path.join(base, 'videodownloaderhelper'),
      path.join(base, 'videodownloadhelper'),
      path.join(base, 'Video DownloadHelper'),
      path.join(base, 'VideoDownloadHelper'),
      path.join(base, 'vdh')
    ];
    for (const c of candidates) {
      try {
        if (c && fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
      } catch (e) {}
    }
    return base;
  } catch (e) {
    return path.join(os.homedir(), 'Downloads');
  }
})();
const AUTO_IMPORT_ROOT_DIR = String(process.env.WEBDL_AUTO_IMPORT_ROOT_DIR || DEFAULT_AUTO_IMPORT_ROOT_DIR).trim();
const AUTO_IMPORT_MAX_DEPTH_RAW = parseInt(process.env.WEBDL_AUTO_IMPORT_MAX_DEPTH || '2', 10);
const AUTO_IMPORT_MIN_FILE_AGE_MS = Math.max(0, parseInt(process.env.WEBDL_AUTO_IMPORT_MIN_FILE_AGE_MS || '8000', 10) || 8000);
const AUTO_IMPORT_FLATTEN_TO_WEBDL = String(process.env.WEBDL_AUTO_IMPORT_FLATTEN_TO_WEBDL || '1').trim() !== '0';
const AUTO_IMPORT_MOVE_SOURCE = String(process.env.WEBDL_AUTO_IMPORT_MOVE_SOURCE || '1').trim() !== '0';
const AUTO_IMPORT_DEFAULT_POLL_MS = (() => {
  try {
    const base = path.resolve(path.join(os.homedir(), 'Downloads'));
    const root = path.resolve(AUTO_IMPORT_ROOT_DIR || base);
    if (root === base) return 0;
    return 8000;
  } catch (e) {
    return 0;
  }
})();
const AUTO_IMPORT_POLL_MS = Math.max(0, parseInt(process.env.WEBDL_AUTO_IMPORT_POLL_MS || String(AUTO_IMPORT_DEFAULT_POLL_MS), 10) || 0);
const STARTUP_REHYDRATE_DELAY_MS = Math.max(0, parseInt(process.env.WEBDL_STARTUP_REHYDRATE_DELAY_MS || '2500', 10) || 2500);
const STARTUP_REHYDRATE_MAX_ROWS = Math.max(0, parseInt(process.env.WEBDL_STARTUP_REHYDRATE_MAX_ROWS || '250', 10) || 250);
const STARTUP_REHYDRATE_MODE = String(process.env.WEBDL_STARTUP_REHYDRATE_MODE || 'active').trim().toLowerCase();

function getAutoImportMaxDepth() {
  if (!Number.isFinite(AUTO_IMPORT_MAX_DEPTH_RAW)) return 2;
  return Math.max(0, Math.min(12, Math.floor(AUTO_IMPORT_MAX_DEPTH_RAW)));
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
      `${base}.txt`
    ];

    for (const c of candidates) {
      if (!c || !fs.existsSync(c)) continue;
      const st = fs.statSync(c);
      if (!st || !st.isFile() || st.size <= 0 || st.size > (2 * 1024 * 1024)) continue;
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
        } catch (e) {}
      }

      const sourceUrl = findFirstHttpUrl(raw);
      if (sourceUrl) {
        out.sourceUrl = sourceUrl;
        out.sidecarPath = c;
        return out;
      }
    }
  } catch (e) {}
  return out;
}

function inferPlatformFromImportedFile(absPath, sourceUrl) {
  const src = String(sourceUrl || '').trim();
  if (src) {
    try {
      const p = normalizePlatform(null, src);
      if (p && p !== 'unknown') return p;
    } catch (e) {}
  }

  const lower = String(absPath || '').toLowerCase();
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
      } catch (e) {}
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
      abs.startsWith(baseReal + path.sep)
    );
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
    try { ctrl.abort(); } catch (e) {}
  }, Math.max(1000, timeoutMs));
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': REDDIT_DL_USERNAME
          ? `script:webdl-reddit-index:1.0 (by /u/${REDDIT_DL_USERNAME})`
          : 'script:webdl-reddit-index:1.0 (by /u/webdl)',
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
    try { ctrl.abort(); } catch (e) {}
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
    const token = String((data && data.access_token) || '').trim();
    const expiresIn = Number((data && data.expires_in) || 3600);
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
  } catch (e) {}

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
    const children = (((payload || {}).data || {}).children || []);
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

    after = String((((payload || {}).data || {}).after) || '');
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
  for (const s of (Array.isArray(suffixes) ? suffixes : [])) {
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
      if (cached && cached.dirMtimeMs === dirMtimeMs && (Date.now() - (cached.at || 0)) < 8000) {
        return cached.value || null;
      }
    } catch (e) {}

    const files = listMediaFilesInDir(dir, maxScan);
    if (!files.length) {
      try { cache.set(dir, { at: Date.now(), dirMtimeMs, value: null }); } catch (e) {}
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
      if (videoExts.has(ext)) score += 1000;
      else if (imageExts.has(ext)) score += 300;
      else score += 50;
      if (!/_raw/i.test(name)) score += 120;
      if (/final|edited|merged/.test(name)) score += 40;
      if (/\.mp4$/.test(name)) score += 20;
      try {
        const st = fs.statSync(file);
        if (st && st.mtimeMs) score += st.mtimeMs / 1000000;
      } catch (e) {}
      if (score > bestScore) {
        bestScore = score;
        best = file;
      }
    }

    if (!best) {
      try { cache.set(dir, { at: Date.now(), dirMtimeMs, value: null }); } catch (e) {}
      return null;
    }

    let mtime = 0;
    try {
      const st = fs.statSync(best);
      if (st && st.mtimeMs) mtime = st.mtimeMs;
    } catch (e) {}

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
    } catch (e) {}
    return out;
  } catch (e) {
    return null;
  }
}
function getAvfoundationDeviceListCached(maxAgeMs = 60 * 1000) {
  return new Promise((resolve) => {
    try {
      const now = Date.now();
      if (avfoundationDeviceListCache && (now - (avfoundationDeviceListCache.ts || 0)) < maxAgeMs) {
        return resolve(avfoundationDeviceListCache.data);
      }

      const args = ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''];
      const proc = spawn(FFMPEG, args);
      let stderr = '';
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try { proc.kill('SIGKILL'); } catch (e) {}
        const data = parseAvfoundationDeviceList(stderr);
        avfoundationDeviceListCache = { ts: now, data };
        resolve(data);
      }, 12000);

      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', () => {
        if (done) return;
        done = true;
        try { clearTimeout(timer); } catch (e) {}
        const data = parseAvfoundationDeviceList(stderr);
        avfoundationDeviceListCache = { ts: now, data };
        resolve(data);
      });
      proc.on('error', () => {
        if (done) return;
        done = true;
        try { clearTimeout(timer); } catch (e) {}
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
    const list = (devices && Array.isArray(devices.video)) ? devices.video : [];
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
    const list = (devices && Array.isArray(devices.audio)) ? devices.audio : [];
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
    } catch (e) {}
  }

  return candidates[0];
}

function getViewerHTML() {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WEBDL Viewer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0b1020; color: #eee; height: 100vh; overflow: hidden; }
    .app { display: flex; height: 100vh; }
    .sidebar { width: 320px; background: #121a33; border-right: 1px solid #1f2a52; display: flex; flex-direction: column; }
    .sidebar header { padding: 12px; border-bottom: 1px solid #1f2a52; }
    .sidebar h1 { font-size: 14px; color: #00d4ff; margin-bottom: 6px; }
    .controls { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .controls .row { grid-column: 1 / -1; display: flex; gap: 8px; }
    select, button, input[type="range"] { width: 100%; }
    select, button { background: #0f3460; color: #fff; border: 1px solid #1f2a52; border-radius: 6px; padding: 8px; font-size: 12px; }
    button:hover { background: #00d4ff; color: #0b1020; }
    label { font-size: 11px; color: #9aa7d1; display: flex; align-items: center; gap: 6px; }
    .list { overflow: auto; flex: 1 1 auto; padding: 10px; }
    .item { padding: 8px 10px; border-radius: 8px; border: 1px solid #1f2a52; background: #0b1020; margin-bottom: 8px; cursor: pointer; }
    .item.active { border-color: #00d4ff; }
    .item .row { display: flex; gap: 10px; align-items: center; }
    .item .thumb { width: 52px; height: 38px; border-radius: 6px; object-fit: contain; flex: 0 0 auto; border: 1px solid #1f2a52; background: #000; }
    .item .text { flex: 1 1 auto; min-width: 0; }
    .item .meta { font-size: 11px; color: #9aa7d1; }
    .item .title { font-size: 12px; color: #eee; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .main { flex: 1 1 auto; display: flex; flex-direction: column; }
    .topbar { padding: 10px 12px; background: #0b1020; border-bottom: 1px solid #1f2a52; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .topbar .left { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .topbar .now { font-size: 12px; color: #00d4ff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .topbar .sub { font-size: 11px; color: #9aa7d1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .topbar .right { display: flex; gap: 8px; align-items: center; }
    .viewer { flex: 1 1 auto; position: relative; display: flex; justify-content: center; align-items: center; background: #050816; }
    .stage { position: relative; max-width: 100%; max-height: 100%; overflow: hidden; }
    .stage .content { transform-origin: 0 0; cursor: zoom-in; }
    .stage.zoomed .content { cursor: grab; }
    img, video { max-width: 100%; max-height: calc(100vh - 120px); display: block; }
    video { background: #000; }
    .hud { position: absolute; bottom: 10px; left: 10px; right: 10px; display: flex; justify-content: space-between; gap: 10px; pointer-events: none; }
    .hud .pill { pointer-events: none; background: rgba(15,52,96,0.85); border: 1px solid rgba(31,42,82,0.8); padding: 6px 10px; border-radius: 999px; font-size: 11px; color: #d7e6ff; }
    .log { position: fixed; bottom: 12px; right: 12px; width: 420px; max-width: 90vw; background: rgba(10,14,28,0.95); border: 1px solid #1f2a52; border-radius: 10px; overflow: hidden; }
    .log header { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: #121a33; }
    .log header span { font-size: 11px; color: #9aa7d1; }
    .log header button { width: auto; padding: 6px 8px; font-size: 11px; }
    .log .body { max-height: 0; overflow: auto; transition: max-height 0.25s; }
    .log.open .body { max-height: 240px; }
    .log pre { padding: 10px; font-size: 11px; color: #c7d3ff; white-space: pre-wrap; word-break: break-word; }
    .range { width: 220px; }
    .tiny { font-size: 11px; color: #9aa7d1; }
  </style>
</head>
<body>
  <div class="app">
    <div class="sidebar">
      <header>
        <h1>WEBDL Viewer</h1>
        <div class="controls">
          <div class="row">
            <select id="mode">
              <option value="channel">Kanaal (↑↓ kanaal, ←→ media)</option>
              <option value="recent">Recent (←→ media)</option>
            </select>
          </div>
          <div class="row">
            <select id="filter">
              <option value="media">Media (foto+video)</option>
              <option value="video">Alleen video</option>
              <option value="image">Alleen foto</option>
              <option value="all">Alles</option>
            </select>
          </div>
          <div class="row">
            <button id="btnReload">↻ Herladen</button>
            <button id="btnSlideshow">▶︎ Dia</button>
          </div>
          <div class="row">
            <select id="slideshowSec">
              <option value="2">Dia: 2s</option>
              <option value="4" selected>Dia: 4s</option>
              <option value="7">Dia: 7s</option>
              <option value="10">Dia: 10s</option>
            </select>
            <button id="btnWrap">🔁 Wrap: aan</button>
          </div>
        </div>
        <div style="margin-top:10px" class="tiny">
          ←/→: vorige/volgende
          <br>↑/↓: kanaal
          <br>Spatie: play/pause
          <br>M: mute
        </div>
      </header>
      <div class="list" id="list"></div>
    </div>
    <div class="main">
      <div class="topbar">
        <div class="left">
          <div class="now" id="nowTitle">-</div>
          <div class="sub" id="nowSub">-</div>
        </div>
        <div class="right">
          <button id="btnOpen" style="width:auto;">Open</button>
          <button id="btnFinder" style="width:auto;">Finder</button>
          <label style="gap:8px;">Vol <input id="vol" class="range" type="range" min="0" max="1" step="0.01" value="0.8"></label>
          <button id="btnMute" style="width:auto;">Mute</button>
          <label style="gap:8px;">Tijd <input id="seek" class="range" type="range" min="0" max="1000" step="1" value="0"></label>
        </div>
      </div>
      <div class="viewer">
        <div class="stage" id="stage">
          <div class="content" id="content"></div>
        </div>
        <div class="hud">
          <div class="pill" id="hudLeft">-</div>
          <div class="pill" id="hudRight">-</div>
        </div>
      </div>
    </div>
  </div>

  <div class="log" id="log">
    <header>
      <span>Log</span>
      <button id="btnLog">Open</button>
    </header>
    <div class="body"><pre id="logBody"></pre></div>
  </div>

  <script>
    const state = {
      mode: 'recent',
      filter: 'media',
      wrap: true,
      channels: [],
      chIndex: 0,
      items: [],
      index: 0,
      cursor: '',
      done: false,
      loadingMore: false,
      slideshow: false,
      slideshowTimer: null,
      zoomed: false,
      scale: 1,
      panX: 0,
      panY: 0,
      dragging: false,
      dragStart: null
    };

    const elList = document.getElementById('list');
    const elMode = document.getElementById('mode');
    const elFilter = document.getElementById('filter');
    const elNowTitle = document.getElementById('nowTitle');
    const elNowSub = document.getElementById('nowSub');
    const elContent = document.getElementById('content');
    const elStage = document.getElementById('stage');
    const elHudLeft = document.getElementById('hudLeft');
    const elHudRight = document.getElementById('hudRight');
    const elSeek = document.getElementById('seek');
    const elVol = document.getElementById('vol');
    const elBtnMute = document.getElementById('btnMute');
    const elBtnOpen = document.getElementById('btnOpen');
    const elBtnFinder = document.getElementById('btnFinder');
    const elBtnSlideshow = document.getElementById('btnSlideshow');
    const elSlideshowSec = document.getElementById('slideshowSec');
    const elBtnWrap = document.getElementById('btnWrap');
    const elLog = document.getElementById('log');
    const elLogBody = document.getElementById('logBody');
    const elBtnLog = document.getElementById('btnLog');

    function log(msg) {
      const ts = new Date().toLocaleTimeString();
      elLogBody.textContent = '[' + ts + '] ' + msg + '\n' + elLogBody.textContent;
    }

    function api(path) {
      return fetch(path, { cache: 'no-store' }).then(r => r.json());
    }

    function currentItem() {
      return state.items[state.index] || null;
    }

    function applyTransform() {
      elContent.style.transform = 'translate(' + state.panX + 'px, ' + state.panY + 'px) scale(' + state.scale + ')';
    }

    function resetZoom() {
      state.zoomed = false;
      state.scale = 1;
      state.panX = 0;
      state.panY = 0;
      elStage.classList.remove('zoomed');
      applyTransform();
    }

    function toggleZoom() {
      if (!state.zoomed) {
        state.zoomed = true;
        state.scale = 2;
        state.panX = 0;
        state.panY = 0;
        elStage.classList.add('zoomed');
        applyTransform();
      } else {
        resetZoom();
      }
    }

    function stopSlideshow() {
      state.slideshow = false;
      if (state.slideshowTimer) clearTimeout(state.slideshowTimer);
      state.slideshowTimer = null;
      elBtnSlideshow.textContent = '▶︎ Dia';
    }

    function scheduleSlideshowTick() {
      if (!state.slideshow) return;
      const sec = parseInt(elSlideshowSec.value, 10) || 4;
      state.slideshowTimer = setTimeout(() => {
        nextItem(1).catch(() => {});
        scheduleSlideshowTick();
      }, Math.max(1, sec) * 1000);
    }

    function startSlideshow() {
      state.slideshow = true;
      elBtnSlideshow.textContent = '⏸ Dia';
      scheduleSlideshowTick();
    }

    function renderList() {
      elList.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (let idx = 0; idx < state.items.length; idx += 1) {
        const it = state.items[idx] || {};
        const item = document.createElement('div');
        item.className = 'item' + (idx === state.index ? ' active' : '');
        item.dataset.idx = String(idx);

        const row = document.createElement('div');
        row.className = 'row';

        if (it.thumb) {
          const img = document.createElement('img');
          img.className = 'thumb';
          img.loading = 'lazy';
          img.src = String(it.thumb);
          img.onerror = () => { img.style.display = 'none'; };
          row.appendChild(img);
        }

        const text = document.createElement('div');
        text.className = 'text';
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = [it.platform || '-', it.channel || '-', it.type || '-'].join(' | ');
        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = String(it.title || '(zonder titel)');
        text.appendChild(meta);
        text.appendChild(title);

        row.appendChild(text);
        item.appendChild(row);
        item.addEventListener('click', () => {
          state.index = idx;
          showCurrent();
          renderList();
        });
        frag.appendChild(item);
      }
      elList.appendChild(frag);
    }

    function attachMediaHandlers(mediaEl) {
      if (!mediaEl) return;
      if (mediaEl.tagName === 'VIDEO') {
        mediaEl.volume = parseFloat(elVol.value || '0.8');
        mediaEl.muted = (elBtnMute.dataset.muted === '1');
        mediaEl.addEventListener('timeupdate', () => {
          const d = mediaEl.duration || 0;
          const c = mediaEl.currentTime || 0;
          if (d > 0) {
            const v = Math.max(0, Math.min(1000, Math.round((c / d) * 1000)));
            if (!elSeek.dataset.dragging) elSeek.value = String(v);
          }
        });
      }
    }

    function showCurrent() {
      const it = currentItem();
      resetZoom();
      elContent.innerHTML = '';
      elSeek.value = '0';

      elBtnOpen.disabled = !it;
      elBtnFinder.disabled = !it;

      if (!it) {
        elNowTitle.textContent = '-';
        elNowSub.textContent = '-';
        elHudLeft.textContent = '-';
        elHudRight.textContent = '-';
        return;
      }

      elNowTitle.textContent = it.title || '(zonder titel)';
      const showOrigin = it.source_url && String(it.source_url) !== String(it.url || '');
      const origin = showOrigin ? (' | origin: ' + String(it.source_url).slice(0, 120)) : '';
      const src = showOrigin ? (' | src: ' + String(it.url || '').slice(0, 120)) : '';
      elNowSub.textContent = it.platform + ' | ' + it.channel + ' | ' + it.type + ' | ' + it.created_at + origin + src;
      elHudLeft.textContent = (state.index + 1) + '/' + state.items.length + (state.done ? '' : '+');
      elHudRight.textContent = state.mode === 'channel' && state.channels[state.chIndex]
        ? (state.channels[state.chIndex].platform + ' / ' + state.channels[state.chIndex].channel + ' (' + state.channels[state.chIndex].count + ')')
        : 'recent';

      let mediaEl = null;
      if (it.type === 'image') {
        mediaEl = document.createElement('img');
        mediaEl.src = it.src;
        mediaEl.alt = it.title || '';
      } else if (it.type === 'video') {
        mediaEl = document.createElement('video');
        mediaEl.src = it.src;
        mediaEl.controls = false;
        mediaEl.playsInline = true;
        mediaEl.autoplay = true;
      } else {
        const a = document.createElement('a');
        a.href = it.src;
        a.textContent = 'Open bestand';
        a.style.color = '#00d4ff';
        a.style.padding = '20px';
        elContent.appendChild(a);
        return;
      }

      mediaEl.style.maxWidth = '100%';
      mediaEl.style.maxHeight = 'calc(100vh - 120px)';
      elContent.appendChild(mediaEl);
      attachMediaHandlers(mediaEl);
    }

    async function openCurrent(action) {
      const it = currentItem();
      if (!it) return;
      try {
        const isPath = it.open && it.open.path;
        const url = isPath ? '/media/open-path' : '/media/open';
        const payload = isPath ? { path: it.open.path, action } : { kind: it.open.kind, id: it.open.id, action };
        const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await resp.json().catch(() => null);
        if (!data || !data.success) throw new Error((data && data.error) ? data.error : 'actie mislukt');
      } catch (e) {
        log((e && e.message) ? e.message : String(e));
      }
    }

    async function maybeLoadMore() {
      if (state.loadingMore || state.done) return;
      state.loadingMore = true;
      try {
        if (state.mode === 'recent') {
          const data = await api('/api/media/recent-files?include_active=0&limit=200&cursor=' + encodeURIComponent(state.cursor) + '&type=' + encodeURIComponent(state.filter));
          if (!data.success) throw new Error(data.error || 'recent failed');
          const newItems = data.items || [];
          state.items = state.items.concat(newItems);
          state.cursor = data.next_cursor || '';
          state.done = !!data.done;
        } else {
          const ch = state.channels[state.chIndex];
          if (!ch) { state.done = true; return; }
          const data = await api('/api/media/channel-files?include_active=0&platform=' + encodeURIComponent(ch.platform) + '&channel=' + encodeURIComponent(ch.channel) + '&limit=300&cursor=' + encodeURIComponent(state.cursor) + '&type=' + encodeURIComponent(state.filter));
          if (!data.success) throw new Error(data.error || 'channel failed');
          const newItems = data.items || [];
          state.items = state.items.concat(newItems);
          state.cursor = data.next_cursor || '';
          state.done = !!data.done;
        }
      } catch (e) {
        log(e.message);
        state.done = true;
      } finally {
        state.loadingMore = false;
      }
    }

    async function nextItem(delta) {
      if (!state.items.length) return;
      let next = state.index + delta;

      if (delta > 0 && next >= state.items.length - 2 && !state.done) {
        await maybeLoadMore();
        next = state.index + delta;
      }

      if (state.wrap) {
        state.index = (next % state.items.length + state.items.length) % state.items.length;
      } else {
        state.index = Math.max(0, Math.min(state.items.length - 1, next));
      }
      showCurrent();
      renderList();
    }

    async function loadRecent() {
      state.cursor = '';
      state.done = false;
      const data = await api('/api/media/recent-files?include_active=0&limit=200&cursor=&type=' + encodeURIComponent(state.filter));
      if (!data.success) throw new Error(data.error || 'recent failed');
      state.items = data.items || [];
      state.cursor = data.next_cursor || '';
      state.done = !!data.done;
      state.index = 0;
      renderList();
      showCurrent();
      log('Recent geladen: ' + state.items.length);
    }

    async function loadChannels() {
      const data = await api('/api/media/channels?limit=500');
      if (!data.success) throw new Error(data.error || 'channels failed');
      state.channels = data.channels || [];
      state.chIndex = 0;
      log('Kanalen geladen: ' + state.channels.length);
    }

    async function loadChannelItems() {
      const ch = state.channels[state.chIndex];
      if (!ch) {
        state.items = [];
        state.index = 0;
        state.cursor = '';
        state.done = true;
        renderList();
        showCurrent();
        return;
      }
      state.cursor = '';
      state.done = false;
      const data = await api('/api/media/channel-files?include_active=0&platform=' + encodeURIComponent(ch.platform) + '&channel=' + encodeURIComponent(ch.channel) + '&limit=300&cursor=&type=' + encodeURIComponent(state.filter));
      if (!data.success) throw new Error(data.error || 'channel failed');
      state.items = data.items || [];
      state.cursor = data.next_cursor || '';
      state.done = !!data.done;
      state.index = 0;
      renderList();
      showCurrent();
      log('Kanaal geladen: ' + ch.platform + '/' + ch.channel + ' (' + state.items.length + ')');
    }

    async function init() {
      elMode.value = state.mode;
      elFilter.value = state.filter;
      if (state.mode === 'recent') {
        await loadRecent();
      } else {
        await loadChannels();
        await loadChannelItems();
      }
    }

    function currentVideo() {
      const v = elContent.querySelector('video');
      return v || null;
    }

    document.getElementById('btnReload').addEventListener('click', async () => {
      stopSlideshow();
      try {
        if (state.mode === 'recent') await loadRecent();
        else { await loadChannels(); await loadChannelItems(); }
      } catch (e) { log(e.message); }
    });

    elBtnOpen.addEventListener('click', () => openCurrent('open'));
    elBtnFinder.addEventListener('click', () => openCurrent('finder'));

    elMode.addEventListener('change', async () => {
      stopSlideshow();
      state.mode = elMode.value;
      try {
        if (state.mode === 'recent') {
          await loadRecent();
        } else {
          await loadChannels();
          await loadChannelItems();
        }
      } catch (e) { log(e.message); }
    });

    elFilter.addEventListener('change', async () => {
      stopSlideshow();
      state.filter = elFilter.value;
      try {
        if (state.mode === 'recent') await loadRecent();
        else await loadChannelItems();
      } catch (e) { log(e.message); }
    });

    elBtnSlideshow.addEventListener('click', () => {
      if (state.slideshow) stopSlideshow();
      else startSlideshow();
    });

    elBtnWrap.addEventListener('click', () => {
      state.wrap = !state.wrap;
      elBtnWrap.textContent = state.wrap ? '🔁 Wrap: aan' : '↯ Wrap: uit';
    });

    elBtnLog.addEventListener('click', () => {
      elLog.classList.toggle('open');
      elBtnLog.textContent = elLog.classList.contains('open') ? 'Dicht' : 'Open';
    });

    elStage.addEventListener('click', () => {});

    elStage.addEventListener('wheel', (e) => {
      if (!state.zoomed) return;
      e.preventDefault();
      const delta = (e.deltaY > 0) ? -0.1 : 0.1;
      state.scale = Math.max(1, Math.min(6, state.scale + delta));
      applyTransform();
    }, { passive: false });

    elStage.addEventListener('mousedown', (e) => {
      if (!state.zoomed) return;
      state.dragging = true;
      state.dragStart = { x: e.clientX, y: e.clientY, panX: state.panX, panY: state.panY };
      elStage.classList.add('zoomed');
    });

    window.addEventListener('mousemove', (e) => {
      if (!state.dragging || !state.dragStart) return;
      const dx = e.clientX - state.dragStart.x;
      const dy = e.clientY - state.dragStart.y;
      state.panX = state.dragStart.panX + dx;
      state.panY = state.dragStart.panY + dy;
      applyTransform();
    });

    window.addEventListener('mouseup', () => {
      state.dragging = false;
      state.dragStart = null;
    });

    elVol.addEventListener('input', () => {
      const v = currentVideo();
      if (v) v.volume = parseFloat(elVol.value || '0.8');
    });

    elBtnMute.dataset.muted = '0';
    elBtnMute.addEventListener('click', () => {
      const v = currentVideo();
      const muted = elBtnMute.dataset.muted === '1';
      elBtnMute.dataset.muted = muted ? '0' : '1';
      elBtnMute.textContent = muted ? 'Mute' : 'Unmute';
      if (v) v.muted = !muted;
    });

    elSeek.addEventListener('mousedown', () => { elSeek.dataset.dragging = '1'; });
    elSeek.addEventListener('mouseup', () => { elSeek.dataset.dragging = ''; });
    elSeek.addEventListener('input', () => {
      const v = currentVideo();
      if (!v) return;
      const d = v.duration || 0;
      if (d > 0) {
        const frac = (parseInt(elSeek.value, 10) || 0) / 1000;
        v.currentTime = Math.max(0, Math.min(d, frac * d));
      }
    });

    window.addEventListener('keydown', async (e) => {
      if (e.key === 'ArrowRight') { await nextItem(1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { await nextItem(-1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') {
        if (state.mode === 'channel' && state.channels.length) {
          stopSlideshow();
          state.chIndex = (state.chIndex - 1 + state.channels.length) % state.channels.length;
          await loadChannelItems();
        }
        e.preventDefault();
      }
      else if (e.key === 'ArrowDown') {
        if (state.mode === 'channel' && state.channels.length) {
          stopSlideshow();
          state.chIndex = (state.chIndex + 1) % state.channels.length;
          await loadChannelItems();
        }
        e.preventDefault();
      }
      else if (e.key === ' ') {
        const v = currentVideo();
        if (v) {
          if (v.paused) v.play().catch(() => {});
          else v.pause();
        }
        e.preventDefault();
      }
      else if (e.key.toLowerCase() === 'm') {
        elBtnMute.click();
        e.preventDefault();
      }
      else if (e.key === 'Escape') {
        stopSlideshow();
        try {
          if (elLog.classList.contains('open')) {
            elLog.classList.remove('open');
            elBtnLog.textContent = 'Open';
            e.preventDefault();
            return;
          }
        } catch (err) {}
        resetZoom();
        e.preventDefault();
      }
    });

    init().catch(e => {
      const msg = e && e.message ? e.message : String(e);
      log(msg);
      elList.innerHTML = '<div style="padding:10px;border:1px solid #7f1d1d;border-radius:8px;color:#fecaca;background:#450a0a;font-size:12px;line-height:1.4;">Viewer init fout: ' + msg.replace(/</g, '&lt;') + '</div>';
    });
  </script>
</body>
</html>`;
}

function getGalleryHTML() {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>WEBDL Gallery</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0b1020; color: #eee; min-height: 100vh; }
    .top { position: sticky; top: 0; z-index: 50; background: rgba(11,16,32,0.96); backdrop-filter: blur(8px); border-bottom: 1px solid #1f2a52; }
    .bar { padding: 12px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .title { font-size: 14px; color: #00d4ff; font-weight: 700; margin-right: 10px; }
    select, button { background: #0f3460; color: #fff; border: 1px solid #1f2a52; border-radius: 8px; padding: 8px 10px; font-size: 12px; }
    button:hover { background: #00d4ff; color: #0b1020; }
    .btn { width: auto; }
    .spacer { flex: 1 1 auto; }
    .mini { padding: 6px 8px; font-size: 11px; }
    .yt-controls { display: flex; flex-direction: column; gap: 4px; padding: 6px 10px; border: 1px solid #1f2a52; border-radius: 10px; background: #07112a; }
    .yt-controls.loading { opacity: 0.7; }
    .yt-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .yt-tag { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #9dd7ff; }
    .yt-input { width: 52px; border-radius: 8px; border: 1px solid #1f2a52; background: #020614; color: #fff; padding: 6px; text-align: center; font-size: 12px; }
    .yt-status { font-size: 11px; color: #9aa7d1; min-height: 14px; }
    .hint { font-size: 11px; color: #9aa7d1; }

    .content { padding: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
    .card { border: 1px solid #1f2a52; background: #050816; border-radius: 12px; overflow: hidden; cursor: pointer; position: relative; }
    .card:hover { border-color: #00d4ff; }
    .thumb { width: 100%; height: 140px; background: #000; object-fit: contain; display: block; }
    .meta { padding: 8px 10px 10px; }
    .line1 { font-size: 11px; color: #9aa7d1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .line2 { font-size: 12px; color: #eee; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badge { position: absolute; top: 8px; left: 8px; font-size: 10px; background: rgba(15,52,96,0.9); border: 1px solid rgba(31,42,82,0.9); padding: 3px 8px; border-radius: 999px; color: #d7e6ff; }
    .badge.r { left: auto; right: 8px; }
    .sentinel { padding: 18px; text-align: center; color: #9aa7d1; }

    .modal { position: fixed; inset: 0; padding: 10px; background: rgba(0,0,0,0.75); display: none; align-items: stretch; justify-content: center; z-index: 100; touch-action: manipulation; }
    .modal.open { display: flex; }
    .panel { width: min(1200px, 100%); height: calc(100vh - 20px); background: #050816; border: 1px solid #1f2a52; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; }
    .panel.portrait { width: min(700px, 100%); }
    .panel header { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid #1f2a52; background: #0b1020; }
    .panel header .h { flex: 1 1 auto; min-width: 0; }
    .panel header .h .t { font-size: 12px; color: #00d4ff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .panel header .h .s { font-size: 11px; color: #9aa7d1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .panel header button { width: auto; }
    .zoomctl { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border: 1px solid #1f2a52; border-radius: 8px; background: #07112a; color: #9aa7d1; font-size: 11px; }
    .zoomctl input[type="range"] { width: 120px; }
    .panel .body { flex: 1 1 auto; display: flex; justify-content: center; align-items: center; background: #000; touch-action: manipulation; padding: 10px; overflow: hidden; }
    .panel img, .panel video { width: 100%; height: 100%; max-width: 100%; max-height: 100%; display: block; object-fit: contain; }
    .panel .zoom-media { will-change: transform; transform-origin: center center; cursor: zoom-in; }
    .panel .zoom-media.zoomed { cursor: grab; }
    .panel .zoom-media.zoomed.dragging { cursor: grabbing; }
  </style>
</head>
<body>
  <div class="top">
    <div class="bar">
      <div class="title">WEBDL Gallery</div>
      <select id="mode" title="Weergave">
        <option value="recent">Chronologisch (alles)</option>
        <option value="channel">Per kanaal/model</option>
      </select>
      <select id="filter" title="Filter">
        <option value="media" selected>Media (foto+video)</option>
        <option value="video">Alleen video</option>
        <option value="image">Alleen foto</option>
        <option value="all">Alles</option>
      </select>
      <select id="channelSel" style="min-width: 280px; display:none;"></select>
      <button id="btnReload" class="btn">↻ Herladen</button>
      <div class="yt-controls" id="ytControls" style="display:none;">
        <div class="yt-row">
          <span class="yt-tag">YT</span>
          <button id="btnYtMinus" class="mini">-</button>
          <input id="inpYtConcurrency" class="yt-input" type="number" min="0" max="20" step="1" value="1" />
          <button id="btnYtPlus" class="mini">+</button>
          <button id="btnYtPause" class="mini">Pauze</button>
          <button id="btnYtResume" class="mini">Resume</button>
          <button id="btnYtReset" class="mini">Reset</button>
        </div>
        <div class="yt-status" id="ytStatus">-</div>
      </div>
      <div class="spacer"></div>
      <div class="hint" id="hint">-</div>
    </div>
  </div>

  <div class="content">
    <div class="grid" id="grid"></div>
    <div class="sentinel" id="sentinel">Laden…</div>
  </div>

  <div class="modal" id="modal">
    <div class="panel" id="mPanel">
      <header>
        <button id="btnClose" class="btn">✕</button>
        <div class="h">
          <div class="t" id="mTitle">-</div>
          <div class="s" id="mSub">-</div>
        </div>
        <label class="zoomctl">Zoom
          <input id="zoomRange" type="range" min="100" max="600" step="10" value="100">
        </label>
        <button id="btnZoomReset" class="btn">Reset zoom</button>
        <button id="btnOpen" class="btn">Open</button>
        <button id="btnFinder" class="btn">Finder</button>
      </header>
      <div class="body" id="mBody"></div>
    </div>
  </div>

  <script>
    const FALLBACK_THUMB = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="100%" height="100%" fill="#000"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#00d4ff" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="18">thumb…</text></svg>');
    const elMode = document.getElementById('mode');
    const elFilter = document.getElementById('filter');
    const elChannelSel = document.getElementById('channelSel');
    const elGrid = document.getElementById('grid');
    const elSentinel = document.getElementById('sentinel');
    const elHint = document.getElementById('hint');
    const elYtControls = document.getElementById('ytControls');
    const elYtStatus = document.getElementById('ytStatus');
    const elYtMinus = document.getElementById('btnYtMinus');
    const elYtPlus = document.getElementById('btnYtPlus');
    const elYtPause = document.getElementById('btnYtPause');
    const elYtResume = document.getElementById('btnYtResume');
    const elYtReset = document.getElementById('btnYtReset');
    const elYtValue = document.getElementById('inpYtConcurrency');

    const elModal = document.getElementById('modal');
    const elPanel = document.getElementById('mPanel');
    const elBtnClose = document.getElementById('btnClose');
    const elBtnOpen = document.getElementById('btnOpen');
    const elBtnFinder = document.getElementById('btnFinder');
    const elZoomRange = document.getElementById('zoomRange');
    const elBtnZoomReset = document.getElementById('btnZoomReset');
    const elMTitle = document.getElementById('mTitle');
    const elMSub = document.getElementById('mSub');
    const elMBody = document.getElementById('mBody');

    const state = {
      mode: 'recent',
      filter: 'media',
      loading: false,
      done: false,
      cursor: '',
      limit: 80,
      items: [],
      status: null,
      channels: [],
      channel: null,
      current: null,
      currentIndex: -1,
      currentMediaEl: null,
      zoom: 1,
      panX: 0,
      panY: 0,
      dragging: false,
      dragMoved: false,
      dragStart: null,
      reloading: false,
      lastAutoLoadAt: 0,
      autoFillLoads: 0,
      hasUserScrolled: false,
      youtube: null,
      youtubeDefaults: null,
      youtubeLastManual: null,
      youtubeLoading: false
    };

    function api(path) {
      return fetch(path, { cache: 'no-store' }).then(r => r.json());
    }

    function setHint() {
      if (state.mode === 'recent') {
        const s = state.status;
        const dl = s && Number.isFinite(s.activeDownloads) ? s.activeDownloads : null;
        const qh = s && s.queues && s.queues.heavy ? s.queues.heavy : null;
        const ql = s && s.queues && s.queues.light ? s.queues.light : null;
        const extra = (dl !== null)
          ? (' | actief: ' + dl + ((qh && ql)
            ? (' | queue H ' + qh.active + '/' + qh.limit + ' (+' + qh.queued + ') | L ' + ql.active + '/' + ql.limit + ' (+' + ql.queued + ')')
            : ''))
          : '';
        elHint.textContent = 'Items: ' + state.items.length + extra;
      } else {
        const ch = state.channel;
        const s = state.status;
        const dl = s && Number.isFinite(s.activeDownloads) ? s.activeDownloads : null;
        const qh = s && s.queues && s.queues.heavy ? s.queues.heavy : null;
        const ql = s && s.queues && s.queues.light ? s.queues.light : null;
        const extra = (dl !== null)
          ? (' | actief: ' + dl + ((qh && ql)
            ? (' | queue H ' + qh.active + '/' + qh.limit + ' (+' + qh.queued + ') | L ' + ql.active + '/' + ql.limit + ' (+' + ql.queued + ')')
            : ''))
          : '';
        elHint.textContent = ch ? (ch.platform + '/' + ch.channel + ' • items: ' + state.items.length + extra) : 'Geen kanaal';
      }
    }

    function clearGrid() {
      elGrid.innerHTML = '';
    }

    const thumbIo = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const img = e.target;
        const src = img && img.dataset ? String(img.dataset.src || '') : '';
        if (src && img && img.src !== src) img.src = src;
        try { thumbIo.unobserve(img); } catch (e2) {}
      }
    }, { rootMargin: '350px' });

    function pageIsScrollable() {
      try {
        const h = document.documentElement ? (document.documentElement.scrollHeight || 0) : 0;
        return h > (window.innerHeight + 40);
      } catch (e) {
        return true;
      }
    }

    function primeThumbs(max = 18) {
      try {
        const imgs = elGrid.querySelectorAll('img.thumb');
        let n = 0;
        for (const img of imgs) {
          if (!img) continue;
          const src = img.dataset ? String(img.dataset.src || '') : (img.getAttribute ? String(img.getAttribute('data-src') || '') : '');
          if (!src) continue;
          try {
            const r = img.getBoundingClientRect();
            if (r && r.top > (window.innerHeight + 800)) continue;
          } catch (e) {}
          img.src = src;
          try { if (img.dataset) img.dataset.retries = img.dataset.retries || '0'; } catch (e) {}
          n++;
          if (n >= max) break;
        }
      } catch (e) {}
    }

    function attachThumbRetry(img) {
      if (!img) return;
      try {
        if (img.dataset && img.dataset._webdlThumbRetry) return;
        if (img.dataset) img.dataset._webdlThumbRetry = '1';
      } catch (e) {}

      img.addEventListener('load', () => {
        try { if (img.dataset) img.dataset.src = ''; } catch (e) {}
        try { thumbIo.unobserve(img); } catch (e) {}
      });

      img.addEventListener('error', () => {
        try {
          const base = img.dataset ? String(img.dataset.src || '') : '';
          if (!base) return;
          const tries = img.dataset ? (parseInt(String(img.dataset.retries || '0'), 10) || 0) : 0;
          if (tries >= 3) return;
          if (img.dataset) img.dataset.retries = String(tries + 1);
          const bust = (base.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now();
          setTimeout(() => {
            try { img.src = base + bust; } catch (e2) {}
          }, 650 + (tries * 800));
        } catch (e) {}
      });
    }

    function fmtItemSub(it) {
      const showOrigin = it && it.source_url && String(it.source_url) !== String(it.url || '');
      const origin = showOrigin ? (' | origin: ' + String(it.source_url).slice(0, 120)) : '';
      const src = showOrigin ? (' | src: ' + String(it.url || '').slice(0, 120)) : '';
      return (it.platform || '-') + ' | ' + (it.channel || '-') + ' | ' + (it.type || '-') + ' | ' + (it.created_at || '-') + origin + src;
    }

    function itemKey(it) {
      return (it && it.kind ? String(it.kind) : '') + ':' + String(it && it.id != null ? it.id : '');
    }

    function syncZoomUi() {
      if (elZoomRange) elZoomRange.value = String(Math.round(state.zoom * 100));
      if (elBtnZoomReset) elBtnZoomReset.disabled = state.zoom <= 1;
    }

    function applyZoomTransform() {
      const el = state.currentMediaEl;
      if (!el) return;
      el.style.transform = 'translate(' + state.panX + 'px, ' + state.panY + 'px) scale(' + state.zoom + ')';
      if (state.zoom > 1) {
        el.classList.add('zoomed');
      } else {
        el.classList.remove('zoomed');
        el.classList.remove('dragging');
      }
      syncZoomUi();
    }

    function resetZoom() {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      state.dragging = false;
      state.dragMoved = false;
      state.dragStart = null;
      applyZoomTransform();
    }

    function setZoom(nextZoom) {
      state.zoom = Math.max(1, Math.min(6, Number(nextZoom) || 1));
      if (state.zoom <= 1) {
        state.panX = 0;
        state.panY = 0;
      }
      applyZoomTransform();
    }

    function attachZoomHandlers(el) {
      if (!el) return;
      state.currentMediaEl = el;
      el.classList.add('zoom-media');
      el.style.transition = 'transform 120ms ease-out';
      resetZoom();

      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (state.zoom <= 1) return;
        state.dragging = true;
        state.dragMoved = false;
        state.dragStart = {
          x: e.clientX,
          y: e.clientY,
          panX: state.panX,
          panY: state.panY
        };
        el.classList.add('dragging');
        e.preventDefault();
      });

      el.addEventListener('click', () => {
        if (state.dragMoved) {
          state.dragMoved = false;
          return;
        }
        if (state.zoom > 1) resetZoom();
        else setZoom(2);
      });
    }

    async function cycleMode(direction) {
      const modes = ['recent', 'channel'];
      const curr = Math.max(0, modes.indexOf(state.mode));
      const next = (curr + direction + modes.length) % modes.length;
      const nextMode = modes[next];
      if (nextMode === state.mode) return;
      state.mode = nextMode;
      elMode.value = nextMode;
      closeModal();
      await reloadAll();
    }

    function openModalByKey(key) {
      try {
        const idx = state.items.findIndex((x) => itemKey(x) === key);
        if (idx >= 0) openModalIndex(idx);
      } catch (e) {}
    }

    function addCards(items) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const key = itemKey(it);
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.key = key;
        if (it && it.ready === false) {
          card.style.opacity = '0.82';
        }

        const img = document.createElement('img');
        img.className = 'thumb';
        img.loading = 'lazy';
        try { img.decoding = 'async'; } catch (e) {}
        const thumbUrl = it.thumb || '';
        if (String(thumbUrl).startsWith('data:')) {
          img.src = thumbUrl;
        } else {
          const real = thumbUrl || '';
          if (real) {
            img.src = FALLBACK_THUMB;
            try { img.dataset.src = real; } catch (e) {}
            try { attachThumbRetry(img); } catch (e) {}
            try { thumbIo.observe(img); } catch (e) {}
          } else {
            img.src = FALLBACK_THUMB;
          }
        }
        img.alt = it.title || '';
        img.onerror = () => {
          try {
            img.onerror = null;
            img.src = FALLBACK_THUMB;
          } catch (e) {}
        };

        const b1 = document.createElement('div');
        b1.className = 'badge';
        b1.textContent = it.platform || 'other';

        const b2 = document.createElement('div');
        b2.className = 'badge r';
        if (it && it.ready === false) {
          const st = (it.status || 'queued');
          const pct = Number.isFinite(Number(it.progress)) ? Math.max(0, Math.min(100, Number(it.progress))) : 0;
          b2.textContent = st + ' ' + pct + '%';
        } else {
          b2.textContent = it.type || '';
        }

        const meta = document.createElement('div');
        meta.className = 'meta';
        const l1 = document.createElement('div');
        l1.className = 'line1';
        l1.textContent = it.channel || 'unknown';
        const l2 = document.createElement('div');
        l2.className = 'line2';
        if (it && it.ready === false) {
          const st = (it.status || 'queued');
          const pct = Number.isFinite(Number(it.progress)) ? Math.max(0, Math.min(100, Number(it.progress))) : 0;
          l2.textContent = (it.title || '(download)') + ' • ' + st + ' ' + pct + '%';
        } else {
          l2.textContent = it.title || '(zonder titel)';
        }
        meta.appendChild(l1);
        meta.appendChild(l2);

        card.appendChild(img);
        card.appendChild(b1);
        card.appendChild(b2);
        card.appendChild(meta);
        card.addEventListener('click', () => openModalByKey(key));
        frag.appendChild(card);
      }
      elGrid.appendChild(frag);
      try { requestAnimationFrame(() => primeThumbs(18)); } catch (e) { primeThumbs(18); }
    }

    function prependCards(items) {
      if (!items || !items.length) return;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const key = itemKey(it);
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.key = key;
        if (it && it.ready === false) {
          card.style.opacity = '0.82';
        }

        const img = document.createElement('img');
        img.className = 'thumb';
        img.loading = 'lazy';
        try { img.decoding = 'async'; } catch (e) {}
        const thumbUrl = it.thumb || '';
        if (String(thumbUrl).startsWith('data:')) {
          img.src = thumbUrl;
        } else {
          const real = thumbUrl || '';
          if (real) {
            img.src = FALLBACK_THUMB;
            try { img.dataset.src = real; } catch (e) {}
            try { attachThumbRetry(img); } catch (e) {}
            try { thumbIo.observe(img); } catch (e) {}
          } else {
            img.src = FALLBACK_THUMB;
          }
        }
        img.alt = it.title || '';
        img.onerror = () => {
          try {
            img.onerror = null;
            img.src = FALLBACK_THUMB;
          } catch (e) {}
        };

        const b1 = document.createElement('div');
        b1.className = 'badge';
        b1.textContent = it.platform || 'other';

        const b2 = document.createElement('div');
        b2.className = 'badge r';
        if (it && it.ready === false) {
          const st = (it.status || 'queued');
          const pct = Number.isFinite(Number(it.progress)) ? Math.max(0, Math.min(100, Number(it.progress))) : 0;
          b2.textContent = st + ' ' + pct + '%';
        } else {
          b2.textContent = it.type || '';
        }

        const meta = document.createElement('div');
        meta.className = 'meta';
        const l1 = document.createElement('div');
        l1.className = 'line1';
        l1.textContent = it.channel || 'unknown';
        const l2 = document.createElement('div');
        l2.className = 'line2';
        if (it && it.ready === false) {
          const st = (it.status || 'queued');
          const pct = Number.isFinite(Number(it.progress)) ? Math.max(0, Math.min(100, Number(it.progress))) : 0;
          l2.textContent = (it.title || '(download)') + ' • ' + st + ' ' + pct + '%';
        } else {
          l2.textContent = it.title || '(zonder titel)';
        }
        meta.appendChild(l1);
        meta.appendChild(l2);

        card.appendChild(img);
        card.appendChild(b1);
        card.appendChild(b2);
        card.appendChild(meta);
        card.addEventListener('click', () => openModalByKey(key));
        frag.appendChild(card);
      }
      elGrid.insertBefore(frag, elGrid.firstChild);
      try { requestAnimationFrame(() => primeThumbs(18)); } catch (e) { primeThumbs(18); }
    }

    function openModalIndex(idx) {
      const it = state.items[idx];
      if (!it) return;
      state.current = it;
      state.currentIndex = idx;
      state.currentMediaEl = null;
      if (elPanel) elPanel.classList.remove('portrait');

      const isReady = !(it && it.ready === false);
      elBtnOpen.disabled = !isReady;
      elBtnFinder.disabled = !isReady;

      elMTitle.textContent = it.title || '(zonder titel)';
      elMSub.textContent = fmtItemSub(it);
      elMBody.innerHTML = '';

      if (!isReady) {
        const box = document.createElement('div');
        box.style.padding = '20px';
        box.style.color = '#d7e6ff';
        box.innerHTML = '<div style="font-size:13px;color:#00d4ff;font-weight:700">Download bezig…</div>'
          + '<div style="margin-top:8px;font-size:12px;color:#9aa7d1">Status: ' + (it.status || 'queued')
          + ' • ' + (Number.isFinite(Number(it.progress)) ? Math.max(0, Math.min(100, Number(it.progress))) : 0) + '%</div>'
          + '<div style="margin-top:10px;font-size:12px;color:#9aa7d1">Media verschijnt automatisch zodra bestanden klaar zijn.</div>';
        elMBody.appendChild(box);
        resetZoom();
        elModal.classList.add('open');
        return;
      }

      let el = null;
      if (it.type === 'video') {
        el = document.createElement('video');
        el.src = it.src;
        el.controls = true;
        el.playsInline = true;
        el.autoplay = true;
        try { el.disablePictureInPicture = true; } catch (e) {}
        try { el.setAttribute('disablePictureInPicture', ''); } catch (e) {}
        try { el.setAttribute('controlsList', 'nofullscreen noremoteplayback nodownload'); } catch (e) {}
        el.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); });
        el.addEventListener('click', (e) => { e.stopPropagation(); });
        el.addEventListener('loadedmetadata', () => {
          try {
            const vw = el.videoWidth || 0;
            const vh = el.videoHeight || 0;
            if (elPanel && vw > 0 && vh > 0 && vh > vw) elPanel.classList.add('portrait');
          } catch (e) {}
        });
      } else {
        el = document.createElement('img');
        el.src = it.src;
        el.alt = it.title || '';
        el.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); });
        el.addEventListener('load', () => {
          try {
            const iw = el.naturalWidth || 0;
            const ih = el.naturalHeight || 0;
            if (elPanel && iw > 0 && ih > 0 && ih > iw) elPanel.classList.add('portrait');
          } catch (e) {}
        });
      }
      elMBody.appendChild(el);
      attachZoomHandlers(el);
      elModal.classList.add('open');
    }

    function closeModal() {
      elModal.classList.remove('open');
      elMBody.innerHTML = '';
      state.current = null;
      state.currentIndex = -1;
      state.currentMediaEl = null;
      resetZoom();
    }

    async function openCurrent(action) {
      const it = state.current;
      if (!it) return;
      if (it && it.ready === false) {
        alert('Download is nog bezig. Wacht tot het item klaar is.');
        return;
      }
      try {
        const isPath = it.open && it.open.path;
        const url = isPath ? '/media/open-path' : '/media/open';
        const payload = isPath ? { path: it.open.path, action: action } : { kind: it.open.kind, id: it.open.id, action: action };
        const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await resp.json().catch(() => null);
        if (!data || !data.success) throw new Error((data && data.error) ? data.error : 'actie mislukt');
      } catch (e) {
        alert((e && e.message) ? e.message : String(e));
      }
    }

    async function gotoDelta(delta) {
      if (state.currentIndex < 0) return;
      const target = state.currentIndex + delta;
      if (target >= 0 && target < state.items.length) {
        openModalIndex(target);
        return;
      }
      if (delta > 0 && !state.done) {
        await loadNext();
        const nextTarget = Math.min(state.items.length - 1, state.currentIndex + delta);
        if (nextTarget !== state.currentIndex) openModalIndex(nextTarget);
      }
    }

    async function loadChannels() {
      const data = await api('/api/media/channels?limit=800');
      if (!data.success) throw new Error(data.error || 'channels failed');
      state.channels = data.channels || [];
      elChannelSel.innerHTML = '';
      for (const ch of state.channels) {
        const opt = document.createElement('option');
        opt.value = ch.platform + '||' + ch.channel;
        opt.textContent = ch.platform + '/' + ch.channel + ' (' + ch.count + ')';
        elChannelSel.appendChild(opt);
      }
      if (!state.channel && state.channels.length) {
        state.channel = { platform: state.channels[0].platform, channel: state.channels[0].channel };
        elChannelSel.value = state.channel.platform + '||' + state.channel.channel;
      }
    }

    function resetPaging() {
      state.cursor = '';
      state.done = false;
      state.items = [];
      state.autoFillLoads = 0;
      state.hasUserScrolled = false;
      clearGrid();
      setHint();
    }

    async function loadNext() {
      if (state.loading || state.done) return;
      state.loading = true;
      elSentinel.textContent = 'Laden…';
      try {
        let path = '';
        if (state.mode === 'recent') {
          path = '/api/media/recent-files?limit=' + state.limit + '&cursor=' + encodeURIComponent(state.cursor) + '&type=' + encodeURIComponent(state.filter) + '&include_active=0';
        } else {
          const ch = state.channel;
          if (!ch) { state.done = true; return; }
          path = '/api/media/channel-files?platform=' + encodeURIComponent(ch.platform) + '&channel=' + encodeURIComponent(ch.channel) + '&limit=' + state.limit + '&cursor=' + encodeURIComponent(state.cursor) + '&type=' + encodeURIComponent(state.filter) + '&include_active=0';
        }
        const data = await api(path);
        if (!data.success) throw new Error(data.error || 'load failed');
        const items = data.items || [];
        state.items = state.items.concat(items);
        state.cursor = data.next_cursor || '';
        state.done = !!data.done;
        addCards(items);
        setHint();
        elSentinel.textContent = state.done ? 'Einde' : 'Scroll om meer te laden…';
      } catch (e) {
        elSentinel.textContent = 'Fout: ' + ((e && e.message) ? e.message : String(e));
      } finally {
        state.loading = false;
      }
    }

    async function reloadAll() {
      if (state.reloading) return;
      state.reloading = true;
      resetPaging();
      try {
        if (state.mode === 'channel') {
          elChannelSel.style.display = '';
          await loadChannels();
        } else {
          elChannelSel.style.display = 'none';
        }
        await loadNext();
      } finally {
        state.reloading = false;
      }
    }

    async function softRefreshTop() {
      if (state.loading || state.reloading) return;
      try {
        const existingIndex = new Map();
        for (let i = 0; i < state.items.length; i++) {
          const k = itemKey(state.items[i]);
          if (k && !existingIndex.has(k)) existingIndex.set(k, i);
        }

        const patchCard = (key, it) => {
          try {
            if (!key) return;
            let card = null;
            try {
              if (window.CSS && typeof CSS.escape === 'function') {
                card = elGrid.querySelector('.card[data-key="' + CSS.escape(String(key)) + '"]');
              }
            } catch (e) {
              card = null;
            }
            if (!card) {
              for (const c of Array.from(elGrid.querySelectorAll('.card'))) {
                try {
                  if (String(c.dataset.key || '') === String(key)) {
                    card = c;
                    break;
                  }
                } catch (e) {}
              }
            }
            if (!card) return;

            try {
              card.style.opacity = (it && it.ready === false) ? '0.82' : '';
            } catch (e) {}

            const img = card.querySelector('img.thumb');
            if (img) {
              const thumbUrl = it && it.thumb ? String(it.thumb) : '';
              if (thumbUrl && String(thumbUrl).startsWith('data:')) {
                img.src = thumbUrl;
                try { if (img.dataset) img.dataset.src = ''; } catch (e) {}
                try { thumbIo.unobserve(img); } catch (e) {}
              } else if (thumbUrl) {
                img.src = FALLBACK_THUMB;
                try { if (img.dataset) img.dataset.src = thumbUrl; } catch (e) {}
                try { attachThumbRetry(img); } catch (e) {}
                try { thumbIo.observe(img); } catch (e) {}
              } else {
                img.src = FALLBACK_THUMB;
                try { if (img.dataset) img.dataset.src = ''; } catch (e) {}
                try { thumbIo.unobserve(img); } catch (e) {}
              }
            }

            const left = card.querySelector('.badge');
            if (left) left.textContent = (it && it.platform) ? it.platform : 'other';

            const right = card.querySelector('.badge.r');
            if (right) {
              if (it && it.ready === false) {
                const st = (it.status || 'queued');
                const pct = Number.isFinite(Number(it.progress)) ? Math.max(0, Math.min(100, Number(it.progress))) : 0;
                right.textContent = st + ' ' + pct + '%';
              } else {
                right.textContent = (it && it.type) ? it.type : '';
              }
            }

            const l1 = card.querySelector('.line1');
            if (l1) l1.textContent = (it && it.channel) ? it.channel : 'unknown';
            const l2 = card.querySelector('.line2');
            if (l2) {
              if (it && it.ready === false) {
                const st = (it.status || 'queued');
                const pct = Number.isFinite(Number(it.progress)) ? Math.max(0, Math.min(100, Number(it.progress))) : 0;
                l2.textContent = (it.title || '(download)') + ' • ' + st + ' ' + pct + '%';
              } else {
                l2.textContent = it.title || '(zonder titel)';
              }
            }
          } catch (e) {}
        };
        let path = '';
        if (state.mode === 'recent') {
          path = '/api/media/recent-files?limit=' + state.limit + '&cursor=' + encodeURIComponent('') + '&type=' + encodeURIComponent(state.filter) + '&include_active=0';
        } else {
          const ch = state.channel;
          if (!ch) return;
          path = '/api/media/channel-files?platform=' + encodeURIComponent(ch.platform) + '&channel=' + encodeURIComponent(ch.channel) + '&limit=' + state.limit + '&cursor=' + encodeURIComponent('') + '&type=' + encodeURIComponent(state.filter) + '&include_active=0';
        }
        const data = await api(path);
        if (!data || !data.success) return;
        const got = Array.isArray(data.items) ? data.items : [];
        const fresh = [];
        for (const it of got) {
          const k = itemKey(it);
          if (!k) continue;

          const idx = existingIndex.has(k) ? existingIndex.get(k) : -1;
          if (idx >= 0) {
            try {
              const prev = state.items[idx];
              const changed = JSON.stringify(prev || null) !== JSON.stringify(it || null);
              if (changed) {
                state.items[idx] = it;
                patchCard(k, it);
              }
            } catch (e) {}
            continue;
          }

          fresh.push(it);
        }
        if (!fresh.length) return;
        state.items = fresh.concat(state.items);
        prependCards(fresh);
        setHint();

        const maxKeep = 900;
        if (state.items.length > maxKeep) {
          state.items = state.items.slice(0, maxKeep);
          while (elGrid.childNodes.length > maxKeep) {
            elGrid.removeChild(elGrid.lastChild);
          }
        }
      } catch (e) {}
    }

    document.getElementById('btnReload').addEventListener('click', () => reloadAll());
    elMode.addEventListener('change', async () => { state.mode = elMode.value; await reloadAll(); });
    elFilter.addEventListener('change', async () => { state.filter = elFilter.value; await reloadAll(); });
    elChannelSel.addEventListener('change', async () => {
      const parts = String(elChannelSel.value || '').split('||');
      if (parts.length === 2) state.channel = { platform: parts[0], channel: parts[1] };
      await reloadAll();
    });

    elBtnClose.addEventListener('click', closeModal);
    elModal.addEventListener('click', (e) => { if (e.target === elModal) closeModal(); });
    elModal.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    elBtnOpen.addEventListener('click', () => openCurrent('open'));
    elBtnFinder.addEventListener('click', () => openCurrent('finder'));

    window.addEventListener('keydown', async (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        await cycleMode(-1);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        await cycleMode(1);
        return;
      }
      if (!elModal.classList.contains('open')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); await gotoDelta(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); await gotoDelta(-1); }
      else if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
    });

    if (elZoomRange) {
      elZoomRange.addEventListener('input', () => {
        const pct = Number(elZoomRange.value || '100');
        setZoom(pct / 100);
      });
    }
    if (elBtnZoomReset) {
      elBtnZoomReset.addEventListener('click', () => resetZoom());
    }

    window.addEventListener('mousemove', (e) => {
      if (!state.dragging || !state.dragStart || state.zoom <= 1 || !state.currentMediaEl) return;
      const dx = e.clientX - state.dragStart.x;
      const dy = e.clientY - state.dragStart.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) state.dragMoved = true;
      state.panX = state.dragStart.panX + dx;
      state.panY = state.dragStart.panY + dy;
      applyZoomTransform();
    });

    window.addEventListener('mouseup', () => {
      state.dragging = false;
      state.dragStart = null;
      if (state.currentMediaEl) state.currentMediaEl.classList.remove('dragging');
    });

    window.addEventListener('scroll', () => {
      try {
        const y = window.scrollY || document.documentElement.scrollTop || 0;
        if (y > 50) state.hasUserScrolled = true;
      } catch (e) {}
    }, { passive: true });

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        if (state.loading || state.done) continue;

        // Prevent "load everything at once" on first paint:
        // - if the page is already scrollable, only start infinite-load after user scroll
        // - if not scrollable yet, allow a small number of auto-fills
        if (!state.hasUserScrolled) {
          if (pageIsScrollable()) continue;
          if ((state.autoFillLoads || 0) >= 2) continue;
          state.autoFillLoads = (state.autoFillLoads || 0) + 1;
        }

        const now = Date.now();
        if (now - (state.lastAutoLoadAt || 0) < 650) continue;
        state.lastAutoLoadAt = now;
        loadNext();
      }
    }, { rootMargin: '250px' });
    io.observe(elSentinel);

    // Never stay in fullscreen for modal media.
    try {
      document.addEventListener('fullscreenchange', () => {
        try {
          if (!document.fullscreenElement) return;
          if (elModal.classList.contains('open') && elModal.contains(document.fullscreenElement)) {
            document.exitFullscreen().catch(() => {});
          }
        } catch (e) {}
      });
    } catch (e) {}

    // Poll status so you can see active downloads even before files land on disk.
    try {
      const pollStatus = async () => {
        try {
          const s = await api('/status');
          if (s && typeof s === 'object') {
            state.status = s;
            setHint();
          }
        } catch (e) {}
      };
      setInterval(pollStatus, 2500);
      pollStatus();
    } catch (e) {}

    // Light live-refresh: when DB updates, refresh the grid (without interrupting modal).
    try {
      let last = null;
      let lastReloadAt = 0;
      let lastPeriodicAt = 0;
      const tick = async () => {
        try {
          const data = await api('/api/stats');
          const s = data && data.stats ? data.stats : null;
          if (!s) return;
          const modalOpen = elModal.classList.contains('open');
          const activeDl = state.status && Number.isFinite(Number(state.status.activeDownloads)) ? Number(state.status.activeDownloads) : 0;
          const key = (activeDl > 0)
            ? [s.downloads, s.downloads_created_last || '', s.downloads_finished_last || '', s.screenshots, s.download_files, s.screenshots_last, s.download_files_last].join('|')
            : [s.downloads, s.downloads_created_last || '', s.downloads_finished_last || '', s.screenshots, s.download_files, s.downloads_last || '', s.screenshots_last, s.download_files_last].join('|');
          const now = Date.now();
          const scrollTop = (typeof window !== 'undefined') ? (window.scrollY || document.documentElement.scrollTop || 0) : 0;
          const nearTop = scrollTop < 160;
          const canAutoReload = !modalOpen && nearTop && !state.loading && !state.reloading;
          const changed = !!(last && key !== last);

          // Safety net: even if the stats key doesn't change (e.g. timestamp resolution),
          // refresh occasionally when you're near the top.
          if (canAutoReload && !changed && (now - lastPeriodicAt) >= (activeDl > 0 ? 12000 : 8000)) {
            lastPeriodicAt = now;
            lastReloadAt = now;
            softRefreshTop();
          }

          if (!modalOpen) {
            if (activeDl > 0) {
              if (changed && canAutoReload) {
                lastReloadAt = now;
                softRefreshTop();
              } else if (canAutoReload && (now - lastReloadAt) >= 15000) {
                lastReloadAt = now;
                softRefreshTop();
              } else if (!canAutoReload) {
                elHint.textContent = 'Download bezig — nieuwe files beschikbaar (klik Herladen)';
              }
            } else if (changed) {
              if (canAutoReload && (now - lastReloadAt) >= 2500) {
                lastReloadAt = now;
                softRefreshTop();
              } else if (!canAutoReload) {
                elHint.textContent = 'Nieuwe items — klik Herladen';
              }
            }
          } else if (changed) {
            elHint.textContent = 'Nieuwe items — klik Herladen';
          }
          last = key;
        } catch (e) {}
      };
      setInterval(tick, 2500);
      tick();
    } catch (e) {}

    reloadAll().catch(e => { elSentinel.textContent = 'Fout: ' + e.message; });
  </script>
</body>
</html>`;
}

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
  } catch (e) {}

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
  const allowCookies = (p === 'download') || (p === 'metadata' && YTDLP_USE_COOKIES_FOR_METADATA);
  if (!allowCookies) return [];

  if (YTDLP_COOKIES_MODE === 'none' || YTDLP_COOKIES_MODE === 'off' || YTDLP_COOKIES_MODE === '0') return [];

  if (YTDLP_COOKIES_MODE === 'file') {
    if (YTDLP_COOKIES_FILE) {
      try {
        if (fs.existsSync(YTDLP_COOKIES_FILE)) return ['--cookies', YTDLP_COOKIES_FILE];
      } catch (e) {}
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
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
`);

try {
  const cols = db.prepare("PRAGMA table_info(downloads)").all();
  const hasFinishedAt = (cols || []).some((c) => String(c && c.name ? c.name : '') === 'finished_at');
  if (!hasFinishedAt) {
    db.exec('ALTER TABLE downloads ADD COLUMN finished_at DATETIME');
  }
} catch (e) {}

try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_downloads_finished_at ON downloads(finished_at DESC)');
} catch (e) {}

try {
  db.exec("UPDATE downloads SET finished_at = COALESCE(finished_at, updated_at) WHERE status IN ('completed','error','cancelled') AND (finished_at IS NULL OR TRIM(finished_at)='')");
} catch (e) {}

try {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_downloads_finished_at_insert
    AFTER INSERT ON downloads
    WHEN NEW.status IN ('completed','error','cancelled') AND (NEW.finished_at IS NULL OR TRIM(NEW.finished_at)='')
    BEGIN
      UPDATE downloads
      SET finished_at = STRFTIME('%Y-%m-%d %H:%M:%f','now')
      WHERE id = NEW.id;
    END;
  `);
} catch (e) {}

try {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_downloads_finished_at_update
    AFTER UPDATE OF status ON downloads
    WHEN NEW.status IN ('completed','error','cancelled') AND (NEW.finished_at IS NULL OR TRIM(NEW.finished_at)='')
    BEGIN
      UPDATE downloads
      SET finished_at = STRFTIME('%Y-%m-%d %H:%M:%f','now')
      WHERE id = NEW.id;
    END;
  `);
} catch (e) {}

try {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_downloads_finished_at_clear
    AFTER UPDATE OF status ON downloads
    WHEN OLD.status IN ('completed','error','cancelled') AND NEW.status NOT IN ('completed','error','cancelled')
    BEGIN
      UPDATE downloads
      SET finished_at = NULL
      WHERE id = NEW.id;
    END;
  `);
} catch (e) {}

const insertDownload = db.prepare(`INSERT INTO downloads (url, platform, channel, title, status) VALUES (?, ?, ?, ?, 'pending')`);
const updateDownload = db.prepare(`UPDATE downloads SET status=?, progress=?, filepath=?, filename=?, filesize=?, format=?, metadata=?, error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const updateDownloadStatus = db.prepare(`UPDATE downloads SET status=?, progress=?, error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const updateDownloadMeta = db.prepare(`UPDATE downloads SET title=?, channel=?, description=?, duration=?, thumbnail=?, metadata=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const updateDownloadBasics = db.prepare(`UPDATE downloads SET platform=?, channel=?, title=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const updateDownloadFilepath = db.prepare(`UPDATE downloads SET filepath=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const updateDownloadSourceUrl = db.prepare(`UPDATE downloads SET source_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const updateDownloadThumbnail = db.prepare(`UPDATE downloads SET thumbnail=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const updateDownloadUrl = db.prepare(`UPDATE downloads SET url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
const getDownload = db.prepare(`SELECT * FROM downloads WHERE id=?`);
const findReusableDownloadByUrl = db.prepare(`
  SELECT id, url, platform, channel, title, status, progress, filepath, filename
  FROM downloads
  WHERE url=?
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
  WHERE status IN ('pending', 'queued')
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);

const getRecentQueuedDownloadsByChannel = db.prepare(`
  SELECT id, url, source_url, platform, channel, title, status, progress, filepath, created_at, updated_at, thumbnail
  FROM downloads
  WHERE status IN ('pending', 'queued')
    AND platform = ?
    AND channel = ?
  ORDER BY created_at DESC, id DESC
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
  VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(download_id, relpath) DO UPDATE SET
    filesize=excluded.filesize,
    mtime_ms=excluded.mtime_ms,
    created_at=COALESCE(download_files.created_at, excluded.created_at),
    updated_at=CURRENT_TIMESTAMP
`);

const getRecentIndexedMedia = db.prepare(`
  SELECT kind, id, platform, channel, title, filepath, created_at, ts
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      NULL AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(f.mtime_ms, 0) AS ts
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
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts
    FROM screenshots s
  )
  ORDER BY ts DESC
  LIMIT ? OFFSET ?
`);

const getIndexedMediaByChannel = db.prepare(`
  SELECT kind, id, platform, channel, title, filepath, created_at, ts
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      NULL AS filepath,
      COALESCE(f.created_at, d.created_at) AS created_at,
      COALESCE(f.mtime_ms, 0) AS ts
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
      CAST(strftime('%s', s.created_at) AS INTEGER) * 1000 AS ts
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

const getStats = db.prepare(`
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
    COALESCE((SELECT MAX(created_at) FROM screenshots), '') AS screenshots_last,
    COALESCE((SELECT MAX(updated_at) FROM download_files), '') AS download_files_last
`);

let statsCache = null;
let statsCacheAt = 0;
const STATS_CACHE_MS = Math.max(250, parseInt(process.env.WEBDL_STATS_CACHE_MS || '1500', 10) || 1500);

let recentFilesTopCache = new Map();
let recentFilesTopCacheAt = 0;
const RECENT_FILES_TOP_CACHE_MS = Math.max(250, parseInt(process.env.WEBDL_RECENT_FILES_TOP_CACHE_MS || '2000', 10) || 2000);

const getRecentMedia = db.prepare(`
  SELECT kind, id, platform, channel, title, filepath, created_at, thumbnail, url, source_url
  FROM (
    SELECT 'd' AS kind, id, platform, channel, title, filepath, created_at, thumbnail, url, source_url, COALESCE(finished_at, updated_at) AS sort_ts
    FROM downloads
    WHERE status = 'completed' AND filepath IS NOT NULL AND TRIM(filepath) != ''
    UNION ALL
    SELECT 's' AS kind, id, platform, channel, title, filepath, created_at, NULL AS thumbnail, url, NULL AS source_url, created_at AS sort_ts
    FROM screenshots
    WHERE filepath IS NOT NULL AND TRIM(filepath) != ''
  )
  ORDER BY sort_ts DESC
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

const getIndexedChannels = db.prepare(`
  SELECT platform, channel, COUNT(*) AS count, MAX(ts) AS last_at
  FROM (
    SELECT d.platform AS platform, d.channel AS channel, COALESCE(f.mtime_ms, 0) AS ts
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
  SELECT kind, id, platform, channel, title, filepath, created_at, thumbnail, url, source_url
  FROM (
    SELECT 'd' AS kind, id, platform, channel, title, filepath, created_at, thumbnail, url, source_url, COALESCE(finished_at, updated_at) AS sort_ts
    FROM downloads
    WHERE status = 'completed' AND filepath IS NOT NULL AND TRIM(filepath) != ''
    UNION ALL
    SELECT 's' AS kind, id, platform, channel, title, filepath, created_at, NULL AS thumbnail, url, NULL AS source_url, created_at AS sort_ts
    FROM screenshots
    WHERE filepath IS NOT NULL AND TRIM(filepath) != ''
  )
  WHERE platform = ? AND channel = ?
  ORDER BY sort_ts DESC
  LIMIT ? OFFSET ?
`);

// ========================
// ACTIEVE DOWNLOADS TRACKER
// ========================
const activeProcesses = new Map();

const HEAVY_DOWNLOAD_CONCURRENCY = parseInt(process.env.WEBDL_HEAVY_DOWNLOAD_CONCURRENCY || '4', 10);
const LIGHT_DOWNLOAD_CONCURRENCY = parseInt(process.env.WEBDL_LIGHT_DOWNLOAD_CONCURRENCY || '3', 10);

const initialYoutubeConcurrency = parseInt(process.env.WEBDL_YOUTUBE_DOWNLOAD_CONCURRENCY || '4', 10);
const initialYoutubeSpacing = parseInt(process.env.WEBDL_YOUTUBE_START_SPACING_MS || '0', 10);
const initialYoutubeJitter = parseInt(process.env.WEBDL_YOUTUBE_START_JITTER_MS || '0', 10);

const runtimeYoutubeConfig = {
  concurrency: Number.isFinite(initialYoutubeConcurrency) ? Math.max(0, initialYoutubeConcurrency) : 4,
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
  runtimeYoutubeConfig.concurrency = Number.isFinite(initialYoutubeConcurrency) ? Math.max(0, initialYoutubeConcurrency) : 4;
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
const queuedJobs = new Map();
const jobLane = new Map();
const jobPlatform = new Map();
const metadataProbeQueue = [];
let metadataProbeActive = 0;
const startingJobs = new Set();
const cancelledJobs = new Set();
const onHoldJobs = new Set();

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

function applyAbortStatus(id, kind) {
  try {
    const proc = activeProcesses.get(id);
    if (proc) {
      try { proc.kill('SIGTERM'); } catch (e) {}
      try { activeProcesses.delete(id); } catch (e) {}
    }

    if (kind === 'cancelled') {
      clearCancelled(id);
      startingJobs.delete(id);
      queuedJobs.delete(id);
      removeFromQueue(queuedHeavy, id);
      removeFromQueue(queuedLight, id);
      jobLane.delete(id);
      updateDownloadStatus.run('cancelled', 0, null, id);
      try { runDownloadSchedulerSoon(); } catch (e) {}
      return true;
    }
    if (kind === 'on_hold') {
      startingJobs.delete(id);
      queuedJobs.delete(id);
      removeFromQueue(queuedHeavy, id);
      removeFromQueue(queuedLight, id);
      jobLane.delete(id);
      updateDownloadStatus.run('on_hold', 0, null, id);
      try { runDownloadSchedulerSoon(); } catch (e) {}
      return true;
    }
  } catch (e) {}
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

function detectLane(platform) {
  if (platform === 'instagram' || platform === 'wikifeet' || platform === 'kinky' || platform === 'reddit') return 'light';
  if (platform === 'tiktok') return 'light';
  if (platform === 'onlyfans') return 'heavy';
  return 'heavy';
}

function enqueueDownloadJob(downloadId, url, platform, channel, title, metadata) {
  const lane = detectLane(platform);
  queuedJobs.set(downloadId, { downloadId, url, platform, channel, title, metadata });
  jobLane.set(downloadId, lane);
  jobPlatform.set(downloadId, platform);
  updateDownloadStatus.run('queued', 0, null, downloadId);

  if (lane === 'light') queuedLight.unshift(downloadId);
  else queuedHeavy.unshift(downloadId);

  if (METADATA_PROBE_ENABLED && METADATA_PROBE_CONCURRENCY > 0 && platform !== 'onlyfans' && platform !== 'instagram' && platform !== 'wikifeet' && platform !== 'kinky' && platform !== 'tiktok' && platform !== 'reddit') {
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
  }, 300);
}

function runDownloadScheduler() {
  const heavyLimit = Math.max(0, HEAVY_DOWNLOAD_CONCURRENCY);
  const lightLimit = Math.max(0, LIGHT_DOWNLOAD_CONCURRENCY);

  const youtubeSettings = getYoutubeRuntimeConfig();
  const youtubeLimit = Math.max(0, youtubeSettings.concurrency);
  const youtubeSpacingMs = Math.max(0, youtubeSettings.spacingMs);
  const youtubeJitterMs = Math.max(0, youtubeSettings.jitterMs);

  const countRuntimePlatform = (platform) => {
    try {
      const p = String(platform || '').toLowerCase();
      if (!p) return 0;
      const ids = new Set();
      for (const id of activeProcesses.keys()) ids.add(id);
      for (const id of startingJobs) ids.add(id);
      let n = 0;
      for (const id of ids) {
        const plat = String(jobPlatform.get(id) || '').toLowerCase();
        if (plat === p) n++;
      }
      return n;
    } catch (e) {
      return 0;
    }
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
      if (plat === 'youtube' && !canStartYoutubeNow()) {
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
    try {
      jobPlatform.set(id, job.platform);
    } catch (e) {}
    if (String(job.platform || '').toLowerCase() === 'youtube') markYoutubeStarted();
    try {
      startDownload(job.downloadId, job.url, job.platform, job.channel, job.title, job.metadata)
        .catch(() => {})
        .finally(() => {
          startingJobs.delete(id);
          runDownloadSchedulerSoon();
        });
    } catch (e) {
      updateDownloadStatus.run('error', 0, e.message, job.downloadId);
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
    try {
      jobPlatform.set(id, job.platform);
    } catch (e) {}
    if (String(job.platform || '').toLowerCase() === 'youtube') markYoutubeStarted();
    try {
      startDownload(job.downloadId, job.url, job.platform, job.channel, job.title, job.metadata)
        .catch(() => {})
        .finally(() => {
          startingJobs.delete(id);
          runDownloadSchedulerSoon();
        });
    } catch (e) {
      updateDownloadStatus.run('error', 0, e.message, job.downloadId);
      jobLane.delete(job.downloadId);
      startingJobs.delete(id);
    }
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
      const dur = (meta && Number.isFinite(meta.durationSeconds)) ? meta.durationSeconds : null;
      if (dur !== null && dur > 0 && dur <= SMALL_DURATION_SECONDS) {
        const lane = jobLane.get(downloadId);
        if (lane === 'heavy') {
          jobLane.set(downloadId, 'light');
          removeFromQueue(queuedHeavy, downloadId);
          queuedLight.push(downloadId);
        }
      }
    }).catch(() => {}).finally(() => {
      metadataProbeActive--;
      runMetadataProbeSchedulerSoon();
      runDownloadSchedulerSoon();
    });
  }
}

function getRuntimeActiveDownloadRows() {
  try {
    const ids = new Set();
    for (const id of activeProcesses.keys()) ids.add(id);
    for (const id of startingJobs) ids.add(id);
    const rows = [];
    for (const id of ids) {
      const row = getDownload.get(id);
      if (row) rows.push(row);
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

function rehydrateDownloadQueueWithMode(modeRaw, maxRowsRaw) {
  try {
    const mode = String(modeRaw || '').trim().toLowerCase();
    if (!mode || mode === '0' || mode === 'off' || mode === 'none' || mode === 'false' || mode === 'disabled') {
      return { success: true, mode: 'off', queued: 0 };
    }
    const maxRows = Math.max(0, parseInt(String(maxRowsRaw == null ? STARTUP_REHYDRATE_MAX_ROWS : maxRowsRaw), 10) || STARTUP_REHYDRATE_MAX_ROWS);
    const statusList = (mode === 'all')
      ? "('pending', 'queued', 'downloading', 'postprocessing')"
      : (mode === 'queued')
        ? "('pending', 'queued')"
        : (mode === 'post' || mode === 'postprocessing' || mode === 'postproc')
          ? "('postprocessing')"
          : "('downloading', 'postprocessing')";

    const rows = db.prepare(
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
    for (const row of (rows || [])) {
      const id = Number(row.id);
      if (!Number.isFinite(id)) continue;
      if (activeProcesses.has(id) || startingJobs.has(id) || queuedJobs.has(id)) continue;

      const url = String(row.url || '').trim();
      if (!url) continue;

      let parsedMeta = null;
      if (typeof row.metadata === 'string' && row.metadata.trim()) {
        try { parsedMeta = JSON.parse(row.metadata); } catch (e) { parsedMeta = null; }
      }
      if (url.startsWith('recording:') || (parsedMeta && parsedMeta.webdl_kind === 'recording')) continue;

      const storedPlatform = (row.platform && String(row.platform).trim()) ? String(row.platform).trim() : '';
      const platform = normalizePlatform(storedPlatform, url);

      const storedChannel = (row.channel && String(row.channel).trim()) ? String(row.channel).trim() : '';
      const channel = (storedChannel && storedChannel !== 'unknown') ? storedChannel : (deriveChannelFromUrl(platform, url) || 'unknown');

      const storedTitle = (row.title && String(row.title).trim()) ? String(row.title).trim() : '';
      const title = (storedTitle && storedTitle !== 'untitled') ? storedTitle : deriveTitleFromUrl(url);

      if (platform !== storedPlatform || channel !== storedChannel || title !== storedTitle) {
        updateDownloadBasics.run(platform, channel, title, id);
      }

      const metadata = parsedMeta;
      const lane = detectLane(platform);
      queuedJobs.set(id, { downloadId: id, url, platform, channel, title, metadata });
      jobLane.set(id, lane);
      jobPlatform.set(id, platform);
      if (lane === 'light') queuedLight.push(id);
      else queuedHeavy.push(id);
      queued++;
    }

    runDownloadSchedulerSoon();
    return { success: true, mode, queued };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function rehydrateDownloadQueue() {
  try {
    const mode = String(STARTUP_REHYDRATE_MODE || '').trim().toLowerCase();
    if (!mode || mode === '0' || mode === 'off' || mode === 'none' || mode === 'false' || mode === 'disabled') {
      return;
    }
    const statusList = (mode === 'all')
      ? "('pending', 'queued', 'downloading', 'postprocessing')"
      : (mode === 'post' || mode === 'postprocessing' || mode === 'postproc')
        ? "('postprocessing')"
        : "('downloading', 'postprocessing')";
    const rows = db.prepare(
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
      if (url.startsWith('recording:') || (parsedMeta && parsedMeta.webdl_kind === 'recording')) {
        continue;
      }

      const storedPlatform = (row.platform && String(row.platform).trim()) ? String(row.platform).trim() : '';
      const platform = normalizePlatform(storedPlatform, url);

      const storedChannel = (row.channel && String(row.channel).trim()) ? String(row.channel).trim() : '';
      const channel = (storedChannel && storedChannel !== 'unknown') ? storedChannel : (deriveChannelFromUrl(platform, url) || 'unknown');

      const storedTitle = (row.title && String(row.title).trim()) ? String(row.title).trim() : '';
      const title = (storedTitle && storedTitle !== 'untitled') ? storedTitle : deriveTitleFromUrl(url);

      if (platform !== storedPlatform || channel !== storedChannel || title !== storedTitle) {
        updateDownloadBasics.run(platform, channel, title, id);
      }

      const metadata = parsedMeta;

      const lane = detectLane(platform);
      queuedJobs.set(id, { downloadId: id, url, platform, channel, title, metadata });
      jobLane.set(id, lane);
      jobPlatform.set(id, platform);
      if (lane === 'light') queuedLight.push(id);
      else queuedHeavy.push(id);

      // Vermijd zware DB writes tijdens startup; scheduler pakt queue direct op.

      if (STARTUP_METADATA_PROBE_ENABLED && METADATA_PROBE_ENABLED && METADATA_PROBE_CONCURRENCY > 0 && platform !== 'onlyfans' && platform !== 'instagram' && platform !== 'wikifeet' && platform !== 'kinky' && platform !== 'tiktok' && platform !== 'reddit') {
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
// ========================
let isRecording = false;
let recordingProcess = null;
let currentRecordingFile = null;
let currentRecording = null;
let currentRecordingMeta = null;

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

// CORS
expressApp.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

expressApp.post('/api/queue/resume', (req, res) => {
  const mode = String(req.body && req.body.mode ? req.body.mode : 'all');
  const max = Number.isFinite(Number(req.body && req.body.max)) ? Number(req.body.max) : 500;
  const result = rehydrateDownloadQueueWithMode(mode, max);
  res.json(result);
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
  } catch (e) {}
}

io.on('connection', (socket) => {
  socket.emit('connection-state', {
    success: true,
    connected: true,
    serverTime: new Date().toISOString()
  });
  socket.emit('recording-status-changed', { isRecording });

  socket.on('webdl:request', async (message, ack) => {
    const reply = (payload) => {
      if (typeof ack === 'function') {
        try { ack(payload); } catch (e) {}
      }
    };

    const action = String(message && message.action ? message.action : '').trim().toLowerCase();
    const payload = message && message.payload && typeof message.payload === 'object'
      ? message.payload
      : {};

    if (!action) {
      reply({ success: false, error: 'Action ontbreekt' });
      return;
    }

    if (action === 'status') {
      reply({
        success: true,
        isRecording,
        activeDownloads: getRuntimeActiveDownloadRows().length,
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

expressApp.post('/media/open', (req, res) => {
  const kind = String(req.body && req.body.kind ? req.body.kind : '').toLowerCase();
  const id = parseInt(req.body && req.body.id != null ? req.body.id : '', 10);
  const action = String(req.body && req.body.action ? req.body.action : 'open').toLowerCase();
  if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'id is vereist' });

  try {
    let row = null;
    if (kind === 'd') row = getDownload.get(id);
    else if (kind === 's') row = db.prepare(`SELECT * FROM screenshots WHERE id=?`).get(id);
    else return res.status(400).json({ success: false, error: 'kind moet d of s zijn' });
    if (!row) return res.status(404).json({ success: false, error: 'niet gevonden' });

    const fp = String(row.filepath || '').trim();
    if (!fp || !safeIsInsideBaseDir(fp) || !fs.existsSync(fp)) return res.status(404).json({ success: false, error: 'bestand niet gevonden' });

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
    const rel = String(relPath || '').trim().replace(/^\/+/, '');
    if (!rel) return null;
    const abs = path.resolve(BASE_DIR, rel);
    if (!safeIsInsideBaseDir(abs)) return null;
    return abs;
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
  return res.sendFile(abs, (err) => {
    if (!err) return;
    if (res.headersSent) return;
    const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
    if (status === 404) return res.status(404).end();
    console.warn(`media path sendFile failed: ${err.message}`);
    return res.status(500).end();
  });
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
        try { scheduleThumbGeneration(abs); } catch (e) {}
        return res.status(404).end();
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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

expressApp.post('/media/open-path', (req, res) => {
  const rel = String(req.body && req.body.path ? req.body.path : '').trim();
  const action = String(req.body && req.body.action ? req.body.action : 'open').toLowerCase();
  const abs = safeResolveMediaRelPath(rel);
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'bestand niet gevonden' });
  try {
    const stat = fs.statSync(abs);
    if (action === 'finder') {
      if (stat.isDirectory && stat.isDirectory()) spawn('/usr/bin/open', [abs]);
      else spawn('/usr/bin/open', ['-R', abs]);
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
      } catch (e) {}
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
      try { fs.unlinkSync(srcPath); } catch (e2) {}
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
      } catch (e) {}
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
    const inBase = (
      abs === baseResolved ||
      abs.startsWith(baseResolved + path.sep) ||
      abs === baseReal ||
      abs.startsWith(baseReal + path.sep)
    );
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
    const stat = fs.statSync(abs);
    if (!safeIsInsideBaseDir(abs)) return null;

    if (stat.isFile() && isImagePath(abs)) {
      return abs;
    }

    const rootDir = stat.isDirectory() ? abs : path.dirname(abs);
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
    for (const e of entries) {
      if (!e || !e.isFile()) continue;
      if (!e.name || e.name.startsWith('.')) continue;
      const full = path.join(abs, e.name);
      if (!safeIsInsideBaseDir(full)) continue;
      if (!isImagePath(full)) continue;
      let score = 0;
      if (/(thumb|thumbnail|cover|poster)/i.test(e.name)) score += 1000;
      if (/\.(jpg|jpeg|png|webp)$/i.test(e.name)) score += 10;
      candidates.push({ name: e.name, path: full, score });
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

function isStableEnoughForVideoThumb(videoPath) {
  try {
    const st = fs.statSync(videoPath);
    const ageMs = Date.now() - (st.mtimeMs || 0);
    if ((st.size || 0) < 256 * 1024) return false;
    if (ageMs < 1500) return false;
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
          outJpgPath
        ];
        const proc = spawn(FFMPEG, args);
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
          try {
            if (code === 0 && outJpgPath && fs.existsSync(outJpgPath)) {
              const st = fs.statSync(outJpgPath);
              if (st && (st.size || 0) >= 12000) return resolve();
            }
          } catch (e) {}
          try { if (outJpgPath) fs.rmSync(outJpgPath, { force: true }); } catch (e) {}
          reject(new Error(stderr || `ffmpeg exit code ${code}`));
        });
        proc.on('error', reject);
      });
      return outJpgPath;
    } catch (e) {
      lastErr = (e && e.message) ? e.message : String(e);
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

function drainThumbGenQueueSoon() {
  if (thumbGenTimer) return;
  thumbGenTimer = setTimeout(() => {
    thumbGenTimer = null;
    drainThumbGenQueue();
  }, 150);
}

function scheduleThumbGeneration(targetPath) {
  try {
    if (!THUMB_GEN_CONCURRENCY) return;
    const abs = path.resolve(String(targetPath || ''));
    if (!abs) return;
    if (!safeIsInsideBaseDir(abs) || !fs.existsSync(abs)) return;
    if (thumbGenInflight.has(abs) || thumbGenQueued.has(abs)) return;
    if (thumbGenQueue.length >= THUMB_GEN_MAX_QUEUE) return;
    thumbGenQueued.add(abs);
    thumbGenQueue.push(abs);
    drainThumbGenQueueSoon();
  } catch (e) {}
}

function drainThumbGenQueue() {
  try {
    while (thumbGenActive < THUMB_GEN_CONCURRENCY && thumbGenQueue.length) {
      const abs = thumbGenQueue.shift();
      if (!abs) continue;
      thumbGenQueued.delete(abs);
      if (thumbGenInflight.has(abs)) continue;
      thumbGenInflight.add(abs);
      thumbGenActive++;
      pickOrCreateThumbPath(abs, { allowGenerate: true })
        .catch(() => {})
        .finally(() => {
          thumbGenActive = Math.max(0, thumbGenActive - 1);
          thumbGenInflight.delete(abs);
          drainThumbGenQueueSoon();
        });
    }
  } catch (e) {}
}

async function pickOrCreateThumbPath(targetPath, opts) {
  try {
    if (!targetPath) return null;
    const abs = path.resolve(String(targetPath));
    if (!safeIsInsideBaseDir(abs) || !fs.existsSync(abs)) return null;
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
      } catch (e) {}

      if (stat.isFile() && isVideoPath(abs)) {
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
        } catch (e) {}

        const out = makeVideoThumbPath(abs);
        if (!out || !safeIsInsideBaseDir(out)) return null;
        if (fs.existsSync(out)) {
          try {
            const st2 = fs.statSync(out);
            if (st2 && (st2.size || 0) >= 12000) return out;
            try { fs.rmSync(out, { force: true }); } catch (e) {}
          } catch (e) {}
        }
        if (!isStableEnoughForVideoThumb(abs)) return null;
        if (!allowGenerate) return null;
        return await extractVideoThumbnail(abs, out);
      }

      if (stat.isDirectory()) {
        const pickedShallow = pickThumbnailFileShallow(abs);
        if (pickedShallow) return pickedShallow;
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
              if (st2 && (st2.size || 0) >= 12000) return out;
              try { fs.rmSync(out, { force: true }); } catch (e) {}
            } catch (e) {}
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
      } catch (e) {}
      return outPath;
    } finally {
      try { if (inflight && inflight.delete) inflight.delete(abs); } catch (e) {}
    }
  } catch (e) {
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

function applyRecordingLockCrop({ rawFilePath, finalFilePath, cmdText, cropWidth, cropHeight }) {
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
      finalFilePath
    ];

    if (POSTPROCESS_THREADS) {
      args.splice(args.indexOf('-i') + 2, 0, '-threads', POSTPROCESS_THREADS);
    }

    if (VIDEO_CODEC === 'h264_videotoolbox') {
      args.splice(args.indexOf('-pix_fmt'), 0, '-realtime', '1', '-prio_speed', '1');
    }

    const proc = spawnNice(FFMPEG, args);

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      try { fs.unlinkSync(cmdFile); } catch (e) {}
      if (code === 0) return resolve();
      reject(new Error(stderr || `ffmpeg exit code ${code}`));
    });

    proc.on('error', (err) => {
      try { fs.unlinkSync(cmdFile); } catch (e) {}
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
        'pipe:1'
      ];
      const proc = spawn(FFMPEG, args);
      const chunks = [];
      let bytes = 0;
      let done = false;

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try { proc.kill('SIGKILL'); } catch (e) {}
        resolve(null);
      }, 7000);

      proc.stdout.on('data', (d) => {
        chunks.push(d);
        bytes += d.length;
        if (bytes >= 16 * 16) {
          try { proc.kill('SIGKILL'); } catch (e) {}
        }
      });

      proc.on('close', () => {
        if (done) return;
        done = true;
        try { clearTimeout(timer); } catch (e) {}
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
        try { clearTimeout(timer); } catch (e) {}
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
  const s2 = await probeFrameGrayStats(fp, (Number.isFinite(durationSec) && durationSec > 6) ? 3 : 0.7);
  const blackLikely = !!(
    (Number.isFinite(durationSec) ? durationSec > 1 : true) &&
    ((s1 && s1.max <= 8 && s1.avg <= 4) || (s2 && s2.max <= 8 && s2.avg <= 4))
  );
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
  } catch (e) {}
  try {
    if (diag && diag.black_likely) console.warn('Recording diagnostic: black video likely', { file: String(filePath || '') });
  } catch (e) {}
  return diag;
}

function transcodeToFinalCutMov(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a?',
      '-c:v', FINALCUT_VIDEO_CODEC,
      '-pix_fmt', 'yuv420p'
    ];

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
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(stderr || `ffmpeg exit code ${code}`));
    });
    proc.on('error', reject);
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
  if (/tiktok\.com|tiktokv\.com/i.test(u)) return 'tiktok';

  try {
    const host = new URL(u).hostname.toLowerCase();
    const cleaned = host
      .replace(/^www\./, '')
      .replace(/^m\./, '')
      .replace(/^mobile\./, '');
    const parts = cleaned.split('.').filter(Boolean);
    if (parts.length === 0) return 'other';
    if (parts.length === 1) {
      const one = parts[0].replace(/[^a-z0-9_-]+/g, '').slice(0, 30);
      return one || 'other';
    }

    const tld = parts[parts.length - 1];
    const sld = parts[parts.length - 2];
    const secondLevelTlds = new Set(['co', 'com', 'net', 'org', 'gov', 'edu']);
    const base = (tld.length === 2 && secondLevelTlds.has(sld) && parts.length >= 3)
      ? parts[parts.length - 3]
      : sld;
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
  'tiktok',
  'other'
]);

function normalizePlatform(platform, url) {
  const p = (typeof platform === 'string') ? platform.trim().toLowerCase() : '';
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

function parseFootFetishForumThreadInfo(input) {
  try {
    const raw = String(input || '');
    if (!raw) return null;
    const match = raw.match(/footfetishforum\.com\/threads\/([^\/\?#]+)\.(\d+)(?:\/|\?|#|$)/i);
    if (!match) return null;
    const slug = String(match[1] || '').trim();
    const id = String(match[2] || '').trim();
    const name = slug
      .split('-')
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
      .trim();
    return { slug, id, name: name || `thread_${id}` };
  } catch (e) {
    return null;
  }
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
    const m = u.match(/kinky\.nl\/([^\/\?#]+)/i);
    if (m) return m[1];
  }

  if (platform === 'tiktok') {
    const m = u.match(/tiktok\.com\/@([^\/\?#]+)/i);
    if (m) return `@${m[1]}`;
  }

  if (platform === 'chaturbate') {
    const m = u.match(/chaturbate\.com\/([^\/\?#]+)/i);
    if (m) return m[1];
  }

  return null;
}

function getDownloadDir(platform, channel, title) {
  const safePlatform = sanitizeName(platform || 'other');
  const safeChannel = sanitizeName(channel || 'unknown');
  const safeTitle = sanitizeName(title || 'untitled');
  const dir = String(platform || '').toLowerCase() === 'footfetishforum' && safeChannel && safeTitle && safeChannel === safeTitle
    ? path.join(BASE_DIR, safePlatform, safeChannel)
    : path.join(BASE_DIR, safePlatform, safeChannel, safeTitle);
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
    return (channelHint && channelHint !== 'unknown') ? String(channelHint).trim() : String(url || '').trim();
  }
}

function fetchMetadata(url) {
  return new Promise((resolve, reject) => {
    const cookieArgs = getYtDlpCookieArgs('metadata');
    const args = [
      ...cookieArgs,
      '--dump-json',
      '--no-download',
      String(url || '')
    ];
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
      String(url || '')
    ];
    const proc = spawnNice(YT_DLP, args);
    let stdoutAll = '';
    let stderrAll = '';
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { proc.kill('SIGTERM'); } catch (e) {}
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) {} }, 2500);
      reject(new Error(`yt-dlp metadata timeout after ${timeoutMs}ms`));
    }, Math.max(1000, Number(timeoutMs) || 20000));

    proc.stdout.on('data', (d) => { stdoutAll += d.toString(); });
    proc.stderr.on('data', (d) => { stderrAll += d.toString(); });

    const finish = (fn) => {
      if (done) return;
      done = true;
      try { clearTimeout(timer); } catch (e) {}
      fn();
    };

    proc.on('close', (code) => finish(() => {
      if (code !== 0) {
        const errMsg = String(stderrAll || '').trim() || `yt-dlp metadata exit code: ${code}`;
        const certFailed = /CERTIFICATE_VERIFY_FAILED|certificate\s+verify\s+failed/i.test(errMsg);
        if (!noCheckCertificates && allowRetryNoCheckCertificates && certFailed) {
          return fetchMetadataWithTimeout(url, timeoutMs, { ...opt, noCheckCertificates: true, allowRetryNoCheckCertificates: false })
            .then(resolve)
            .catch(reject);
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

async function resolveMetadata(url, metadata = {}) {
  const resolved = { ...metadata };
  if (url && !resolved.url) resolved.url = url;
  const resolvedUrl = resolved.url || url || '';
  resolved.platform = normalizePlatform(resolved.platform, resolvedUrl);

  const needsFetch = resolvedUrl && (
    !resolved.title || resolved.title === 'untitled' ||
    !resolved.channel || resolved.channel === 'unknown'
  );

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
expressApp.get('/status', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const runtimeActive = getRuntimeActiveDownloadRows();
  const activeProcIds = new Set(Array.from(activeProcesses.keys()));
  const startingOnlyIds = Array.from(startingJobs).filter((id) => !activeProcIds.has(id));
  const heavyLimit = Math.max(0, HEAVY_DOWNLOAD_CONCURRENCY);
  const lightLimit = Math.max(0, LIGHT_DOWNLOAD_CONCURRENCY);
  const heavyActive = activeLaneCount('heavy');
  const lightActive = activeLaneCount('light');
  res.json({
    status: 'running',
    isRecording,
    activeDownloads: runtimeActive.length,
    db_active_downloads: null,
    db_active_by_status: null,
    db_in_progress_downloads: null,
    queues: {
      heavy: { active: heavyActive, limit: heavyLimit, queued: queuedHeavy.length },
      light: { active: lightActive, limit: lightLimit, queued: queuedLight.length }
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
    youtube: getYoutubeRuntimeConfig(),
    serverTime: new Date().toISOString(),
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
      concurrency: Number.isFinite(initialYoutubeConcurrency) ? Math.max(0, initialYoutubeConcurrency) : 4,
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

function computeStuckDownloadRepairReport({ minAgeMinutes = 30, max = 400, markError = false, debugLimit = 80, mode = 'in_progress' } = {}) {
  const now = Date.now();
  const minAgeMs = Math.max(0, Number(minAgeMinutes) || 0) * 60 * 1000;

  // Only treat *actually running* items as runtime-active.
  // queuedJobs are DB-derived and can contain many items; we still want to repair them if output exists.
  const runningIds = new Set();
  for (const id of activeProcesses.keys()) runningIds.add(id);
  for (const id of startingJobs) runningIds.add(id);

  const allRows = getActiveDownloads.all();
  const wantInProgress = String(mode || '').toLowerCase() !== 'all';
  const rows = wantInProgress
    ? allRows.filter((r) => String(r && r.status ? r.status : '') === 'downloading' || String(r && r.status ? r.status : '') === 'postprocessing')
    : allRows;
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
    if (minAgeMs > 0 && ageRefMs && (now - ageRefMs) < minAgeMs) {
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
    jobLane.delete(id);
  } catch (e) {}
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

expressApp.post('/api/repair/stuck-downloads', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const body = req.body || {};
  const minAgeMinutes = parseInt(String(body.minAgeMinutes != null ? body.minAgeMinutes : (body.min_age_minutes != null ? body.min_age_minutes : '30')), 10);
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
      if (a.to === 'completed') updateDownloadStatus.run('completed', 100, null, a.id);
      else if (a.to === 'error') updateDownloadStatus.run('error', 0, String(a.reason || 'stuck'), a.id);
      cleanupSchedulerForId(a.id);
      applied.push(a);
    } catch (e) {}
  }

  try { runDownloadSchedulerSoon(); } catch (e) {}
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

let addonBuildInFlight = null;

function ensureFirefoxAddonBuilt(options = {}) {
  if (addonBuildInFlight) return addonBuildInFlight;

  addonBuildInFlight = new Promise((resolve, reject) => {
    try {
      const opt = (options && typeof options === 'object') ? options : {};
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
      let newest = fs.statSync(manifestPath).mtimeMs;
      if (fs.existsSync(toolbarPath)) newest = Math.max(newest, fs.statSync(toolbarPath).mtimeMs);
      if (fs.existsSync(backgroundPath)) newest = Math.max(newest, fs.statSync(backgroundPath).mtimeMs);

      if (!force && outStat && outMtime >= newest) return resolve();

      const tmpOut = path.join(os.tmpdir(), `webdl-addon-${Date.now()}-${Math.random().toString(36).slice(2)}.xpi`);
      try { fs.rmSync(tmpOut, { force: true }); } catch (e) {}

      const zipProc = spawn('/usr/bin/zip', ['-r', '-q', tmpOut, '.', '-x', '*.DS_Store', '__MACOSX/*'], {
        cwd: ADDON_SOURCE_DIR
      });
      const buildTimeout = setTimeout(() => {
        try { zipProc.kill('SIGKILL'); } catch (e) {}
      }, buildTimeoutMs);
      let stderr = '';
      zipProc.stderr.on('data', (d) => { stderr += d.toString(); });
      zipProc.on('error', (err) => reject(err));
      zipProc.on('close', (code) => {
        clearTimeout(buildTimeout);
        if (code !== 0) {
          try { fs.rmSync(tmpOut, { force: true }); } catch (e) {}
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
          try { fs.rmSync(tmpOut, { force: true }); } catch (e2) {}
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
  if (isRecording || recordingProcess) return res.json({ success: false, error: 'Er loopt al een opname' });

  const { metadata = {}, crop, lock } = req.body || {};
  let resolved = metadata;
  try {
    resolved = await resolveMetadata(metadata.url, metadata);
  } catch (e) {
    // fallback blijft metadata
  }
  const platform = resolved.platform || 'other';
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

  const inputPixelFormatRaw = platform === 'chaturbate' ? (CHB_RECORDING_INPUT_PIXEL_FORMAT || RECORDING_INPUT_PIXEL_FORMAT) : RECORDING_INPUT_PIXEL_FORMAT;
  const inputPixelFormat = String(inputPixelFormatRaw || '').trim();
  const recordingVideoCodec = platform === 'chaturbate' ? (CHB_RECORDING_VIDEO_CODEC || VIDEO_CODEC) : VIDEO_CODEC;

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
    '-i', inputDevice
  ];

  if (inputPixelFormat && inputPixelFormat.toLowerCase() !== 'auto') {
    args.splice(args.indexOf('-capture_cursor'), 0, '-pixel_format', inputPixelFormat);
  }

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
    const preset = platform === 'chaturbate' ? (CHB_RECORDING_X264_PRESET || LIBX264_PRESET) : LIBX264_PRESET;
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
    logStream.end();
    isRecording = false;
    recordingProcess = null;
    broadcastRecordingState();
  });

  recordingProcess.on('error', (err) => {
    console.error(`ffmpeg fout: ${err.message}`);
    logStream.end();
    isRecording = false;
    recordingProcess = null;
    broadcastRecordingState();
  });

  isRecording = true;
  broadcastRecordingState();
  currentRecordingFile = recordingFilePath;
  console.log(`🔴 Opname gestart: ${recordingFilePath}`);
  res.json({ success: true, action: 'start-recording', file: filename, dir, meta: resolved, lock: lockMode, rawFile: lockMode ? path.basename(rawFilePath) : undefined, finalFile: path.basename(finalFilePath), input: { device: inputDevice, video_name: resolvedVideoName, audio_name: resolvedAudioName, pixel_format: inputPixelFormat } });
});

expressApp.post('/recording/crop-update', (req, res) => {
  if (!isRecording || !currentRecording || !currentRecording.lock) {
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
  if (!isRecording || !recordingProcess) {
    return res.json({ success: false, error: 'Er loopt geen opname' });
  }

  const proc = recordingProcess;
  const lockJob = (currentRecording && currentRecording.lock) ? {
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
    recordingProcess = null;
    isRecording = false;
    currentRecording = null;
    broadcastRecordingState();
  };

  const softTimeout = setTimeout(() => {
    if (recordingProcess) { recordingProcess.kill('SIGINT'); }
  }, 20000);

  const hardTimeout = setTimeout(() => {
    if (recordingProcess) {
      console.warn('ffmpeg stop timeout, force kill');
      recordingProcess.kill('SIGKILL');
      cleanup();
      finish(false, 'Opname stop timeout');
    }
  }, 40000);

  proc.once('close', () => {
    clearTimeout(softTimeout);
    clearTimeout(hardTimeout);
    cleanup();

    const meta = (lockJob && lockJob.meta) ? lockJob.meta : currentRecordingMeta;

    if (lockJob) {
      try {
        runRecordingDiagnosticsToLog(lockJob.rawFilePath, lockJob.logFile).catch(() => {});
      } catch (e) {}

      let dbId = null;
      try {
        const fp = String(lockJob.rawFilePath || '');
        const exists = fp && fs.existsSync(fp);
        const size = exists ? fs.statSync(fp).size : 0;
        const recordMeta = {
          webdl_kind: 'recording',
          webdl_recording: { lock: true, raw: lockJob.rawFilePath, final: lockJob.finalFilePath, log: lockJob.logFile, page_url: meta && meta.pageUrl ? meta.pageUrl : null }
        };
        const ins = insertCompletedDownload.run(
          String(meta && meta.recordingUrl ? meta.recordingUrl : '').trim() || `recording:${Date.now()}`,
          String(meta && meta.platform ? meta.platform : 'other'),
          String(meta && meta.channel ? meta.channel : 'unknown'),
          String(meta && meta.title ? meta.title : 'recording'),
          path.basename(fp || lockJob.finalFilePath || ''),
          fp,
          size,
          'mp4',
          'postprocessing',
          50,
          JSON.stringify(recordMeta)
        );
        dbId = ins && ins.lastInsertRowid ? ins.lastInsertRowid : null;
      } catch (e) {}

      finish(true, null, { processing: true, rawFile: lockJob.rawFilePath, finalFile: lockJob.finalFilePath, logFile: lockJob.logFile });
      (async () => {
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
          const maxX = Math.floor(Math.max(0, (size.width - safeW)) / 2) * 2;
          const maxY = Math.floor(Math.max(0, (size.height - safeH)) / 2) * 2;
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
        } catch (e) {}

        await applyRecordingLockCrop({
          rawFilePath: lockJob.rawFilePath,
          finalFilePath: lockJob.finalFilePath,
          cmdText,
          cropWidth: safeW,
          cropHeight: safeH
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
            updateDownload.run('completed', 100, fp, path.basename(fp), finalSize, 'mp4', JSON.stringify(recordMeta), null, dbId);
          } catch (e) {}
        }

        try {
          fs.appendFileSync(lockJob.logFile, `\n[WEBDL] LOCK CROP done: ${lockJob.finalFilePath}\n`);
        } catch (e) {}
      })().catch((e) => {
        if (dbId) {
          try {
            updateDownloadStatus.run('error', 0, e.message, dbId);
          } catch (err) {}
        }
        try {
          fs.appendFileSync(lockJob.logFile, `\n[WEBDL] LOCK CROP error: ${e.message}\n`);
        } catch (err) {}
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
      insertCompletedDownload.run(
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
    } catch (e) {}

    try {
      const lf = meta && meta.logFile ? meta.logFile : null;
      runRecordingDiagnosticsToLog(file, lf).catch(() => {});
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
  const { url, metadata, force } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: 'URL is vereist' });
  const forceDuplicates = force === true;

  const metaPlatform = (metadata && typeof metadata.platform === 'string') ? metadata.platform : null;
  const effectiveUrl = String(url || '');

  const pageUrl = (metadata && typeof metadata.url === 'string') ? metadata.url.trim() : '';
  const originPlatform = normalizePlatform(metaPlatform, pageUrl || effectiveUrl);
  const pinToOrigin = !!(originPlatform === 'footfetishforum' && pageUrl && pageUrl !== effectiveUrl && isFootfetishforumThreadUrl(pageUrl));
  const detectedPlatform = detectPlatform(effectiveUrl);

  const platform = pinToOrigin ? originPlatform : normalizePlatform(metaPlatform, effectiveUrl);
  const channel = pinToOrigin
    ? ((metadata && metadata.channel) ? metadata.channel : (deriveChannelFromUrl(originPlatform, pageUrl) || 'unknown'))
    : ((metadata && metadata.channel) ? metadata.channel : (deriveChannelFromUrl(platform, effectiveUrl) || 'unknown'));
  const title = pinToOrigin
    ? ((metadata && metadata.title) ? metadata.title : deriveTitleFromUrl(pageUrl))
    : ((metadata && metadata.title) ? metadata.title : deriveTitleFromUrl(effectiveUrl));

  const allowRedditRerun = platform === 'reddit' && isRedditRollingTargetUrl(effectiveUrl);
  const existing = findReusableDownloadByUrl.get(effectiveUrl);
  if (!forceDuplicates && existing && existing.id && !(allowRedditRerun && String(existing.status || '') === 'completed')) {
    return res.json({
      success: true,
      downloadId: existing.id,
      platform: existing.platform || platform,
      channel: existing.channel || channel,
      title: existing.title || title,
      duplicate: true,
      status: existing.status || null
    });
  }

  const result = insertDownload.run(effectiveUrl, platform, channel, title);
  const downloadId = result.lastInsertRowid;

  try {
    const pageUrl = (metadata && typeof metadata.url === 'string') ? metadata.url.trim() : '';
    if (pageUrl && pageUrl !== effectiveUrl) {
      updateDownloadSourceUrl.run(pageUrl, downloadId);
    }
  } catch (e) {}

  try {
    const thumb = (metadata && typeof metadata.thumbnail === 'string') ? metadata.thumbnail.trim() : '';
    if (thumb) updateDownloadThumbnail.run(thumb, downloadId);
  } catch (e) {}

  console.log(`\n📥 Download gestart #${downloadId}: ${effectiveUrl}`);
  console.log(`   Platform: ${platform} | Kanaal: ${channel} | Titel: ${title}`);

  res.json({ success: true, downloadId, platform, channel, title });

  const jobMetadata = (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) ? { ...metadata } : {};
  if (forceDuplicates) jobMetadata.webdl_force = true;
  if (!jobMetadata.webdl_direct_hint && jobMetadata.webdl_direct_hints && typeof jobMetadata.webdl_direct_hints === 'object') {
    const directHint = jobMetadata.webdl_direct_hints[effectiveUrl];
    if (typeof directHint === 'string' && directHint.trim()) jobMetadata.webdl_direct_hint = directHint.trim();
  }
  if (pinToOrigin) {
    jobMetadata.webdl_pin_context = true;
    jobMetadata.origin_thread = { url: pageUrl, platform: originPlatform, channel, title };
    jobMetadata.webdl_media_url = effectiveUrl;
    jobMetadata.webdl_detected_platform = detectedPlatform;
  }
  enqueueDownloadJob(downloadId, effectiveUrl, platform, channel, title, jobMetadata);
});

expressApp.post('/reddit/index', async (req, res) => {
  try {
    const body = req.body || {};
    const seedUrl = String(body.url || '').trim();
    if (!seedUrl) return res.status(400).json({ success: false, error: 'url is vereist' });
    if (!isRedditFamilyUrl(seedUrl)) return res.status(400).json({ success: false, error: 'Geen Reddit URL' });

    const result = await indexRedditSeedUrl(seedUrl, {
      maxItems: body.maxItems,
      maxPages: body.maxPages
    });
    return res.json({ success: true, ...result });
  } catch (e) {
    const seedUrl = String((req.body && req.body.url) || '').trim();
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

expressApp.post('/download/batch', async (req, res) => {
  const { urls, metadata, force } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ success: false, error: 'urls is vereist' });
  }
  const forceDuplicates = force === true;

  const metaPlatform = (metadata && typeof metadata.platform === 'string') ? metadata.platform : null;
  const pageUrl = (metadata && typeof metadata.url === 'string') ? metadata.url.trim() : '';
  const originPlatform = normalizePlatform(metaPlatform, pageUrl || '');
  const pinFffOrigin = !!(originPlatform === 'footfetishforum' && pageUrl && isFootfetishforumThreadUrl(pageUrl));
  const originChannel = (metadata && metadata.channel) ? metadata.channel : (deriveChannelFromUrl(originPlatform, pageUrl) || 'unknown');
  const originTitle = (metadata && metadata.title) ? metadata.title : deriveTitleFromUrl(pageUrl);

  const unique = [];
  const seen = new Set();
  for (const u of urls) {
    const raw = (typeof u === 'string' ? u.trim() : '');
    const s = isRedditFamilyUrl(raw) ? canonicalizeRedditCandidateUrl(raw) : raw;
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    unique.push(s);
  }

  const created = [];
  for (const u of unique) {
    const pinToOrigin = !!(pinFffOrigin && pageUrl && pageUrl !== u);
    const detectedPlatform = detectPlatform(u);
    const platform = pinToOrigin ? originPlatform : normalizePlatform(metaPlatform, u);
    const channel = pinToOrigin ? originChannel : ((metadata && metadata.channel) ? metadata.channel : (deriveChannelFromUrl(platform, u) || 'unknown'));
    const title = pinToOrigin ? originTitle : ((metadata && metadata.title) ? metadata.title : deriveTitleFromUrl(u));
    const allowRedditRerun = platform === 'reddit' && isRedditRollingTargetUrl(u);

    const existing = findReusableDownloadByUrl.get(u);
    if (!forceDuplicates && existing && existing.id && !(allowRedditRerun && String(existing.status || '') === 'completed')) {
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

    const result = insertDownload.run(u, platform, channel, title);
    const downloadId = result.lastInsertRowid;

    try {
      const pageUrl = (metadata && typeof metadata.url === 'string') ? metadata.url.trim() : '';
      if (pageUrl && pageUrl !== u) {
        updateDownloadSourceUrl.run(pageUrl, downloadId);
      }
    } catch (e) {}

    created.push({ downloadId, url: u, platform, channel, title });
    const jobMetadata = (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) ? { ...metadata } : {};
    if (forceDuplicates) jobMetadata.webdl_force = true;
    if (!jobMetadata.webdl_direct_hint && jobMetadata.webdl_direct_hints && typeof jobMetadata.webdl_direct_hints === 'object') {
      const directHint = jobMetadata.webdl_direct_hints[u];
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

  res.json({ success: true, downloads: created });
});

async function startDownload(downloadId, url, platform, channel, title, metadata) {
  const abort = abortKind(downloadId);
  if (abort) {
    applyAbortStatus(downloadId, abort);
    return;
  }

  const forceDuplicates = !!(metadata && typeof metadata === 'object' && !Array.isArray(metadata) && (metadata.webdl_force === true || metadata.force === true));

  try {
    const allowRedditRerun = platform === 'reddit' && isRedditRollingTargetUrl(url);
    const reusable = findReusableDownloadByUrlExcludingId.get(url, downloadId);
    if (!forceDuplicates && reusable && reusable.id) {
      if (allowRedditRerun && String(reusable.status || '') === 'completed') {
        // Voor r/<subreddit> en u/<user> willen we herhaalde scans toestaan.
      } else {
      if (reusable.status === 'completed' && reusable.filepath) {
        updateDownload.run(
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
        updateDownloadStatus.run('cancelled', 0, `Duplicate URL; al actief als #${reusable.id}`, downloadId);
      }
      return;
      }
    }
  } catch (e) {}

  if (platform === 'onlyfans') {
    return startOfscraperDownload(downloadId, url, platform, channel, title, metadata);
  }

  if (platform === 'instagram') {
    return startInstaloaderDownload(downloadId, url, platform, channel, title, metadata);
  }

  if (platform === 'reddit') {
    return startRedditDlDownload(downloadId, url, platform, channel, title, metadata);
  }

  if (platform === 'wikifeet' || platform === 'wikifeetx' || platform === 'kinky' || (platform === 'tiktok' && isTikTokPhotoUrl(url))) {
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
        try { updateDownloadUrl.run(resolved, downloadId); } catch (e) {}
        const nextMeta = (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) ? { ...metadata } : {};
        if (!nextMeta.webdl_input_url) nextMeta.webdl_input_url = url;
        nextMeta.webdl_resolved_url = resolved;
        return startDirectFileDownload(downloadId, resolved, platform, channel, title, nextMeta);
      }
    } catch (e) {}
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
      updateDownloadStatus.run('cancelled', 0, null, downloadId);
      return;
    }

    const target = toRedditDlTarget(url);
    if (!target) {
      updateDownloadStatus.run('error', 0, 'Reddit URL wordt niet ondersteund', downloadId);
      return;
    }

    if (!REDDIT_DL || (REDDIT_DL.includes('/') && !fs.existsSync(REDDIT_DL))) {
      updateDownloadStatus.run('error', 0, `reddit-dl niet gevonden: ${REDDIT_DL}`, downloadId);
      return;
    }

    const outChannel = (channel && channel !== 'unknown') ? channel : (deriveChannelFromUrl('reddit', url) || 'unknown');
    const dir = getDownloadDirChannelOnly('reddit', outChannel);
    try { updateDownloadFilepath.run(dir, downloadId); } catch (e) {}
    updateDownloadStatus.run('downloading', 0, null, downloadId);

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
        `password = ${REDDIT_DL_PASSWORD}`
      ].join('\n') + '\n', 'utf8');
      createdAuthFile = true;
    }

    const args = [
      '--no-prompt',
      '--ffmpeg', resolveUsableFfmpegPath(),
      '--log-level', 'warn',
      '-o', dir
    ];
    if (authFilePath) args.push('-x', authFilePath);
    args.push(target);

    const result = await new Promise((resolve) => {
      const proc = spawnNice(REDDIT_DL, args);
      activeProcesses.set(downloadId, proc);
      try { startingJobs.delete(downloadId); } catch (e) {}
      let stderr = '';
      let stdout = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      const finish = (code) => {
        activeProcesses.delete(downloadId);
        if (createdAuthFile) {
          try { fs.unlinkSync(authFilePath); } catch (e) {}
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
      updateDownload.run('completed', 100, dir, filenameLabel, safeTotalBytes, '', JSON.stringify(metaObj), null, downloadId);
      return;
    }

    if (result.code === 0 && safeCount === 0) {
      const stderrMsg = stripAnsiCodes(result.stderr).trim();
      const stdoutMsg = stripAnsiCodes(result.stdout).trim();
      const details = stderrMsg || stdoutMsg || 'reddit-dl afgerond maar geen media-bestanden gevonden';
      const blocked = /\b403\b\s*-\s*blocked|about\.json\?raw_json=1|failed to fetch user|failed to fetch subreddit/i.test(details);
      if (blocked) {
        const authHint = 'Reddit blokkeert anonieme requests. Configureer WEBDL_REDDIT_AUTH_FILE (auth.conf) of WEBDL_REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD.';
        updateDownloadStatus.run('error', 0, `Reddit auth vereist: ${authHint}`.slice(0, 1200), downloadId);
      } else {
        updateDownloadStatus.run('error', 0, `Reddit: geen media gevonden in output (${dir}). ${details}`.slice(0, 1200), downloadId);
      }
      return;
    }

    const stderrMsg = stripAnsiCodes(result.stderr).trim();
    const stdoutMsg = stripAnsiCodes(result.stdout).trim();
    const details = stderrMsg || stdoutMsg || `reddit-dl exit code: ${result.code}`;
    const blocked = /\b403\b\s*-\s*blocked|about\.json\?raw_json=1|failed to fetch user|failed to fetch subreddit/i.test(details);
    if (blocked) {
      const authHint = 'Reddit blokkeert anonieme requests. Configureer WEBDL_REDDIT_AUTH_FILE (auth.conf) of WEBDL_REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD.';
      updateDownloadStatus.run('error', 0, `Reddit auth vereist: ${authHint}`.slice(0, 1200), downloadId);
    } else {
      updateDownloadStatus.run('error', 0, details.slice(0, 1200), downloadId);
    }
  } catch (err) {
    updateDownloadStatus.run('error', 0, err.message, downloadId);
  }
}

function looksLikeDirectFileUrl(url) {
  try {
    const u = new URL(String(url || ''));
    const host = String(u.hostname || '').toLowerCase();

    if (host.includes('tiktokcdn.com') || host.includes('ttwstatic.com')) return true;
    if (host.includes('cdninstagram.com') || host.includes('fbcdn.net')) return true;

    const p = (u.pathname || '').toLowerCase();
    const m = p.match(/\.([a-z0-9]{1,8})$/i);
    if (!m) {
      const suffix = p.match(/[-_](zip|rar|7z|tar|gz|jpg|jpeg|png|gif|webp|bmp|mp4|mov|m4v|webm|mkv|mp3|m4a|wav|flac|pdf)$/i);
      return !!suffix;
    }
    const ext = m[1];
    const direct = new Set([
      'zip', 'rar', '7z', 'tar', 'gz',
      'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
      'mp4', 'mov', 'm4v', 'webm', 'mkv',
      'mp3', 'm4a', 'wav', 'flac',
      'pdf'
    ]);
    return direct.has(ext);
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
    return false;
  } catch (e) {
    return false;
  }
}

async function fetchTextWithTimeout(url, timeoutMs = 15000, referer = '') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try { ctrl.abort(); } catch (e) {}
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

function normalizeHtmlExtractedUrl(raw, baseUrl) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const decoded = s.replace(/&amp;/g, '&');
  try {
    return new URL(decoded, baseUrl).toString();
  } catch (e) {
    return '';
  }
}

function extractOpenGraphMediaUrl(html, baseUrl) {
  try {
    const h = String(html || '');
    const patterns = [
      /<meta\s+[^>]*(?:property|name)=["']og:video:url["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<meta\s+[^>]*(?:property|name)=["']og:video["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<meta\s+[^>]*(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<meta\s+[^>]*(?:property|name)=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i
    ];
    for (const re of patterns) {
      const m = h.match(re);
      if (m && m[1]) {
        const u = normalizeHtmlExtractedUrl(m[1], baseUrl);
        if (u) return u;
      }
    }

    const urls = [];
    for (const m of h.matchAll(/https?:\/\/[^"'\s<>]+/gi)) {
      if (m && m[0]) urls.push(m[0]);
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
      .replace(/\.md\.(jpg|jpeg|png|gif|webp)$/i, '.$1')
      .replace(/\.th\.(jpg|jpeg|png|gif|webp)$/i, '.$1');
    try {
      const u = new URL(out);
      const host = String(u.hostname || '').toLowerCase();
      const p = String(u.pathname || '');
      if ((host === 'upload.footfetishforum.com' || host.endsWith('.footfetishforum.com')) && /\/images\//i.test(p)) {
        u.pathname = p
          .replace(/\.md\.(jpg|jpeg|png|gif|webp)$/i, '.$1')
          .replace(/\.th\.(jpg|jpeg|png|gif|webp)$/i, '.$1');
        out = u.toString();
      }
      if (host.endsWith('pixhost.to')) {
        u.pathname = p.replace(/\/thumbs\//i, '/images/');
        out = u.toString();
      }
    } catch (e) {}
    return out;
  } catch (e) {
    return String(rawUrl || '').trim();
  }
}

function scoreDirectMediaCandidate(url) {
  try {
    const s = upgradeKnownLowQualityMediaUrl(url);
    if (!s || !looksLikeDirectFileUrl(s)) return -1000;
    let score = 0;
    if (/\.(mp4|mov|m4v|webm|mkv)(?:$|[?#])/i.test(s)) score += 120;
    else if (/\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|avif|heic|heif)(?:$|[?#])/i.test(s)) score += 80;
    if (/upload\.footfetishforum\.com\/images\//i.test(s)) score += 40;
    if (/pixhost\.to\/images\//i.test(s)) score += 35;
    if (/\.(?:th|md)\.(jpg|jpeg|png|gif|webp)(?:$|[?#])/i.test(s)) score -= 160;
    if (/\/thumbs\//i.test(s)) score -= 180;
    if (/(?:^|[^a-z])(thumb|thumbnail|preview|poster|cover|small)(?:[^a-z]|$)/i.test(s)) score -= 120;
    return score;
  } catch (e) {
    return -1000;
  }
}

function extractDirectMediaCandidates(html, baseUrl) {
  try {
    const h = String(html || '');
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
    for (const re of metaPatterns) {
      for (const m of h.matchAll(re)) {
        if (m && m[1]) pushUrl(m[1]);
      }
    }

    for (const m of h.matchAll(/<(?:a|img|source|video)\b[^>]+(?:href|src|data-src|data-url)=["']([^"']+)["'][^>]*>/ig)) {
      if (m && m[1]) pushUrl(m[1]);
    }

    for (const m of h.matchAll(/https?:\/\/[^"'\s<>]+/gi)) {
      if (m && m[0]) pushUrl(m[0]);
    }

    return out
      .filter((u) => looksLikeDirectFileUrl(u))
      .sort((a, b) => scoreDirectMediaCandidate(b) - scoreDirectMediaCandidate(a));
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
    const base = path.basename(u.pathname || '');
    const name = (base && base !== '/' && base !== '.' && base !== '..') ? base : '';
    const safe = sanitizeName(name);
    return safe || fallback;
  } catch (e) {
    const safe = sanitizeName(String(url || ''));
    return safe ? safe.slice(0, 60) : fallback;
  }
}

async function startDirectFileDownload(downloadId, url, platform, channel, title, metadata) {
  try {
    if (isCancelled(downloadId)) {
      clearCancelled(downloadId);
      jobLane.delete(downloadId);
      updateDownloadStatus.run('cancelled', 0, null, downloadId);
      return;
    }
    updateDownloadStatus.run('downloading', 0, null, downloadId);

    url = upgradeKnownLowQualityMediaUrl(url);

    const pinContext = !!(metadata && typeof metadata === 'object' && !Array.isArray(metadata) && metadata.webdl_pin_context === true);
    const originThread = (metadata && typeof metadata === 'object' && metadata.origin_thread && typeof metadata.origin_thread === 'object') ? metadata.origin_thread : null;
    if (isKnownHtmlWrapperUrl(url)) {
      const directHint = upgradeKnownLowQualityMediaUrl(String(metadata && typeof metadata === 'object' && metadata.webdl_direct_hint ? metadata.webdl_direct_hint : '').trim());
      if (directHint && looksLikeDirectFileUrl(directHint) && directHint !== url) {
        try { updateDownloadUrl.run(directHint, downloadId); } catch (e) {}
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
          try { updateDownloadUrl.run(resolved, downloadId); } catch (e) {}
          url = upgradeKnownLowQualityMediaUrl(resolved);
        }
      } catch (e) {}
      if (isKnownHtmlWrapperUrl(url)) {
        updateDownloadStatus.run('error', 0, 'Kon wrapper media URL niet resolven naar een direct bestand', downloadId);
        return;
      }
    }

    let dir = getDownloadDir(platform, channel, title);
    let meta = {};
    try {
      meta = await fetchMetadataWithTimeout(url, YTDLP_METADATA_TIMEOUT_MS);
      if (isCancelled(downloadId)) {
        clearCancelled(downloadId);
        jobLane.delete(downloadId);
        updateDownloadStatus.run('cancelled', 0, null, downloadId);
        return;
      }
      const finalTitle = pinContext ? title : (meta.title || title);
      const finalChannel = pinContext ? channel : (meta.channel || channel);
      updateDownloadMeta.run(finalTitle, finalChannel, meta.description, meta.duration, meta.thumbnail, JSON.stringify(meta.fullMeta), downloadId);
      title = finalTitle;
      channel = finalChannel;
      console.log(`   [#${downloadId}] ✅ Metadata: "${title}" door ${channel} (${meta.duration})`);
    } catch (e) {
      console.log(`   [#${downloadId}] ⚠️ Metadata ophalen mislukt: ${e.message}`);
    }

    dir = getDownloadDir(platform, channel, title);
    try { updateDownloadFilepath.run(dir, downloadId); } catch (e) {}

    // Sla metadata op als JSON
    const metaFile = path.join(dir, 'metadata.json');
    fs.writeFileSync(metaFile, JSON.stringify({
      url,
      source_url: originThread && originThread.url ? originThread.url : ((metadata && metadata.url && metadata.url !== url) ? metadata.url : null),
      platform,
      channel,
      title,
      description: meta.description || metadata?.description,
      duration: meta.duration,
      thumbnail: meta.thumbnail,
      origin_thread: originThread && originThread.url ? originThread : null,
      webdl_pin_context: pinContext,
      webdl_media_url: (metadata && metadata.webdl_media_url) ? metadata.webdl_media_url : url,
      webdl_detected_platform: (metadata && metadata.webdl_detected_platform) ? metadata.webdl_detected_platform : detectPlatform(url),
      downloadedAt: new Date().toISOString()
    }, null, 2));

    // Start yt-dlp download
    const abort2 = abortKind(downloadId);
    if (abort2) {
      applyAbortStatus(downloadId, abort2);
      return;
    }
    updateDownloadStatus.run('downloading', 0, null, downloadId);

    const filename = filenameFromUrl(url, `download_${downloadId}.bin`);
    const filepath = uniqueFilePath(path.join(dir, filename), downloadId);
    const tmpFilepath = uniqueFilePath(filepath + '.part', downloadId);

    const proc = spawnNice('/usr/bin/curl', [
      '-L',
      '--fail',
      '--silent',
      '--show-error',
      '-o', tmpFilepath,
      url
    ]);

    activeProcesses.set(downloadId, proc);
    try { startingJobs.delete(downloadId); } catch (e) {}
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.stdout.on('data', () => {});

    proc.on('close', (code) => {
      activeProcesses.delete(downloadId);
      if (code === 0 && fs.existsSync(tmpFilepath)) {
        try {
          if (fs.existsSync(filepath)) {
            try { fs.rmSync(filepath, { force: true }); } catch (e) {}
          }
          fs.renameSync(tmpFilepath, filepath);
        } catch (e) {
          updateDownloadStatus.run('error', 0, e.message, downloadId);
          return;
        }
        const size = fs.existsSync(filepath) ? fs.statSync(filepath).size : 0;
        const ext = (path.extname(filename).replace('.', '') || '').toLowerCase();
        const metaObj = { tool: 'curl', platform, channel, title, url, outputDir: dir };
        if (pinContext) {
          metaObj.webdl_pin_context = true;
          metaObj.origin_thread = originThread && originThread.url ? originThread : null;
          metaObj.webdl_media_url = (metadata && metadata.webdl_media_url) ? metadata.webdl_media_url : url;
          metaObj.webdl_detected_platform = (metadata && metadata.webdl_detected_platform) ? metadata.webdl_detected_platform : detectPlatform(url);
          if (originThread && originThread.url) metaObj.source_url = originThread.url;
        }

        const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
        if (isImage) {
          try {
            updateDownloadThumbnail.run(`/download/${downloadId}/thumb`, downloadId);
          } catch (e) {}
        }

        try {
          const relPath = path.relative(BASE_DIR, filepath);
          if (relPath && !relPath.startsWith('..')) {
            const indexedAt = new Date().toISOString();
            upsertDownloadFile.run(downloadId, relPath, size, Math.floor(fs.statSync(filepath).mtimeMs), indexedAt);
          }
        } catch (e) {}

        updateDownload.run('completed', 100, filepath, filename, size, ext || '', JSON.stringify(metaObj), null, downloadId);
      } else {
        updateDownloadStatus.run('error', 0, stderr || `curl exit code: ${code}`, downloadId);
      }
    });

    proc.on('error', (err) => {
      activeProcesses.delete(downloadId);
      updateDownloadStatus.run('error', 0, err.message, downloadId);
    });
  } catch (err) {
    updateDownloadStatus.run('error', 0, err.message, downloadId);
  }
}

async function startOfscraperDownload(downloadId, url, platform, channel, title, metadata) {
  try {
    if (isCancelled(downloadId)) {
      clearCancelled(downloadId);
      jobLane.delete(downloadId);
      updateDownloadStatus.run('cancelled', 0, null, downloadId);
      return;
    }
    const user = channel && channel !== 'unknown' ? channel : deriveChannelFromUrl('onlyfans', url);
    if (!user) {
      updateDownloadStatus.run('error', 0, 'OnlyFans: kon geen model/username afleiden uit URL. Open de modelpagina (onlyfans.com/<username>) en probeer opnieuw.', downloadId);
      return;
    }
    const outChannel = user || 'unknown';
    const dir = getDownloadDirChannelOnly('onlyfans', outChannel);

    try { updateDownloadFilepath.run(dir, downloadId); } catch (e) {}

    updateDownloadStatus.run('downloading', 0, null, downloadId);

    try {
      if (!fs.existsSync(OFSCRAPER)) {
        updateDownloadStatus.run('error', 0, `ofscraper niet gevonden: ${OFSCRAPER}`, downloadId);
        return;
      }
    } catch (e) {
      updateDownloadStatus.run('error', 0, `ofscraper niet gevonden: ${OFSCRAPER}`, downloadId);
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
    } catch (e) {}

    const normalizeAuthJsonInPlace = (authPath) => {
      try {
        if (!fs.existsSync(authPath)) return false;
        const raw = fs.readFileSync(authPath, 'utf8') || '';
        if (!raw.trim()) return false;

        try {
          JSON.parse(raw);
          return true;
        } catch (e) {}

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
        updateDownloadStatus.run('error', 0, 'OnlyFans: ofscraper auth ontbreekt (auth.json). Run ofscraper één keer handmatig om auth aan te maken, of zet WEBDL_OFSCRAPER_CONFIG_DIR naar je ofscraper config map.', downloadId);
        try {
          if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
        } catch (e) {}
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
          updateDownloadStatus.run('error', 0, 'OnlyFans: auth.json cookie export lijkt incompleet/verkeerd (sess ontbreekt). Exporteer cookies opnieuw (bijv. OnlyFans Cookie Helper) en zorg dat auth.json als *platte JSON* is opgeslagen (geen TextEdit/RTF).', downloadId);
          try {
            if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
          } catch (e) {}
          return;
        }

        try {
          const profileAuthPath = path.join(cfgDir, 'main_profile', 'auth.json');
          fs.mkdirSync(path.dirname(profileAuthPath), { recursive: true });
          fs.writeFileSync(profileAuthPath, JSON.stringify(parsed, null, 2));
        } catch (e) {}
      } catch (e) {
        updateDownloadStatus.run('error', 0, 'OnlyFans: je ofscraper auth.json is geen geldige JSON (lijkt als RTF/TextEdit opgeslagen). Fix auth.json (exporteer opnieuw cookies) en probeer opnieuw.', downloadId);
        try {
          if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
        } catch (e) {}
        return;
      }
    } catch (e) {}

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
      cfg.performance_options.download_sems = (Number.isFinite(sems) && sems > 0) ? sems : 1;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    } catch (e) {}

    const proc = spawnNice(OFSCRAPER, [
      '-cg', cfgDir,
      '-p', 'stats',
      '--action', 'download',
      '--download-area', 'all',
      '--usernames', user,
      '--auth-quit'
    ]);

    activeProcesses.set(downloadId, proc);
    try { startingJobs.delete(downloadId); } catch (e) {}

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
          try { fs.closeSync(fd); } catch (e) {}
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
    const timeoutTimer = setTimeout(() => {
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
      updateDownloadStatus.run('error', 0, `OnlyFans: ofscraper timeout na ${Math.round((Date.now() - startMs) / 1000)}s. ${summary}${resumeHint} Log: ${logPath || 'n/a'}${tail ? `\n\n${tail}` : ''}`.trim(), downloadId);

      try {
        proc.kill('SIGTERM');
        setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch (e) {}
        }, 5000);
      } catch (e) {}

      try {
        activeProcesses.delete(downloadId);
        jobLane.delete(downloadId);
        runDownloadSchedulerSoon();
      } catch (e) {}
    }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : (20 * 60 * 1000));

    proc.on('close', (code) => {
      activeProcesses.delete(downloadId);

      try { clearTimeout(timeoutTimer); } catch (e) {}
      if (aborted) {
        try {
          if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
        } catch (e) {}
        try { runDownloadSchedulerSoon(); } catch (e) {}
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
          const msg = isAuthIssue
            ? `OnlyFans: inloggen/auth mislukt (auth.json ontbreekt/ongeldig/verlopen of geen toegang). Log: ${logPath || '(kon log niet schrijven)'}${tail ? `\n\n${tail}` : ''}`
            : `OnlyFans: ofscraper klaar maar output map is leeg. Oorzaken: geen toegang/subscription, geen media, alles locked, ofscraper config mismatch. Log: ${logPath || '(kon log niet schrijven)'}${tail ? `\n\n${tail}` : ''}`;
          updateDownloadStatus.run('error', 0, msg, downloadId);
          try {
            if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
          } catch (e) {}
          return;
        }
        const metaObj = { tool: 'ofscraper', platform: 'onlyfans', channel: outChannel, title, url, outputDir: dir };
        updateDownload.run('completed', 100, dir, '(multiple)', 0, '', JSON.stringify(metaObj), null, downloadId);
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
          updateDownload.run('completed', 100, dir, '(multiple)', 0, '', JSON.stringify(metaObj), null, downloadId);
        } else {
          updateDownloadStatus.run('error', 0, tail || `ofscraper exit code: ${code} (log: ${logPath || 'n/a'})`, downloadId);
        }
      }

      try {
        if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
      } catch (e) {}
      try { runDownloadSchedulerSoon(); } catch (e) {}
    });

    proc.on('error', (err) => {
      activeProcesses.delete(downloadId);
      try {
        if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
      } catch (e) {}
      updateDownloadStatus.run('error', 0, err.message, downloadId);
      try { runDownloadSchedulerSoon(); } catch (e) {}
    });
  } catch (err) {
    updateDownloadStatus.run('error', 0, err.message, downloadId);
  }
}

async function startGalleryDlDownload(downloadId, url, platform, channel, title, metadata) {
  try {
    if (isCancelled(downloadId)) {
      clearCancelled(downloadId);
      jobLane.delete(downloadId);
      updateDownloadStatus.run('cancelled', 0, null, downloadId);
      return;
    }

    const outChannel = (channel && channel !== 'unknown') ? channel : (deriveChannelFromUrl(platform, url) || 'unknown');
    const dir = getDownloadDirChannelOnly(platform, outChannel);

    try { updateDownloadFilepath.run(dir, downloadId); } catch (e) {}

    updateDownloadStatus.run('downloading', 0, null, downloadId);

    try {
      if (!fs.existsSync(GALLERY_DL)) {
        updateDownloadStatus.run('error', 0, `gallery-dl niet gevonden: ${GALLERY_DL}`, downloadId);
        return;
      }
    } catch (e) {
      updateDownloadStatus.run('error', 0, `gallery-dl niet gevonden: ${GALLERY_DL}`, downloadId);
      return;
    }

    const proc = spawnNice(GALLERY_DL, [url], { cwd: dir });
    activeProcesses.set(downloadId, proc);
    try { startingJobs.delete(downloadId); } catch (e) {}

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.stdout.on('data', () => {});

    proc.on('close', (code) => {
      activeProcesses.delete(downloadId);
      if (code === 0) {
        const metaObj = { tool: 'gallery-dl', platform, channel: outChannel, title, url, outputDir: dir };
        updateDownload.run('completed', 100, dir, '(multiple)', 0, '', JSON.stringify(metaObj), null, downloadId);
      } else {
        updateDownloadStatus.run('error', 0, stderr || `gallery-dl exit code: ${code}`, downloadId);
      }
    });

    proc.on('error', (err) => {
      activeProcesses.delete(downloadId);
      updateDownloadStatus.run('error', 0, err.message, downloadId);
    });
  } catch (err) {
    updateDownloadStatus.run('error', 0, err.message, downloadId);
  }
}

async function startInstaloaderDownload(downloadId, url, platform, channel, title, metadata) {
  try {
    if (isCancelled(downloadId)) {
      clearCancelled(downloadId);
      jobLane.delete(downloadId);
      updateDownloadStatus.run('cancelled', 0, null, downloadId);
      return;
    }

    const outChannel = (channel && channel !== 'unknown') ? channel : (deriveChannelFromUrl('instagram', url) || 'unknown');
    const dir = getDownloadDirChannelOnly('instagram', outChannel);
    try { updateDownloadFilepath.run(dir, downloadId); } catch (e) {}
    updateDownloadStatus.run('downloading', 0, null, downloadId);

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
      '--no-profile-pic'
    ];
    const argCandidates = [];
    argCandidates.push([...baseArgs, '--', igTarget]);
    if (String(igTarget) !== String(url)) argCandidates.push([...baseArgs, '--', String(url)]);

    const runAttempt = (args) => new Promise((resolve) => {
      const proc = spawnNice(INSTALOADER, args);
      activeProcesses.set(downloadId, proc);
      try { startingJobs.delete(downloadId); } catch (e) {}

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
      updateDownload.run('completed', 100, dir, '(multiple)', 0, '', JSON.stringify(metaObj), null, downloadId);
      return;
    }
    console.warn(`[#${downloadId}] instaloader gaf geen media, fallback naar yt-dlp`);
    return startYtDlpDownload(downloadId, url, platform, channel, title, metadata);
  } catch (err) {
    updateDownloadStatus.run('error', 0, err.message, downloadId);
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
    const originThread = (metadata && typeof metadata === 'object' && metadata.origin_thread && typeof metadata.origin_thread === 'object') ? metadata.origin_thread : null;
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
        const finalTitle = pinContext ? title : (meta.title || title);
        const finalChannel = pinContext ? channel : (meta.channel || channel);
        updateDownloadMeta.run(finalTitle, finalChannel, meta.description, meta.duration, meta.thumbnail, JSON.stringify(meta.fullMeta), downloadId);
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
    try { updateDownloadFilepath.run(dir, downloadId); } catch (e) {}

    // Sla metadata op als JSON
    const metaFile = path.join(dir, 'metadata.json');
    fs.writeFileSync(metaFile, JSON.stringify({
      url,
      source_url: originThread && originThread.url ? originThread.url : ((metadata && metadata.url && metadata.url !== url) ? metadata.url : null),
      platform,
      channel,
      title,
      description: meta.description || metadata?.description,
      duration: meta.duration,
      thumbnail: meta.thumbnail,
      origin_thread: originThread && originThread.url ? originThread : null,
      webdl_pin_context: pinContext,
      webdl_media_url: (metadata && metadata.webdl_media_url) ? metadata.webdl_media_url : url,
      webdl_detected_platform: (metadata && metadata.webdl_detected_platform) ? metadata.webdl_detected_platform : detectPlatform(url),
      downloadedAt: new Date().toISOString()
    }, null, 2));

    // Start yt-dlp download
    if (isCancelled(downloadId)) {
      clearCancelled(downloadId);
      jobLane.delete(downloadId);
      updateDownloadStatus.run('cancelled', 0, null, downloadId);
      return;
    }
    updateDownloadStatus.run('downloading', 0, null, downloadId);

    const outputTemplate = forceDuplicates
      ? path.join(dir, `%(title).120B [%(id)s] [#${downloadId}].%(ext)s`)
      : path.join(dir, '%(title).120B [%(id)s].%(ext)s');
    const baseArgs = [
      '--concurrent-fragments', YTDLP_CONCURRENT_FRAGMENTS,
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--write-thumbnail',
      '--write-info-json',
      '--no-overwrites',
      '--progress',
      '--newline',
      '-o', outputTemplate,
      url
    ];

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

    const cookieArgs = getYtDlpCookieArgs('download');

    const runOnce = (attemptCookieArgs, allowRetryNoCookies, attemptExtraArgs = [], allowRetryNoCheckCertificates = true) => {
      return new Promise((resolve) => {
        const extra = Array.isArray(attemptExtraArgs) ? attemptExtraArgs : [];
        const proc = spawnNice(YT_DLP, [...attemptCookieArgs, ...extra, ...baseArgs]);
        activeProcesses.set(downloadId, proc);
        try { startingJobs.delete(downloadId); } catch (e) {}

        let lastFile = '';
        let markedPostprocessing = false;
        let stderrAll = '';

        proc.stdout.on('data', (data) => {
          const line = data.toString().trim();
          if (line.includes('[download]') && line.includes('%')) {
            const match = line.match(/([\d.]+)%/);
            if (match) {
              const pct = Math.round(parseFloat(match[1]));
              if (!markedPostprocessing) updateDownloadStatus.run('downloading', pct, null, downloadId);
            }
          }
          if (line.includes('Destination:')) {
            lastFile = line.split('Destination:')[1]?.trim() || '';
          }
          if (line.includes('[Merger]') || line.includes('has already been downloaded')) {
            if (!markedPostprocessing && (line.includes('[Merger]') || line.includes('Merging formats into'))) {
              markedPostprocessing = true;
              updateDownloadStatus.run('postprocessing', 100, null, downloadId);
            }
            const mergeMatch = line.match(/Merging formats into "(.+)"/);
            if (mergeMatch) lastFile = mergeMatch[1];
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
        let lastFile = result.lastFile || '';
        let mainPath = '';
        if (lastFile) {
          const candidate = lastFile.startsWith('/') ? lastFile : path.join(dir, lastFile);
          if (fs.existsSync(candidate)) mainPath = candidate;
        }

        if (!mainPath) {
          const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.webm'));
          const mainFileGuess = files[0] || '';
          mainPath = mainFileGuess ? path.join(dir, mainFileGuess) : '';
        }

        const mainFile = mainPath ? path.basename(mainPath) : '';
        const mainSize = mainPath && fs.existsSync(mainPath) ? fs.statSync(mainPath).size : 0;

        let finalPath = mainPath;
        let finalFile = mainFile;
        let finalSize = mainSize;
        let finalFormat = (path.extname(finalFile || '').replace('.', '') || 'mp4');

        const doFinalCut = FINALCUT_ENABLED;
        const metaObj = meta.fullMeta && typeof meta.fullMeta === 'object' ? meta.fullMeta : {};
        if (pinContext) {
          metaObj.webdl_pin_context = true;
          metaObj.origin_thread = originThread && originThread.url ? originThread : null;
          metaObj.webdl_media_url = (metadata && metadata.webdl_media_url) ? metadata.webdl_media_url : url;
          metaObj.webdl_detected_platform = (metadata && metadata.webdl_detected_platform) ? metadata.webdl_detected_platform : detectPlatform(url);
          if (originThread && originThread.url) metaObj.source_url = originThread.url;
        }

        if (doFinalCut && mainPath && fs.existsSync(mainPath)) {
          updateDownloadStatus.run('postprocessing', 100, null, downloadId);
          const base = path.basename(mainPath, path.extname(mainPath));
          const movFile = `${base}.mov`;
          const movPath = path.join(dir, movFile);
          try {
            console.log(`   🎞️ Transcode Final Cut: ${movFile}`);
            await transcodeToFinalCutMov(mainPath, movPath);
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

        try {
          if (finalPath && fs.existsSync(finalPath)) {
            const st = fs.statSync(finalPath);
            const relPath = path.relative(BASE_DIR, finalPath);
            if (relPath && !relPath.startsWith('..')) {
              const indexedAt = new Date().toISOString();
              upsertDownloadFile.run(downloadId, relPath, st.size, Math.floor(st.mtimeMs), indexedAt);
            }
          }
        } catch (e) {}

        updateDownload.run('completed', 100, finalPath, finalFile, finalSize, finalFormat, JSON.stringify(metaObj), null, downloadId);
        try {
          const thumbPath = pickThumbnailFile(dir);
          if (thumbPath) updateDownloadThumbnail.run(`/download/${downloadId}/thumb`, downloadId);
        } catch (e) {}
        console.log(`   ✅ Download voltooid: ${finalPath} (${(finalSize / 1024 / 1024).toFixed(1)} MB)`);
      })().catch((e) => {
        updateDownloadStatus.run('error', 0, e.message, downloadId);
        console.log(`   ❌ Postprocess fout: ${e.message}`);
      });
    } else {
      const msg = String(result && result.stderrAll ? result.stderrAll : '').trim();
      if (msg.includes('Unsupported URL') && looksLikeDirectFileUrl(url)) {
        console.log(`   ↩️ Fallback naar direct download (unsupported url)`);
        startDirectFileDownload(downloadId, url, platform, channel, title, metadata).catch(() => {});
        return;
      }
      updateDownloadStatus.run('error', 0, msg || `yt-dlp exit code: ${(result && result.code != null) ? result.code : '?'}`, downloadId);
      console.log(`   ❌ Download mislukt (code ${(result && result.code != null) ? result.code : '?'})`);
    }

  } catch (err) {
    updateDownloadStatus.run('error', 0, err.message, downloadId);
    console.error(`   ❌ Download fout: ${err.message}`);
  }
}

// Video opname uploaden (van browser MediaRecorder)
expressApp.post('/upload-recording', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'Geen video bestand ontvangen' });

  let metadata = {};
  try { metadata = JSON.parse(req.body.metadata || '{}'); } catch(e) {}

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
    insertCompletedDownload.run(
      `recording:${Date.now()}`,
      platform,
      channel,
      title,
      filename,
      filepath,
      size,
      (path.extname(filename || '').replace('.', '') || 'webm'),
      'completed',
      100,
      JSON.stringify(recordMeta)
    );
  } catch (e) {}
  res.json({ success: true, file: filename, path: filepath, size, meta: resolved });
});

// Re-index recordings from disk into the DB so they show up in the dashboard/viewer.
// This is safe to call multiple times; it will skip files already present in the DB.
expressApp.get('/recordings/reindex', (req, res) => {
  try {
    const inserted = [];
    const skipped = [];
    const errors = [];

    const walk = (dir, depth = 0) => {
      if (!dir || !fs.existsSync(dir)) return;
      if (depth > 6) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry || !entry.name) continue;
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (!safeIsInsideBaseDir(fullPath)) continue;
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!/^recording_.*\.(mp4|mov|m4v|webm|mkv)$/i.test(entry.name)) continue;
        if (/_raw\.(mp4|mov|m4v|webm|mkv)$/i.test(entry.name)) continue;

        try {
          const fp = path.resolve(fullPath);
          const existing = getDownloadIdByFilepath.get(fp);
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
          const format = (path.extname(fp).replace('.', '') || 'mp4');
          const recordMeta = { webdl_kind: 'recording', webdl_recording: { reindexed: true } };

          const url = `recording:${entry.name}`;
          insertCompletedDownload.run(url, platform, channel, title, entry.name, fp, size, format, 'completed', 100, JSON.stringify(recordMeta));
          inserted.push(fp);
        } catch (e) {
          errors.push({ file: fullPath, error: e.message });
        }
      }
    };

    walk(BASE_DIR);
    res.json({ success: true, base: BASE_DIR, inserted: inserted.length, skipped: skipped.length, errors, insertedFiles: inserted.slice(0, 50) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Import existing video files from disk (e.g. Video DownloadHelper downloads) into DB.
// Safe to rerun: existing filepaths are skipped.
function importExistingVideosFromDisk(options = {}) {
  const requestedRoot = String(options.rootDir || options.dir || '').trim();
  const rootDir = requestedRoot ? path.resolve(requestedRoot) : path.resolve(path.join(os.homedir(), 'Downloads'));
  const maxDepthRaw = Number(options.maxDepth);
  const maxDepth = Number.isFinite(maxDepthRaw) ? Math.max(0, Math.min(12, Math.floor(maxDepthRaw))) : 6;
  const dryRun = !!options.dryRun;
  const flattenToWebdl = options.flattenToWebdl == null ? AUTO_IMPORT_FLATTEN_TO_WEBDL : !!options.flattenToWebdl;
  const moveSource = options.moveSource == null ? AUTO_IMPORT_MOVE_SOURCE : !!options.moveSource;
  const minFileAgeMsRaw = Number(options.minFileAgeMs);
  const minFileAgeMs = Number.isFinite(minFileAgeMsRaw) ? Math.max(0, Math.floor(minFileAgeMsRaw)) : AUTO_IMPORT_MIN_FILE_AGE_MS;
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

  const walk = (dir, depth = 0) => {
    if (!dir || !fs.existsSync(dir)) return;
    if (depth > maxDepth) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry || !entry.name) continue;
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (flattenToWebdl && path.resolve(fullPath) === targetDir) continue;
        walk(fullPath, depth + 1);
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
          if (mtimeMs && minFileAgeMs > 0 && (Date.now() - mtimeMs) < minFileAgeMs) {
            skipped.push({ file: fp, reason: 'too_new' });
            continue;
          }
        } catch (e) {}
        const existing = getDownloadIdByFilepath.get(fp);
        if (existing && existing.id) {
          if (flattenToWebdl && moveSource && !dryRun) {
            try {
              const relocatePath = buildVdhImportTargetPath(fp, targetDir);
              const row = getDownload.get(existing.id);
              const rowPath = row && row.filepath ? path.resolve(row.filepath) : fp;
              if (fp !== relocatePath && fs.existsSync(fp)) {
                if (rowPath === fp) {
                  if (!fs.existsSync(relocatePath)) {
                    moveFileSyncWithFallback(fp, relocatePath);
                    try { updateDownloadFilepath.run(relocatePath, existing.id); } catch (e) {}
                    relocated.push({ id: existing.id, from: fp, to: relocatePath });
                    continue;
                  }
                  fs.unlinkSync(fp);
                  try { updateDownloadFilepath.run(relocatePath, existing.id); } catch (e) {}
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
        const existingTarget = getDownloadIdByFilepath.get(targetPath);
        if (existingTarget && existingTarget.id) {
          if (flattenToWebdl && moveSource && !dryRun && fp !== targetPath && fs.existsSync(fp)) {
            try {
              if (fs.existsSync(targetPath)) {
                fs.unlinkSync(fp);
                relocated.push({ id: existingTarget.id, from: fp, to: targetPath, cleanupOnly: true });
              } else {
                moveFileSyncWithFallback(fp, targetPath);
                try { updateDownloadFilepath.run(targetPath, existingTarget.id); } catch (e) {}
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
        const channelFromUrl = sourceUrl ? (deriveChannelFromUrl(platform, sourceUrl) || '') : '';
        const channel = String(sidecar.channel || '').trim() || channelFromUrl || 'imported';
        const canonicalSource = sourceUrl ? sourceUrl : `file://${fp}`;
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

        const stStored = (!dryRun && fs.existsSync(storedPath)) ? fs.statSync(storedPath) : st;
        const storedSize = stStored && Number.isFinite(stStored.size) ? stStored.size : size;
        const storedExt = path.extname(storedPath).replace('.', '').toLowerCase() || (ext.replace('.', '') || 'mp4');

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
          const info = insertCompletedDownload.run(
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
            try { updateDownloadSourceUrl.run(sourceUrl, newId); } catch (e) {}
          }
        }

        inserted.push({ file: storedPath, originalFile: fp, platform, channel, title, sourceUrl: sourceUrl || null });
      } catch (e) {
        errors.push({ file: fullPath, error: e.message });
      }
    }
  };

  walk(rootDir, 0);
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

expressApp.post('/downloads/import', (req, res) => {
  try {
    const result = importExistingVideosFromDisk(req.body || {});
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
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
  let metaPayload = metadata || {};
  if (typeof metaPayload === 'string') {
    try { metaPayload = JSON.parse(metaPayload); } catch (e) { metaPayload = {}; }
  }

  const resolvedUrl = (typeof url === 'string' && url) ? url : (metaPayload.url || '');
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
        if (mime.includes('jpeg')) ext = 'jpg';
        else if (mime.includes('png')) ext = 'png';
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
      const base64Data = match
        ? imageData.replace(/^data:image\/[^;]+;base64,/i, '')
        : imageData.replace(/^data:image\/.+;base64,/i, '');

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
    } catch (e) {}
    return res.status(500).json({ success: false, error: `Screenshot te klein (${size} bytes)` });
  }

  try {
    const info = insertScreenshot.run(resolvedUrl || '', platform, channel, title, filename, filepath, size);
    const newId = (info && info.lastInsertRowid != null) ? Number(info.lastInsertRowid) : null;
    console.log(`📷 Screenshot DB: id=${newId} path=${filepath}`);
    return res.json({ success: true, id: newId, file: filename, path: filepath, meta: resolved });
  } catch (e) {
    return res.status(500).json({ success: false, error: `DB insert screenshot mislukt: ${e.message}` });
  }
});

// Alle downloads ophalen
expressApp.get('/downloads', (req, res) => {
  const downloads = db.prepare(`SELECT * FROM downloads ORDER BY updated_at DESC, created_at DESC LIMIT 500`).all();
  res.json({ success: true, downloads });
});

// Alle screenshots ophalen
expressApp.get('/screenshots', (req, res) => {
  const screenshots = db.prepare(`SELECT * FROM screenshots ORDER BY created_at DESC LIMIT 500`).all();
  res.json({ success: true, screenshots });
});

// Download status ophalen
expressApp.get('/download/:id', (req, res) => {
  const download = getDownload.get(req.params.id);
  if (!download) return res.status(404).json({ success: false, error: 'Download niet gevonden' });
  res.json({ success: true, download });
});

expressApp.get('/download/:id/thumb', async (req, res) => {
  const id = parseInt(req.params.id);
  const download = getDownload.get(id);
  if (!download) return res.status(404).end();

  const st = String(download.status || '').toLowerCase();
  if (st !== 'completed') return res.status(404).end();

  const fp = String(download.filepath || '').trim();
  if (!fp || !safeIsInsideBaseDir(fp) || !fs.existsSync(fp)) return res.status(404).end();

  try {
    const thumbPath = await pickOrCreateThumbPath(fp, { allowGenerate: false });
    if (!thumbPath) {
      try { scheduleThumbGeneration(fp); } catch (e) {}
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).end();
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
        const download = getDownload.get(id);
        if (!download) return res.status(404).end();

        const st = String(download.status || '').toLowerCase();
        if (st !== 'completed') return res.status(404).end();

        const fp = String(download.filepath || '').trim();
        if (!fp || !safeIsInsideBaseDir(fp) || !fs.existsSync(fp)) return res.status(404).end();
        const thumbPath = await pickOrCreateThumbPath(fp, { allowGenerate: false });
        if (!thumbPath) {
          try { scheduleThumbGeneration(fp); } catch (e) {}
          res.setHeader('Cache-Control', 'no-store');
          return res.status(404).end();
        }
        res.setHeader('Cache-Control', 'public, max-age=86400');
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
        const row = db.prepare(`SELECT * FROM screenshots WHERE id=?`).get(id);
        if (!row) return res.status(404).end();
        const fp = String(row.filepath || '').trim();
        if (!fp || !safeIsInsideBaseDir(fp) || !fs.existsSync(fp)) return res.status(404).end();
        res.setHeader('Cache-Control', 'no-store');
        return res.sendFile(fp, (err) => {
          if (!err) return;
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
expressApp.post('/download/:id/cancel', (req, res) => {
  const id = parseInt(req.params.id);
  const proc = activeProcesses.get(id);
  if (proc) {
    cancelledJobs.add(id);
    try { proc.kill('SIGTERM'); } catch (e) {}
    activeProcesses.delete(id);
    jobLane.delete(id);
    updateDownloadStatus.run('cancelled', 0, null, id);
    console.log(`⏹️ Download #${id} geannuleerd`);
    runDownloadSchedulerSoon();
    return res.json({ success: true });
  }

  if (startingJobs.has(id)) {
    cancelledJobs.add(id);
    startingJobs.delete(id);
    jobLane.delete(id);
    updateDownloadStatus.run('cancelled', 0, null, id);
    console.log(`⏹️ Download #${id} geannuleerd (starting)`);
    runDownloadSchedulerSoon();
    return res.json({ success: true });
  }

  if (isQueued(id)) {
    queuedJobs.delete(id);
    removeFromQueue(queuedHeavy, id);
    removeFromQueue(queuedLight, id);
    jobLane.delete(id);
    updateDownloadStatus.run('cancelled', 0, null, id);
    console.log(`⏹️ Download #${id} geannuleerd (queue)`);
    runDownloadSchedulerSoon();
    return res.json({ success: true });
  }

  return res.json({ success: false, error: 'Download niet actief' });
});

// Mappenstructuur ophalen
expressApp.get('/tree', (req, res) => {
  function buildTree(dir, depth = 0) {
    if (depth > 3 || !fs.existsSync(dir)) return [];
    const items = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'webdl.db' || entry.name.endsWith('-wal') || entry.name.endsWith('-shm')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        items.push({ name: entry.name, type: 'dir', path: fullPath, children: buildTree(fullPath, depth + 1) });
      } else {
        const stat = fs.statSync(fullPath);
        items.push({ name: entry.name, type: 'file', path: fullPath, size: stat.size });
      }
    }
    return items;
  }
  res.json({ success: true, tree: buildTree(BASE_DIR) });
});

// ========================
// DASHBOARD UI
// ========================
expressApp.get('/dashboard', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  // Alleen recente en actieve tonen voor een snelle dashboard laadtijd
  const downloads = db.prepare(`SELECT * FROM downloads ORDER BY COALESCE(finished_at, updated_at) DESC, created_at DESC LIMIT 400`).all();
  const screenshots = db.prepare(`SELECT * FROM screenshots ORDER BY created_at DESC LIMIT 200`).all();
  res.send(getDashboardHTML(downloads, screenshots));
});

expressApp.get('/media/file', (req, res) => {
  const kind = String(req.query.kind || '').toLowerCase();
  const id = parseInt(req.query.id, 10);
  if (!Number.isFinite(id)) return res.status(400).end();

  try {
    let row = null;
    if (kind === 'd') row = getDownload.get(id);
    else if (kind === 's') row = db.prepare(`SELECT * FROM screenshots WHERE id=?`).get(id);
    else return res.status(400).end();

    if (!row) return res.status(404).end();
    const fp = String(row.filepath || '').trim();
    if (!fp || !safeIsInsideBaseDir(fp) || !fs.existsSync(fp)) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-store');
    try {
      const st = fs.statSync(fp);
      if (st && st.isDirectory && st.isDirectory()) {
        const t = inferMediaType(fp);
        if (t === 'video') {
          const v = findFirstVideoInDirDeep(fp) || findFirstVideoInDir(fp);
          if (v && safeIsInsideBaseDir(v) && fs.existsSync(v)) {
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

        const img = pickThumbnailFile(fp);
        if (img && safeIsInsideBaseDir(img) && fs.existsSync(img)) {
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
    } catch (e) {}

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

function inferMediaType(fp) {
  try {
    const p = String(fp || '').trim();
    if (!p) return 'file';
    const abs = path.resolve(p);
    if (safeIsInsideBaseDir(abs) && fs.existsSync(abs)) {
      const st = fs.statSync(abs);
      if (st && st.isDirectory && st.isDirectory()) {
        const img = pickThumbnailFile(abs);
        if (img) return 'image';
        const v = findFirstVideoInDirDeep(abs) || findFirstVideoInDir(abs);
        if (v) return 'video';
        return 'file';
      }
    }
  } catch (e) {}

  const ext = String(path.extname(String(fp || '')).toLowerCase() || '');
  if (['.mp4', '.mov', '.m4v', '.webm', '.mkv'].includes(ext)) return 'video';
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif', '.heic', '.heif'].includes(ext)) return 'image';
  return 'file';
}

function normalizeThumbValue(v) {
  try {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (s.startsWith('data:image/')) return s;
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    if (s.startsWith('/')) {
      const ok = (
        s.startsWith('/download/') ||
        s.startsWith('/media/') ||
        s.startsWith('/addon/')
      );
      return ok ? s : '';
    }
    return '';
  } catch (e) {
    return '';
  }
}

function makeMediaItem(row) {
  const fp = String(row.filepath || '').trim();
  const t = inferMediaType(fp);

  let fileRel = '';
  try {
    if (fp) {
      const abs = path.resolve(fp);
      if (isInsidePrimaryBaseDir(abs)) {
        fileRel = path.relative(path.resolve(BASE_DIR), abs);
      }
    }
  } catch (e) {
    fileRel = '';
  }

  const safeDecode = (v) => {
    try {
      const s = String(v == null ? '' : v);
      return /%[0-9a-f]{2}/i.test(s) ? decodeURIComponent(s) : s;
    } catch (e) {
      return String(v == null ? '' : v);
    }
  };

  const preferredThumb = (row && row.kind === 'd') ? normalizeThumbValue(row.thumbnail) : '';

  return {
    kind: row.kind,
    id: row.id,
    platform: row.platform,
    channel: safeDecode(row.channel),
    title: safeDecode(row.title),
    created_at: row.created_at,
    type: t,
    url: row.url || null,
    source_url: row.source_url || null,
    file_rel: fileRel || null,
    ready: true,
    src: `/media/file?kind=${encodeURIComponent(row.kind)}&id=${encodeURIComponent(row.id)}`,
    thumb: preferredThumb || `/media/thumb?kind=${encodeURIComponent(row.kind)}&id=${encodeURIComponent(row.id)}&v=5`,
    open: { kind: row.kind, id: row.id }
  };
}

function makePendingThumbDataUrl(label) {
  try {
    const t = String(label || '').slice(0, 80);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="100%" height="100%" fill="#000"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#00d4ff" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="22">${t.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  } catch (e) {
    return '';
  }
}

function makeActiveDownloadItem(row) {
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
  const label = (status === 'queued') ? 'queued' : (status === 'postprocessing' ? 'post' : 'dl')
  const thumb = makePendingThumbDataUrl(`${label} ${Math.max(0, Math.min(100, progress))}%`);

  return {
    kind: 'd',
    id: row.id,
    platform: String(row.platform || 'unknown'),
    channel: safeDecode(row.channel) || 'unknown',
    title: safeDecode(row.title) || '(download)',
    created_at: row.created_at || row.updated_at || '',
    type: 'video',
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
    const activeOffset = (obj.activeOffset === -1) ? -1 : Math.max(0, parseInt(obj.activeOffset || 0, 10) || 0);
    const rowOffset = Math.max(0, parseInt(obj.rowOffset || 0, 10) || 0);
    const dir = String(obj.dir || '');
    const fileIndex = Math.max(0, parseInt(obj.fileIndex || 0, 10) || 0);
    return { activeOffset, rowOffset, dir, fileIndex };
  } catch (e) {
    return { activeOffset: 0, rowOffset: 0, dir: '', fileIndex: 0 };
  }
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
        if (/_thumb(?:_v\d+)?\.(?:jpg|jpeg)$/i.test(entry.name)) continue;
        if (entry.name === 'metadata.json') continue;
        out.push(path.resolve(fullPath));
        if (out.length >= MAX_FILES) break;
      }

      if (out.length >= MAX_FILES) break;
    }
  } catch (e) {}

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
      if (videoExts.has(ext)) entry.videos.push(file);
      else entry.images.push(file);
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

function makePathMediaItem({ relPath, platform, channel, title, created_at, thumbTs, url, source_url }) {
  const type = inferMediaType(path.resolve(BASE_DIR, relPath));
  const base = path.basename(relPath);
  const combinedTitle = title ? `${base} • ${title}` : base;
  return {
    kind: 'p',
    id: relPath,
    platform,
    channel: channel,
    title: combinedTitle,
    created_at,
    type,
    url: url || null,
    source_url: source_url || null,
    file_rel: relPath,
    src: `/media/path?path=${encodeURIComponent(relPath)}`,
    thumb: `/media/path-thumb?path=${encodeURIComponent(relPath)}&v=5${thumbTs ? ('&t=' + encodeURIComponent(String(thumbTs))) : ''}`,
    open: { path: relPath }
  };
}

function mediaItemKey(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.file_rel) {
    return `file:${item.file_rel}`;
  }
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
  if (type !== 'all' && type !== 'media' && item.type !== type) return false;
  const key = mediaItemKey(item);
  if (key && seen.has(key)) return false;
  if (key) seen.add(key);
  bucket.push(item);
  return true;
}

function expandRowToMediaItems(row, cursorFileIndex = 0, maxItems = 500) {
  const items = [];
  const fp = String(row.filepath || '').trim();
  if (!fp) return { items, nextFileIndex: 0, done: true };

  try {
    const abs = path.resolve(fp);
    const st = fs.existsSync(abs) ? fs.statSync(abs) : null;
    if (!st) return { items, nextFileIndex: 0, done: true };
    if (!st.isDirectory()) {
      items.push(makeMediaItem(row));
      return { items, nextFileIndex: 0, done: true };
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
          source_url: row.source_url
        });
        try {
          const preferred = (row && row.kind === 'd') ? normalizeThumbValue(row.thumbnail) : '';
          if (preferred) it.thumb = preferred;
        } catch (e) {}
        if (it.type === 'image' || it.type === 'video') items.push(it);
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

expressApp.get('/api/media/recent-files', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '120', 10) || 120));
  const type = String(req.query.type || 'all').toLowerCase();
  const cursorRaw = String(req.query.cursor || '').trim();
  const cur = decodeCursor(cursorRaw);
  const includeActive = String(req.query.include_active || '0') !== '0';

  try {
    const isTopCursor = (!cursorRaw) || (
      cur && cur.activeOffset === 0 && cur.rowOffset === 0 && !cur.dir && cur.fileIndex === 0
    );
    if (!includeActive && isTopCursor) {
      try {
        const now = Date.now();
        const st = getStats.get();
        const marker = [
          st && st.downloads_finished_last ? String(st.downloads_finished_last) : '',
          st && st.screenshots_last ? String(st.screenshots_last) : ''
        ].join('|');
        const key = `recent|${type}|${limit}`;
        const cached = recentFilesTopCache.get(key);
        if (cached && cached.marker === marker && (now - (cached.at || 0)) < RECENT_FILES_TOP_CACHE_MS) {
          return res.json(cached.payload);
        }
        if (now - recentFilesTopCacheAt > (RECENT_FILES_TOP_CACHE_MS * 8)) {
          recentFilesTopCacheAt = now;
          recentFilesTopCache = new Map();
        }
      } catch (e) {}
    }

    const items = [];
    const seenKeys = new Set();

    const isTopRequest = cur && cur.activeOffset === 0 && cur.rowOffset === 0 && !cur.dir && cur.fileIndex === 0;
    if (includeActive && isTopRequest) {
      try {
        const cap = Math.min(28, Math.max(8, Math.floor(limit / 2)));
        const rows = getRecentQueuedDownloads.all(cap);
        for (const r of (rows || [])) {
          if (!r) continue;
          const it = makeActiveDownloadItem(r);
          pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type });
          if (items.length >= limit) break;
        }
      } catch (e) {}
    }

    const activeOffset = Number.isFinite(cur.activeOffset) ? cur.activeOffset : 0;
    let nextActiveOffset = activeOffset;
    if (includeActive && nextActiveOffset >= 0) {
      const activeRows = getRuntimeActiveDownloadRows();
      const maxActiveRowsPerCall = 24;
      for (let i = nextActiveOffset; i < activeRows.length && items.length < limit; i++) {
        if ((i - nextActiveOffset) >= maxActiveRowsPerCall) { nextActiveOffset = i; break; }
        const r = activeRows[i];
        if (!r) continue;

        const fp = String(r && r.filepath ? r.filepath : '').trim();
        try {
          const abs = fp ? path.resolve(fp) : '';
          const st = abs && safeIsInsideBaseDir(abs) && fs.existsSync(abs) ? fs.statSync(abs) : null;
          if (st && st.isDirectory && st.isDirectory()) {
            const perDownload = Math.min(24, Math.max(12, Math.ceil(limit / Math.max(1, activeRows.length))));
            const want = Math.min(perDownload, Math.max(0, limit - items.length));
            if (want <= 0) break;
            const scan = Math.max(600, Math.min(8000, want * 200));
            const files = listMediaFilesInDir(abs, scan);
            const ranked = [];
            for (const absFile of files) {
              if (!absFile) continue;
              try {
                const st2 = fs.existsSync(absFile) ? fs.statSync(absFile) : null;
                ranked.push({ p: absFile, t: st2 ? (st2.mtimeMs || 0) : 0 });
              } catch (e) {
                ranked.push({ p: absFile, t: 0 });
              }
            }
            ranked.sort((a, b) => (b.t || 0) - (a.t || 0));
            const newest = ranked.slice(0, want);
            for (const f of newest) {
              const absFile = f && f.p ? f.p : null;
              if (!absFile || !safeIsInsideBaseDir(absFile) || !fs.existsSync(absFile)) continue;
              const rel = path.relative(path.resolve(BASE_DIR), absFile);
              const it = makePathMediaItem({
                relPath: rel,
                platform: r.platform,
                channel: r.channel,
                title: r.title,
                created_at: r.created_at,
                thumbTs: f && f.t ? f.t : 0,
                url: r.url,
                source_url: r.source_url
              });
              try {
                const preferred = normalizeThumbValue(r.thumbnail);
                if (preferred) it.thumb = preferred;
              } catch (e) {}
              if (pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type }) && items.length >= limit) {
                break;
              }
            }
          }
        } catch (e) {}
        nextActiveOffset = i + 1;
      }
      if (nextActiveOffset < activeRows.length && items.length >= limit) {
        const nextCursor = encodeCursor({ activeOffset: nextActiveOffset, rowOffset: 0, dir: '', fileIndex: 0 });
        return res.json({ success: true, items, next_cursor: nextCursor, done: false });
      }
      nextActiveOffset = -1; // done with active phase
    }

    let rowOffset = cur.rowOffset;
    let dirCursor = String(cur.dir || '');
    let fileIndex = cur.fileIndex;

    const maxRowsPerCall = 260;
    const batch = getRecentMedia.all(maxRowsPerCall, rowOffset);
    for (const row of (batch || [])) {
      if (!row) { rowOffset += 1; continue; }

      const fp = String(row.filepath || '').trim();
      let localItems = [];
      let nextFileIndex = 0;
      let dirDone = true;

      try {
        const abs = fp ? path.resolve(fp) : '';
        const st = abs && fs.existsSync(abs) ? fs.statSync(abs) : null;
        const isDir = !!(st && st.isDirectory && st.isDirectory());
        if (isDir) {
          const relDir = path.relative(path.resolve(BASE_DIR), abs);
          const startIndex = (dirCursor && relDir === dirCursor) ? fileIndex : 0;
          const cap = Math.min(36, Math.max(1, limit - items.length));
          const r = expandRowToMediaItems(row, startIndex, cap);
          localItems = r.items;
          nextFileIndex = r.nextFileIndex;
          dirDone = r.done;
          dirCursor = relDir;
        } else {
          localItems = [makeMediaItem(row)];
          dirDone = true;
          dirCursor = '';
          fileIndex = 0;
        }
      } catch (e) {
        localItems = [makeMediaItem(row)];
        dirDone = true;
        dirCursor = '';
        fileIndex = 0;
      }

      for (const it of localItems) {
        if (pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type }) && items.length >= limit) {
          break;
        }
      }

      if (!dirDone && items.length >= limit) {
        fileIndex = nextFileIndex;
        const nextCursor = encodeCursor({ activeOffset: nextActiveOffset, rowOffset, dir: dirCursor, fileIndex });
        return res.json({ success: true, items, next_cursor: nextCursor, done: false });
      }

      rowOffset += 1;
      dirCursor = '';
      fileIndex = 0;

      if (items.length >= limit) break;
    }

    const nextCursor = encodeCursor({ activeOffset: nextActiveOffset, rowOffset, dir: '', fileIndex: 0 });
    const done = items.length < limit;
    const payload = { success: true, items, next_cursor: nextCursor, done };

    if (!includeActive && ((!cursorRaw) || (cur && cur.activeOffset === 0 && cur.rowOffset === 0 && !cur.dir && cur.fileIndex === 0))) {
      try {
        const st = getStats.get();
        const marker = [
          st && st.downloads_finished_last ? String(st.downloads_finished_last) : '',
          st && st.screenshots_last ? String(st.screenshots_last) : ''
        ].join('|');
        const key = `recent|${type}|${limit}`;
        recentFilesTopCache.set(key, { at: Date.now(), marker, payload });
        if (recentFilesTopCache.size > 80) {
          const keys = Array.from(recentFilesTopCache.keys()).slice(0, Math.max(1, recentFilesTopCache.size - 60));
          for (const k of keys) recentFilesTopCache.delete(k);
        }
      } catch (e) {}
    }

    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.get('/api/media/channel-files', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const platform = String(req.query.platform || '').trim();
  const channel = String(req.query.channel || '').trim();
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '120', 10) || 120));
  const type = String(req.query.type || 'media').toLowerCase();
  const cursorRaw = String(req.query.cursor || '').trim();
  const cur = decodeCursor(cursorRaw);
  const includeActive = String(req.query.include_active || '0') !== '0';

  if (!platform || !channel) return res.status(400).json({ success: false, error: 'platform en channel zijn vereist' });

  try {
    const isTopCursor = (!cursorRaw) || (
      cur && cur.activeOffset === 0 && cur.rowOffset === 0 && !cur.dir && cur.fileIndex === 0
    );
    if (!includeActive && isTopCursor) {
      try {
        const now = Date.now();
        const st = getStats.get();
        const marker = [
          st && st.downloads_finished_last ? String(st.downloads_finished_last) : '',
          st && st.screenshots_last ? String(st.screenshots_last) : ''
        ].join('|');
        const key = `channel|${platform}|${channel}|${type}|${limit}`;
        const cached = recentFilesTopCache.get(key);
        if (cached && cached.marker === marker && (now - (cached.at || 0)) < RECENT_FILES_TOP_CACHE_MS) {
          return res.json(cached.payload);
        }
        if (now - recentFilesTopCacheAt > (RECENT_FILES_TOP_CACHE_MS * 8)) {
          recentFilesTopCacheAt = now;
          recentFilesTopCache = new Map();
        }
      } catch (e) {}
    }

    const items = [];
    const seenKeys = new Set();

    const isTopRequest = cur && cur.activeOffset === 0 && cur.rowOffset === 0 && !cur.dir && cur.fileIndex === 0;
    if (includeActive && isTopRequest) {
      try {
        const cap = Math.min(28, Math.max(8, Math.floor(limit / 2)));
        const rows = getRecentQueuedDownloadsByChannel.all(platform, channel, cap);
        for (const r of (rows || [])) {
          if (!r) continue;
          const it = makeActiveDownloadItem(r);
          pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type });
          if (items.length >= limit) break;
        }
      } catch (e) {}
    }

    const activeOffset = Number.isFinite(cur.activeOffset) ? cur.activeOffset : 0;
    let nextActiveOffset = activeOffset;
    if (includeActive && nextActiveOffset >= 0) {
      const activeRows = getRuntimeActiveDownloadRows();
      const maxActiveRowsPerCall = 24;
      for (let i = nextActiveOffset; i < activeRows.length && items.length < limit; i++) {
        if ((i - nextActiveOffset) >= maxActiveRowsPerCall) { nextActiveOffset = i; break; }
        const r = activeRows[i];
        if (!r) continue;
        if (String(r.platform || '') !== platform) continue;
        if (String(r.channel || '') !== channel) continue;

        const fp = String(r.filepath || '').trim();
        try {
          const abs = fp ? path.resolve(fp) : '';
          const st = abs && safeIsInsideBaseDir(abs) && fs.existsSync(abs) ? fs.statSync(abs) : null;
          if (st && st.isDirectory && st.isDirectory()) {
            const want = Math.min(36, Math.max(0, limit - items.length));
            if (want <= 0) break;
            const scan = Math.max(800, Math.min(8000, want * 200));
            const files = listMediaFilesInDir(abs, scan);
            const ranked = [];
            for (const absFile of files) {
              if (!absFile) continue;
              try {
                const st2 = fs.existsSync(absFile) ? fs.statSync(absFile) : null;
                ranked.push({ p: absFile, t: st2 ? (st2.mtimeMs || 0) : 0 });
              } catch (e) {
                ranked.push({ p: absFile, t: 0 });
              }
            }
            ranked.sort((a, b) => (b.t || 0) - (a.t || 0));
            const newest = ranked.slice(0, want);
            for (const f of newest) {
              const absFile = f && f.p ? f.p : null;
              if (!absFile || !safeIsInsideBaseDir(absFile) || !fs.existsSync(absFile)) continue;
              const rel = path.relative(path.resolve(BASE_DIR), absFile);
              const it = makePathMediaItem({
                relPath: rel,
                platform: r.platform,
                channel: r.channel,
                title: r.title,
                created_at: r.created_at,
                thumbTs: f && f.t ? f.t : 0,
                url: r.url,
                source_url: r.source_url
              });
              if (pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type }) && items.length >= limit) {
                break;
              }
            }
          }
        } catch (e) {}
        nextActiveOffset = i + 1;
      }
      if (nextActiveOffset < activeRows.length && items.length >= limit) {
        const nextCursor = encodeCursor({ activeOffset: nextActiveOffset, rowOffset: 0, dir: '', fileIndex: 0 });
        return res.json({ success: true, items, next_cursor: nextCursor, done: false });
      }
      nextActiveOffset = -1;
    }

    let rowOffset = cur.rowOffset;
    let dirCursor = String(cur.dir || '');
    let fileIndex = cur.fileIndex;

    const maxRowsPerCall = 260;
    const batch = getMediaByChannel.all(platform, channel, maxRowsPerCall, rowOffset);
    for (const row of (batch || [])) {
      if (!row) { rowOffset += 1; continue; }

      const fp = String(row.filepath || '').trim();
      let localItems = [];
      let nextFileIndex = 0;
      let dirDone = true;

      try {
        const abs = fp ? path.resolve(fp) : '';
        const st = abs && fs.existsSync(abs) ? fs.statSync(abs) : null;
        const isDir = !!(st && st.isDirectory && st.isDirectory());
        if (isDir) {
          const relDir = path.relative(path.resolve(BASE_DIR), abs);
          const startIndex = (dirCursor && relDir === dirCursor) ? fileIndex : 0;
          const cap = Math.min(36, Math.max(1, limit - items.length));
          const r = expandRowToMediaItems(row, startIndex, cap);
          localItems = r.items;
          nextFileIndex = r.nextFileIndex;
          dirDone = r.done;
          dirCursor = relDir;
        } else {
          localItems = [makeMediaItem(row)];
          dirDone = true;
          dirCursor = '';
          fileIndex = 0;
        }
      } catch (e) {
        localItems = [makeMediaItem(row)];
        dirDone = true;
        dirCursor = '';
        fileIndex = 0;
      }

      for (const it of localItems) {
        if (pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type }) && items.length >= limit) {
          break;
        }
      }

      if (!dirDone && items.length >= limit) {
        fileIndex = nextFileIndex;
        const nextCursor = encodeCursor({ activeOffset: nextActiveOffset, rowOffset, dir: dirCursor, fileIndex });
        return res.json({ success: true, items, next_cursor: nextCursor, done: false });
      }

      rowOffset += 1;
      dirCursor = '';
      fileIndex = 0;

      if (items.length >= limit) break;
    }

    const nextCursor = encodeCursor({ activeOffset: nextActiveOffset, rowOffset, dir: '', fileIndex: 0 });
    const done = items.length < limit;
    const payload = { success: true, items, next_cursor: nextCursor, done };

    if (!includeActive && ((!cursorRaw) || (cur && cur.activeOffset === 0 && cur.rowOffset === 0 && !cur.dir && cur.fileIndex === 0))) {
      try {
        const st = getStats.get();
        const marker = [
          st && st.downloads_finished_last ? String(st.downloads_finished_last) : '',
          st && st.screenshots_last ? String(st.screenshots_last) : ''
        ].join('|');
        const key = `channel|${platform}|${channel}|${type}|${limit}`;
        recentFilesTopCache.set(key, { at: Date.now(), marker, payload });
        if (recentFilesTopCache.size > 80) {
          const keys = Array.from(recentFilesTopCache.keys()).slice(0, Math.max(1, recentFilesTopCache.size - 60));
          for (const k of keys) recentFilesTopCache.delete(k);
        }
      } catch (e) {}
    }

    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.get('/api/media/recent', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '120', 10) || 120));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  const type = String(req.query.type || 'all').toLowerCase();

  try {
    const rows = getRecentMedia.all(limit, offset);
    const items = rows.map(makeMediaItem).filter(it => {
      if (type === 'all') return true;
      if (type === 'media') return it.type === 'video' || it.type === 'image';
      return it.type === type;
    });
    res.json({ success: true, items });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.get('/api/stats', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const now = Date.now();
    if (statsCache && (now - statsCacheAt) < STATS_CACHE_MS) {
      return res.json(statsCache);
    }
    const stats = getStats.get();
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
      db_path: DB_PATH,
      base_dir: BASE_DIR
    };
    statsCache = payload;
    statsCacheAt = now;
    return res.json(payload);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.get('/api/media/channels', (req, res) => {
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '200', 10) || 200));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  const platform = String(req.query.platform || '').trim();

  try {
    let rows = getMediaChannels.all(limit, offset);
    if (platform) rows = rows.filter((r) => String(r.platform) === platform);
    res.json({ success: true, channels: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.get('/api/media/channel', (req, res) => {
  const platform = String(req.query.platform || '').trim();
  const channel = String(req.query.channel || '').trim();
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '300', 10) || 300));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  const type = String(req.query.type || 'media').toLowerCase();

  if (!platform || !channel) return res.status(400).json({ success: false, error: 'platform en channel zijn vereist' });

  try {
    const rows = getMediaByChannel.all(platform, channel, limit, offset);
    let items = rows.map(makeMediaItem);
    if (type === 'video' || type === 'image') items = items.filter((x) => x.type === type);
    else if (type === 'media') items = items.filter((x) => x.type === 'video' || x.type === 'image');
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

expressApp.get('/gallery', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(getGalleryHTML());
});

function getDashboardHTML(downloads, screenshots) {
  function dashCaptureKind(d) {
    try {
      const u = String(d && d.url ? d.url : '');
      if (u.startsWith('recording:')) return 'recording';
      const raw = String(d && d.metadata ? d.metadata : '').trim();
      if (raw) {
        const m = JSON.parse(raw);
        if (m && m.webdl_kind === 'recording') return 'recording';
        if (m && m.tool === 'gallery-dl') return 'gallery';
      }
    } catch (e) {}
    if (String(d && d.filename ? d.filename : '') === '(multiple)') return 'gallery';
    return 'download';
  }

  function dashFootFetishForumThreadId(d) {
    try {
      const u = String((d && (d.source_url || d.url)) || '');
      const m = u.match(/footfetishforum\.com\/threads\/[^\/\?#]*\.(\d+)(?:\/|\?|#|$)/i);
      return m ? String(m[1] || '') : '';
    } catch (e) {
      return '';
    }
  }

  function dashSortKeyTs(d) {
    try {
      const u = (d && (d.updated_at || d.created_at)) ? String(d.updated_at || d.created_at) : '';
      return u || '';
    } catch (e) {
      return '';
    }
  }

  function dashMediaTypeFromPath(fp) {
    try {
      const p = String(fp || '');
      const ext = String(path.extname(p).toLowerCase() || '');
      if (['.mp4', '.mov', '.m4v', '.webm', '.mkv'].includes(ext)) return 'video';
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'].includes(ext)) return 'image';
      return 'file';
    } catch (e) {
      return 'file';
    }
  }

  const downloadGroups = new Map();
  for (const d of (Array.isArray(downloads) ? downloads : [])) {
    const tid = dashFootFetishForumThreadId(d);
    const key = tid ? `fff:${tid}` : `id:${d && d.id}`;
    const g = downloadGroups.get(key) || { key, threadId: tid || '', items: [] };
    if (!downloadGroups.has(key)) downloadGroups.set(key, g);
    if (tid) g.threadId = tid;
    g.items.push(d);
  }

  const groupedDownloads = Array.from(downloadGroups.values()).map((g) => {
    const items = (g.items || []).slice().sort((a, b) => {
      const as = dashSortKeyTs(a);
      const bs = dashSortKeyTs(b);
      if (as && bs && as !== bs) return bs.localeCompare(as);
      const ai = Number(a && a.id != null ? a.id : 0);
      const bi = Number(b && b.id != null ? b.id : 0);
      if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return bi - ai;
      return 0;
    });
    const rep = items[0] || {};
    const statuses = new Set(items.map(x => String(x && x.status ? x.status : '')));
    let aggStatus = String(rep.status || '');
    if (statuses.has('downloading') || statuses.has('postprocessing')) aggStatus = 'downloading';
    else if (statuses.has('queued') || statuses.has('pending')) aggStatus = 'queued';
    else if (statuses.has('error')) aggStatus = 'error';
    else if (statuses.has('cancelled')) aggStatus = 'cancelled';
    else if (statuses.has('completed')) aggStatus = 'completed';

    const aggProgress = (() => {
      let p = 0;
      for (const it of items) {
        const st = String(it && it.status ? it.status : '');
        if (st === 'downloading' || st === 'postprocessing') {
          const v = Number(it && it.progress != null ? it.progress : 0);
          if (Number.isFinite(v)) p = Math.max(p, v);
        }
      }
      return Math.max(0, Math.min(100, Math.round(p)));
    })();

    const totalSize = (() => {
      let sum = 0;
      for (const it of items) {
        const v = Number(it && it.filesize != null ? it.filesize : 0);
        if (Number.isFinite(v) && v > 0) sum += v;
      }
      return sum || 0;
    })();

    return {
      ...rep,
      _group: g.threadId ? 'fff-thread' : '',
      _threadId: g.threadId || '',
      _count: items.length,
      _aggStatus: aggStatus,
      _aggProgress: aggProgress,
      _ids: items.map(x => x && x.id).filter(x => Number.isFinite(Number(x))),
      _totalSize: totalSize
    };
  }).sort((a, b) => {
    const as = dashSortKeyTs(a);
    const bs = dashSortKeyTs(b);
    if (as && bs && as !== bs) return bs.localeCompare(as);
    const ai = Number(a && a.id != null ? a.id : 0);
    const bi = Number(b && b.id != null ? b.id : 0);
    if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return bi - ai;
    return 0;
  });

  const downloadRows = groupedDownloads.map(d => {
    const isGroup = d && d._group === 'fff-thread' && (d._count || 0) > 1;
    const status = isGroup ? String(d._aggStatus || '') : String(d.status || '');
    const progress = isGroup ? Number(d._aggProgress || 0) : Number(d.progress || 0);
    const ids = isGroup ? (Array.isArray(d._ids) ? d._ids : []) : [];
    const stopBtn = (() => {
      if (!isGroup) {
        return (status === 'queued' || status === 'downloading' || status === 'postprocessing')
          ? `<button onclick="cancelDownload(${d.id})" class="btn btn-sm btn-danger">Stop</button>`
          : '';
      }
      return (status === 'queued' || status === 'downloading' || status === 'postprocessing')
        ? `<button onclick='cancelDownloadGroup(${JSON.stringify(ids)})' class="btn btn-sm btn-danger">Stop</button>`
        : '';
    })();

    const title = isGroup
      ? `Thread ${String(d._threadId || '')} (${Number(d._count || 0)}) — ${String(d.title || '')}`
      : String(d.title || '');

    const sizeCell = (() => {
      const sz = isGroup ? Number(d._totalSize || 0) : Number(d.filesize || 0);
      return sz ? (sz / 1024 / 1024).toFixed(1) + ' MB' : '-';
    })();

    return `
    <tr class="status-${status}">
      <td>${d.id}${isGroup ? ` <span style="color:#666">(${Number(d._count || 0)})</span>` : ''}</td>
      <td>${d.filepath ? `<img src="/download/${d.id}/thumb?v=3" style="width:64px;height:36px;object-fit:cover;border-radius:4px;" onerror="this.style.display='none'" />` : ''}</td>
      <td><span class="badge">${dashCaptureKind(d)} / ${dashMediaTypeFromPath(d.filepath)}${isGroup ? ' / thread' : ''}</span></td>
      <td><span class="badge badge-${d.platform}">${d.platform}</span></td>
      <td>${d.channel}</td>
      <td class="title-cell">${title}</td>
      <td><span class="status status-${status}">${status}${(status === 'downloading' || status === 'postprocessing') ? ` (${Math.max(0, Math.min(100, progress))}%)` : ''}</span></td>
      <td>${sizeCell}</td>
      <td>${new Date(d.created_at).toLocaleString('nl-NL')}</td>
      <td>
        ${stopBtn}
        ${d.filepath ? `<button onclick="openMedia('d', ${d.id})" class="btn btn-sm">Open</button>` : ''}
        ${d.filepath ? `<button onclick="showInFinder('d', ${d.id})" class="btn btn-sm">Finder</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  const screenshotRows = screenshots.map(s => `
    <tr>
      <td>${s.id}</td>
      <td>${s.filepath ? `<img src="/media/thumb?kind=s&id=${s.id}" style="width:64px;height:36px;object-fit:cover;border-radius:4px;" onerror="this.style.display='none'" />` : ''}</td>
      <td><span class="badge">screenshot / image</span></td>
      <td><span class="badge badge-${s.platform}">${s.platform}</span></td>
      <td>${s.channel}</td>
      <td>${s.title}</td>
      <td>${s.filename}</td>
      <td>${s.filesize ? (s.filesize / 1024).toFixed(0) + ' KB' : '-'}</td>
      <td>${new Date(s.created_at).toLocaleString('nl-NL')}</td>
      <td>
        ${s.filepath ? `<button onclick="openMedia('s', ${s.id})" class="btn btn-sm">Open</button>` : ''}
        ${s.filepath ? `<button onclick="showInFinder('s', ${s.id})" class="btn btn-sm">Finder</button>` : ''}
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WEBDL Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #eee; padding: 20px; }
    h1 { color: #00d4ff; margin-bottom: 5px; }
    .subtitle { color: #888; margin-bottom: 20px; }
    .stats { display: flex; gap: 15px; margin-bottom: 20px; }
    .stat { background: #16213e; padding: 15px 20px; border-radius: 8px; flex: 1; }
    .stat-num { font-size: 28px; font-weight: bold; color: #00d4ff; }
    .stat-label { color: #888; font-size: 13px; }
    h2 { color: #00d4ff; margin: 20px 0 10px; }
    table { width: 100%; border-collapse: collapse; background: #16213e; border-radius: 8px; overflow: hidden; }
    th { background: #0f3460; padding: 10px; text-align: left; font-size: 13px; color: #aaa; }
    td { padding: 8px 10px; border-top: 1px solid #1a1a2e; font-size: 13px; }
    .title-cell { max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
    .badge-youtube { background: #ff0000; color: white; }
    .badge-vimeo { background: #1ab7ea; color: white; }
    .badge-twitch { background: #9146ff; color: white; }
    .badge-other { background: #555; color: white; }
    .status { padding: 2px 8px; border-radius: 4px; font-size: 11px; }
    .status-completed { color: #4caf50; }
    .status-downloading { color: #ff9800; }
    .status-postprocessing { color: #c084fc; }
    .status-queued { color: #aaa; }
    .status-pending { color: #2196f3; }
    .status-error { color: #f44336; }
    .status-cancelled { color: #999; }
    .btn { padding: 4px 10px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; background: #0f3460; color: white; }
    .btn:hover { background: #00d4ff; color: #1a1a2e; }
    .btn-danger { background: #c0392b; }
    .btn-danger:hover { background: #e74c3c; }
    .refresh { position: fixed; top: 20px; right: 20px; }
    .viewer { position: fixed; top: 60px; right: 20px; }
    .path-info { color: #666; font-size: 12px; margin-top: 5px; }
  </style>
</head>
<body>
  <h1>WEBDL Dashboard</h1>
  <p class="subtitle">Video download manager</p>
  <p class="path-info">📁 ${BASE_DIR}</p>
  <button class="btn refresh" onclick="location.reload()">🔄 Vernieuwen</button>
  <button class="btn viewer" onclick="window.open('/viewer','_blank')">📺 Viewer</button>

  <div class="stats">
    <div class="stat">
      <div class="stat-num">${downloads.length}</div>
      <div class="stat-label">Downloads</div>
    </div>
    <div class="stat">
      <div class="stat-num">${downloads.filter(d => d.status === 'completed').length}</div>
      <div class="stat-label">Voltooid</div>
    </div>
    <div class="stat">
      <div class="stat-num">${downloads.filter(d => d.status === 'downloading').length}</div>
      <div class="stat-label">Actief</div>
    </div>
    <div class="stat">
      <div class="stat-num">${screenshots.length}</div>
      <div class="stat-label">Screenshots</div>
    </div>
  </div>

  <h2>Downloads</h2>
  <table>
    <thead><tr><th>#</th><th>Thumb</th><th>Type</th><th>Platform</th><th>Kanaal</th><th>Titel</th><th>Status</th><th>Grootte</th><th>Datum</th><th>Acties</th></tr></thead>
    <tbody>${downloadRows || '<tr><td colspan="10" style="text-align:center;color:#666;">Nog geen downloads</td></tr>'}</tbody>
  </table>

  <h2>Screenshots</h2>
  <table>
    <thead><tr><th>#</th><th>Thumb</th><th>Type</th><th>Platform</th><th>Kanaal</th><th>Titel</th><th>Bestand</th><th>Grootte</th><th>Datum</th><th>Acties</th></tr></thead>
    <tbody>${screenshotRows || '<tr><td colspan="10" style="text-align:center;color:#666;">Nog geen screenshots</td></tr>'}</tbody>
  </table>

  <script>
    async function cancelDownload(id) {
      await fetch('/download/' + id + '/cancel', { method: 'POST' });
      location.reload();
    }
    async function cancelDownloadGroup(ids) {
      try {
        if (!Array.isArray(ids) || !ids.length) return;
        for (const id of ids) {
          try {
            await fetch('/download/' + id + '/cancel', { method: 'POST' });
          } catch (e) {}
        }
      } catch (e) {}
      location.reload();
    }
    async function openFile(path) {
      // Kan niet direct bestanden openen vanuit browser, kopieer pad
      navigator.clipboard.writeText(path);
      alert('Pad gekopieerd: ' + path);
    }
    async function openMedia(kind, id) {
      const resp = await fetch('/media/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, action: 'open' })
      });
      const data = await resp.json().catch(() => null);
      if (!data || !data.success) alert((data && data.error) ? data.error : 'Open mislukt');
    }
    async function showInFinder(kind, id) {
      const resp = await fetch('/media/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, action: 'finder' })
      });
      const data = await resp.json().catch(() => null);
      if (!data || !data.success) alert((data && data.error) ? data.error : 'Finder mislukt');
    }
    async function startDashboardLivePoll() {
      try {
        let last = null;
        const tick = async () => {
          try {
            const resp = await fetch('/api/stats', { cache: 'no-store' });
            const data = await resp.json().catch(() => null);
            const s = data && data.stats ? data.stats : null;
            if (s) {
              const key = [s.downloads, s.screenshots, s.download_files, s.downloads_last, s.screenshots_last, s.download_files_last].join('|');
              if (last && key !== last) location.reload();
              last = key;
            }
          } catch (e) {}
        };
        setInterval(tick, 2500);
        tick();
      } catch (e) {}
    }
    // Auto-refresh elke 5 seconden als er actieve downloads zijn
    ${downloads.some(d => d.status === 'downloading' || d.status === 'postprocessing') ? 'setTimeout(() => location.reload(), 5000);' : ''}
    startDashboardLivePoll();
  </script>
</body>
</html>`;
}

// ========================
// SERVER STARTEN
// ========================
server.listen(PORT, () => {
  console.log(`\n🟢 WEBDL Server draait op http://localhost:${PORT}`);
  console.log(`📁 Bestanden: ${BASE_DIR}`);
  console.log(`🗄️  Database: ${DB_PATH}`);
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
      console.log('🔁 Queue rehydrate gestart na startup');
    } catch (e) {
      console.warn(`⚠️ Queue rehydrate mislukt: ${e && e.message ? e.message : e}`);
    }
  }, STARTUP_REHYDRATE_DELAY_MS);

  if (ADDON_AUTO_BUILD_ON_START || ADDON_FORCE_REBUILD_ON_START) {
    ensureFirefoxAddonBuilt({ force: ADDON_FORCE_REBUILD_ON_START })
      .then((result) => {
        const st = result && result.state ? result.state : getAddonBuildState();
        const marker = st && st.sourceBuildMarker ? st.sourceBuildMarker : 'unknown';
        if (result && result.rebuilt) {
          console.log(`🧩 Addon auto-build: rebuilt (${result.reason}) marker=${marker}`);
        } else {
          console.log(`🧩 Addon auto-build: up-to-date marker=${marker}`);
        }
      })
      .catch((err) => {
        console.warn(`⚠️ Addon auto-build mislukt: ${err && err.message ? err.message : err}`);
      });
  } else {
    console.log('🧩 Addon auto-build bij startup uitgeschakeld (WEBDL_ADDON_AUTO_BUILD_ON_START=0 en WEBDL_ADDON_FORCE_REBUILD_ON_START=0)');
  }

  if (AUTO_IMPORT_ON_START) {
    setTimeout(() => {
      try {
        const result = importExistingVideosFromDisk({
          rootDir: AUTO_IMPORT_ROOT_DIR,
          maxDepth: getAutoImportMaxDepth(),
          dryRun: false,
          minFileAgeMs: AUTO_IMPORT_MIN_FILE_AGE_MS,
          flattenToWebdl: AUTO_IMPORT_FLATTEN_TO_WEBDL,
          moveSource: AUTO_IMPORT_MOVE_SOURCE
        });
        if (result && result.success) {
          console.log(`📥 Auto-import: inserted=${result.inserted} skipped=${result.skipped} errors=${Array.isArray(result.errors) ? result.errors.length : 0} root=${result.rootDir}`);
        } else {
          console.warn(`⚠️ Auto-import overgeslagen: ${(result && result.error) ? result.error : 'onbekende fout'}`);
        }
      } catch (e) {
        console.warn(`⚠️ Auto-import mislukt: ${e && e.message ? e.message : e}`);
      }
    }, 500);
  }

  if (AUTO_IMPORT_ON_START && AUTO_IMPORT_POLL_MS > 0) {
    setTimeout(() => {
      try {
        console.log(`📥 Auto-import watcher: polling elke ${AUTO_IMPORT_POLL_MS}ms (root=${AUTO_IMPORT_ROOT_DIR})`);
      } catch (e) {}

      setInterval(() => {
        try {
          const result = importExistingVideosFromDisk({
            rootDir: AUTO_IMPORT_ROOT_DIR,
            maxDepth: getAutoImportMaxDepth(),
            dryRun: false,
            minFileAgeMs: AUTO_IMPORT_MIN_FILE_AGE_MS,
            flattenToWebdl: AUTO_IMPORT_FLATTEN_TO_WEBDL,
            moveSource: AUTO_IMPORT_MOVE_SOURCE
          });
          if (result && result.success) {
            if (result.inserted > 0 || result.relocated > 0) {
              console.log(`📥 Auto-import watcher: inserted=${result.inserted} relocated=${result.relocated} skipped=${result.skipped} root=${result.rootDir}`);
            }
          }
        } catch (e) {
          console.warn(`⚠️ Auto-import watcher fout: ${e && e.message ? e.message : e}`);
        }
      }, AUTO_IMPORT_POLL_MS);
    }, 1200);
  }
});

let isShuttingDown = false;

function shutdownGracefully(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\nServer wordt afgesloten... (${signal})`);

  const stopRecordingIfAny = () => new Promise((resolve) => {
    try {
      const proc = recordingProcess;
      if (!proc) return resolve();

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
        try { proc.kill('SIGINT'); } catch (err) {}
      }

      setTimeout(() => {
        if (done) return;
        try { proc.kill('SIGINT'); } catch (e) {}
        setTimeout(() => {
          if (done) return;
          try { proc.kill('SIGKILL'); } catch (e) {}
          finish();
        }, 2500);
      }, 8000);
    } catch (e) {
      resolve();
    }
  });

  stopRecordingIfAny().finally(() => {
    for (const [id, proc] of activeProcesses) {
      try { proc.kill('SIGTERM'); } catch (e) {}
      console.log(`  Download #${id} gestopt`);
    }
    try { db.close(); } catch (e) {}
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdownGracefully('SIGINT'));
process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));
