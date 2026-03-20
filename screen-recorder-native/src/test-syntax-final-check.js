const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const os = require('os');
const util = require('util');
const { exec, spawn } = require('child_process');
const { createDb } = require('./db-adapter');
const multer = require('multer');
const upload = multer({ dest: path.join(os.tmpdir(), 'webdl-uploads')   });
// ========================
// CONFIGURATIE
// ========================
const PORT = Math.max(1, parseInt(process.env.WEBDL_PORT || '35729', 10) || 35729);
const BASE_DIR = path.join(os.homedir(), 'Downloads', 'WEBDL');
const DB_PATH = path.join(BASE_DIR, 'webdl.db');
const DIRECTORY_FILTER_CONFIG = path.join(os.homedir(), '.config', 'webdl', 'directory-filter.json');
const YT_DLP = '/opt/homebrew/bin/yt-dlp';
const FFMPEG = process.env.WEBDL_FFMPEG || '/opt/homebrew/bin/ffmpeg';
const FFPROBE = process.env.WEBDL_FFPROBE || '/opt/homebrew/bin/ffprobe';
const OFSCRAPER = process.env.WEBDL_OFSCRAPER || path.join(os.homedir(), '.local', 'bin', 'ofscraper');
const OFSCRAPER_CONFIG_DIR = process.env.WEBDL_OFSCRAPER_CONFIG_DIR || path.join(os.homedir(), '.config', 'ofscraper');
const GALLERY_DL = process.env.WEBDL_GALLERY_DL || path.join(os.homedir(), '.local', 'bin', 'gallery-dl');
const INSTALOADER = process.env.WEBDL_INSTALOADER || path.join(os.homedir(), '.local', 'bin', 'instaloader');
const REDDIT_DL = process.env.WEBDL_REDDIT_DL || path.join(os.homedir(), '.local', 'bin', 'reddit-dl');
const TDL = String(process.env.WEBDL_TDL || '').trim() || path.join(os.homedir(), 'go', 'bin', 'tdl');
const TDL_NAMESPACE = String(process.env.WEBDL_TDL_NAMESPACE || 'webdl').trim();
const TDL_THREADS = Math.max(1, parseInt(process.env.WEBDL_TDL_THREADS || '4', 10) || 4);
const TDL_CONCURRENCY = Math.max(1, parseInt(process.env.WEBDL_TDL_CONCURRENCY || '2', 10) || 2);
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
'gig.sex'];

const DEFAULT_RECORDING_FPS_MODE = VIDEO_CODEC === 'h264_videotoolbox' ? 'cfr' : 'passthrough';
const RECORDING_FPS_MODE = String(process.env.WEBDL_RECORDING_FPS_MODE || DEFAULT_RECORDING_FPS_MODE).toLowerCase();
const FFMPEG_THREAD_QUEUE_SIZE = process.env.WEBDL_FFMPEG_THREAD_QUEUE_SIZE || '8192';
const FFMPEG_RTBUFSIZE = process.env.WEBDL_FFMPEG_RTBUFSIZE || '1500M';
const FFMPEG_MAX_MUXING_QUEUE_SIZE = process.env.WEBDL_FFMPEG_MAX_MUXING_QUEUE_SIZE || '4096';
const MIN_SCREENSHOT_BYTES = parseInt(process.env.WEBDL_MIN_SCREENSHOT_BYTES || '12000', 10);
const MIN_THUMB_BYTES = Math.max(256, parseInt(process.env.WEBDL_MIN_THUMB_BYTES || '2048', 10) || 2048);
const FINALCUT_ENABLED = String(process.env.WEBDL_FINALCUT_OUTPUT || '0') === '1';
const FINALCUT_VIDEO_CODEC = process.env.WEBDL_FINALCUT_VIDEO_CODEC || 'libx264';
const FINALCUT_X264_PRESET = process.env.WEBDL_FINALCUT_X264_PRESET || 'fast';
const FINALCUT_X264_CRF = process.env.WEBDL_FINALCUT_X264_CRF || '18';
const FINALCUT_AUDIO_BITRATE = process.env.WEBDL_FINALCUT_AUDIO_BITRATE || AUDIO_BITRATE;
const ADDON_PACKAGE_PATH = process.env.WEBDL_ADDON_PACKAGE_PATH || path.join(BASE_DIR, 'firefox-debug-controller.xpi');
const LEGACY_ADDON_PACKAGE_PATH = path.join(os.homedir(), 'WEBDL', 'firefox-debug-controller.xpi');

const LOG_FILE = process.env.WEBDL_LOG_FILE || path.join(BASE_DIR, 'webdl-server.log');
let logStream = null;
try {
  try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); } catch (e) {}
  logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
} catch (e) {
  logStream = null;
}

function writeLogLine(level, args) {
  try {
    if (!logStream) return;
    const ts = new Date().toISOString();
    const msg = Array.from(args || []).map((x) => {
      try {
        if (typeof x === 'string') return x;
        return util.inspect(x, { depth: 5, maxArrayLength: 120 });
      } catch (e) {
        return String(x);
      }
    }).join(' ');
    logStream.write(`[${ts}] ${String(level || 'LOG').toUpperCase()} ${msg}\n`);
  } catch (e) {}
}

try {
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  console.log = (...args) => { try { writeLogLine('log', args); } catch (e) {} return origLog(...args); };
  console.warn = (...args) => { try { writeLogLine('warn', args); } catch (e) {} return origWarn(...args); };
  console.error = (...args) => { try { writeLogLine('error', args); } catch (e) {} return origError(...args); };
} catch (e) {}

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
      try { fs.closeSync(fd); } catch (e) {}
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
      if (/AVFoundation video devices:/i.test(l)) {mode = 'video';continue;}
      if (/AVFoundation audio devices:/i.test(l)) {mode = 'audio';continue;}
      const m = l.match(/\[(\d+)\]\s*(.+)\s*$/);
      if (!m) continue;
      const idx = parseInt(m[1], 10);
      const name = String(m[2] || '').trim();
      if (!Number.isFinite(idx) || !name) continue;
      if (mode === 'video') out.video.push({ index: idx, name });else
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
    path.join(base, 'vdh')];

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
  if (AUTO_IMPORT_MAX_DEPTH_RAW < 0) return 99;
  return AUTO_IMPORT_MAX_DEPTH_RAW;
}

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
  if (relPath && relPath.includes('patreon')) console.log('[DEBUG-DIR] Checking Patreon path:', relPath, 'Enabled:', enabledDirs);
  if (!enabledDirs || !enabledDirs.length) return true;
  const p = String(relPath || '').trim();
  if (!p) return true;
  for (const dir of enabledDirs) {
    if (p.startsWith(dir + '/') || p === dir) return true;
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
    } catch (e) {}
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
    try {ctrl.abort();} catch (e) {}
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
    try {ctrl.abort();} catch (e) {}
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
    } catch (e) {}

    const files = listMediaFilesInDir(dir, maxScan);
    if (!files.length) {
      try {cache.set(dir, { at: Date.now(), dirMtimeMs, value: null });} catch (e) {}
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
      if (videoExts.has(ext)) score += 1000;else
      if (imageExts.has(ext)) score += 300;else
      score += 50;
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
      try {cache.set(dir, { at: Date.now(), dirMtimeMs, value: null });} catch (e) {}
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
        try {proc.kill('SIGKILL');} catch (e) {}
        const data = parseAvfoundationDeviceList(stderr);
        avfoundationDeviceListCache = { ts: now, data };
        resolve(data);
      }, 12000);

      proc.stderr.on('data', (d) => {stderr += d.toString();});
      proc.on('close', () => {
        if (done) return;
        done = true;
        try {clearTimeout(timer);} catch (e) {}
        const data = parseAvfoundationDeviceList(stderr);
        avfoundationDeviceListCache = { ts: now, data };
        resolve(data);
      });
      proc.on('error', () => {
        if (done) return;
        done = true;
        try {clearTimeout(timer);} catch (e) {}
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
    :root { --bg: #0b0f14; --panel: #101826; --accent: #00d4ff; --accent-hover: #009ecc; --text: #e5e7eb; --text-muted: #9aa4b2; --border: rgba(255,255,255,0.08); }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); padding: 24px; line-height: 1.5; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    h1 { color: #fff; font-size: 24px; font-weight: 600; margin-bottom: 4px; }
    .subtitle { color: var(--text-muted); font-size: 13px; }
    .btn-main { background: var(--accent); color: #0b0f14; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600; font-size: 14px; transition: all 0.2s; display: inline-flex; align-items: center; gap: 8px; }
    .btn-main:hover { background: var(--accent-hover); transform: translateY(-1px); }
    
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .stat { background: var(--panel); padding: 20px; border-radius: 12px; border: 1px solid var(--border); transition: transform 0.2s; }
    .stat:hover { transform: translateY(-2px); border-color: rgba(0,212,255,0.3); }
    .stat-num { font-size: 32px; font-weight: 700; color: #fff; margin-bottom: 4px; }
    .stat-label { color: var(--text-muted); font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
    
    h2 { color: #fff; font-size: 18px; font-weight: 600; margin: 0 0 16px; display: flex; align-items: center; gap: 8px; }
    
    .section-card { background: var(--panel); border-radius: 12px; border: 1px solid var(--border); overflow: hidden; margin-bottom: 32px; }
    
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th, td { padding: 14px 20px; border-bottom: 1px solid var(--border); font-size: 14px; }
    th { color: var(--text-muted); font-weight: 600; text-transform: uppercase; font-size: 12px; letter-spacing: 0.5px; background: rgba(0,0,0,0.2); }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255,255,255,0.02); }
    
    .status-badge { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .status-completed { background: rgba(46, 204, 113, 0.15); color: #2ecc71; border: 1px solid rgba(46, 204, 113, 0.3); }
    .status-downloading { background: rgba(0, 212, 255, 0.15); color: var(--accent); border: 1px solid rgba(0, 212, 255, 0.3); }
    .status-postprocessing { background: rgba(155, 89, 182, 0.15); color: #9b59b6; border: 1px solid rgba(155, 89, 182, 0.3); }
    .status-queued { background: rgba(243, 156, 18, 0.15); color: #f39c12; border: 1px solid rgba(243, 156, 18, 0.3); }
    .status-pending { background: rgba(149, 165, 166, 0.15); color: #95a5a6; border: 1px solid rgba(149, 165, 166, 0.3); }
    .status-error { background: rgba(231, 76, 60, 0.15); color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.3); }
    .status-cancelled { background: rgba(52, 73, 94, 0.15); color: #bdc3c7; border: 1px solid rgba(52, 73, 94, 0.3); }
    
    .platform-badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: #222; color: #ccc; text-transform: capitalize; margin-right: 8px; }
    
    .item-title { font-weight: 500; color: #fff; margin-bottom: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .item-meta { font-size: 12px; color: var(--text-muted); }
    
    .actions { display: flex; gap: 8px; }
    .btn-action { background: #222; color: #fff; border: 1px solid #333; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; transition: all 0.2s; font-weight: 500; }
    .btn-action:hover { background: #333; border-color: #444; }
    .btn-cancel { color: #e74c3c; border-color: rgba(231, 76, 60, 0.3); background: rgba(231, 76, 60, 0.05); }
    .btn-cancel:hover { background: rgba(231, 76, 60, 0.15); border-color: rgba(231, 76, 60, 0.5); }
    
    .progress-wrapper { width: 100%; min-width: 100px; background: rgba(0,0,0,0.3); border-radius: 4px; height: 6px; overflow: hidden; margin-top: 6px; }
    .progress-bar { height: 100%; background: var(--accent); transition: width 0.3s ease; }
    .progress-text { font-size: 11px; color: var(--accent); font-weight: 600; margin-top: 4px; display: block; }
    
    .empty-state { padding: 40px; text-align: center; color: var(--text-muted); font-size: 14px; }
    
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="webdlv-app" id="app">
    <div class="webdlv-sidebar">
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
              <option value="15">Dia: 15s</option>
              <option value="30">Dia: 30s</option>
              <option value="60">Dia: 1m</option>
              <option value="300">Dia: 5m</option>
            </select>
            <button id="btnWrap">🔁 Wrap: aan</button>
          </div>
          <div class="row">
            <button id="btnRandom">🔀 Random: uit</button>
            <button id="btnVideoWait">⏳ Video afwachten: aan</button>
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
    <div class="webdlv-backdrop" id="sidebarBackdrop"></div>
    <div class="main">
      <div class="topbar">
        <div class="left">
          <div class="now" id="nowTitle">-</div>
          <div class="sub" id="nowSub">-</div>
        </div>
        <div class="right">
          <button id="btnSidebar" style="width:auto;">☰</button>
          <div id="nowRating"></div>
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
    const FALLBACK_THUMB = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    const state = {
      initialized: false,
      mode: 'recent',
      tag: '',
      availableTags: [],
      filter: 'media',
      sort: 'recent',
      wrap: true,
      random: false,
      videoWait: true,
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
    const elBtnRandom = document.getElementById('btnRandom');
    const elBtnVideoWait = document.getElementById('btnVideoWait');
    const elLog = document.getElementById('log');
    const elLogBody = document.getElementById('logBody');
    const elBtnLog = document.getElementById('btnLog');
    const elNowRating = document.getElementById('nowRating');
    const elApp = document.getElementById('app');
    const elBtnSidebar = document.getElementById('btnSidebar');
    const elSidebarBackdrop = document.getElementById('sidebarBackdrop');

    function isSidebarOpen() {
      try { return !!(elApp && elApp.classList && elApp.classList.contains('sidebar-open')); } catch (e) { return false; }
    }

    function setSidebarOpen(open) {
      try {
        if (!elApp || !elApp.classList) return;
        if (open) elApp.classList.add('sidebar-open');
        else elApp.classList.remove('sidebar-open');
        try { localStorage.setItem('webdl_viewer_sidebar_open', open ? '1' : '0'); } catch (e2) {}
      } catch (e) {}
    }

    function log(msg) {
      const ts = new Date().toLocaleTimeString();
      elLogBody.textContent = '[' + ts + '] ' + msg + '\n' + elLogBody.textContent;
    }

    function attachThumbRetry(img) {
      if (!img) return;
      try {
        if (img.dataset && img.dataset._webdlThumbRetry) return;
        if (img.dataset) img.dataset._webdlThumbRetry = '1';
      } catch (e) {}

      img.addEventListener('load', () => {
        try {
          const cur = String(img.currentSrc || img.src || '');
          if (cur.startsWith('data:')) return;
          if (cur.includes('/media/pending-thumb.svg')) {
            const base = img.dataset ? String(img.dataset.src || '') : '';
            if (!base) return;
            const tries = img.dataset ? (parseInt(String(img.dataset.retries || '0'), 10) || 0) : 0;
            if (tries >= 25) return;
            if (img.dataset) img.dataset.retries = String(tries + 1);
            const delay = Math.min(45000, Math.floor(2000 * Math.pow(1.45, tries) + (Math.random() * 500)));
            setTimeout(() => {
              try {
                if (!img.isConnected) return;
                if (img.dataset && img.dataset._thumbLoaded === '1') return;
                const u = base + (base.includes('?') ? '&' : '?') + 'r=' + Date.now();
                img.src = u;
              } catch (e2) {}
            }, delay);
            return;
          }
        } catch (e) {}
        try { if (img.dataset) img.dataset._thumbLoaded = '1'; } catch (e) {}
      });

      img.addEventListener('error', () => {
        try {
          if (img.dataset && img.dataset._thumbLoaded === '1') return;
          const base = img.dataset ? String(img.dataset.src || '') : '';
          if (!base) return;
          const tries = img.dataset ? (parseInt(String(img.dataset.retries || '0'), 10) || 0) : 0;
          if (tries >= 25) return;
          if (img.dataset) img.dataset.retries = String(tries + 1);
          const delay = Math.min(45000, Math.floor(2000 * Math.pow(1.45, tries) + (Math.random() * 500)));
          setTimeout(() => {
            try {
              if (!img.isConnected) return;
              if (img.dataset && img.dataset._thumbLoaded === '1') return;
              const u = base + (base.includes('?') ? '&' : '?') + 'r=' + Date.now();
              img.src = u;
            } catch (e2) {}
          }, delay);
        } catch (e) {}
      });
    }

    function api(path) {
      return fetch(path, { cache: 'no-store' }).then(r => r.json());
    }

    function postApi(path, body) {
      return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json());
    }

    function clampRating(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(5, Math.round(n * 2) / 2));
    }

    function getRatingRef(it) {
      const kind = it && it.rating_kind ? String(it.rating_kind) : (it && it.kind ? String(it.kind) : '');
      const id = it && it.rating_id != null ? Number(it.rating_id) : (it && it.id != null ? Number(it.id) : NaN);
      if (!kind || !Number.isFinite(id)) return null;
      if (kind !== 'd' && kind !== 's') return null;
      return { kind, id };
    }

    function setStars(container, rating) {
      if (!container) return;
      const r = clampRating(rating);
      const stars = Array.from(container.querySelectorAll('.webdl-star'));
      for (let i = 0; i < stars.length; i++) {
        const star = stars[i];
        const idx = i + 1;
        star.classList.remove('full');
        star.classList.remove('half');
        if (r >= idx) star.classList.add('full');
        else if (r >= (idx - 0.5)) star.classList.add('half');
      }
    }

    function updateAllRatingUIs(ref, rating) {
      try {
        if (!ref || !ref.kind || ref.id == null) return;
        const nodes = Array.from(document.querySelectorAll('.webdl-rating[data-kind="' + String(ref.kind) + '"][data-id="' + String(ref.id) + '"]'));
        for (const n of nodes) setStars(n, rating);
      } catch (e) {}
    }

    function applyRatingToState(ref, rating) {
      try {
        for (const item of state.items) {
          const r2 = getRatingRef(item);
          if (!r2) continue;
          if (r2.kind === ref.kind && Number(r2.id) === Number(ref.id)) item.rating = rating;
        }
      } catch (e) {}
    }

    function makeViewerRatingEl(it) {
      const ref = getRatingRef(it);
      const box = document.createElement('div');
      box.className = 'webdl-rating';
      box.dataset.kind = ref ? ref.kind : '';
      box.dataset.id = ref ? String(ref.id) : '';
      const current = clampRating(it && it.rating != null ? it.rating : 0);
      for (let i = 1; i <= 5; i++) {
        const s = document.createElement('span');
        s.className = 'webdl-star';
        s.textContent = '★';
        s.dataset.i = String(i);
        box.appendChild(s);
      }
      setStars(box, current);
      if (!ref) {
        box.style.opacity = '0.35';
        return box;
      }

      box.addEventListener('click', async (e) => {
        try {
          e.preventDefault();
          e.stopPropagation();
          const t = e.target;
          if (!t || !t.classList || !t.classList.contains('webdl-star')) return;
          const idx = parseInt(String(t.dataset.i || '0'), 10) || 0;
          if (idx <= 0) return;
          const rect = t.getBoundingClientRect();
          const isHalf = (e.clientX - rect.left) < (rect.width / 2);
          const next = clampRating(isHalf ? (idx - 0.5) : idx);
          setStars(box, next);
          const resp = await postApi('/api/rating', { kind: ref.kind, id: ref.id, rating: next });
          if (!resp || !resp.success) throw new Error((resp && resp.error) ? resp.error : 'rating opslaan mislukt');
          applyRatingToState(ref, next);
          updateAllRatingUIs(ref, next);
        } catch (err) {}
      });

      box.addEventListener('contextmenu', async (e) => {
        try {
          e.preventDefault();
          e.stopPropagation();
          const next = null;
          setStars(box, next);
          const resp = await postApi('/api/rating', { kind: ref.kind, id: ref.id, rating: next });
          if (!resp || !resp.success) return;
          applyRatingToState(ref, next);
          updateAllRatingUIs(ref, next);
        } catch (e2) {}
      });

      return box;
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
      
      let waitTimeMs = Math.max(1, sec) * 1000;
      
      if (state.videoWait) {
        const v = currentVideo();
        if (v && !v.paused && !v.ended && v.duration) {
          const remaining = (v.duration - v.currentTime) * 1000;
          if (remaining > 0) {
            waitTimeMs = Math.max(waitTimeMs, remaining + 500); 
          }
        }
      }

      state.slideshowTimer = setTimeout(() => {
        nextItem(1).catch(() => {});
        scheduleSlideshowTick();
      }, waitTimeMs);
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
          const base = String(it.thumb);
          if (base.startsWith('data:')) {
            img.src = base;
          } else {
            img.src = FALLBACK_THUMB;
            try { img.dataset.src = base; } catch (e) {}
            try { attachThumbRetry(img); } catch (e) {}
            setTimeout(() => {
              try {
                if (!img.isConnected) return;
                if (img.dataset && img.dataset._thumbLoaded === '1') return;
                img.src = base + (base.includes('?') ? '&' : '?') + 'r=' + Date.now();
              } catch (e2) {}
            }, 0);
          }
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
        try {
          const r = makeViewerRatingEl(it);
          r.style.marginTop = '6px';
          text.appendChild(r);
        } catch (e) {}

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
        try { if (elNowRating) elNowRating.innerHTML = ''; } catch (e) {}
        return;
      }

      try {
        if (elNowRating) {
          elNowRating.innerHTML = '';
          const r = makeViewerRatingEl(it);
          r.style.marginTop = '0';
          elNowRating.appendChild(r);
        }
      } catch (e) {}

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
        mediaEl.controls = false;
        mediaEl.playsInline = true;
        const source = document.createElement('source');
        source.src = it.src;
        const ext = (it.src || '').match(/\.(mp4|webm|mov|m4v|mkv|avi)(?:[?#]|$)/i);
        source.type = ext && ext[1] ? 'video/' + ext[1].toLowerCase().replace('m4v', 'mp4') : 'video/mp4';
        mediaEl.appendChild(source);
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
      if (state.loading || state.loadingMore || state.done) return;
      state.loadingMore = true;
      try {
        if (state.mode === 'recent') {
          const data = await api('/api/media/recent-files?include_active=0&include_active_files=0&include_downloads=0&limit=200&cursor=' + encodeURIComponent(state.cursor) + '&type=' + encodeURIComponent(state.filter) + '&sort=' + encodeURIComponent(state.sort || 'recent'));
          if (!data.success) throw new Error(data.error || 'recent failed');
          const newItems = data.items || [];
          state.items = state.items.concat(newItems);
          state.cursor = data.next_cursor || '';
          state.done = !!data.done;
        } else {
          const ch = state.channels[state.chIndex];
          if (!ch) { state.done = true; return; }
          const dirsParam = state.enabledDirs ? '&dirs=' + encodeURIComponent(JSON.stringify(state.enabledDirs)) : '';
          const data = await api(/api/media/channel?platform=${encodeURIComponent(ch.platform)}&channel=${encodeURIComponent(ch.channel)}&limit=300&type= + encodeURIComponent(state.filter) + dirsParam + '&sort=' + encodeURIComponent(state.sort || 'recent'));
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
      
      let next;
      if (state.slideshow && state.random) {
        if (state.items.length <= 1) return;
        let r;
        do {
          r = Math.floor(Math.random() * state.items.length);
        } while (r === state.index);
        next = r;
      } else {
        next = state.index + delta;
      }

      if (!state.random && delta > 0 && next >= state.items.length - 2 && !state.done) {
        await maybeLoadMore();
        next = state.index + delta;
      }

      if (state.wrap || (state.slideshow && state.random)) {
        state.index = (next % state.items.length + state.items.length) % state.items.length;
      } else {
        state.index = Math.max(0, Math.min(state.items.length - 1, next));
      }
      showCurrent();
      renderList();
    }

    async function loadRecent() {
      if (state.loading) return;
      state.loading = true;
      try {
        state.cursor = '';
        state.done = false;
        const dirsParam = state.enabledDirs ? '&dirs=' + encodeURIComponent(JSON.stringify(state.enabledDirs)) : '';
        const data = await api('/api/media/recent-files?include_active=0&include_active_files=0&limit=200&cursor=&type=' + encodeURIComponent(state.filter) + '&sort=' + encodeURIComponent(state.sort || 'recent') + dirsParam);
        if (!data.success) throw new Error(data.error || 'recent failed');
        state.items = data.items || [];
        state.cursor = data.next_cursor || '';
        state.done = !!data.done;
        state.index = 0;
        renderList();
      } finally {
        state.loading = false;
      }
}

    async function loadTags() {
      try {
        const data = await api('/api/tags');
        if (data && data.success) {
          state.availableTags = data.tags || [];
          const sel = document.getElementById('tagFilter');
          if (sel) {
            const current = sel.value;
            sel.innerHTML = '<option value="">Alle tags</option>';
            for (const t of state.availableTags) {
              const opt = document.createElement('option');
              opt.value = t.name;
              opt.textContent = t.name;
              sel.appendChild(opt);
            }
            sel.value = state.tag;
          }
        }
      } catch(e) {}
    }
    
    async function loadChannels() {
      const dirsParam = state.enabledDirs ? '&dirs=' + encodeURIComponent(JSON.stringify(state.enabledDirs)) : '';
      const data = await api('/api/media/channels?limit=500' + dirsParam);
      if (!data.success) throw new Error(data.error || 'channels failed');
      state.channels = data.channels || [];
      state.chIndex = 0;
      log('Kanalen geladen: ' + state.channels.length);
    }

    async function loadChannelItems() {
      if (state.loading) return;
      state.loading = true;
      try {
      const ch = state.channels[state.chIndex];
      if (!ch) {
        state.items = [];
        state.index = 0;
        state.cursor = '';
        state.done = true;
        renderList();
        showCurrent();
        state.loading = false; return;
      }
      state.cursor = '';
      state.done = false;
      const dirsParam = state.enabledDirs ? '&dirs=' + encodeURIComponent(JSON.stringify(state.enabledDirs)) : '';
      const data = await api('/api/media/channel-files?include_active=0&include_active_files=0&platform=' + encodeURIComponent(ch.platform) + '&channel=' + encodeURIComponent(ch.channel) + '&limit=300&cursor=&type=' + encodeURIComponent(state.filter) + '&sort=' + encodeURIComponent(state.sort || 'recent') + dirsParam);
      if (!data.success) throw new Error(data.error || 'channel failed');
      state.items = data.items || [];
      state.cursor = data.next_cursor || '';
      state.done = !!data.done;
      state.index = 0;
      renderList();
      showCurrent();
      log('Kanaal geladen: ' + ch.platform + '/' + ch.channel + ' (' + state.items.length + ')');
      } finally { state.loading = false; }
    }

    async function init() {
      try {
        const sessionEnabledDirs = getSessionEnabledDirs();
        if (Array.isArray(sessionEnabledDirs)) {
          state.enabledDirs = sessionEnabledDirs.slice();
        } else {
          const resp = await fetch('/api/directories');
          const data = await resp.json();
          if (data.success && data.enabled && data.enabled.length > 0) {
            state.enabledDirs = data.enabled;
          }
        }
      } catch (e) {}
      
      elMode.value = state.mode;
      elFilter.value = state.filter;
      await loadTags();
      if (state.mode === 'recent') {
        await loadRecent();
      } else {
      await loadChannels();
        await loadChannelItems();
      }
      state.initialized = true;
      setInterval(tick, 2500);
      tick();
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

    const elBtnTags = document.getElementById('btnTags');
    const elTagDialog = document.getElementById('tagDialog');
    const elTagList = document.getElementById('tagList');
    const elNewTagInput = document.getElementById('newTagInput');
    const elBtnAddTag = document.getElementById('btnAddTag');

    let currentItemTags = [];

    async function loadCurrentItemTags() {
      if (!state.current) return;
      try {
        const data = await api('/api/media/' + encodeURIComponent(state.current.kind) + '/' + encodeURIComponent(state.current.id) + '/tags');
        if (data && data.success) {
          currentItemTags = data.tags || [];
          renderTagDialog();
        }
      } catch (e) {}
    }

    function renderTagDialog() {
      if (!elTagList) return;
      elTagList.innerHTML = '';
      for (const t of state.availableTags) {
        const hasTag = currentItemTags.some(ct => ct.id === t.id);
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.marginBottom = '4px';
        
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = hasTag;
        cb.style.marginRight = '6px';
        cb.addEventListener('change', async () => {
          if (!state.current) return;
          try {
            if (cb.checked) {
              await api('/api/media/' + encodeURIComponent(state.current.kind) + '/' + encodeURIComponent(state.current.id) + '/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tag_id: t.id })
              });
            } else {
              await api('/api/media/' + encodeURIComponent(state.current.kind) + '/' + encodeURIComponent(state.current.id) + '/tags/' + t.id, {
                method: 'DELETE'
              });
            }
            await loadCurrentItemTags();
          } catch(e) {}
        });

        
        const lbl = document.createElement('span');
        lbl.textContent = t.name;
        lbl.style.color = '#d7e6ff';
        lbl.style.fontSize = '12px';
        lbl.style.flex = '1';

        const delBtn = document.createElement('button');
        delBtn.textContent = '❌';
        delBtn.style.background = 'none';
        delBtn.style.border = 'none';
        delBtn.style.cursor = 'pointer';
        delBtn.style.fontSize = '10px';
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm('Tag "' + t.name + '" volledig verwijderen?')) {
            try {
              await api('/api/tags/' + t.id, { method: 'DELETE' });
              await loadTags();
              await loadCurrentItemTags();
            } catch(e){}
          }
        });

        div.appendChild(cb);
        div.appendChild(lbl);
        div.appendChild(delBtn);
        elTagList.appendChild(div);
      }
    }

    if (elBtnTags) {
      
    const elBtnSource = document.getElementById('btnSource');
    if (elBtnSource) {
      elBtnSource.addEventListener('click', () => {
        if (state.current && (state.current.source_url || state.current.url)) {
          window.open(state.current.source_url || state.current.url, '_blank');
        }
      });
    }

    elBtnTags.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (elTagDialog.style.display === 'none') {
          elTagDialog.style.display = 'block';
          await loadTags(); // refresh available
          await loadCurrentItemTags();
        } else {
          elTagDialog.style.display = 'none';
        }
      });
    }

    if (elBtnAddTag) {
      elBtnAddTag.addEventListener('click', async () => {
        const name = elNewTagInput.value.trim();
        if (!name) return;
        try {
          await api('/api/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
          });
          elNewTagInput.value = '';
          await loadTags();
          renderTagDialog();
        } catch(e) {}
      });
    }

    // close dialog when clicking outside
    elModal.addEventListener('click', (e) => {
      if (elTagDialog && elTagDialog.style.display !== 'none' && !elTagDialog.contains(e.target) && e.target !== elBtnTags) {
        elTagDialog.style.display = 'none';
      }
    });


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
      elBtnWrap.textContent = state.wrap ? '🔁 Wrap: aan' : '🔁 Wrap: uit';
    });

    elBtnRandom.addEventListener('click', () => {
      state.random = !state.random;
      elBtnRandom.textContent = state.random ? '🔀 Random: aan' : '🔀 Random: uit';
    });

    elBtnVideoWait.addEventListener('click', () => {
      state.videoWait = !state.videoWait;
      elBtnVideoWait.textContent = state.videoWait ? '⏳ Video afwachten: aan' : '⏳ Video afwachten: uit';
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
        try {
          if (state.mode === 'channel' && state.channels.length) {
            stopSlideshow();
            const next = state.chIndex - 1;
            state.chIndex = Math.max(0, Math.min(state.channels.length - 1, next));
            await loadChannelItems();
          }
        } catch (e2) {}
        e.preventDefault();
      }
      else if (e.key === 'ArrowDown') {
        try {
          if (state.mode === 'channel' && state.channels.length) {
            stopSlideshow();
            const next = state.chIndex + 1;
            state.chIndex = Math.max(0, Math.min(state.channels.length - 1, next));
            await loadChannelItems();
          }
        } catch (e2) {}
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
        try {
          if (isSidebarOpen()) {
            setSidebarOpen(false);
            e.preventDefault();
            return;
          }
        } catch (err2) {}
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
    }, { capture: true });

    try {
      const saved = (() => { try { return localStorage.getItem('webdl_viewer_sidebar_open'); } catch (e) { return null; } })();
      if (saved == null || saved === '') setSidebarOpen(true);
      else setSidebarOpen(saved === '1');
    } catch (e) {}

    try {
      if (elBtnSidebar) {
        elBtnSidebar.addEventListener('click', (e) => {
          try {
            e.preventDefault();
            e.stopPropagation();
            setSidebarOpen(!isSidebarOpen());
          } catch (e2) {}
        });
      }
      if (elSidebarBackdrop) {
        elSidebarBackdrop.addEventListener('click', (e) => {
          try {
            e.preventDefault();
            setSidebarOpen(false);
          } catch (e2) {}
        });
      }
    } catch (e) {}

    init().catch(e => {
      const msg = e && e.message ? e.message : String(e);
      log(msg);
      elList.innerHTML = '<div style="padding:10px;border:1px solid #7f1d1d;border-radius:8px;color:#fecaca;background:#450a0a;font-size:12px;line-height:1.4;">Viewer init fout: ' + msg.replace(/</g, '&lt;') + '</div>';
    });
  </script>
  </div>
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
    .webdl-rating { margin-top: 8px; display: inline-flex !important; gap: 2px !important; align-items: center !important; user-select: none !important; }
    .webdl-rating .webdl-star { position: relative !important; display: inline-block !important; width: 1em !important; font-size: 14px !important; line-height: 1 !important; color: rgba(215,230,255,0.55) !important; cursor: pointer !important; }
    .webdl-rating .webdl-star.full { color: #ffd166 !important; }
    .webdl-rating .webdl-star.half { color: rgba(215,230,255,0.30) !important; }
    .webdl-rating .webdl-star.half::before { content: '★' !important; position: absolute !important; left: 0 !important; top: 0 !important; width: 50% !important; overflow: hidden !important; color: #ffd166 !important; }

    .modal { position: fixed; inset: 0; padding: 0; background: rgba(0,0,0,0.82); display: none; align-items: stretch; justify-content: center; z-index: 100; touch-action: manipulation; }
    .modal.open { display: flex; }
    .panel { width: 100vw; height: 100vh; background: #000; border: 0; border-radius: 0; overflow: hidden; display: flex; flex-direction: column; position: relative; }
    .panel header { position: absolute; top: 0; left: 0; right: 0; z-index: 10; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: none; background: linear-gradient(to bottom, rgba(5,8,22,0.9) 0%, rgba(5,8,22,0.7) 70%, transparent 100%); backdrop-filter: blur(6px); }
    .panel header .h { flex: 1 1 auto; min-width: 0; }
    .panel header .h .t { font-size: 13px; font-weight: 500; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .panel header .h .s { font-size: 11px; color: #9aa7d1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
    .panel .body { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: #000; overflow: hidden; }
    .panel .body img, .panel .body video { width: 100%; height: 100%; object-fit: contain; }
    .panel header { transition: opacity 0.3s ease, transform 0.3s ease; }
    .panel header.hide { opacity: 0; transform: translateY(-100%); pointer-events: none; }

    .dir-panel { width: 600px; max-width: 90vw; max-height: 80vh; background: #0b1020; border: 1px solid #2a4a82; border-radius: 8px; display: flex; flex-direction: column; }
    .dir-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #1f2a52; background: #050816; }
    .dir-header h3 { flex: 1; margin: 0; font-size: 16px; color: #00d4ff; }
    .dir-body { flex: 1; overflow: auto; padding: 16px; min-height: 400px; max-height: 60vh; }
    .dir-controls { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
    .dir-count { margin-left: auto; color: #9aa7d1; font-size: 12px; }
    .dir-list { display: flex; flex-direction: column; gap: 4px; }
    .dir-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #1f2a52; border-radius: 4px; cursor: pointer; user-select: none; }
    .dir-item:hover { background: #2a4a82; }
    .dir-item input[type=checkbox] { width: 18px; height: 18px; cursor: pointer; }
    .dir-item label { flex: 1; cursor: pointer; color: #d7e6ff; font-size: 13px; }
    .dir-footer { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #1f2a52; justify-content: flex-end; }
    .btn-primary { background: #2a4a82 !important; font-weight: bold; }
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
      <select id="sort" title="Sorteren">
        <option value="recent" selected>Nieuwste</option>
        <option value="rating_desc">Rating hoog→laag</option>
        <option value="rating_asc">Rating laag→hoog</option>
      </select>
      <select id="channelSel" style="min-width: 280px; display:none;"></select>
      <button id="btnReload" class="btn">↻ Herladen</button>
      <button id="btnDirSelect" class="btn">📁 Mappen</button>
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
        <div id="mRating" style="margin-right:6px"></div>
        <button id="mBtnSlideshow" class="btn">▶︎ Dia</button>
        <select id="mSlideshowSec" style="font-size:11px;padding:6px 8px;">
          <option value="2">2s</option>
          <option value="4" selected>4s</option>
          <option value="7">7s</option>
          <option value="10">10s</option>
          <option value="15">15s</option>
          <option value="30">30s</option>
          <option value="60">1m</option>
          <option value="300">5m</option>
        </select>
        <button id="mBtnRandom" class="btn" title="Random volgorde">🔀 Uit</button>
        <button id="mBtnVideoWait" class="btn" title="Video afwachten">⏳ Aan</button>
        <select id="mFilter" title="Filter" style="font-size:11px;padding:6px 8px;">
          <option value="media">Media</option>
          <option value="video">Video</option>
          <option value="image">Foto</option>
          <option value="all">Alles</option>
        </select>
        <select id="mSort" title="Sorteren" style="font-size:11px;padding:6px 8px;">
          <option value="recent">Nieuwste</option>
          <option value="rating_desc">Rating ↓</option>
          <option value="rating_asc">Rating ↑</option>
        </select>
        <label class="zoomctl">Zoom
          <input id="zoomRange" type="range" min="100" max="600" step="10" value="100">
        </label>
        <button id="btnZoomReset" class="btn">Reset zoom</button>
        <button id="btnRotate" class="btn">↻ 90°</button>
        <button id="btnOpen" class="btn">Open</button>
        <button id="btnFinder" class="btn">Finder</button>
      </header>
      <div class="body" id="mBody"></div>
    </div>
  </div>

  <div id="dirModal" class="modal" style="display:none;">
    <div class="dir-panel">
      <header class="dir-header">
        <h3>📁 Selecteer Mappen</h3>
        <button id="btnDirClose" class="btn">✕</button>
      </header>
      <div class="dir-body">
        <div class="dir-controls">
          <button id="btnDirSelectAll" class="btn">✓ Alles</button>
          <button id="btnDirDeselectAll" class="btn">✗ Geen</button>
          <span class="dir-count"></span>
        </div>
        <div id="dirList" class="dir-list"></div>
      </div>
      <footer class="dir-footer">
        <button id="btnDirCancel" class="btn">Annuleer</button>
        <button id="btnDirApply" class="btn btn-primary">✓ Toepassen</button>
      </footer>
    </div>
  </div>

  <script>
    const FALLBACK_THUMB = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="100%" height="100%" fill="#000"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#00d4ff" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="18">thumb…</text></svg>');
    const elMode = document.getElementById('mode');
    const elFilter = document.getElementById('filter');
    const elSort = document.getElementById('sort');
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
    const elBtnRotate = document.getElementById('btnRotate');
    const elZoomRange = document.getElementById('zoomRange');
    const elBtnZoomReset = document.getElementById('btnZoomReset');
    const elMTitle = document.getElementById('mTitle');
    const elMSub = document.getElementById('mSub');
    const elMRating = document.getElementById('mRating');
    const elMBody = document.getElementById('mBody');
    const elMFilter = document.getElementById('mFilter');
    const elMSort = document.getElementById('mSort');
    const elMBtnSlideshow = document.getElementById('mBtnSlideshow');
    const elMSlideshowSec = document.getElementById('mSlideshowSec');
    const elMBtnRandom = document.getElementById('mBtnRandom');
    const elMBtnVideoWait = document.getElementById('mBtnVideoWait');

    const state = {
      mode: 'recent',
      filter: 'media',
      sort: 'recent',
      enabledDirs: null,
      dirConfig: null,
      loading: false,
      done: false,
      cursor: '',
      limit: 120,
      items: [],
      status: null,
      channels: [],
      channel: null,
      current: null,
      currentIndex: -1,
      currentMediaEl: null,
      reloading: false,
      lastAutoLoadAt: 0,
      autoFillLoads: 0,
      hasUserScrolled: false,
      
      slideshow: false,
      slideshowTimer: null,
      random: false,
      videoWait: true,

      volume: 0.8,
      playbackSpeed: 1,

      youtube: null,
      youtubeDefaults: null,
      youtubeLastManual: null,
      youtubeLoading: false,
      reversePlayback: false,
      reverseInterval: null
    };

    function api(path) {
      return fetch(path, { cache: 'no-store' }).then(r => r.json());
    }

    function postApi(path, body) {
      return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json());
    }

    function getSessionEnabledDirs() {
      try {
        const instanceId = window.location.pathname === '/viewer' ? 'viewer' : 'gallery';
        const raw = sessionStorage.getItem('gallery.enabledDirs.' + instanceId);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(v => String(v || '').trim()).filter(Boolean) : [];
      } catch (e) {
        return null;
      }
    }

    function setSessionEnabledDirs(enabledDirs) {
      try {
        const instanceId = window.location.pathname === '/viewer' ? 'viewer' : 'gallery';
        if (enabledDirs == null) {
          sessionStorage.removeItem('gallery.enabledDirs.' + instanceId);
          return;
        }
        sessionStorage.setItem('gallery.enabledDirs.' + instanceId, JSON.stringify(Array.isArray(enabledDirs) ? enabledDirs : []));
      } catch (e) {}
    }

    function log(msg) {
      try {
        console.log('[Gallery]', msg);
      } catch (e) {}
    }

    function itemKey(it) {
      return (it && it.kind ? String(it.kind) : '') + ':' + String(it && it.id != null ? it.id : '');
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

    function clampRating(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(5, Math.round(n * 2) / 2));
    }

    function getRatingRef(it) {
      const kind = it && it.rating_kind ? String(it.rating_kind) : (it && it.kind ? String(it.kind) : '');
      const id = it && it.rating_id != null ? Number(it.rating_id) : (it && it.id != null ? Number(it.id) : NaN);
      if (!kind || !Number.isFinite(id)) return null;
      if (kind !== 'd' && kind !== 's') return null;
      return { kind, id };
    }

    function setStars(container, rating) {
      if (!container) return;
      const r = clampRating(rating);
      const stars = Array.from(container.querySelectorAll('.webdl-star'));
      for (let i = 0; i < stars.length; i++) {
        const star = stars[i];
        const idx = i + 1;
        star.classList.remove('full');
        star.classList.remove('half');
        if (r >= idx) star.classList.add('full');
        else if (r >= (idx - 0.5)) star.classList.add('half');
      }
    }

    function makeRatingEl(it) {
      const ref = getRatingRef(it);
      const box = document.createElement('div');
      box.className = 'webdl-rating';
      box.dataset.kind = ref ? ref.kind : '';
      box.dataset.id = ref ? String(ref.id) : '';
      const current = clampRating(it && it.rating != null ? it.rating : 0);
      for (let i = 1; i <= 5; i++) {
        const s = document.createElement('span');
        s.className = 'webdl-star';
        s.textContent = '★';
        s.dataset.i = String(i);
        box.appendChild(s);
      }
      setStars(box, current);
      if (!ref) {
        box.style.opacity = '0.35';
        return box;
      }

      const applyToState = (kind, id, rating) => {
        try {
          for (const item of state.items) {
            const r2 = getRatingRef(item);
            if (!r2) continue;
            if (r2.kind === kind && Number(r2.id) === Number(id)) item.rating = rating;
          }
        } catch (e) {}
      };

      const patchAllCards = (kind, id, rating) => {
        try {
          const cards = Array.from(elGrid.querySelectorAll('.card'));
          for (const c of cards) {
            const k = c.dataset && c.dataset.key ? String(c.dataset.key) : '';
            if (!k) continue;
            const idx = state.items.findIndex((x) => itemKey(x) === k);
            if (idx < 0) continue;
            const r2 = getRatingRef(state.items[idx]);
            if (!r2) continue;
            if (r2.kind === kind && Number(r2.id) === Number(id)) {
              const el = c.querySelector('.webdl-rating');
              if (el) setStars(el, rating);
            }
          }
        } catch (e) {}
      };

      box.addEventListener('click', async (e) => {
        try {
          e.preventDefault();
          e.stopPropagation();
          const t = e.target;
          if (!t || !t.classList || !t.classList.contains('webdl-star')) return;
          const idx = parseInt(String(t.dataset.i || '0'), 10) || 0;
          if (idx <= 0) return;
          const rect = t.getBoundingClientRect();
          const isHalf = (e.clientX - rect.left) < (rect.width / 2);
          const next = clampRating(isHalf ? (idx - 0.5) : idx);
          setStars(box, next);
          if (elMRating && elMRating.dataset && elMRating.dataset.kind === ref.kind && elMRating.dataset.id === String(ref.id)) {
            setStars(elMRating, next);
          }
          const resp = await postApi('/api/rating', { kind: ref.kind, id: ref.id, rating: next });
          if (!resp || !resp.success) throw new Error((resp && resp.error) ? resp.error : 'rating opslaan mislukt');
          applyToState(ref.kind, ref.id, next);
          patchAllCards(ref.kind, ref.id, next);
        } catch (err) {}
      });

      box.addEventListener('contextmenu', async (e) => {
        try {
          e.preventDefault();
          e.stopPropagation();
          const next = null;
          setStars(box, next);
          if (elMRating && elMRating.dataset && elMRating.dataset.kind === ref.kind && elMRating.dataset.id === String(ref.id)) {
            setStars(elMRating, next);
          }
          const resp = await postApi('/api/rating', { kind: ref.kind, id: ref.id, rating: next });
          if (!resp || !resp.success) return;
          applyToState(ref.kind, ref.id, next);
          patchAllCards(ref.kind, ref.id, next);
        } catch (e2) {}
      });

      return box;
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

    const THUMB_MAX_INFLIGHT = Math.max(1, Math.min(32, parseInt((new URLSearchParams(location.search)).get('thumb_inflight') || '20', 10) || 20));
    const thumbQueue = [];
    const thumbInflight = new Set();
    let thumbDrainTimer = null;

    function drainThumbQueueSoon() {
      if (thumbDrainTimer) return;
      thumbDrainTimer = setTimeout(() => {
        thumbDrainTimer = null;
        drainThumbQueue();
      }, 5);
    }

    function markThumbDone(img) {
      try { thumbInflight.delete(img); } catch (e) {}
      drainThumbQueueSoon();
    }

    function setThumbSource(img, real) {
      try {
        if (!img) return;
        const base = String(real || '');
        const prevBase = (img.dataset && typeof img.dataset.src === 'string') ? String(img.dataset.src || '') : '';
        const prevReal = (img.dataset && typeof img.dataset.real === 'string') ? String(img.dataset.real || '') : '';
        try {
          if (base && prevReal && base === prevReal && img.dataset && img.dataset._thumbLoaded === '1') {
            const cur = String(img.currentSrc || img.src || '');
            if (cur && cur !== FALLBACK_THUMB && !cur.includes('/media/pending-thumb.svg')) {
              return;
            }
          }
        } catch (e) {}
        if (base && base.startsWith('data:')) {
          img.src = base;
          try { if (img.dataset) img.dataset.src = ''; } catch (e) {}
          try { if (img.dataset) img.dataset.real = base; } catch (e) {}
          try { if (img.dataset) img.dataset._thumbLoaded = '1'; } catch (e) {}
          try { if (img.dataset) img.dataset._thumbQueued = ''; } catch (e) {}
          try { if (img.dataset) img.dataset._thumbFallback = ''; } catch (e) {}
          try { if (img.dataset) img.dataset.retries = '0'; } catch (e) {}
          try { if (img.dataset) img.dataset.next_retry_at = ''; } catch (e) {}
          try { thumbIo.unobserve(img); } catch (e) {}
          return;
        }
        if (base && (base.startsWith('/') || base.startsWith('https://') || base.startsWith('http://'))) {
          const preloader = new Image();
          preloader.onload = () => {
            try {
              img.src = base;
              try { if (img.dataset) img.dataset.src = ''; } catch (e) {}
              try { if (img.dataset) img.dataset.real = base; } catch (e) {}
              try { if (img.dataset) img.dataset._thumbLoaded = '1'; } catch (e) {}
              try { if (img.dataset) img.dataset._thumbQueued = ''; } catch (e) {}
              try { if (img.dataset) img.dataset._thumbFallback = ''; } catch (e) {}
            } catch (e) {}
          };
          preloader.onerror = () => {
            try {
              img.src = FALLBACK_THUMB;
              try { if (img.dataset) img.dataset._thumbFallback = '1'; } catch (e) {}
            } catch (e) {}
          };
          preloader.src = base;
          return;
        }
        img.src = FALLBACK_THUMB;
        try { if (img.dataset) img.dataset.src = base; } catch (e) {}
        try { if (img.dataset) img.dataset.real = base; } catch (e) {}
        try { if (img.dataset) img.dataset._thumbLoaded = ''; } catch (e) {}
        try { if (img.dataset) img.dataset._thumbQueued = ''; } catch (e) {}
        try { if (img.dataset) img.dataset._thumbFallback = base ? '1' : ''; } catch (e) {}
        try {
          if (img.dataset) {
            const baseUnchanged = prevBase && base && prevBase === base;
            const hasRetryState = !!(img.dataset.retries && String(img.dataset.retries) !== '0') || !!(img.dataset.next_retry_at && String(img.dataset.next_retry_at) !== '');
            if (!(baseUnchanged && hasRetryState)) {
              img.dataset.retries = '0';
              img.dataset.next_retry_at = '';
            }
          }
        } catch (e) {}
        if (base) {
          try { attachThumbRetry(img); } catch (e) {}
          try { thumbIo.observe(img); } catch (e) {}
        } else {
          try { if (img.dataset) img.dataset.real = ''; } catch (e) {}
          try { thumbIo.unobserve(img); } catch (e) {}
        }
      } catch (e) {}
    }

    function enqueueThumb(img) {
      try {
        if (!img || !img.dataset) return;
        const base = String(img.dataset.src || '');
        if (!base) return;
        if (img.dataset._thumbQueued === '1') return;
        if (img.dataset._thumbLoaded === '1') return;
        img.dataset._thumbQueued = '1';
        thumbQueue.push(img);
        drainThumbQueueSoon();
      } catch (e) {}
    }

    function drainThumbQueue() {
      try {
        while (thumbInflight.size < THUMB_MAX_INFLIGHT && thumbQueue.length) {
          const img = thumbQueue.shift();
          if (!img || !img.dataset) continue;
          if (!img.isConnected) continue;
          img.dataset._thumbQueued = '';
          const base = String(img.dataset.src || '');
          if (!base) continue;
          if (thumbInflight.has(img)) continue;
          const tries = parseInt(String(img.dataset.retries || '0'), 10) || 0;
          const bust = tries > 0 ? ((base.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now() + '-' + tries) : '';
          thumbInflight.add(img);
          img.src = base + bust;
        }
      } catch (e) {}
    }

    if (!window.thumbIo) {
      window.thumbIo = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const img = e.target;
          enqueueThumb(img);
          try { window.thumbIo.unobserve(img); } catch (e2) {}
        }
      }, { rootMargin: '1500px' });
    }
    var thumbIo = window.thumbIo;

    function pageIsScrollable() {
      try {
        const h = document.documentElement ? (document.documentElement.scrollHeight || 0) : 0;
        return h > (window.innerHeight + 40);
      } catch (e) {
        return true;
      }
    }

    function isNearBottom(margin = 700) {
      try {
        const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
        const viewport = window.innerHeight || 0;
        const full = document.documentElement ? (document.documentElement.scrollHeight || 0) : 0;
        return (scrollTop + viewport + margin) >= full;
      } catch (e) {
        return false;
      }
    }

    function primeThumbs(max = 8) {
      try {
        const imgs = elGrid.querySelectorAll('img.thumb');
        let n = 0;
        for (const img of imgs) {
          if (!img) continue;
          const src = img.dataset ? String(img.dataset.src || '') : (img.getAttribute ? String(img.getAttribute('data-src') || '') : '');
          if (!src) continue;
          try {
            const r = img.getBoundingClientRect();
            if (r && r.top > (window.innerHeight + 360)) continue;
          } catch (e) {}
          enqueueThumb(img);
          try { if (img.dataset) img.dataset.retries = img.dataset.retries || '0'; } catch (e) {}
          n++;
          if (n >= max) break;
        }
      } catch (e) {}
    }

    function refreshPendingThumbs(max = 4) {
      try {
        const imgs = elGrid.querySelectorAll('img.thumb');
        let n = 0;
        const now = Date.now();
        for (const img of imgs) {
          if (!img || !img.isConnected || !img.dataset) continue;
          const base = String(img.dataset.src || '');
          if (!base) continue;
          if (img.dataset._thumbLoaded === '1') continue;
          const cur = String(img.currentSrc || img.src || '');
          const isPending = cur.includes('/media/pending-thumb.svg');
          const isFallback = (img.dataset && img.dataset._thumbFallback === '1') || cur === FALLBACK_THUMB;
          if (!isPending && !isFallback) continue;

          try {
            const r = img.getBoundingClientRect();
            if (r && (r.bottom < -180 || r.top > (window.innerHeight + 320))) continue;
          } catch (e) {}

          const tries = parseInt(String(img.dataset.retries || '0'), 10) || 0;
          if (tries >= 30) continue;
          const nextAt = parseInt(String(img.dataset.next_retry_at || '0'), 10) || 0;
          if (nextAt && now < nextAt) continue;

          const delay = Math.min(120000, Math.floor(1200 * Math.pow(1.6, tries) + (Math.random() * 400)));
          try { img.dataset.next_retry_at = String(now + delay); } catch (e) {}
          try { img.dataset.retries = String(tries + 1); } catch (e) {}

          try { img.dataset._thumbLoaded = ''; } catch (e) {}
          try { img.dataset._thumbQueued = ''; } catch (e) {}
          enqueueThumb(img);
          n++;
          if (n >= max) break;
        }
      } catch (e) {}
    }

    function saveStateToUrl() {
      const params = new URLSearchParams();
      params.set('mode', state.mode);
      params.set('filter', state.filter);
      params.set('sort', state.sort);
      if (state.channel) {
        params.set('platform', state.channel.platform);
        params.set('channel', state.channel.channel);
      }
      const url = '/gallery?' + params.toString();
      history.replaceState({ page: 'gallery' }, '', url);
    }

    function restoreStateFromUrl() {
      const params = new URLSearchParams(window.location.search);
      if (params.has('mode')) state.mode = params.get('mode');
      if (params.has('filter')) state.filter = params.get('filter');
      if (params.has('sort')) state.sort = params.get('sort');
      if (params.has('platform') && params.has('channel')) {
        state.channel = { platform: params.get('platform'), channel: params.get('channel') };
      }
      
      if (elMode) elMode.value = state.mode;
      if (elFilter) elFilter.value = state.filter;
      if (elSort) elSort.value = state.sort;
    }

    function fmtItemSub(it) {
      if (!it) return '';
      const src = it.src ? ' - ' + it.src.split('/').pop() : '';
      const origin = it.origin_url ? ' (' + new URL(it.origin_url).hostname + ')' : '';
      return (it.platform || '-') + ' | ' + (it.channel || '-') + ' | ' + (it.type || '-') + ' | ' + (it.created_at || '-') + origin + src;
    }

    function syncZoomUi() {
      if (elZoomRange) elZoomRange.value = String(Math.round(state.zoom * 100));
      if (elBtnZoomReset) elBtnZoomReset.disabled = state.zoom <= 1;
    }

    function applyZoomTransform() {
      const el = state.currentMediaEl;
      if (!el) return;
      const transforms = [];
      if (state.rotation) transforms.push('rotate(' + state.rotation + 'deg)');
      if (state.zoom > 1) {
        transforms.push('scale(' + state.zoom + ')');
        transforms.push('translate(' + state.panX + 'px, ' + state.panY + 'px)');
      }
      el.style.transform = transforms.join(' ');
      if (elBtnZoomReset) elBtnZoomReset.disabled = state.zoom <= 1;
    }

    function resetZoom() {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      state.dragging = false;
      state.dragMoved = false;
      state.dragStart = null;
      applyZoomTransform();
      if (elZoomRange) elZoomRange.value = '100';
    }

    function rotateMedia() {
      state.rotation = (state.rotation + 90) % 360;
      applyZoomTransform();
    }

    function resetRotation() {
      state.rotation = 0;
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

      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(state.zoom + delta);
      }, { passive: false });

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
        try { img.decoding = 'async'; } catch (e) {}
        const thumbUrl = it.thumb || '';
        if (String(thumbUrl).startsWith('data:')) {
          setThumbSource(img, thumbUrl);
        } else {
          const real = thumbUrl || '';
          if (real) {
            setThumbSource(img, real);
          } else {
            setThumbSource(img, '');
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
        l1.textContent = it.channel_display || it.channel || 'unknown';
        const l2 = document.createElement('div');
        l2.className = 'line2';
        if (it && it.ready === false) {
          const st = (it.status || 'queued');
          const pct = Number.isFinite(Number(it.progress)) ? Math.max(0, Math.min(100, Number(it.progress))) : 0;
          l2.textContent = (it.title || '(download)') + ' • ' + st + ' ' + pct + '%';
        } else {
          l2.textContent = it.title_display || it.title || '(zonder titel)';
        }
        meta.appendChild(l1);
        meta.appendChild(l2);
        try {
          const ratingEl = makeRatingEl(it);
          meta.appendChild(ratingEl);
        } catch (e) {}

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
      const keysToAdd = new Set();
      for (const it of items) {
        const k = itemKey(it);
        if (k) keysToAdd.add(k);
      }
      for (const k of keysToAdd) {
        try {
          const existing = elGrid.querySelector('.card[data-key="' + CSS.escape(String(k)) + '"]');
          if (existing) existing.remove();
        } catch (e) {
          for (const c of Array.from(elGrid.querySelectorAll('.card'))) {
            try {
              if (String(c.dataset.key || '') === String(k)) c.remove();
            } catch (e2) {}
          }
        }
      }
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
        try { img.decoding = 'async'; } catch (e) {}
        const thumbUrl = it.thumb || '';
        if (String(thumbUrl).startsWith('data:')) {
          setThumbSource(img, thumbUrl);
        } else {
          const real = thumbUrl || '';
          if (real) {
            setThumbSource(img, real);
          } else {
            setThumbSource(img, '');
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
        l1.textContent = it.channel_display || it.channel || 'unknown';
        const l2 = document.createElement('div');
        l2.className = 'line2';
        if (it && it.ready === false) {
          const st = (it.status || 'queued');
          const pct = Number.isFinite(Number(it.progress)) ? Math.max(0, Math.min(100, Number(it.progress))) : 0;
          l2.textContent = (it.title || '(download)') + ' • ' + st + ' ' + pct + '%';
        } else {
          l2.textContent = it.title_display || it.title || '(zonder titel)';
        }
        meta.appendChild(l1);
        meta.appendChild(l2);
        try {
          const ratingEl = makeRatingEl(it);
          meta.appendChild(ratingEl);
        } catch (e) {}

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
      
      history.pushState({ page: 'viewer', index: idx }, '', '/gallery#viewer');
      
      // Clean up previous media properly
      if (state.currentMediaEl) {
        try {
          if (state.currentMediaEl.tagName === 'VIDEO') {
            state.currentMediaEl.pause();
            state.currentMediaEl.src = '';
            state.currentMediaEl.load();
          }
        } catch (e) {}
      }
      if (state.reverseInterval) {
        clearInterval(state.reverseInterval);
        state.reverseInterval = null;
      }
      state.reversePlayback = false;
      
      state.current = it;
      state.currentIndex = idx;
      state.currentMediaEl = null;
      if (elPanel) elPanel.classList.remove('portrait');
      
      // Sync modal dropdowns with current state
      if (elMFilter) elMFilter.value = state.filter;
      if (elMSort) elMSort.value = state.sort;

      const isReady = !(it && it.ready === false);
      elBtnOpen.disabled = !isReady;
      elBtnFinder.disabled = !isReady;

      elMTitle.textContent = it.title_display || it.title || '(zonder titel)';
      elMSub.textContent = fmtItemSub(it);
      try {
        if (elMRating) {
          elMRating.innerHTML = '';
          const r = makeRatingEl(it);
          try {
            if (elMRating.dataset) {
              elMRating.dataset.kind = r && r.dataset ? String(r.dataset.kind || '') : '';
              elMRating.dataset.id = r && r.dataset ? String(r.dataset.id || '') : '';
            }
          } catch (e2) {}
          elMRating.appendChild(r);
          setStars(elMRating, it && it.rating != null ? it.rating : 0);
        }
      } catch (e) {}
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
        el.controls = true;
        el.playsInline = true;
        el.autoplay = true;
        el.volume = state.volume;
        el.playbackRate = state.playbackSpeed;
        state.currentMediaEl = el;
        const source = document.createElement('source');
        source.src = it.src;
        const ext = (it.src || '').match(/\.(mp4|webm|mov|m4v|mkv|avi)(?:[?#]|$)/i);
        source.type = ext && ext[1] ? 'video/' + ext[1].toLowerCase().replace('m4v', 'mp4') : 'video/mp4';
        el.appendChild(source);
        el.addEventListener('volumechange', () => {
          state.volume = el.volume;
        });
        
        // Ensure slideshow wait timer recalculates if playback state changes
        const rescheduleIfSlideshow = () => {
          if (state.slideshow) {
            if (state.slideshowTimer) clearTimeout(state.slideshowTimer);
            scheduleSlideshowTick();
          }
        };
        el.addEventListener('play', rescheduleIfSlideshow);
        el.addEventListener('pause', rescheduleIfSlideshow);
        el.addEventListener('ended', () => {
          if (state.slideshow) {
            if (state.slideshowTimer) clearTimeout(state.slideshowTimer);
            gotoDelta(1).catch(() => {});
            scheduleSlideshowTick();
          }
        });

        try { el.disablePictureInPicture = true; } catch (e) {}
        try { el.setAttribute('disablePictureInPicture', ''); } catch (e) {}
        try { el.setAttribute('controlsList', 'noremoteplayback nodownload'); } catch (e) {}
        el.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); });
        el.addEventListener('click', (e) => { e.stopPropagation(); });
      } else {
        el = document.createElement('img');
        el.src = it.src;
        el.alt = it.title || '';
        el.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); });
      }
      elMBody.appendChild(el);
      attachZoomHandlers(el);
      elModal.classList.add('open');
      if (it.type === 'video') {
        setTimeout(() => {
          try {
            el.play();
          } catch (e) {}
        }, 3000);
      }
      
      // Auto-hide header after 3 seconds
      let hideHeaderTimer = null;
      if (elPanel && elPanel.querySelector('header')) {
        elPanel.querySelector('header').classList.add('hide');
      }
      const showHeader = () => {
        if (elPanel && elPanel.querySelector('header')) {
          elPanel.querySelector('header').classList.remove('hide');
        }
        if (hideHeaderTimer) clearTimeout(hideHeaderTimer);
        hideHeaderTimer = setTimeout(() => {
          if (elPanel && elPanel.querySelector('header')) {
            elPanel.querySelector('header').classList.add('hide');
          }
        }, 3000);
      };
      elMBody.addEventListener('mousemove', showHeader);
      elMBody.addEventListener('click', showHeader);
    }

    function closeModal(skipHistory) {
      stopSlideshow();
      if (state.reverseInterval) {
        clearInterval(state.reverseInterval);
        state.reverseInterval = null;
      }
      state.reversePlayback = false;
      elModal.classList.remove('open');
      elMBody.innerHTML = '';
      state.current = null;
      state.currentIndex = -1;
      state.currentMediaEl = null;
      resetZoom();
      resetRotation();
      
      if (!skipHistory && window.location.hash === '#viewer') {
        history.back();
      }
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

    function currentVideo() {
      const el = state.currentMediaEl;
      if (!el || String(el.tagName || '').toUpperCase() !== 'VIDEO') return null;
      return el;
    }

    function stopReversePlayback() {
      if (state.reverseInterval) {
        clearInterval(state.reverseInterval);
        state.reverseInterval = null;
      }
      state.reversePlayback = false;
    }

    function applyPlaybackState() {
      const v = currentVideo();
      if (!v) return;
      if (state.reverseInterval) {
        clearInterval(state.reverseInterval);
        state.reverseInterval = null;
      }
      if (state.reversePlayback) {
        const speed = Math.max(0.25, Math.min(4, Number(state.playbackSpeed) || 1));
        try { v.pause(); } catch (e) {}
        const intervalMs = Math.max(16, Math.round(80 / speed));
        const stepSeconds = Math.max(0.04, 0.08 * speed);
        state.reverseInterval = setInterval(() => {
          if (state.currentMediaEl !== v) {
            stopReversePlayback();
            return;
          }
          try {
            const nextTime = Math.max(0, Number(v.currentTime || 0) - stepSeconds);
            v.currentTime = nextTime;
            if (nextTime <= 0) v.pause();
          } catch (e) {
            stopReversePlayback();
          }
        }, intervalMs);
        return;
      }
      if (!(Number(state.playbackSpeed) > 0)) {
        try { v.pause(); } catch (e) {}
        return;
      }
      try { v.playbackRate = Math.max(0.25, Math.min(4, Number(state.playbackSpeed) || 1)); } catch (e) {}
      try { v.play().catch(() => {}); } catch (e) {}
    }

    function stepPlaybackControl(delta) {
      const signed = state.reversePlayback ? -Math.max(0.25, Number(state.playbackSpeed) || 1) : (Number(state.playbackSpeed) || 0);
      let next = Math.round((signed + delta) * 100) / 100;
      next = Math.max(-4, Math.min(4, next));
      if (Math.abs(next) < 0.001) next = 0;
      if (next < 0) {
        state.reversePlayback = true;
        state.playbackSpeed = Math.max(0.25, Math.abs(next));
      } else {
        state.reversePlayback = false;
        state.playbackSpeed = next;
      }
      applyPlaybackState();
    }

    async function gotoDelta(delta) {
      if (state.reverseInterval) {
        clearInterval(state.reverseInterval);
        state.reverseInterval = null;
      }
      state.reversePlayback = false;
      if (state.currentIndex < 0) return;
      
      let target;
      if (state.slideshow && state.random) {
        if (state.items.length <= 1) return;
        let r;
        do {
          r = Math.floor(Math.random() * state.items.length);
        } while (r === state.currentIndex);
        target = r;
      } else {
        target = state.currentIndex + delta;
      }

      if (target >= 0 && target < state.items.length) {
        openModalIndex(target);
        return;
      }
      if (!state.random && delta > 0 && !state.done) {
        await loadNext();
        const nextTarget = Math.min(state.items.length - 1, state.currentIndex + delta);
        if (nextTarget !== state.currentIndex) openModalIndex(nextTarget);
      } else if (!state.random && delta > 0 && state.done && state.mode === 'channel') {
        await changeViewerChannel(1);
      } else if (state.random || state.wrap) {
        // Fallback wrap if we overshot despite random not supposed to, or if regular wrap
        openModalIndex((target % state.items.length + state.items.length) % state.items.length);
      }
    }

    function stopSlideshow() {
      state.slideshow = false;
      if (state.slideshowTimer) clearTimeout(state.slideshowTimer);
      state.slideshowTimer = null;
      if (elMBtnSlideshow) elMBtnSlideshow.textContent = '▶︎ Dia';
    }

    function scheduleSlideshowTick() {
      if (!state.slideshow) return;
      const sec = parseInt(elMSlideshowSec ? elMSlideshowSec.value : 4, 10) || 4;
      
      let waitTimeMs = Math.max(1, sec) * 1000;
      
      if (state.videoWait) {
        const v = state.currentMediaEl;
        if (v && v.tagName === 'VIDEO' && !v.paused && !v.ended && v.duration) {
          const remaining = (v.duration - v.currentTime) * 1000;
          if (remaining > 0) {
            waitTimeMs = Math.max(waitTimeMs, remaining + 500); 
          }
        }
      }

      state.slideshowTimer = setTimeout(() => {
        gotoDelta(1).catch(() => {});
        scheduleSlideshowTick();
      }, waitTimeMs);
    }

    function startSlideshow() {
      state.slideshow = true;
      if (elMBtnSlideshow) elMBtnSlideshow.textContent = '⏸ Dia';
      scheduleSlideshowTick();
    }

    async function loadChannels() {
      const data = await api('/api/media/channels?limit=800');
      if (!data.success) throw new Error(data.error || 'channels failed');
      state.channels = data.channels || [];
      elChannelSel.innerHTML = '';
      for (const ch of state.channels) {
        const opt = document.createElement('option');
        opt.value = ch.platform + '||' + ch.channel;
        const chLabel = (String(ch.platform || '').toLowerCase() === 'footfetishforum' && /^thread_\d+$/i.test(String(ch.channel || '')))
          ? ('Thread ' + String(ch.channel || '').replace(/^thread_/i, ''))
          : ch.channel;
        opt.textContent = ch.platform + '/' + chLabel + ' (' + ch.count + ')';
        elChannelSel.appendChild(opt);
      }
      if (!state.channel && state.channels.length) {
        state.channel = { platform: state.channels[0].platform, channel: state.channels[0].channel };
      }
      if (state.channel) {
        elChannelSel.value = state.channel.platform + '||' + state.channel.channel;
      }
    }

    async function changeViewerChannel(delta) {
      if (state.mode !== 'channel') {
        state.mode = 'channel';
        if (elMode) elMode.value = 'channel';
        if (elChannelSel) elChannelSel.style.display = '';
      }
      if (!Array.isArray(state.channels) || !state.channels.length) {
        await loadChannels();
      }
      if (!Array.isArray(state.channels) || !state.channels.length) return;
      let idx = state.channels.findIndex((ch) => {
        return ch && state.channel
          && String(ch.platform || '') === String(state.channel.platform || '')
          && String(ch.channel || '') === String(state.channel.channel || '');
      });
      if (idx < 0) {
        idx = 0;
      } else {
        idx = (idx + delta + state.channels.length) % state.channels.length;
      }
      const ch = state.channels[idx];
      if (!ch) return;
      state.channel = { platform: ch.platform, channel: ch.channel };
      if (elChannelSel) elChannelSel.value = state.channel.platform + '||' + state.channel.channel;
      resetPaging();
      await loadNext();
      if (state.items.length) openModalIndex(0);
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
      if (state.loading || state.reloading || state.items.length === 0) return;
      try {
        let path = '';
        const dirsParam = state.enabledDirs ? '&dirs=' + encodeURIComponent(JSON.stringify(state.enabledDirs)) : '';
        if (state.mode === 'recent') {
          path = '/api/media/recent-files?limit=60&cursor=&type=' + encodeURIComponent(state.filter) + '&include_active=1' + dirsParam + '&_t=' + Date.now();
        } else {
          const ch = state.channel;
          if (!ch) return;
          path = '/api/media/channel-files?platform=' + encodeURIComponent(ch.platform) + '&channel=' + encodeURIComponent(ch.channel) + '&limit=60&cursor=&type=' + encodeURIComponent(state.filter) + '&include_active=1' + dirsParam + '&_t=' + Date.now();
        }
        const data = await api(path);
        if (!data || !data.success) return;
        const got = Array.isArray(data.items) ? data.items : [];
        const fresh = [];
        for (const it of got) {
          const k = itemKey(it);
          if (!k) continue;
          let found = false;
          for (const existing of state.items) {
            if (itemKey(existing) === k) { found = true; break; }
          }
          if (!found) fresh.push(it);
        }
        if (!fresh.length) return;
        state.items = fresh.concat(state.items);
        prependCards(fresh);
        setHint();
      } catch (e) {}
    }

    async function init() {
      try {
        const resp = await fetch('/api/directories');
        const data = await resp.json();
        if (data && data.success) {
          state.dirConfig = {
            directories: Array.isArray(data.directories) ? data.directories.slice() : [],
            enabled: Array.isArray(data.enabled) ? data.enabled.slice() : []
          };
          const sessionEnabledDirs = getSessionEnabledDirs();
          if (Array.isArray(sessionEnabledDirs)) {
            state.enabledDirs = sessionEnabledDirs.slice();
          } else if (Array.isArray(data.directories)) {
            state.enabledDirs = data.directories.slice();
          } else {
            state.enabledDirs = null;
          }
        }
      } catch (e) {}
      
      elMode.value = state.mode;
      elFilter.value = state.filter;
      if (state.mode === 'recent') {
        await loadNext();
      } else {
        await loadChannels();
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
      const startTime = Date.now();
      elSentinel.textContent = '⏳ Verbinden met server...';
      try {
        let path = '';
        const dirsParam = state.enabledDirs ? '&dirs=' + encodeURIComponent(JSON.stringify(state.enabledDirs)) : '';
        elSentinel.textContent = '📡 Aanvraag verzenden (limit=' + state.limit + ', filters=' + (state.enabledDirs ? state.enabledDirs.length : 'none') + ')...';
        if (state.mode === 'recent') {
          path = '/api/media/recent-files?limit=' + state.limit + '&cursor=' + encodeURIComponent(state.cursor) + '&type=' + encodeURIComponent(state.filter) + '&include_active=0&include_active_files=0' + '&sort=' + encodeURIComponent(state.sort || 'recent') + dirsParam;
        } else {
          const ch = state.channel;
          if (!ch) { state.done = true; return; }
          path = '/api/media/channel-files?platform=' + encodeURIComponent(ch.platform) + '&channel=' + encodeURIComponent(ch.channel) + '&limit=' + state.limit + '&cursor=' + encodeURIComponent(state.cursor) + '&type=' + encodeURIComponent(state.filter) + '&include_active=0&include_active_files=0' + '&sort=' + encodeURIComponent(state.sort || 'recent') + dirsParam;
        }
        const data = await api(path);
        const fetchTime = Date.now() - startTime;
        elSentinel.textContent = '⚙️ Verwerken (' + fetchTime + 'ms)...';
        if (!data.success) throw new Error(data.error || 'load failed');
        const items = data.items || [];
        const existing = new Set();
        for (const it of state.items) {
          try {
            const k = itemKey(it);
            if (k) existing.add(k);
          } catch (e) {}
        }
        const uniqueItems = [];
        for (const it of items) {
          try {
            const k = itemKey(it);
            if (!k) {
              uniqueItems.push(it);
              continue;
            }
            if (existing.has(k)) continue;
            existing.add(k);
            uniqueItems.push(it);
          } catch (e) {
            uniqueItems.push(it);
          }
        }
        state.items = state.items.concat(uniqueItems);
        state.cursor = data.next_cursor || '';
        state.done = data.done || false;
        addCards(uniqueItems);
        setHint();
        state.loading = false;
        const totalTime = Date.now() - startTime;
        const stats = items.length + ' items in ' + totalTime + 'ms';
        if (state.done) {
          elSentinel.innerHTML = '✓ Klaar: ' + stats;
        } else {
          elSentinel.innerHTML = '↓ Scroll voor meer (' + stats + ') <button onclick="loadNext()" style="margin-left:10px;padding:4px 8px;font-size:11px;background:#0f3460;color:#fff;border:1px solid #1f2a52;border-radius:4px;cursor:pointer;">Forceer laden</button>';
        }
      } catch (e) {
        state.loading = false;
        const totalTime = Date.now() - startTime;
        elSentinel.textContent = '❌ Fout na ' + totalTime + 'ms: ' + e.message;
        log('Load error: ' + e.message);
      }
    }

    window.addEventListener('scroll', () => {
      try {
        const y = window.scrollY || document.documentElement.scrollTop || 0;
        if (y > 50) state.hasUserScrolled = true;
      } catch (e) {}
    }, { passive: true });

    function pageIsScrollable() {
      try {
        const h = document.documentElement ? (document.documentElement.scrollHeight || 0) : 0;
        return h > (window.innerHeight + 40);
      } catch (e) {
        return true;
      }
    }

    var io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        if (state.loading || state.done) continue;
        
        const now = Date.now();
        if (now - (state.lastAutoLoadAt || 0) < 500) continue;
        state.lastAutoLoadAt = now;
        loadNext().catch(e => { log('LoadNext error: ' + e.message); });
      }
    }, { rootMargin: '3000px' });
    try { io.observe(elSentinel); } catch(e) {}

    // Fallback if IntersectionObserver gets stuck or scroll isn't detected
    setInterval(() => {
      if (state.loading || state.done) return;
      try {
        const r = elSentinel.getBoundingClientRect();
        if (r && r.top < window.innerHeight + 2000) {
          const now = Date.now();
          if (now - (state.lastAutoLoadAt || 0) > 1000) {
            state.lastAutoLoadAt = now;
            loadNext().catch(() => {});
          }
        }
      } catch (e) {}
    }, 1500);

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

    document.getElementById('btnReload').addEventListener('click', () => reloadAll());
    const elBtnDirSelect = document.getElementById('btnDirSelect');
    const elDirModal = document.getElementById('dirModal');
    const elBtnDirClose = document.getElementById('btnDirClose');
    const elBtnDirCancel = document.getElementById('btnDirCancel');
    const elBtnDirApply = document.getElementById('btnDirApply');
    const elBtnDirSelectAll = document.getElementById('btnDirSelectAll');
    const elBtnDirDeselectAll = document.getElementById('btnDirDeselectAll');
    const elDirList = document.getElementById('dirList');
    const elDirCount = document.querySelector('#dirModal .dir-count');

    function getSelectedDirsFromModal() {
      if (!elDirList) return [];
      return Array.from(elDirList.querySelectorAll('input[type="checkbox"]')).filter(c => c.checked).map(c => c.value);
    }

    function updateDirCount() {
      if (!elDirCount || !elDirList) return;
      const checks = Array.from(elDirList.querySelectorAll('input[type="checkbox"]'));
      const checked = checks.filter(c => c.checked).length;
      elDirCount.textContent = checked + '/' + checks.length + ' geselecteerd';
    }

    function renderDirList(dirConfig) {
      if (!elDirList) return;
      const directories = Array.isArray(dirConfig && dirConfig.directories) ? dirConfig.directories : [];
      const enabled = Array.isArray(dirConfig && dirConfig.enabled) ? dirConfig.enabled : [];
      const enabledSet = new Set(enabled);
      elDirList.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (const dirName of directories) {
        const label = document.createElement('label');
        label.className = 'dir-item';
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '8px';
        label.style.padding = '6px';
        label.style.borderBottom = '1px solid #1f2a52';
        label.style.cursor = 'pointer';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = dirName;
        input.checked = enabledSet.has(dirName);
        input.addEventListener('change', updateDirCount);

        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.flexDirection = 'column';
        wrap.style.flex = '1';

        const title = document.createElement('span');
        title.style.fontSize = '12px';
        title.style.color = '#eee';
        title.textContent = dirName;

        wrap.appendChild(title);
        label.appendChild(input);
        label.appendChild(wrap);
        frag.appendChild(label);
      }
      elDirList.appendChild(frag);
      updateDirCount();
    }

    async function loadDirConfig(force) {
      if (!force && state.dirConfig) return state.dirConfig;
      const data = await api('/api/directories');
      if (!data || !data.success) throw new Error(data && data.error ? data.error : 'directories load failed');
      state.dirConfig = {
        directories: Array.isArray(data.directories) ? data.directories.slice() : [],
        enabled: Array.isArray(data.enabled) ? data.enabled.slice() : []
      };
      return state.dirConfig;
    }

    if (elBtnDirSelect && elDirModal) {
      const closeDirModal = () => { elDirModal.style.display = 'none'; };

      elBtnDirSelect.addEventListener('click', async () => {
        elDirModal.style.display = 'flex';
        if (!elDirList) return;
        elDirList.textContent = 'Mappen laden...';
        try {
          const dirConfig = await loadDirConfig(false);
          const enabled = Array.isArray(state.enabledDirs) ? state.enabledDirs.slice() : (Array.isArray(dirConfig.enabled) ? dirConfig.enabled.slice() : []);
          renderDirList({ directories: dirConfig.directories, enabled });
        } catch (e) {
          elDirList.textContent = 'Kon mappen niet laden';
          if (elDirCount) elDirCount.textContent = '';
        }
      });

      if (elBtnDirClose) elBtnDirClose.addEventListener('click', closeDirModal);
      if (elBtnDirCancel) elBtnDirCancel.addEventListener('click', closeDirModal);

      if (elBtnDirApply) {
        elBtnDirApply.addEventListener('click', async () => {
          const selected = getSelectedDirsFromModal();
          state.enabledDirs = selected.slice();
          if (state.dirConfig) state.dirConfig.enabled = selected.slice();
          setSessionEnabledDirs(selected.slice());
          closeDirModal();
          await reloadAll();
        });
      }

      elDirModal.addEventListener('click', (e) => {
        if (e.target === elDirModal) closeDirModal();
      });
      if (elBtnDirSelectAll) {
        elBtnDirSelectAll.addEventListener('click', () => {
          if (!elDirList) return;
          for (const c of elDirList.querySelectorAll('input[type="checkbox"]')) c.checked = true;
          updateDirCount();
        });
      }
      if (elBtnDirDeselectAll) {
        elBtnDirDeselectAll.addEventListener('click', () => {
          if (!elDirList) return;
          for (const c of elDirList.querySelectorAll('input[type="checkbox"]')) c.checked = false;
          updateDirCount();
        });
      }
    }

    elMode.addEventListener('change', async () => { state.mode = elMode.value; await reloadAll(); });
    elFilter.addEventListener('change', async () => { state.filter = elFilter.value; await reloadAll(); });
    elSort.addEventListener('change', async () => { state.sort = elSort.value; await reloadAll(); });
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

    if (elMBtnSlideshow) {
      elMBtnSlideshow.addEventListener('click', () => {
        if (state.slideshow) stopSlideshow();
        else startSlideshow();
      });
    }
    if (elMBtnRandom) {
      elMBtnRandom.addEventListener('click', () => {
        state.random = !state.random;
        elMBtnRandom.textContent = state.random ? '🔀 Aan' : '🔀 Uit';
      });
    }
    if (elMSlideshowSec) {
      elMSlideshowSec.addEventListener('change', () => {
        if (state.slideshow) {
          if (state.slideshowTimer) clearTimeout(state.slideshowTimer);
          scheduleSlideshowTick();
        }
      });
    }
    if (elMBtnVideoWait) {
      elMBtnVideoWait.addEventListener('click', () => {
        state.videoWait = !state.videoWait;
        elMBtnVideoWait.textContent = state.videoWait ? '⏳ Aan' : '⏳ Uit';
        // Apply immediately if slideshow is running
        if (state.slideshow) {
          if (state.slideshowTimer) clearTimeout(state.slideshowTimer);
          scheduleSlideshowTick();
        }
      });
    }

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

    window.addEventListener('keydown', async (e) => {
      const tag = e.target && e.target.tagName ? String(e.target.tagName).toUpperCase() : '';
      const isFormTarget = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (!elModal.classList.contains('open')) {
        if (isFormTarget) return;
        if (e.key === 'ArrowUp') { e.preventDefault(); state.mode = 'recent'; elMode.value = 'recent'; await reloadAll(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); state.mode = 'channel'; elMode.value = 'channel'; await reloadAll(); return; }
        return;
      }
      if (isFormTarget && e.key !== 'Escape') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); await gotoDelta(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); await gotoDelta(-1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); await changeViewerChannel(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); await changeViewerChannel(1); }
      else if (e.key === ' ') {
        const v = currentVideo();
        if (v) {
          if (state.reversePlayback) {
            stopReversePlayback();
          }
          if (v.paused) v.play().catch(() => {});
          else v.pause();
        }
        e.preventDefault();
      }
      else if (e.key.toLowerCase() === 'm') {
        const v = currentVideo();
        if (v) {
          v.muted = !v.muted;
        }
        e.preventDefault();
      }
      else if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
    });

    init().catch(e => { elSentinel.textContent = 'Fout: ' + e.message; });
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
  const allowCookies = p === 'download' || p === 'metadata' && YTDLP_USE_COOKIES_FOR_METADATA;
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
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const DEFAULT_DB_ENGINE = DATABASE_URL ? 'postgres' : 'sqlite';
const WEBDL_DB_ENGINE = String(process.env.WEBDL_DB_ENGINE || DEFAULT_DB_ENGINE).trim();
if ((WEBDL_DB_ENGINE === 'postgres' || WEBDL_DB_ENGINE === 'pg') && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required when WEBDL_DB_ENGINE=postgres');
}
const db = createDb({ engine: WEBDL_DB_ENGINE, sqlitePath: DB_PATH, databaseUrl: DATABASE_URL });
if (db.isSqlite) db.pragma('journal_mode = WAL');

async function ensurePostgresSchemaReady() {
  if (!db.isPostgres) return;
  try {
    await db.prepare('ALTER TABLE downloads ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP').run();
  } catch (e) {}
  try {
    await db.prepare('ALTER TABLE downloads ADD COLUMN IF NOT EXISTS rating DOUBLE PRECISION').run();
  } catch (e) {}
  try {
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_downloads_finished_at ON downloads(finished_at DESC)').run();
  } catch (e) {}
  try {
    await db.prepare('ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS rating DOUBLE PRECISION').run();
  } catch (e) {}
  try {
    await db.prepare('ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP').run();
  } catch (e) {}

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
} catch (e) {}

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
      } catch (e) {}
    }
  }
} catch (e) {}

try {
  if (db.isSqlite) db.exec('CREATE INDEX IF NOT EXISTS idx_downloads_finished_at ON downloads(finished_at DESC)');
} catch (e) {}

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
} catch (e) {}

try {
  if (db.isSqlite) db.exec("UPDATE downloads SET finished_at = COALESCE(finished_at, updated_at) WHERE status IN ('completed','error','cancelled') AND (finished_at IS NULL OR TRIM(finished_at)='')");
} catch (e) {}

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
} catch (e) {}

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
} catch (e) {}

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
} catch (e) {}

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
  } catch (e) {}
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
  } catch (e) {}
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
  } catch (e) {}
}

async function emitDownloadStatusActivity(downloadId, status, progress, error, extra = {}) {
  try {
    const id = Number(downloadId);
    if (!Number.isFinite(id)) return;
    const st = String(status || '').toLowerCase();
    const pct = Number.isFinite(Number(progress)) ? Math.max(0, Math.min(100, Number(progress))) : null;
    setDownloadActivityContext(id, extra || {});
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
  } catch (e) {}
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
        const d = db.prepare('SELECT title, filename, filepath FROM downloads WHERE id = ' + (db.isPostgres ? '$1' : '?')).get(id);
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
  INSERT INTO download_files (download_id, relpath, filesize, mtime_ms, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(download_id, relpath) DO UPDATE SET
    filesize=excluded.filesize,
    mtime_ms=excluded.mtime_ms,
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
  } catch (e) {}
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
            try {await deleteDownloadFile.run(downloadId, rel);} catch (e) {}
            return;
          }
        }
        await upsertDownloadFile.run(downloadId, rel, size, mtime, createdAt);
      } catch (e) {}
    };

    if (st.isDirectory && st.isDirectory()) {
      const maxFiles = (row && Number.isFinite(Number(row._maxFiles))) ? Math.max(1, Number(row._maxFiles)) : DOWNLOAD_FILES_AUTO_INDEX_MAX_FILES;
      const files = listMediaFilesInDir(abs, maxFiles);
      if (!files || !files.length) return { ok: true, reason: 'dir empty' };
      for (const f of files) {
        await upsertOne(f);
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
      }
    } catch (e) {}

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
    }
  } catch (e) {
  } finally {
    downloadFilesAutoIndexInProgress = false;
  }
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
      NULL AS filepath,
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
      NULL AS filepath,
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

const getRecentHybridMediaWithActiveFiles = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      NULL AS filepath,
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
    WHERE d.status NOT IN ('pending', 'queued')
      AND d.filepath IS NOT NULL
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
    WHERE d.status NOT IN ('pending', 'queued')
      AND d.filepath IS NOT NULL
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
  )
  ORDER BY ts DESC
  LIMIT ? OFFSET ?
`);

const getRecentHybridMedia = db.prepare(db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      AND TRIM(d.filepath) != ''
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
      AND TRIM(s.filepath) != ''
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
      NULL AS filepath,
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
      NULL AS filepath,
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
const STATS_ROW_CACHE_MS = Math.max(150, parseInt(process.env.WEBDL_STATS_ROW_CACHE_MS || '800', 10) || 800);

async function getStatsRowCached() {
  const now = Date.now();
  if (statsRowCache && now - statsRowCacheAt < STATS_ROW_CACHE_MS) return statsRowCache;
  const row = await Promise.resolve(getStats.get());
  statsRowCache = row || {};
  statsRowCacheAt = now;
  return statsRowCache;
}

let statsCache = null;
let statsCacheAt = 0;
const STATS_CACHE_MS = Math.max(250, parseInt(process.env.WEBDL_STATS_CACHE_MS || '1500', 10) || 1500);

let recentFilesTopCache = new Map();
let recentFilesTopCacheAt = 0;
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

const HEAVY_DOWNLOAD_CONCURRENCY = parseInt(process.env.WEBDL_HEAVY_DOWNLOAD_CONCURRENCY || '4', 10);
const LIGHT_DOWNLOAD_CONCURRENCY = parseInt(process.env.WEBDL_LIGHT_DOWNLOAD_CONCURRENCY || '3', 10);

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
    const rows = await getRuntimeActiveDownloadRows();
    const ids = new Set();
    for (const r of rows || []) {
      if (r && r.id != null) ids.add(Number(r.id));
    }
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
    const proc = activeProcesses.get(id);
    if (proc) {
      try {proc.kill('SIGTERM');} catch (e) {}
      try {activeProcesses.delete(id);} catch (e) {}
    }

    if (kind === 'cancelled') {
      clearCancelled(id);
      startingJobs.delete(id);
      queuedJobs.delete(id);
      removeFromQueue(queuedHeavy, id);
      removeFromQueue(queuedLight, id);
      jobLane.delete(id);
      await updateDownloadStatus.run('cancelled', 0, null, id);
      return true;
    }
    if (kind === 'on_hold') {
      startingJobs.delete(id);
      queuedJobs.delete(id);
      removeFromQueue(queuedHeavy, id);
      removeFromQueue(queuedLight, id);
      jobLane.delete(id);
      await updateDownloadStatus.run('on_hold', 0, null, id);
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
  if (platform === 'instagram' || platform === 'wikifeet' || platform === 'kinky' || platform === 'reddit' || platform === 'aznudefeet' || platform === 'telegram') return 'light';
  if (platform === 'tiktok') return 'light';
  if (platform === 'onlyfans') return 'heavy';
  return 'heavy';
}

async function enqueueDownloadJob(downloadId, url, platform, channel, title, metadata) {
  const lane = detectLane(platform);
  setDownloadActivityContext(downloadId, { url, platform, channel, title, lane });
  queuedJobs.set(downloadId, { downloadId, url, platform, channel, title, metadata });
  jobLane.set(downloadId, lane);
  jobPlatform.set(downloadId, platform);
  await updateDownloadStatus.run('queued', 0, null, downloadId);

  if (lane === 'light') queuedLight.unshift(downloadId);else
  queuedHeavy.unshift(downloadId);

  if (METADATA_PROBE_ENABLED && METADATA_PROBE_CONCURRENCY > 0 && platform !== 'onlyfans' && platform !== 'instagram' && platform !== 'wikifeet' && platform !== 'kinky' && platform !== 'tiktok' && platform !== 'reddit' && platform !== 'aznudefeet') {
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
    syncRuntimeActiveState().catch(() => {});
  }, 120);
}

async function runDownloadScheduler() {
  const heavyLimit = Math.max(0, HEAVY_DOWNLOAD_CONCURRENCY);
  const lightLimit = Math.max(0, LIGHT_DOWNLOAD_CONCURRENCY);
  // console.log(`[SCHEDULER] Running... active=${activeProcesses.size} starting=${startingJobs.size}`);

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
      startDownload(job.downloadId, job.url, job.platform, job.channel, job.title, job.metadata).
      catch(() => {}).
      finally(() => {
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
    try {
      jobPlatform.set(id, job.platform);
    } catch (e) {}
    if (String(job.platform || '').toLowerCase() === 'youtube') markYoutubeStarted();
    try {
      startDownload(job.downloadId, job.url, job.platform, job.channel, job.title, job.metadata).
      catch(() => {}).
      finally(() => {
        startingJobs.delete(id);
        runDownloadSchedulerSoon();
      });
    } catch (e) {
      await updateDownloadStatus.run('error', 0, e.message, job.downloadId);
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
      const dur = meta && Number.isFinite(meta.durationSeconds) ? meta.durationSeconds : null;
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

async function getRuntimeActiveDownloadRows() {
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
    const statusList = mode === 'all' ?
    "('pending', 'queued', 'downloading', 'postprocessing')" :
    mode === 'queued' ?
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
        try {parsedMeta = JSON.parse(row.metadata);} catch (e) {parsedMeta = null;}
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
      const lane = detectLane(platform);
      queuedJobs.set(id, { downloadId: id, url, platform, channel, title, metadata });
      jobLane.set(id, lane);
      jobPlatform.set(id, platform);
      if (lane === 'light') queuedLight.push(id);else
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
    const statusList = mode === 'all' ?
    "('pending', 'queued', 'downloading', 'postprocessing')" :
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

      const lane = detectLane(platform);
      queuedJobs.set(id, { downloadId: id, url, platform, channel, title, metadata });
      jobLane.set(id, lane);
      jobPlatform.set(id, platform);
      if (lane === 'light') queuedLight.push(id);else
      queuedHeavy.push(id);

      // Vermijd zware DB writes tijdens startup; scheduler pakt queue direct op.

      if (STARTUP_METADATA_PROBE_ENABLED && METADATA_PROBE_ENABLED && METADATA_PROBE_CONCURRENCY > 0 && platform !== 'onlyfans' && platform !== 'instagram' && platform !== 'wikifeet' && platform !== 'kinky' && platform !== 'tiktok' && platform !== 'reddit' && platform !== 'aznudefeet') {
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
        try {ack(payload);} catch (e) {}
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
  const action = String(req.body && req.body.action ? req.body.action : 'open').toLowerCase();
  if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'id is vereist' });

  try {
    let row = null;
    if (kind === 'd') row = await getDownload.get(id);else
    if (kind === 's') row = await db.prepare(`SELECT * FROM screenshots WHERE id=?`).get(id);else
    return res.status(400).json({ success: false, error: 'kind moet d of s zijn' });
    if (!row) return res.status(404).json({ success: false, error: 'niet gevonden' });

    const fp = String(row.filepath || '').trim();

    if (row.platform === 'patreon') {
      console.log(`[DEBUG-PATREON-EXPAND] Processing id=${row.id}, fp=${fp}, isAllowed=${safeIsAllowedExistingPath(path.resolve(fp))}`);
    }

    if (!fp || !safeIsAllowedExistingPath(fp)) return res.status(404).json({ success: false, error: 'bestand niet gevonden' });

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
    } catch (e) {}
    try {
      const rel = raw.replace(/^\/+/, '');
      if (rel) candidates.push(path.resolve(BASE_DIR, rel));
    } catch (e) {}

    for (const abs of candidates) {
      try {
        if (safeIsAllowedExistingPath(abs)) return abs;
      } catch (e) {}
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
    const known = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif', '.heic', '.heif']);
    if (!known.has(ext)) {
      const mime = sniffMediaMimeByMagic(abs);
      if (mime) res.setHeader('Content-Type', mime);
    }
  } catch (e) {}
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
        let sched = 'error';
        try {sched = scheduleThumbGeneration(abs) || 'error';} catch (e) {}
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
      } catch (e) {}
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
      if (stat.isDirectory && stat.isDirectory()) spawn('/usr/bin/open', [abs]);else
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
  } catch (e) {}
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
    proc.stdout.on('data', (d) => {out += d.toString();});
    proc.stderr.on('data', (d) => {err += d.toString();});
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
      try {fs.unlinkSync(srcPath);} catch (e2) {}
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
      try { fs.closeSync(fd); } catch (e) {}
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
      try { fs.closeSync(fd); } catch (e) {}
    }
  } catch (e) {}
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
        proc.stderr.on('data', (d) => {stderr += d.toString();});
        proc.on('close', (code) => {
          let outSize = 0;
          try {
            if (code === 0 && outJpgPath && fs.existsSync(outJpgPath)) {
              const st = fs.statSync(outJpgPath);
              outSize = st && st.size ? st.size : 0;
              if (outSize >= MIN_THUMB_BYTES) return resolve();
            }
          } catch (e) {}
          try {if (outJpgPath) fs.rmSync(outJpgPath, { force: true });} catch (e) {}
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
      try { thumbGenFailOnce.clear(); } catch (e) {}
    }
    console.warn(`⚠️ thumb gen failed: ${abs} :: ${msg}`);
  } catch (e) {}
}

function drainThumbGenQueueSoon() {
  if (thumbGenTimer) return;
  thumbGenTimer = setTimeout(() => {
    thumbGenTimer = null;
    drainThumbGenQueue();
  }, 150);
}

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
    } catch (e) {}
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
  } catch (e) {}
  return 'error';
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
      pickOrCreateThumbPath(abs, { allowGenerate: true, throwOnError: true }).
      then((out) => {
        if (out) return;
        try {
          const st = fs.existsSync(abs) ? fs.statSync(abs) : null;
          const ageMs = st ? (Date.now() - (st.mtimeMs || 0)) : 0;
          if (ageMs > 15000) {
            logThumbGenFailureOnce(abs, new Error('thumb gen returned null'));
            try {
              thumbGenCooldownUntil.set(abs, Date.now() + THUMB_GEN_COOLDOWN_MS);
              if (thumbGenCooldownUntil.size > 12000) {
                const keys = Array.from(thumbGenCooldownUntil.keys()).slice(0, Math.max(1, thumbGenCooldownUntil.size - 9000));
                for (const k of keys) thumbGenCooldownUntil.delete(k);
              }
            } catch (e) {}
          }
        } catch (e) {}
      }).
      catch((e) => {
        try { logThumbGenFailureOnce(abs, e); } catch (e2) {}
        try {
          const st = fs.existsSync(abs) ? fs.statSync(abs) : null;
          const ageMs = st ? (Date.now() - (st.mtimeMs || 0)) : 0;
          if (ageMs > 15000) thumbGenCooldownUntil.set(abs, Date.now() + THUMB_GEN_COOLDOWN_MS);
        } catch (e2) {}
      }).
      finally(() => {
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
    if (!safeIsAllowedExistingPath(abs)) return null;
    const allowGenerate = !(opts && opts.allowGenerate === false);

    const inflight = pickOrCreateThumbPath._inflight;
    const cache = pickOrCreateThumbPath._cache;
    if (inflight && inflight.has(abs)) {
      try {return await inflight.get(abs);} catch (e) {return null;}
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
        } catch (e) {}

        const out = makeVideoThumbPath(abs);
        if (!out || !safeIsInsideBaseDir(out)) return null;
        if (fs.existsSync(out)) {
          try {
            const st2 = fs.statSync(out);
            if (st2 && (st2.size || 0) >= MIN_THUMB_BYTES) return out;
            try {fs.rmSync(out, { force: true });} catch (e) {}
          } catch (e) {}
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
              try {fs.rmSync(out, { force: true });} catch (e) {}
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
      try {if (inflight && inflight.delete) inflight.delete(abs);} catch (e) {}
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
    finalFilePath];


    if (POSTPROCESS_THREADS) {
      args.splice(args.indexOf('-i') + 2, 0, '-threads', POSTPROCESS_THREADS);
    }

    if (VIDEO_CODEC === 'h264_videotoolbox') {
      args.splice(args.indexOf('-pix_fmt'), 0, '-realtime', '1', '-prio_speed', '1');
    }

    const proc = spawnNice(FFMPEG, args);

    let stderr = '';
    proc.stderr.on('data', (d) => {stderr += d.toString();});

    proc.on('close', (code) => {
      try {fs.unlinkSync(cmdFile);} catch (e) {}
      if (code === 0) return resolve();
      reject(new Error(stderr || `ffmpeg exit code ${code}`));
    });

    proc.on('error', (err) => {
      try {fs.unlinkSync(cmdFile);} catch (e) {}
      reject(err);
    });
  });
}

function probeVideoSize(filePath) {
  return new Promise((resolve) => {
    const args = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', filePath];
    const proc = spawn(FFPROBE, args);
    let out = '';

    proc.stdout.on('data', (d) => {out += d.toString();});

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
        try {proc.kill('SIGKILL');} catch (e) {}
        resolve(null);
      }, 7000);

      proc.stdout.on('data', (d) => {
        chunks.push(d);
        bytes += d.length;
        if (bytes >= 16 * 16) {
          try {proc.kill('SIGKILL');} catch (e) {}
        }
      });

      proc.on('close', () => {
        if (done) return;
        done = true;
        try {clearTimeout(timer);} catch (e) {}
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
        try {clearTimeout(timer);} catch (e) {}
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
  try {sizeBytes = fs.statSync(fp).size || 0;} catch (e) {sizeBytes = 0;}
  let durationSec = null;
  try {durationSec = await probeVideoDurationSeconds(fp);} catch (e) {durationSec = null;}
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
    let stderr = '';
    proc.stderr.on('data', (d) => {stderr += d.toString();});
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
  if (/aznudefeet\.com/i.test(u)) return 'aznudefeet';
  if (((/t\.me|telegram\.me/i.test(u)) || (/web\.telegram\.org/i.test(u) && /#-?\d+/.test(u))) && !/web\.telegram\.org.*#@/i.test(u)) return 'telegram';
    if (/patreon\.com/i.test(u)) return 'patreon';
  if (/tiktok\.com|tiktokv\.com/i.test(u)) return 'tiktok';

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
'telegram',
'tiktok',
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
    const m = u.match(/footfetishforum\.com\/threads\/[^\/\?#]*\.(\d+)(?:\/|\?|#|$)/i);
    if (m && m[1]) return `thread_${m[1]}`;
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
    const m = u.match(/kinky\.nl\/([^\/\?#]+)/i);
    if (m) return m[1];
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
    } catch (e) {}
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
  const dir = path.join(BASE_DIR, safePlatform, safeChannel, safeTitle);
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

    proc.stdout.on('data', (d) => {stdoutAll += d.toString();});
    proc.stderr.on('data', (d) => {stderrAll += d.toString();});

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
      try {proc.kill('SIGTERM');} catch (e) {}
      setTimeout(() => {try {proc.kill('SIGKILL');} catch (e) {}}, 2500);
      reject(new Error(`yt-dlp metadata timeout after ${timeoutMs}ms`));
    }, Math.max(1000, Number(timeoutMs) || 20000));

    proc.stdout.on('data', (d) => {stdoutAll += d.toString();});
    proc.stderr.on('data', (d) => {stderrAll += d.toString();});

    const finish = (fn) => {
      if (done) return;
      done = true;
      try {clearTimeout(timer);} catch (e) {}
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
    }}

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
      } catch (e) {}
    }
    dbActiveByStatus = m;
    dbQueuedCount = (m && Number.isFinite(Number(m.queued))) ? Number(m.queued) : 0;
    dbPendingCount = (m && Number.isFinite(Number(m.pending))) ? Number(m.pending) : 0;
    dbDownloadingCount = (m && Number.isFinite(Number(m.downloading))) ? Number(m.downloading) : 0;
    dbPostprocessingCount = (m && Number.isFinite(Number(m.postprocessing))) ? Number(m.postprocessing) : 0;
    const ip = await getInProgressDownloadCount.get();
    dbInProgressCount = ip && Number.isFinite(Number(ip.n)) ? Number(ip.n) : 0;
  } catch (e) {
    dbStatusError = (e && e.message) ? e.message : String(e);
  }
  res.json({
    status: 'running',
    isRecording,
    activeDownloads: runtimeActive.length,
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
    recent_download_activity: recentDownloadActivity.slice(-80).reverse(),
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
      if (a.to === 'completed') await updateDownloadStatus.run('completed', 100, null, a.id);else
      if (a.to === 'error') await updateDownloadStatus.run('error', 0, String(a.reason || 'stuck'), a.id);
      cleanupSchedulerForId(a.id);
      applied.push(a);
    } catch (e) {}
  }

  try {runDownloadSchedulerSoon();} catch (e) {}
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
      let newest = fs.statSync(manifestPath).mtimeMs;
      if (fs.existsSync(toolbarPath)) newest = Math.max(newest, fs.statSync(toolbarPath).mtimeMs);
      if (fs.existsSync(backgroundPath)) newest = Math.max(newest, fs.statSync(backgroundPath).mtimeMs);

      if (!force && outStat && outMtime >= newest) return resolve();

      const tmpOut = path.join(os.tmpdir(), `webdl-addon-${Date.now()}-${Math.random().toString(36).slice(2)}.xpi`);
      try {fs.rmSync(tmpOut, { force: true });} catch (e) {}

      const zipProc = spawn('/usr/bin/zip', ['-r', '-q', tmpOut, '.', '-x', '*.DS_Store', '__MACOSX/*'], {
        cwd: ADDON_SOURCE_DIR
      });
      const buildTimeout = setTimeout(() => {
        try {zipProc.kill('SIGKILL');} catch (e) {}
      }, buildTimeoutMs);
      let stderr = '';
      zipProc.stderr.on('data', (d) => {stderr += d.toString();});
      zipProc.on('error', (err) => reject(err));
      zipProc.on('close', (code) => {
        clearTimeout(buildTimeout);
        if (code !== 0) {
          try {fs.rmSync(tmpOut, { force: true });} catch (e) {}
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
          try {fs.rmSync(tmpOut, { force: true });} catch (e2) {}
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
  } catch (e) {}
  if (isRecording || recordingProcess) return res.json({ success: false, error: 'Er loopt al een opname' });

  const { metadata = {}, crop, lock } = req.body || {};
  let resolved = metadata;
  try {
    resolved = await resolveMetadata(metadata.url, metadata);
  } catch (e) {

    // fallback blijft metadata
  }const platform = resolved.platform || 'other';
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
  try {
    console.log(`[INGRESS] POST /stop-recording recording=${isRecording ? '1' : '0'}`);
  } catch (e) {}
  if (!isRecording || !recordingProcess) {
    return res.json({ success: false, error: 'Er loopt geen opname' });
  }

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
    recordingProcess = null;
    isRecording = false;
    currentRecording = null;
    broadcastRecordingState();
  };

  const softTimeout = setTimeout(() => {
    if (recordingProcess) {recordingProcess.kill('SIGINT');}
  }, 20000);

  const hardTimeout = setTimeout(() => {
    if (recordingProcess) {
      console.warn('ffmpeg stop timeout, force kill');
      recordingProcess.kill('SIGKILL');
      cleanup();
      finish(false, 'Opname stop timeout');
    }
  }, 40000);

  proc.once('close', async () => {
    clearTimeout(softTimeout);
    clearTimeout(hardTimeout);
    cleanup();

    const meta = lockJob && lockJob.meta ? lockJob.meta : currentRecordingMeta;

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
        const ins = await insertCompletedDownload.run(
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
            await updateDownload.run('completed', 100, fp, path.basename(fp), finalSize, 'mp4', JSON.stringify(recordMeta), null, dbId);
          } catch (e) {}
        }

        try {
          fs.appendFileSync(lockJob.logFile, `\n[WEBDL] LOCK CROP done: ${lockJob.finalFilePath}\n`);
        } catch (e) {}
      })().catch(async (e) => {
        if (dbId) {
          try {
            await updateDownloadStatus.run('error', 0, e.message, dbId);
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
  try {
    console.log(`[INGRESS] POST /download url=${String(url || '').slice(0, 200)} page=${String(metadata && metadata.url || '').slice(0, 200)} force=${force === true ? '1' : '0'}`);
  } catch (e) {}
  if (!url) return res.status(400).json({ success: false, error: 'URL is vereist' });
  const forceDuplicates = force === true;

  const metaPlatform = metadata && typeof metadata.platform === 'string' ? metadata.platform : null;
  const effectiveUrl = String(url || '');

    const isProfileUrl = (u) => {
      if (u.includes('patreon.com/c/') || u.match(/patreon\.com\/.*\/posts/)) return true;
      if (u.includes('youtube.com/@') || u.includes('youtube.com/channel/') || u.includes('youtube.com/c/')) return true;
      if (u.includes('reddit.com/user/') || u.includes('reddit.com/r/') && !u.includes('/comments/')) return true;
      if (u.includes('onlyfans.com/') && !u.includes('/posts/')) return true;
      return false;
    };
    if (isProfileUrl(effectiveUrl)) {
      return res.status(400).json({ success: false, error: 'Dit is een profiel/kanaal link. Gebruik de BATCH knop in de extensie om het hele kanaal te downloaden.' });
    }


  const pageUrl = metadata && typeof metadata.url === 'string' ? metadata.url.trim() : '';
  const originPlatform = normalizePlatform(metaPlatform, pageUrl || effectiveUrl);
  const pinFffOrigin = !!(originPlatform === 'footfetishforum' && pageUrl && pageUrl !== effectiveUrl && isFootfetishforumThreadUrl(pageUrl));
  const pinAznOrigin = !!(originPlatform === 'aznudefeet' && pageUrl && pageUrl !== effectiveUrl && isAznudefeetViewUrl(pageUrl));
  const pinToOrigin = !!(pinFffOrigin || pinAznOrigin);
  const detectedPlatform = detectPlatform(effectiveUrl);
  const originChannel = metadata && metadata.channel ? metadata.channel : deriveChannelFromUrl(originPlatform, pageUrl || effectiveUrl) || 'unknown';
  const originTitle = metadata && metadata.title ? metadata.title : deriveTitleFromUrl(pageUrl || effectiveUrl);

  const preferDetectedPlatform = !!(pinFffOrigin && detectedPlatform && detectedPlatform !== 'other' && detectedPlatform !== originPlatform);
  const platform = preferDetectedPlatform ? detectedPlatform : (pinToOrigin ? originPlatform : normalizePlatform(metaPlatform, effectiveUrl));
  const channel = preferDetectedPlatform ?
  deriveChannelFromUrl(platform, effectiveUrl) || originChannel :
  pinToOrigin ?
  originChannel :
  metadata && metadata.channel ? metadata.channel : deriveChannelFromUrl(platform, effectiveUrl) || 'unknown';
  const title = preferDetectedPlatform ?
  deriveTitleFromUrl(effectiveUrl) :
  pinToOrigin ?
  originTitle :
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
    } catch (e) {}
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

  try {
    const pageUrl = metadata && typeof metadata.url === 'string' ? metadata.url.trim() : '';
    if (pageUrl && pageUrl !== effectiveUrl) {
      await updateDownloadSourceUrl.run(pageUrl, downloadId);
    }
  } catch (e) {}

  try {
    const thumb = metadata && typeof metadata.thumbnail === 'string' ? metadata.thumbnail.trim() : '';
    if (thumb) await updateDownloadThumbnail.run(thumb, downloadId);
  } catch (e) {}

  console.log(`\n📥 Download gestart #${downloadId}: ${effectiveUrl}`);
  console.log(`   Platform: ${platform} | Kanaal: ${channel} | Titel: ${title}`);

  res.json({ success: true, downloadId, platform, channel, title });

  const jobMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {};
  if (forceDuplicates) jobMetadata.webdl_force = true;
  if (pinToOrigin) {
    jobMetadata.webdl_pin_context = true;
    jobMetadata.origin_thread = { url: pageUrl, platform: originPlatform, channel: originChannel, title: originTitle };
    jobMetadata.webdl_media_url = effectiveUrl;
    jobMetadata.webdl_detected_platform = detectedPlatform;
  }
  enqueueDownloadJob(downloadId, effectiveUrl, platform, channel, title, jobMetadata);
});

expressApp.post('/reddit/index', async (req, res) => {
  try {
    const body = req.body || {};
    const seedUrl = String(body.url || '').trim();
    try {
      console.log(`[INGRESS] POST /reddit/index url=${seedUrl.slice(0, 200)} maxItems=${String(body.maxItems || '')} maxPages=${String(body.maxPages || '')}`);
    } catch (e) {}
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

expressApp.post('/download/batch', async (req, res) => {
  const { urls, metadata, force } = req.body || {};
  try {
    const n = Array.isArray(urls) ? urls.length : 0;
    console.log(`[INGRESS] POST /download/batch count=${n} page=${String(metadata && metadata.url || '').slice(0, 200)} force=${force === true ? '1' : '0'}`);
  } catch (e) {}
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ success: false, error: 'urls is vereist' });
  }
  const forceDuplicates = force === true;

  const metaPlatform = metadata && typeof metadata.platform === 'string' ? metadata.platform : null;
  const pageUrl = metadata && typeof metadata.url === 'string' ? metadata.url.trim() : '';
  const originPlatform = normalizePlatform(metaPlatform, pageUrl || '');
  const pinFffOrigin = !!(originPlatform === 'footfetishforum' && pageUrl && isFootfetishforumThreadUrl(pageUrl));
  const pinAznOrigin = !!(originPlatform === 'aznudefeet' && pageUrl && isAznudefeetViewUrl(pageUrl));
  const originChannel = metadata && metadata.channel ? metadata.channel : deriveChannelFromUrl(originPlatform, pageUrl) || 'unknown';
  const originTitle = metadata && metadata.title ? metadata.title : deriveTitleFromUrl(pageUrl);

  const unique = [];
  const seen = new Set();
  for (const u of urls) {
    const raw = typeof u === 'string' ? u.trim() : '';
    const s = isRedditFamilyUrl(raw) ? canonicalizeRedditCandidateUrl(raw) : raw;
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    unique.push(s);
  }

  const created = [];
  for (const u of unique) {
    const pinToOrigin = !!((pinFffOrigin || pinAznOrigin) && pageUrl && pageUrl !== u);
    const detectedPlatform = detectPlatform(u);
    const preferDetectedPlatform = !!(pinFffOrigin && pinToOrigin && detectedPlatform && detectedPlatform !== 'other' && detectedPlatform !== originPlatform);
    const platform = preferDetectedPlatform ? detectedPlatform : (pinToOrigin ? originPlatform : normalizePlatform(metaPlatform, u));
    const channel = preferDetectedPlatform ? deriveChannelFromUrl(platform, u) || originChannel : pinToOrigin ? originChannel : metadata && metadata.channel ? metadata.channel : deriveChannelFromUrl(platform, u) || 'unknown';
    const title = preferDetectedPlatform ? deriveTitleFromUrl(u) : pinToOrigin ? originTitle : metadata && metadata.title ? metadata.title : deriveTitleFromUrl(u);
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

    try {
      const pageUrl = metadata && typeof metadata.url === 'string' ? metadata.url.trim() : '';
      if (pageUrl && pageUrl !== u) {
        await updateDownloadSourceUrl.run(pageUrl, downloadId);
      }
    } catch (e) {}

    created.push({ downloadId, url: u, platform, channel, title });
    const jobMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {};
    if (forceDuplicates) jobMetadata.webdl_force = true;
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

  let driver = 'yt-dlp';
  if (platform === 'onlyfans') driver = 'ofscraper'; else
  if (platform === 'instagram') driver = 'instaloader'; else
  if (platform === 'reddit') driver = 'reddit-dl'; else
  if (platform === 'telegram') driver = 'tdl'; else
  if (
    platform === 'wikifeet' ||
    platform === 'wikifeetx' ||
    platform === 'kinky' ||
    platform === 'aznudefeet' && !looksLikeDirectFileUrl(url) ||
    platform === 'tiktok' && isTikTokPhotoUrl(url)
  ) driver = 'gallery-dl'; else
  if (isKnownHtmlWrapperUrl(url) || looksLikeDirectFileUrl(url)) driver = 'direct';
  setDownloadActivityContext(downloadId, { url, platform, channel, title, lane: jobLane.get(downloadId) || '', driver });
  emitDownloadEventActivity('dispatch', downloadId, { url, platform, channel, title, lane: jobLane.get(downloadId) || '', driver }).catch(() => {});

  const forceDuplicates = !!(metadata && typeof metadata === 'object' && !Array.isArray(metadata) && (metadata.webdl_force === true || metadata.force === true));

  try {
    const allowRedditRerun = platform === 'reddit' && isRedditRollingTargetUrl(url);
    const allowPatreonRerun = platform === 'patreon' && (url.includes('/posts') || url.includes('patreon.com/c/'));
    const allowRerun = allowRedditRerun || allowPatreonRerun;
    const reusable = await findReusableDownloadByUrlExcludingId.get(url, downloadId);
    if (!forceDuplicates && reusable && reusable.id) {
      if (allowRerun && String(reusable.status || '') === 'completed') {

        // Voor r/<subreddit> en u/<user> willen we herhaalde scans toestaan.
      } else {if (reusable.status === 'completed' && reusable.filepath) {
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

  if (platform === 'telegram') {
    return startTdlDownload(downloadId, url, platform, channel, title, metadata);
  }

  if (
    platform === 'wikifeet' ||
    platform === 'wikifeetx' ||
    platform === 'kinky' ||
    (platform === 'aznudefeet' && !looksLikeDirectFileUrl(url)) ||
    platform === 'tiktok' && isTikTokPhotoUrl(url)
  ) {
    return startGalleryDlDownload(downloadId, url, platform, channel, title, metadata);
  }

  if (isKnownHtmlWrapperUrl(url)) {
    try {
      const resolved = await resolveHtmlWrapperToDirectMediaUrl(url, 15000);
      if (resolved && resolved !== url) {
        try {await updateDownloadUrl.run(resolved, downloadId);} catch (e) {}
        const nextMeta = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {};
        if (!nextMeta.webdl_input_url) nextMeta.webdl_input_url = url;
        nextMeta.webdl_resolved_url = resolved;
        return startDirectFileDownload(downloadId, resolved, platform, channel, title, nextMeta);
      }
    } catch (e) {}
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
    try {await updateDownloadFilepath.run(dir, downloadId);} catch (e) {}
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
      try {startingJobs.delete(downloadId);} catch (e) {}
      let stderr = '';
      let stdout = '';
      proc.stderr.on('data', (d) => {stderr += d.toString();});
      proc.stdout.on('data', (d) => {stdout += d.toString();});
      const finish = (code) => {
        activeProcesses.delete(downloadId);
        if (createdAuthFile) {
          try {fs.unlinkSync(authFilePath);} catch (e) {}
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
    'pdf']
    );
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

async function fetchTextWithTimeout(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try {ctrl.abort();} catch (e) {}
  }, Math.max(1000, timeoutMs));
  try {
    const res = await fetch(String(url || ''), {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: ctrl.signal
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, contentType: String(res.headers.get('content-type') || '') };
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
    /<meta\s+[^>]*(?:property|name)=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i];

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

async function resolveHtmlWrapperToDirectMediaUrl(url, timeoutMs = 15000) {
  try {
    const u0 = String(url || '').trim();
    if (!u0) return '';
    const r = await fetchTextWithTimeout(u0, timeoutMs);
    if (!r || !r.text) return '';
    if (r.contentType && r.contentType.toLowerCase().startsWith('image/')) return u0;
    if (r.contentType && r.contentType.toLowerCase().startsWith('video/')) return u0;
    const og = extractOpenGraphMediaUrl(r.text, u0);
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
    const name = base && base !== '/' && base !== '.' && base !== '..' ? base : '';
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
      await updateDownloadStatus.run('cancelled', 0, null, downloadId);
      return;
    }
    await updateDownloadStatus.run('downloading', 0, null, downloadId);

    const pinContext = !!(metadata && typeof metadata === 'object' && !Array.isArray(metadata) && metadata.webdl_pin_context === true);
    const originThread = metadata && typeof metadata === 'object' && metadata.origin_thread && typeof metadata.origin_thread === 'object' ? metadata.origin_thread : null;
    const pinnedPlatform = String(originThread && originThread.platform ? originThread.platform : platform || '').toLowerCase();

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
      const finalChannel = pinContext ? channel : meta.channel || channel;
      await updateDownloadMeta.run(finalTitle, finalChannel, meta.description, meta.duration, meta.thumbnail, JSON.stringify(meta.fullMeta), downloadId);
      title = finalTitle;
      channel = finalChannel;
      console.log(`   [#${downloadId}] ✅ Metadata: "${title}" door ${channel} (${meta.duration})`);
    } catch (e) {
      console.log(`   [#${downloadId}] ⚠️ Metadata ophalen mislukt: ${e.message}`);
    }

    dir = pinContext && pinnedPlatform === 'aznudefeet' ? getDownloadDirChannelOnly(platform, channel) : getDownloadDir(platform, channel, title);
    try {await updateDownloadFilepath.run(dir, downloadId);} catch (e) {}

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

    const filename = filenameFromUrl(url, `download_${downloadId}.bin`);
    const filepath = uniqueFilePath(path.join(dir, filename), downloadId);
    const tmpFilepath = uniqueFilePath(filepath + '.part', downloadId);
    const referer = String(
      originThread && originThread.url ? originThread.url :
      metadata && typeof metadata === 'object' && metadata.url && metadata.url !== url ? metadata.url :
      ''
    ).trim();
    const curlArgs = [
      '-L',
      '--fail',
      '--silent',
      '--show-error',
      '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    ];
    if (referer) curlArgs.push('-e', referer);
    curlArgs.push('-o', tmpFilepath, url);
    const proc = spawnNice('/usr/bin/curl', curlArgs);

    activeProcesses.set(downloadId, proc);
    try {startingJobs.delete(downloadId);} catch (e) {}
    let stderr = '';
    proc.stderr.on('data', (d) => {stderr += d.toString();});
    proc.stdout.on('data', () => {});

    proc.on('close', async (code) => {
      activeProcesses.delete(downloadId);
      if (code === 0 && fs.existsSync(tmpFilepath)) {
        try {
          if (fs.existsSync(filepath)) {
            try {fs.rmSync(filepath, { force: true });} catch (e) {}
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
          } catch (e) {}
        }

        await updateDownload.run('completed', 100, filepath, filename, size, ext || '', JSON.stringify(metaObj), null, downloadId);
      } else {
        await updateDownloadStatus.run('error', 0, stderr || `curl exit code: ${code}`, downloadId);
      }
    });

    proc.on('error', async (err) => {
      activeProcesses.delete(downloadId);
      await updateDownloadStatus.run('error', 0, err.message, downloadId);
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
    try {await updateDownloadFilepath.run(dir, downloadId);} catch (e) {}
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
    } catch (e) {}

    if (!chatId) {
      await updateDownloadStatus.run('error', 0, 'Kon chat ID niet afleiden uit URL. Gebruik t.me/c/123456 formaat of web.telegram.org/#-123456', downloadId);
      return;
    }

    const args = [scriptPath, chatId, dir];
    const proc = spawn('python3', args, { env: { ...process.env, TELEGRAM_PHONE: process.env.TELEGRAM_PHONE || '' } });
    activeProcesses.set(downloadId, proc);
    try {startingJobs.delete(downloadId);} catch (e) {}
    let stderr = '';
    let stdout = '';
    proc.stderr.on('data', (d) => {stderr = (stderr + d.toString()).slice(-200000);});
    proc.stdout.on('data', (d) => {
      stdout = (stdout + d.toString()).slice(-200000);
      const lines = d.toString().split('\n');
      for (const line of lines) {
        if (line.includes('✅ [') && line.includes('] Downloaded:')) {
          const match = line.match(/\[(\d+)\]/);
          if (match) {
            const count = parseInt(match[1], 10);
            updateDownloadStatus.run('downloading', Math.min(99, count * 5), null, downloadId).catch(() => {});
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
          for (const file of files) {
            try {
              const fullPath = path.join(dir, file);
              const st = fs.statSync(fullPath);
              // Skip gallery-dl downloaded thumbnails/logos (not server-generated ones)
              if (file.endsWith('_thumb.jpg') || file.endsWith('_thumb.png') || file.endsWith('_logo.jpg') || file.endsWith('_logo.png')) continue;
              if (st.isFile() && /\.(mp4|webm|mkv|avi|mov|jpg|jpeg|png|gif|webp)$/i.test(file)) {
                const relPath = path.relative(BASE_DIR, fullPath);
                if (relPath && !relPath.startsWith('..')) {
                  await upsertDownloadFile.run(downloadId, relPath, st.size, Math.floor(st.mtimeMs), new Date().toISOString());
                }
              }
            } catch (e) {}
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
        return;
      }
      const msg = String(stderr || stdout || `telegram-channel-download exit code: ${code}`).trim();
      await updateDownloadStatus.run('error', 0, msg.slice(0, 4000), downloadId);
    });

    proc.on('error', async (err) => {
      activeProcesses.delete(downloadId);
      await updateDownloadStatus.run('error', 0, err.message, downloadId);
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

    try {await updateDownloadFilepath.run(dir, downloadId);} catch (e) {}

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
        await updateDownloadStatus.run('error', 0, 'OnlyFans: ofscraper auth ontbreekt (auth.json). Run ofscraper één keer handmatig om auth aan te maken, of zet WEBDL_OFSCRAPER_CONFIG_DIR naar je ofscraper config map.', downloadId);
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
        } catch (e) {cookieStr = '';}

        const hasSess = /(?:^|;\s*)sess=([^;]+)/i.test(cookieStr);
        if (!hasSess) {
          await updateDownloadStatus.run('error', 0, 'OnlyFans: auth.json cookie export lijkt incompleet/verkeerd (sess ontbreekt). Exporteer cookies opnieuw (bijv. OnlyFans Cookie Helper) en zorg dat auth.json als *platte JSON* is opgeslagen (geen TextEdit/RTF).', downloadId);
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
        await updateDownloadStatus.run('error', 0, 'OnlyFans: je ofscraper auth.json is geen geldige JSON (lijkt als RTF/TextEdit opgeslagen). Fix auth.json (exporteer opnieuw cookies) en probeer opnieuw.', downloadId);
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
      cfg.performance_options.download_sems = Number.isFinite(sems) && sems > 0 ? sems : 1;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    } catch (e) {}

    const proc = spawnNice(OFSCRAPER, [
    '-cg', cfgDir,
    '-p', 'stats',
    '--action', 'download',
    '--download-area', 'all',
    '--usernames', user,
    '--auth-quit']
    );

    activeProcesses.set(downloadId, proc);
    try {startingJobs.delete(downloadId);} catch (e) {}

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
            try {st = fs.statSync(full);} catch (e) {st = null;}
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
          try {fs.closeSync(fd);} catch (e) {}
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
          try {proc.kill('SIGKILL');} catch (e) {}
        }, 5000);
      } catch (e) {}

      try {
        activeProcesses.delete(downloadId);
        jobLane.delete(downloadId);
        runDownloadSchedulerSoon();
      } catch (e) {}
    }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20 * 60 * 1000);

    proc.on('close', async (code) => {
      activeProcesses.delete(downloadId);

      try {clearTimeout(timeoutTimer);} catch (e) {}
      if (aborted) {
        try {
          if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
        } catch (e) {}
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
          } catch (e) {}
          return;
        }
        const metaObj = { tool: 'ofscraper', platform: 'onlyfans', channel: outChannel, title, url, outputDir: dir };
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
          await updateDownload.run('completed', 100, dir, '(multiple)', 0, '', JSON.stringify(metaObj), null, downloadId);
        } else {
          await updateDownloadStatus.run('error', 0, tail || `ofscraper exit code: ${code} (log: ${logPath || 'n/a'})`, downloadId);
        }
      }

      try {
        if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
      } catch (e) {}
    });

    proc.on('error', async (err) => {
      activeProcesses.delete(downloadId);
      try {
        if (fs.existsSync(cfgDir)) fs.rmSync(cfgDir, { recursive: true, force: true });
      } catch (e) {}
      await updateDownloadStatus.run('error', 0, err.message, downloadId);
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
    const dir = getDownloadDirChannelOnly(platform, outChannel);

    try {await updateDownloadFilepath.run(dir, downloadId);} catch (e) {}

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

    const proc = spawnNice(GALLERY_DL, [url], { cwd: dir });
    activeProcesses.set(downloadId, proc);
    try {startingJobs.delete(downloadId);} catch (e) {}

    let stderr = '';
    proc.stderr.on('data', (d) => {stderr += d.toString();});
    proc.stdout.on('data', () => {});

    proc.on('close', async (code) => {
      activeProcesses.delete(downloadId);
      if (code === 0) {
        // Index all downloaded files
        try {
          const files = fs.readdirSync(dir);
          let indexed = 0;
          for (const file of files) {
            try {
              const fullPath = path.join(dir, file);
              const st = fs.statSync(fullPath);
              // Skip gallery-dl downloaded thumbnails/logos (not server-generated ones)
              if (file.endsWith('_thumb.jpg') || file.endsWith('_thumb.png') || file.endsWith('_logo.jpg') || file.endsWith('_logo.png')) continue;
              if (st.isFile() && /\.(mp4|webm|mkv|avi|mov|jpg|jpeg|png|gif|webp)$/i.test(file)) {
                const relPath = path.relative(BASE_DIR, fullPath);
                if (relPath && !relPath.startsWith('..')) {
                  await upsertDownloadFile.run(downloadId, relPath, st.size, Math.floor(st.mtimeMs), new Date().toISOString());
                  indexed++;
                }
              }
            } catch (e) {}
          }
          console.log(`   📂 Geïndexeerd: ${indexed} files voor download #${downloadId}`);
          recentFilesTopCache.clear();
        } catch (e) {
          console.log(`   ⚠️  Indexing fout: ${e.message}`);
        }
        
        const metaObj = { tool: 'gallery-dl', platform, channel: outChannel, title, url, outputDir: dir };
        await updateDownload.run('completed', 100, dir, '(multiple)', 0, '', JSON.stringify(metaObj), null, downloadId);
      } else {
        await updateDownloadStatus.run('error', 0, stderr || `gallery-dl exit code: ${code}`, downloadId);
      }
    });

    proc.on('error', async (err) => {
      activeProcesses.delete(downloadId);
      await updateDownloadStatus.run('error', 0, err.message, downloadId);
    });
  } catch (err) {
    await updateDownloadStatus.run('error', 0, err.message, downloadId);
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
    try {await updateDownloadFilepath.run(dir, downloadId);} catch (e) {}
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
      try {startingJobs.delete(downloadId);} catch (e) {}

      let stderr = '';
      let stdout = '';
      proc.stderr.on('data', (d) => {stderr += d.toString();});
      proc.stdout.on('data', (d) => {stdout += d.toString();});
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
        const finalTitle = pinContext ? title : meta.title || title;
        const finalChannel = pinContext ? channel : meta.channel || channel;
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
    try {await updateDownloadFilepath.run(dir, downloadId);} catch (e) {}

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

    const outputTemplate = forceDuplicates ?
    path.join(dir, `%(title).120B [%(id)s] [#${downloadId}].%(ext)s`) :
    path.join(dir, '%(title).120B [%(id)s].%(ext)s');
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
    url];


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
        try {startingJobs.delete(downloadId);} catch (e) {}

        let lastFile = '';
        let markedPostprocessing = false;
        let stderrAll = '';

        proc.stdout.on('data', async (data) => {
          const line = data.toString().trim();
          if (line.includes('[download]') && line.includes('%')) {
            const match = line.match(/([\d.]+)%/);
            if (match) {
              const pct = Math.round(parseFloat(match[1]));
              if (!markedPostprocessing) await updateDownloadStatus.run('downloading', pct, null, downloadId);
            }
          }
          if (line.includes('Destination:')) {
            lastFile = line.split('Destination:')[1]?.trim() || '';
          }
          if (line.includes('[Merger]') || line.includes('has already been downloaded')) {
            if (!markedPostprocessing && (line.includes('[Merger]') || line.includes('Merging formats into'))) {
              markedPostprocessing = true;
              await updateDownloadStatus.run('postprocessing', 100, null, downloadId);
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
          const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.webm'));
          const mainFileGuess = files[0] || '';
          mainPath = mainFileGuess ? path.join(dir, mainFileGuess) : '';
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
          await updateDownloadStatus.run('postprocessing', 100, null, downloadId);
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

        await updateDownload.run('completed', 100, finalPath, finalFile, finalSize, finalFormat, JSON.stringify(metaObj), null, downloadId);
        try {
          const thumbPath = pickThumbnailFile(dir);
          if (thumbPath) await updateDownloadThumbnail.run(`/download/${downloadId}/thumb`, downloadId);
        } catch (e) {}
        console.log(`   ✅ Download voltooid: ${finalPath} (${(finalSize / 1024 / 1024).toFixed(1)} MB)`);
      })().catch(async (e) => {
        await updateDownloadStatus.run('error', 0, e.message, downloadId);
        console.log(`   ❌ Postprocess fout: ${e.message}`);
      });
    } else {
      const msg = String(result && result.stderrAll ? result.stderrAll : '').trim();
      if (msg.includes('Unsupported URL') && looksLikeDirectFileUrl(url)) {
        console.log(`   ↩️ Fallback naar direct download (unsupported url)`);
        startDirectFileDownload(downloadId, url, platform, channel, title, metadata).catch(() => {});
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
  try {metadata = JSON.parse(req.body.metadata || '{}');} catch (e) {}

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
  } catch (e) {}
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
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
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
        } catch (e) {}
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
                    try {await updateDownloadFilepath.run(relocatePath, existing.id);} catch (e) {}
                    relocated.push({ id: existing.id, from: fp, to: relocatePath });
                    continue;
                  }
                  fs.unlinkSync(fp);
                  try {await updateDownloadFilepath.run(relocatePath, existing.id);} catch (e) {}
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
                try {await updateDownloadFilepath.run(targetPath, existingTarget.id);} catch (e) {}
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
        const channelFromUrl = sourceUrl ? deriveChannelFromUrl(platform, sourceUrl) || '' : '';
        const channel = String(sidecar.channel || '').trim() || channelFromUrl || 'imported';
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
            try {await updateDownloadSourceUrl.run(sourceUrl, newId);} catch (e) {}
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
              await upsertDownloadFile.run(id, relPath, st.size, Math.floor(st.mtimeMs), new Date().toISOString());
              indexed++;
            }
          }
        } catch (e) {}
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
  } catch (e) {}
  let metaPayload = metadata || {};
  if (typeof metaPayload === 'string') {
    try {metaPayload = JSON.parse(metaPayload);} catch (e) {metaPayload = {};}
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
        if (mime.includes('jpeg')) ext = 'jpg';else
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
    } catch (e) {}
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
    const thumbPath = await pickOrCreateThumbPath(fp, { allowGenerate: false });
    if (!thumbPath) {
      let sched = 'error';
      try {sched = scheduleThumbGeneration(fp) || 'error';} catch (e) {}
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
        const thumbPath = await pickOrCreateThumbPath(fp, { allowGenerate: false });
        if (!thumbPath) {
          let sched = 'error';
          try {sched = scheduleThumbGeneration(fp) || 'error';} catch (e) {}
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
        } catch (e) {}
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
    try {proc.kill('SIGTERM');} catch (e) {}
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
    jobLane.delete(id);
    await updateDownloadStatus.run('cancelled', 0, null, id);
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
expressApp.get('/dashboard', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  const runtimeActiveIds = new Set(Array.from(runtimeActiveIdSet));
  const completedRows = await db.prepare(`
    SELECT * FROM downloads 
    WHERE status NOT IN ('queued', 'pending', 'downloading', 'postprocessing')
    ORDER BY COALESCE(finished_at, updated_at) DESC, created_at DESC 
    LIMIT 350
  `).all();
  
  const allDownloads = [...runtimeActiveRows, ...completedRows];
  const seen = new Set();
  const uniqueDownloads = [];
  for (const d of allDownloads) {
    if (!d || !d.id) continue;
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    uniqueDownloads.push(d);
  }
  
  const screenshots = await db.prepare(`SELECT * FROM screenshots ORDER BY created_at DESC LIMIT 200`).all();
  res.send(getDashboardHTML(uniqueDownloads, screenshots));
});

expressApp.get('/media/file', async (req, res) => {
  const kind = String(req.query.kind || '').toLowerCase();
  const id = parseInt(req.query.id, 10);
  try {
    console.log(`[GET /media/file] kind=${kind} id=${id} ua=${String(req.headers['user-agent'] || '').slice(0, 60)}`);
  } catch (e) {}
  if (!Number.isFinite(id)) return res.status(400).end();

  try {
    let row = null;
    if (kind === 'd') row = await getDownload.get(id);else
    if (kind === 's') row = await db.prepare(`SELECT * FROM screenshots WHERE id=?`).get(id);else
    return res.status(400).end();

    if (!row) return res.status(404).end();
    const fp = String(row.filepath || '').trim();

    if (row.platform === 'patreon') {
      console.log(`[DEBUG-PATREON-EXPAND] Processing id=${row.id}, fp=${fp}, isAllowed=${safeIsAllowedExistingPath(path.resolve(fp))}`);
    }

    if (!fp || !safeIsAllowedExistingPath(fp)) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-store');
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

        const img = pickThumbnailFile(fp);
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
    if (safeIsAllowedExistingPath(abs)) {
      const st = fs.statSync(abs);
      if (st && st.isDirectory && st.isDirectory()) {
        const img = pickThumbnailFile(abs);
        if (img) return 'image';
        const v = findFirstVideoInDirDeep(abs) || findFirstVideoInDir(abs);
        if (v) return 'video';
        return 'file';
      }
      if (st && st.isFile && st.isFile()) {
        const sn = sniffMediaKindByMagic(abs);
        if (sn === 'image') return 'image';
        if (sn === 'video') return 'video';
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
  const fp = String(row.filepath || '').trim();

    if (row.platform === 'patreon') {
      console.log(`[DEBUG-PATREON-EXPAND] Processing id=${row.id}, fp=${fp}, isAllowed=${safeIsAllowedExistingPath(path.resolve(fp))}`);
    }

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
  try {
    const plat = String(row && row.platform ? row.platform : '').toLowerCase();
    if (plat === 'footfetishforum') {
      const info = parseFootFetishForumThreadInfo(row && (row.source_url || row.url) ? (row.source_url || row.url) : '');
      if (info && info.name) channelDisplay = info.name;
      else if (/^thread_\d+$/i.test(channel)) channelDisplay = 'Thread ' + channel.replace(/^thread_/i, '');
      if (info && info.name && (!title || title === 'untitled')) title = info.name;
    }
  } catch (e) {}
  if (!channelDisplay) channelDisplay = channel;
  if (channelDisplay) titleDisplay = title ? `${channelDisplay} • ${title}` : channelDisplay;

  const src = `/media/file?kind=${encodeURIComponent(row.kind)}&id=${encodeURIComponent(row.id)}`;
  const thumb = t === 'image' && src ?
  src :
  preferredThumb || `/media/thumb?kind=${encodeURIComponent(row.kind)}&id=${encodeURIComponent(row.id)}&v=5`;

  return {
    kind: row.kind,
    id: row.id,
    platform: row.platform,
    channel,
    title,
    channel_display: channelDisplay || null,
    title_display: titleDisplay || null,
    created_at: row.created_at,
    type: t,
    rating: (row && row.rating != null && row.rating !== '') ? Number(row.rating) : null,
    rating_kind: row.kind,
    rating_id: row.id,
    url: row.url || null,
    source_url: row.source_url || null,
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
  } catch (e) {}
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
    } catch (e) {}
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
  } catch (e) {}
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
      if (videoExts.has(ext)) entry.videos.push(file);else
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
  } catch (e) {}

  const combinedTitle = title ? `${title} • ${base}` : base;
  let titleDisplay = channelDisplay ? `${channelDisplay} • ${combinedTitle}` : combinedTitle;

  let dedupeKey = absPath;
  try {
    if (fs.existsSync(absPath)) dedupeKey = fs.realpathSync(absPath);
  } catch (e) { dedupeKey = absPath; }
  return {
    kind: 'p',
    id: relPath,
    platform,
    channel: channel,
    channel_display: channelDisplay,
    title: combinedTitle,
    title_display: titleDisplay,
    created_at,
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
    } catch (e) {}
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
  try {
    const dk = item.dedupe_key ? String(item.dedupe_key) : '';
    if (dk) {
      const abs = path.resolve(dk);
      return `dedupe:${abs}`;
    }
  } catch (e) {}
  try {
    const rel = item.file_rel ? String(item.file_rel) : '';
    if (rel) {
      const abs = path.resolve(BASE_DIR, rel);
      return `dedupe:${abs}`;
    }
  } catch (e) {}
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

    if (row.platform === 'patreon') {
      console.log(`[DEBUG-PATREON-EXPAND] Processing id=${row.id}, fp=${fp}, isAllowed=${safeIsAllowedExistingPath(path.resolve(fp))}`);
    }

  if (!fp) return { items, nextFileIndex: 0, done: true };

  try {
    const abs = path.resolve(fp);
    if (!safeIsAllowedExistingPath(abs)) return { items, nextFileIndex: 0, done: true };
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
        } catch (e) {}
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
          } catch (e) {}
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

expressApp.get('/api/media/recent-files', async (req, res) => {
  const reqStartTime = Date.now();
  console.log(`📥 [${new Date().toISOString().substr(11,8)}] GET /api/media/recent-files - limit=${req.query.limit || '120'}, type=${req.query.type || 'all'}, cursor=${req.query.cursor ? 'yes' : 'no'}, dirs=${req.query.dirs ? 'yes' : 'no'}`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '120', 10) || 120));
  const type = String(req.query.type || 'all').toLowerCase();
  const tagFilter = String(req.query.tag || '').trim();
  const sort = String(req.query.sort || 'recent').toLowerCase();
  const cursorRaw = String(req.query.cursor || '').trim();
  const cur = decodeCursor(cursorRaw);
  const includeActive = String(req.query.include_active || '0') !== '0';
  const includeActiveFiles = String(req.query.include_active_files || '0') !== '0';
  let enabledDirs = null;
  try {
    const dirsParam = String(req.query.dirs || '').trim();
    if (dirsParam) enabledDirs = JSON.parse(dirsParam);
  } catch (e) {}
  if (!enabledDirs) enabledDirs = loadDirectoryFilter();

  try {
    const isTopCursor = !cursorRaw ||
    cur && cur.activeOffset === 0 && cur.rowOffset === 0 && !cur.dir && cur.fileIndex === 0;

    if (!includeActive && !includeActiveFiles && isTopCursor) {
      try {
        const now = Date.now();
        const st = await getStatsRowCached();
        const marker = buildRecentFilesCacheMarker(st);
        const dirFilterKey = enabledDirs && enabledDirs.length ? enabledDirs.sort().join(',') : '_all';
        const key = `recent|${type}|${limit}|${sort}|${dirFilterKey}`;
        const cached = recentFilesTopCache.get(key);
        if (cached && cached.marker === marker && now - (cached.at || 0) < RECENT_FILES_TOP_CACHE_MS) {
          return res.json(cached.payload);
        }
        if (now - recentFilesTopCacheAt > RECENT_FILES_TOP_CACHE_MS * 8) {
          recentFilesTopCacheAt = now;
          recentFilesTopCache = new Map();
        }
      } catch (e) {}
    }

    const items = [];
    const seenKeys = new Set();

    const isTopRequest = false; // cache disabled to guarantee live updates
    if (includeActive && isTopRequest) {
      try {
        const cap = Math.min(28, Math.max(8, Math.floor(limit / 2)));
        const rows = runtimeActiveRows;
        for (const r of rows || []) {
          if (!r) continue;
          const it = makeActiveDownloadItem(r);
          if (tagFilter) {
        try {
          const tags = db.prepare(db.isPostgres ? 'SELECT t.name FROM tags t JOIN media_tags mt ON t.id = mt.tag_id WHERE mt.kind = $1 AND mt.media_id = $2' : 'SELECT t.name FROM tags t JOIN media_tags mt ON t.id = mt.tag_id WHERE mt.kind = ? AND mt.media_id = ?').all(row.kind, row.id);
          if (!tags.some(t => t.name === tagFilter)) {
            rowOffset += 1;
            continue;
          }
        } catch(e) {}
      }
      pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type });
          if (items.length >= limit) break;
        }
      } catch (e) {}
    }
    const nextActiveOffset = -1;
    let rowOffset = cur.rowOffset;
    const hasDirectoryFilter = enabledDirs && enabledDirs.length > 0 && enabledDirs.length < 10;
    const maxRowsPerCall = hasDirectoryFilter ? 800 : 260;
    const getBatch = (sort === 'rating_asc') ? getRecentHybridMediaByRatingAsc : (sort === 'rating_desc') ? getRecentHybridMediaByRatingDesc : (sort === 'oldest') ? getRecentHybridMediaByOldest : (sort === 'name_asc') ? getRecentHybridMediaByNameAsc : (sort === 'name_desc') ? getRecentHybridMediaByNameDesc : (includeActiveFiles ? getRecentHybridMediaWithActiveFiles : getRecentHybridMedia);
    const batch = await getBatch.all(maxRowsPerCall, rowOffset);
    for (const row of batch || []) {
      if (row && row.platform === 'patreon') {
        console.log(`[DEBUG-PATREON-API] Found DB row: id=${row.id}, kind=${row.kind}, filepath=${row.filepath}, includeActiveFiles=${includeActiveFiles}`);
      }

      if (!row) {rowOffset += 1;continue;}
      
      // Apply directory filter
      const relPath = row.kind === 'p' ? row.id : (row.filepath ? path.relative(BASE_DIR, row.filepath) : '');
      if (enabledDirs && relPath && !shouldIncludePath(relPath, enabledDirs)) {
        rowOffset += 1;
        continue;
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
          } catch (e) {}
        }
      }
      const it = makeIndexedMediaItem(row);
      pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type });
      rowOffset += 1;
      if (items.length >= limit) break;
    }

    const nextCursor = encodeCursor({ activeOffset: nextActiveOffset, rowOffset, dir: '', fileIndex: 0 });
    const done = (batch && batch.length ? batch.length : 0) < maxRowsPerCall;
    const payload = { success: true, items, next_cursor: nextCursor, done };
    const reqTime = Date.now() - reqStartTime;
    console.log(`📤 [${new Date().toISOString().substr(11,8)}] Response /api/media/recent-files - ${items.length} items in ${reqTime}ms`);

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
      } catch (e) {}
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
  } catch (e) {}
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
        const dirFilterKey = enabledDirs && enabledDirs.length ? enabledDirs.sort().join(',') : '_all';
        const key = `channel|${platform}|${channel}|${type}|${limit}|${sort}|${dirFilterKey}`;
        const cached = recentFilesTopCache.get(key);
        if (cached && cached.marker === marker && now - (cached.at || 0) < RECENT_FILES_TOP_CACHE_MS) {
          return res.json(cached.payload);
        }
        if (now - recentFilesTopCacheAt > RECENT_FILES_TOP_CACHE_MS * 8) {
          recentFilesTopCacheAt = now;
          recentFilesTopCache = new Map();
        }
      } catch (e) {}
    }

    const items = [];
    const seenKeys = new Set();

    const isTopRequest = false; // cache disabled to guarantee live updates
    if (includeActive && isTopRequest) {
      try {
        const cap = Math.min(28, Math.max(8, Math.floor(limit / 2)));
        const rows = runtimeActiveRows;
        for (const r of rows || []) {
          if (!r) continue;
          if (String(r.platform || '') !== String(platform || '')) continue;
          if (String(r.channel || '') !== String(channel || '')) continue;
          const it = makeActiveDownloadItem(r);
      if (tagFilter) {
        try {
          const tags = db.prepare(db.isPostgres ? 'SELECT t.name FROM tags t JOIN media_tags mt ON t.id = mt.tag_id WHERE mt.kind = $1 AND mt.media_id = $2' : 'SELECT t.name FROM tags t JOIN media_tags mt ON t.id = mt.tag_id WHERE mt.kind = ? AND mt.media_id = ?').all(row.kind, row.id);
          if (!tags.some(t => t.name === tagFilter)) {
            rowOffset += 1;
            continue;
          }
        } catch(e) {}
      }
          pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type });
          if (items.length >= limit) break;
        }
      } catch (e) {}
    }
    const nextActiveOffset = -1;
    let rowOffset = cur.rowOffset;
    const hasDirectoryFilter = enabledDirs && enabledDirs.length > 0 && enabledDirs.length < 10;
    const maxRowsPerCall = hasDirectoryFilter ? 800 : 260;
    const getBatch = (sort === 'rating_asc') ? getHybridMediaByChannelByRatingAsc : (sort === 'rating_desc') ? getHybridMediaByChannelByRatingDesc : (sort === 'oldest') ? getHybridMediaByChannelByOldest : (sort === 'name_asc') ? getHybridMediaByChannelByNameAsc : (sort === 'name_desc') ? getHybridMediaByChannelByNameDesc : (includeActiveFiles ? getHybridMediaByChannelWithActiveFiles : getHybridMediaByChannel);
    const batch = await getBatch.all(platform, channel, platform, channel, platform, channel, maxRowsPerCall, rowOffset);
    for (const row of batch || []) {
      if (row && row.platform === 'patreon') {
        console.log(`[DEBUG-PATREON-API] Found DB row: id=${row.id}, kind=${row.kind}, filepath=${row.filepath}, includeActiveFiles=${includeActiveFiles}`);
      }

      if (!row) {rowOffset += 1;continue;}
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
          } catch (e) {}
        }
      }
      const it = makeIndexedMediaItem(row);
      pushUniqueMediaItem({ bucket: items, item: it, seen: seenKeys, typeFilter: type });
      rowOffset += 1;
      if (items.length >= limit) break;
    }

    const nextCursor = encodeCursor({ activeOffset: nextActiveOffset, rowOffset, dir: '', fileIndex: 0 });
    const done = (batch && batch.length ? batch.length : 0) < maxRowsPerCall;
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
      } catch (e) {}
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
    const seenKeys = new Set();
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
    const seenKeys = new Set();
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

expressApp.get('/gallery', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(getGalleryHTML());
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
    
    const enabledDirs = loadDirectoryFilter() || directories;
    
    res.json({ 
      success: true, 
      directories: directories,
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
      } catch (e) {}
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
    
    const batch = await query.all(...params);
    const items = [];
    
    for (const row of batch || []) {
      if (row && row.platform === 'patreon') {
        console.log(`[DEBUG-PATREON-API] Found DB row: id=${row.id}, kind=${row.kind}, filepath=${row.filepath}, includeActiveFiles=${includeActiveFiles}`);
      }

      if (!row) continue;
      const relPath = row.kind === 'p' ? row.id : (row.filepath ? path.relative(BASE_DIR, row.filepath) : '');
      if (enabledDirs && relPath && !shouldIncludePath(relPath, enabledDirs)) continue;
      
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
      const u = String(d && (d.source_url || d.url) || '');
      const m = u.match(/footfetishforum\.com\/threads\/[^\/\?#]*\.(\d+)(?:\/|\?|#|$)/i);
      return m ? String(m[1] || '') : '';
    } catch (e) {
      return '';
    }
  }

  function dashSortKeyTs(d) {
    try {
      const u = d && (d.updated_at || d.created_at) ? String(d.updated_at || d.created_at) : '';
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
  for (const d of Array.isArray(downloads) ? downloads : []) {
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
    const statuses = new Set(items.map((x) => String(x && x.status ? x.status : '')));
    let aggStatus = String(rep.status || '');
    if (statuses.has('downloading') || statuses.has('postprocessing')) aggStatus = 'downloading';else
    if (statuses.has('queued') || statuses.has('pending')) aggStatus = 'queued';else
    if (statuses.has('error')) aggStatus = 'error';else
    if (statuses.has('cancelled')) aggStatus = 'cancelled';else
    if (statuses.has('completed')) aggStatus = 'completed';

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
      _ids: items.map((x) => x && x.id).filter((x) => Number.isFinite(Number(x))),
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

  const downloadRows = groupedDownloads.map((d) => {
    const isGroup = d && d._group === 'fff-thread' && (d._count || 0) > 1;
    const status = isGroup ? String(d._aggStatus || '') : String(d.status || '');
    const progress = isGroup ? Number(d._aggProgress || 0) : Number(d.progress || 0);
    const ids = isGroup ? Array.isArray(d._ids) ? d._ids : [] : [];
    const stopBtn = (() => {
      if (!isGroup) {
        return status === 'queued' || status === 'downloading' || status === 'postprocessing' ?
        `<button onclick="cancelDownload(${d.id})" class="btn btn-sm btn-danger">Stop</button>` :
        '';
      }
      return status === 'queued' || status === 'downloading' || status === 'postprocessing' ?
      `<button onclick='cancelDownloadGroup(${JSON.stringify(ids)})' class="btn btn-sm btn-danger">Stop</button>` :
      '';
    })();

    const title = isGroup ?
    `Thread ${String(d._threadId || '')} (${Number(d._count || 0)}) — ${String(d.title || '')}` :
    String(d.title || '');

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
      <td><span class="status status-${status}">${status}${status === 'downloading' || status === 'postprocessing' ? ` (${Math.max(0, Math.min(100, progress))}%)` : ''}</span></td>
      <td>${sizeCell}</td>
      <td>${new Date(d.created_at).toLocaleString('nl-NL')}</td>
      <td>
        ${stopBtn}
        ${d.filepath ? `<button onclick="openMedia('d', ${d.id})" class="btn btn-sm">Open</button>` : ''}
        ${d.filepath ? `<button onclick="showInFinder('d', ${d.id})" class="btn btn-sm">Finder</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  const screenshotRows = screenshots.map((s) => `
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
      <div class="stat-num">${downloads.filter((d) => d.status === 'completed').length}</div>
      <div class="stat-label">Voltooid</div>
    </div>
    <div class="stat">
      <div class="stat-num">${downloads.filter((d) => d.status === 'downloading').length}</div>
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
    ${downloads.some((d) => d.status === 'downloading' || d.status === 'postprocessing') ? 'setTimeout(() => location.reload(), 5000);' : ''}
    startDashboardLivePoll();
  </script>
</body>
</html>`;
}

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
          } catch(e){}
        }
      };

      const dlRows = await db.prepare('SELECT id, title, filename, filepath FROM downloads ORDER BY id DESC LIMIT ' + limitScan).all();
      for (const r of dlRows) {
        await updateTags('d', r.id, r.title + ' ' + (r.filename||'') + ' ' + (r.filepath||''));
        scanned++;
      }
      const scRows = await db.prepare('SELECT id, title, filename, filepath FROM screenshots ORDER BY id DESC LIMIT ' + limitScan).all();
      for (const r of scRows) {
        await updateTags('s', r.id, r.title + ' ' + (r.filename||'') + ' ' + (r.filepath||''));
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
    await scanExistingTagsOnStartup();
  } catch (e) {}

  // Clean up thumbnail files from download_files
  try {
    const result = await deleteThumbnailFiles.run();
    const deleted = result && result.changes ? result.changes : 0;
    if (deleted > 0) {
      console.log(`🧹 Verwijderd: ${deleted} thumbnail entries uit gallery`);
      recentFilesTopCache.clear();
    }
  } catch (e) {
    console.log(`⚠️  Thumbnail cleanup fout: ${e.message}`);
  }

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
        syncRuntimeActiveState().catch(() => {});
        console.log('🔁 Queue rehydrate gestart na startup');
        recentFilesTopCache.clear();
      } catch (e) {
        console.warn(`⚠️ Queue rehydrate mislukt: ${e && e.message ? e.message : e}`);
      }
    }, STARTUP_REHYDRATE_DELAY_MS);

    setInterval(() => {
      syncRuntimeActiveState().catch(() => {});
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
          moveSource: AUTO_IMPORT_MOVE_SOURCE
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
      } catch (e) {}

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
            moveSource: AUTO_IMPORT_MOVE_SOURCE
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
    setTimeout(() => { maybeAutoIndexDownloadFiles().catch(() => {}); }, 1800);
    setInterval(() => { maybeAutoIndexDownloadFiles().catch(() => {}); }, DOWNLOAD_FILES_AUTO_INDEX_MS);
  } catch (e) {}
});

}

startServer();

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
        try {proc.kill('SIGINT');} catch (err) {}
      }

      setTimeout(() => {
        if (done) return;
        try {proc.kill('SIGINT');} catch (e) {}
        setTimeout(() => {
          if (done) return;
          try {proc.kill('SIGKILL');} catch (e) {}
          finish();
        }, 2500);
      }, 8000);
    } catch (e) {
      resolve();
    }
  });

  stopRecordingIfAny().finally(() => {
    for (const [id, proc] of activeProcesses) {
      try {proc.kill('SIGTERM');} catch (e) {}
      console.log(`  Download #${id} gestopt`);
    }
    try {db.close();} catch (e) {}
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdownGracefully('SIGINT'));

// Tags API
expressApp.get('/api/tags', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM tags ORDER BY name ASC').all();
    res.json({ success: true, tags: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.post('/api/tags', (req, res) => {
  try {
    const name = String(req.body.name || '').trim().toLowerCase();
    if (!name) throw new Error('Name required');
    if (db.isPostgres) db.prepare('INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING').run(name); else db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name);
    const tag = db.prepare(db.isPostgres ? 'SELECT * FROM tags WHERE name = $1' : 'SELECT * FROM tags WHERE name = ?').get(name);
    res.json({ success: true, tag });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.delete('/api/tags/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    db.prepare(db.isPostgres ? 'DELETE FROM tags WHERE id = $1' : 'DELETE FROM tags WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.get('/api/media/:kind/:id/tags', (req, res) => {
  try {
    const { kind, id } = req.params;
    const rows = db.prepare(db.isPostgres ? 'SELECT t.* FROM tags t JOIN media_tags mt ON t.id = mt.tag_id WHERE mt.kind = $1 AND mt.media_id = $2' : 'SELECT t.* FROM tags t JOIN media_tags mt ON t.id = mt.tag_id WHERE mt.kind = ? AND mt.media_id = ?').all(kind, id);
    res.json({ success: true, tags: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.post('/api/media/:kind/:id/tags', (req, res) => {
  try {
    const { kind, id } = req.params;
    const tagId = parseInt(req.body.tag_id, 10);
    if (!tagId) throw new Error('Tag ID required');
    if (db.isPostgres) db.prepare('INSERT INTO media_tags (kind, media_id, tag_id) VALUES ($1, $2, $3) ON CONFLICT ON CONSTRAINT media_tags_pkey DO NOTHING').run(kind, id, tagId); else db.prepare('INSERT OR IGNORE INTO media_tags (kind, media_id, tag_id) VALUES (?, ?, ?)').run(kind, id, tagId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

expressApp.delete('/api/media/:kind/:id/tags/:tagId', (req, res) => {
  try {
    const { kind, id, tagId } = req.params;
    db.prepare(db.isPostgres ? 'DELETE FROM media_tags WHERE kind = $1 AND media_id = $2 AND tag_id = $3' : 'DELETE FROM media_tags WHERE kind = ? AND media_id = ? AND tag_id = ?').run(kind, id, parseInt(tagId, 10));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


function extractAndSaveTags(kind, media_id, text) {
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
        db.prepare('INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING').run(tag);
        const tagRow = db.prepare('SELECT id FROM tags WHERE name = $1').get(tag);
        if (tagRow) {
          db.prepare('INSERT INTO media_tags (kind, media_id, tag_id) VALUES ($1, $2, $3) ON CONFLICT ON CONSTRAINT media_tags_pkey DO NOTHING').run(kind, media_id, tagRow.id);
        }
      } else {
        db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(tag);
        const tagRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(tag);
        if (tagRow) {
          db.prepare('INSERT OR IGNORE INTO media_tags (kind, media_id, tag_id) VALUES (?, ?, ?)').run(kind, media_id, tagRow.id);
        }
      }
    } catch(e) { console.error('Error auto-tagging:', e); }
  }
}

process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));