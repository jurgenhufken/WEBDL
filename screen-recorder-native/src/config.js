require('dotenv').config();
const path = require('path');
const os = require('os');

// ========================
// CORE CONFIGURATIE
// ========================
const PORT = Math.max(1, parseInt(process.env.WEBDL_PORT || process.env.PORT || '35729', 10));
const BASE_DIR = process.env.WEBDL_BASE_DIR || path.join(os.homedir(), 'Downloads', 'WEBDL');
const DB_PATH = process.env.WEBDL_DB_PATH || path.join(BASE_DIR, 'webdl.db');
const POSTGRES_URL = process.env.WEBDL_POSTGRES_URL || 'postgres://localhost/webdl';
const DB_ENGINE = process.env.WEBDL_DB_ENGINE || 'postgres';

const LOG_FILE = process.env.WEBDL_LOG_FILE || path.join(BASE_DIR, 'webdl-server.log');
const DIRECTORY_FILTER_CONFIG = process.env.WEBDL_DIRECTORY_FILTER_CONFIG || path.join(os.homedir(), '.config', 'webdl', 'directory-filter.json');

// ========================
// EXTERNE TOOLS (SCRAPERS)
// ========================
const YT_DLP = process.env.WEBDL_YT_DLP || '/opt/homebrew/bin/yt-dlp';
const FFMPEG = process.env.WEBDL_FFMPEG || '/opt/homebrew/bin/ffmpeg';
const FFPROBE = process.env.WEBDL_FFPROBE || '/opt/homebrew/bin/ffprobe';
const OFSCRAPER = process.env.WEBDL_OFSCRAPER || path.join(os.homedir(), '.local', 'bin', 'ofscraper');
const OFSCRAPER_CONFIG_DIR = process.env.WEBDL_OFSCRAPER_CONFIG_DIR || path.join(os.homedir(), '.config', 'ofscraper');
const GALLERY_DL = process.env.WEBDL_GALLERY_DL || path.join(os.homedir(), '.local', 'bin', 'gallery-dl');
const INSTALOADER = process.env.WEBDL_INSTALOADER || path.join(os.homedir(), '.local', 'bin', 'instaloader');
const REDDIT_DL = process.env.WEBDL_REDDIT_DL || path.join(os.homedir(), '.local', 'bin', 'reddit-dl');

// ========================
// TDL (Telegram Downloader) 
// ========================
const TDL = String(process.env.WEBDL_TDL || '').trim() || path.join(os.homedir(), 'go', 'bin', 'tdl');
const TDL_NAMESPACE = String(process.env.WEBDL_TDL_NAMESPACE || 'webdl').trim();
const TDL_THREADS = Math.max(1, parseInt(process.env.WEBDL_TDL_THREADS || '4', 10));
const TDL_CONCURRENCY = Math.max(1, parseInt(process.env.WEBDL_TDL_CONCURRENCY || '2', 10));

// ========================
// REDDIT API CREDENTIALS
// ========================
const REDDIT_DL_CLIENT_ID = String(process.env.WEBDL_REDDIT_CLIENT_ID || '').trim();
const REDDIT_DL_CLIENT_SECRET = String(process.env.WEBDL_REDDIT_CLIENT_SECRET || '').trim();
const REDDIT_DL_USERNAME = String(process.env.WEBDL_REDDIT_USERNAME || '').trim();
const REDDIT_DL_PASSWORD = String(process.env.WEBDL_REDDIT_PASSWORD || '').trim();
const REDDIT_DL_AUTH_FILE = String(process.env.WEBDL_REDDIT_AUTH_FILE || '').trim();
const REDDIT_INDEX_MAX_ITEMS = Math.max(1, parseInt(process.env.WEBDL_REDDIT_INDEX_MAX_ITEMS || '5000', 10));
const REDDIT_INDEX_MAX_PAGES = Math.max(1, parseInt(process.env.WEBDL_REDDIT_INDEX_MAX_PAGES || '120', 10));

// ========================
// RECORDING INSTELLINGEN
// ========================
const VIDEO_DEVICE = process.env.WEBDL_VIDEO_DEVICE || 'auto';
const AUDIO_DEVICE = process.env.WEBDL_AUDIO_DEVICE || 'none';
const RECORDING_FPS = process.env.WEBDL_RECORDING_FPS || '30';
const VIDEO_CODEC = process.env.WEBDL_VIDEO_CODEC || 'h264_videotoolbox';
const VIDEO_BITRATE = process.env.WEBDL_VIDEO_BITRATE || '6000k';
const LIBX264_PRESET = process.env.WEBDL_X264_PRESET || 'veryfast';
const AUDIO_BITRATE = process.env.WEBDL_AUDIO_BITRATE || '192k';
const RECORDING_AUDIO_CODEC = process.env.WEBDL_RECORDING_AUDIO_CODEC || 'aac_at';
const RECORDING_INPUT_PIXEL_FORMAT = String(process.env.WEBDL_RECORDING_INPUT_PIXEL_FORMAT || 'auto').trim();
const DEFAULT_RECORDING_FPS_MODE = VIDEO_CODEC === 'h264_videotoolbox' ? 'cfr' : 'passthrough';
const RECORDING_FPS_MODE = String(process.env.WEBDL_RECORDING_FPS_MODE || DEFAULT_RECORDING_FPS_MODE).toLowerCase();

// ========================
// FFMPEG PRESTATIES
// ========================
const FFMPEG_PROBESIZE = process.env.WEBDL_FFMPEG_PROBESIZE || '50M';
const FFMPEG_ANALYZEDURATION = process.env.WEBDL_FFMPEG_ANALYZEDURATION || '50M';
const FFMPEG_THREAD_QUEUE_SIZE = process.env.WEBDL_FFMPEG_THREAD_QUEUE_SIZE || '8192';
const FFMPEG_RTBUFSIZE = process.env.WEBDL_FFMPEG_RTBUFSIZE || '1500M';
const FFMPEG_MAX_MUXING_QUEUE_SIZE = process.env.WEBDL_FFMPEG_MAX_MUXING_QUEUE_SIZE || '4096';

// ========================
// THUMBNAILS & MEDIA
// ========================
const MIN_SCREENSHOT_BYTES = parseInt(process.env.WEBDL_MIN_SCREENSHOT_BYTES || '12000', 10);
const MIN_THUMB_BYTES = Math.max(256, parseInt(process.env.WEBDL_MIN_THUMB_BYTES || '2048', 10) || 2048);

const FINALCUT_ENABLED = String(process.env.WEBDL_FINALCUT_OUTPUT || '0') === '1';
const FINALCUT_VIDEO_CODEC = process.env.WEBDL_FINALCUT_VIDEO_CODEC || 'libx264';
const FINALCUT_X264_PRESET = process.env.WEBDL_FINALCUT_X264_PRESET || 'fast';
const FINALCUT_X264_CRF = process.env.WEBDL_FINALCUT_X264_CRF || '18';
const FINALCUT_AUDIO_BITRATE = process.env.WEBDL_FINALCUT_AUDIO_BITRATE || AUDIO_BITRATE;

// ========================
// ADDONS
// ========================
const ADDON_PACKAGE_PATH = process.env.WEBDL_ADDON_PACKAGE_PATH || path.join(BASE_DIR, 'firefox-debug-controller.xpi');
const LEGACY_ADDON_PACKAGE_PATH = path.join(os.homedir(), 'WEBDL', 'firefox-debug-controller.xpi');

// ========================
// AUTO-IMPORT
// ========================
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
    const fs = require('fs');
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    }
    return base;
  } catch (e) {
    return path.join(os.homedir(), 'Downloads');
  }
})();
const AUTO_IMPORT_ROOT_DIR = String(process.env.WEBDL_AUTO_IMPORT_ROOT_DIR || DEFAULT_AUTO_IMPORT_ROOT_DIR).trim();
const AUTO_IMPORT_MAX_DEPTH_RAW = parseInt(process.env.WEBDL_AUTO_IMPORT_MAX_DEPTH || '2', 10);
const AUTO_IMPORT_MIN_FILE_AGE_MS = Math.max(0, parseInt(process.env.WEBDL_AUTO_IMPORT_MIN_FILE_AGE_MS || '8000', 10));
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
const AUTO_IMPORT_POLL_MS = Math.max(0, parseInt(process.env.WEBDL_AUTO_IMPORT_POLL_MS || String(AUTO_IMPORT_DEFAULT_POLL_MS), 10));

const STARTUP_REHYDRATE_DELAY_MS = Math.max(0, parseInt(process.env.WEBDL_STARTUP_REHYDRATE_DELAY_MS || '2500', 10));
const STARTUP_REHYDRATE_MAX_ROWS = Math.max(0, parseInt(process.env.WEBDL_STARTUP_REHYDRATE_MAX_ROWS || '250', 10));
const STARTUP_REHYDRATE_MODE = String(process.env.WEBDL_STARTUP_REHYDRATE_MODE || 'active').trim().toLowerCase();

const METADATA_BLOCKED_DOMAIN_SUFFIXES = [
  'motherless.com', 'pornzog.com', 'txxx.com', 'omegleporn.to',
  'tnaflix.com', 'thisvid.com', 'pornone.com', 'pornhex.com',
  'xxxi.porn', 'cums.net', 'gig.sex'
];

module.exports = {
  PORT,
  BASE_DIR,
  DB_PATH,
  POSTGRES_URL,
  DB_ENGINE,
  LOG_FILE,
  DIRECTORY_FILTER_CONFIG,
  YT_DLP,
  FFMPEG,
  FFPROBE,
  OFSCRAPER,
  OFSCRAPER_CONFIG_DIR,
  GALLERY_DL,
  INSTALOADER,
  REDDIT_DL,
  TDL,
  TDL_NAMESPACE,
  TDL_THREADS,
  TDL_CONCURRENCY,
  REDDIT_DL_CLIENT_ID,
  REDDIT_DL_CLIENT_SECRET,
  REDDIT_DL_USERNAME,
  REDDIT_DL_PASSWORD,
  REDDIT_DL_AUTH_FILE,
  REDDIT_INDEX_MAX_ITEMS,
  REDDIT_INDEX_MAX_PAGES,
  VIDEO_DEVICE,
  AUDIO_DEVICE,
  RECORDING_FPS,
  VIDEO_CODEC,
  VIDEO_BITRATE,
  LIBX264_PRESET,
  AUDIO_BITRATE,
  RECORDING_AUDIO_CODEC,
  RECORDING_INPUT_PIXEL_FORMAT,
  RECORDING_FPS_MODE,
  FFMPEG_PROBESIZE,
  FFMPEG_ANALYZEDURATION,
  FFMPEG_THREAD_QUEUE_SIZE,
  FFMPEG_RTBUFSIZE,
  FFMPEG_MAX_MUXING_QUEUE_SIZE,
  MIN_SCREENSHOT_BYTES,
  MIN_THUMB_BYTES,
  FINALCUT_ENABLED,
  FINALCUT_VIDEO_CODEC,
  FINALCUT_X264_PRESET,
  FINALCUT_X264_CRF,
  FINALCUT_AUDIO_BITRATE,
  ADDON_PACKAGE_PATH,
  LEGACY_ADDON_PACKAGE_PATH,
  DEFAULT_VDH_IMPORT_DIR,
  ADDON_AUTO_BUILD_ON_START,
  ADDON_FORCE_REBUILD_ON_START,
  AUTO_IMPORT_ON_START,
  AUTO_IMPORT_ROOT_DIR,
  AUTO_IMPORT_MAX_DEPTH_RAW,
  AUTO_IMPORT_MIN_FILE_AGE_MS,
  AUTO_IMPORT_FLATTEN_TO_WEBDL,
  AUTO_IMPORT_MOVE_SOURCE,
  AUTO_IMPORT_POLL_MS,
  STARTUP_REHYDRATE_DELAY_MS,
  STARTUP_REHYDRATE_MAX_ROWS,
  STARTUP_REHYDRATE_MODE,
  METADATA_BLOCKED_DOMAIN_SUFFIXES,
  getAutoImportMaxDepth: () => {
    if (!Number.isFinite(AUTO_IMPORT_MAX_DEPTH_RAW)) return 2;
    if (AUTO_IMPORT_MAX_DEPTH_RAW < 0) return 99;
    return AUTO_IMPORT_MAX_DEPTH_RAW;
  }
};
