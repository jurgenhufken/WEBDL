// src/adapters/ytdlp.js — yt-dlp adapter.
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { defineAdapter } = require('./base');

const YT_DLP = process.env.WEBDL_YT_DLP || 'yt-dlp';
const FFMPEG_LOCATION = process.env.WEBDL_FFMPEG || '/opt/homebrew/bin/ffmpeg';
const YOUTUBE_SLEEP_REQUESTS = process.env.WEBDL_YTDLP_YOUTUBE_SLEEP_REQUESTS || '2';
const YOUTUBE_SLEEP_INTERVAL = process.env.WEBDL_YTDLP_YOUTUBE_SLEEP_INTERVAL || '2';
const YOUTUBE_MAX_SLEEP_INTERVAL = process.env.WEBDL_YTDLP_YOUTUBE_MAX_SLEEP_INTERVAL || '8';

// Generieke matcher: yt-dlp ondersteunt duizenden sites, dus we accepteren
// elke http(s)-URL. Andere adapters (reddit, instagram, tdl) hebben hogere
// priority zodat zij voor yt-dlp geselecteerd worden.
function matches(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Output-template: alle media van één job in z'n eigen job-dir, nette naam.
const OUTPUT_TEMPLATE = '%(title).200B [%(id)s].%(ext)s';

function normalizeFlatEntryUrl(obj, seedUrl) {
  const raw = String(obj && (obj.url || obj.webpage_url || obj.original_url) || '').trim();
  const id = String(obj && obj.id || '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    const seed = new URL(String(seedUrl || ''));
    const host = seed.hostname.replace(/^www\./, '').toLowerCase();
    if (raw.startsWith('/')) return new URL(raw, seed.origin).toString();
    if ((host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) && id) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    }
    if (raw) return new URL(raw, seed.origin).toString();
  } catch {}
  return raw || (id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : '');
}

function plan(url, opts = {}) {
  const cwd = opts.cwd;
  const quality = opts.quality || 'bv*+ba/best';
  const isYoutube = /(?:youtube\.com|youtu\.be)/i.test(String(url || ''));
  const args = [
    '--no-colors',
    '--newline',                // progress per regel i.p.v. \r-updates
    '--progress-template',
    'download:PROG pct=%(progress._percent_str)s speed=%(progress._speed_str)s eta=%(progress._eta_str)s',
    '-f', quality,
    '-o', OUTPUT_TEMPLATE,
    '--ffmpeg-location', FFMPEG_LOCATION,  // Fix postprocessing / audio merge
    '--cookies-from-browser', 'firefox',   // Fix age verification
    '--write-info-json',                   // Metadata voor gallery sync
    '--no-playlist',                       // NOOIT een hele playlist in 1 job
  ];
  if (isYoutube) {
    args.push(
      '--sleep-requests', YOUTUBE_SLEEP_REQUESTS,
      '--sleep-interval', YOUTUBE_SLEEP_INTERVAL,
      '--max-sleep-interval', YOUTUBE_MAX_SLEEP_INTERVAL,
    );
  }
  args.push(url);
  return { cmd: YT_DLP, args, cwd, env: {} };
}

// Matcht op onze custom progress-template hierboven.
const PROG_RE = /^PROG pct=\s*([\d.]+)%\s+speed=\s*(\S+)\s+eta=\s*(\S+)/;

function parseProgress(line) {
  const m = PROG_RE.exec(line);
  if (!m) return null;
  const pct = Number.parseFloat(m[1]);
  if (!Number.isFinite(pct)) return null;
  return { pct, speed: m[2], eta: m[3] };
}

// Eenvoudige file-collectie: alles wat in workdir staat na afloop, niet-recursief.
async function collectOutputs(workdir) {
  try {
    const entries = await fs.readdir(workdir, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      const full = path.join(workdir, e.name);
      const st = await fs.stat(full);
      out.push({ path: full, size: st.size });
    }
    return out;
  } catch {
    return [];
  }
}

// ─── Playlist/channel expansion ───────────────────────────────────────────────
// Draait `yt-dlp --flat-playlist --dump-json` en parsed elke JSON-line
// tot een compacte entry { id, title, url }.
// Resolvet naar een array of rejects bij fatale fouten.
function expandPlaylist(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--flat-playlist',
      '--dump-json',
      '--no-colors',
      '--cookies-from-browser', 'firefox',
      url,
    ];

    const child = execFile(YT_DLP, args, {
      maxBuffer: 100 * 1024 * 1024, // 100 MB — playlists kunnen groot zijn
      timeout: 120_000,
    }, (err, stdout, stderr) => {
      if (err && (!stdout || stdout.trim().length === 0)) {
        return reject(new Error(stderr || err.message || String(err)));
      }
      const entries = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          const id = obj.id || '';
          const title = obj.title || obj.fulltitle || '';
          const entryUrl = normalizeFlatEntryUrl(obj, url);
          if (entryUrl) {
            entries.push({ id, title, url: entryUrl });
          }
        } catch { /* niet-JSON regel, skip */ }
      }
      resolve(entries);
    });
  });
}

module.exports = defineAdapter({
  name: 'ytdlp',
  priority: 50,
  matches,
  plan,
  parseProgress,
  collectOutputs,
  expandPlaylist,
});
