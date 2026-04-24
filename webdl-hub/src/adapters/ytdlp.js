// src/adapters/ytdlp.js — yt-dlp adapter.
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { defineAdapter } = require('./base');

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

function plan(url, opts = {}) {
  const cwd = opts.cwd;
  const quality = opts.quality || 'bv*+ba/best';
  const args = [
    '--no-colors',
    '--newline',                // progress per regel i.p.v. \r-updates
    '--progress-template',
    'download:PROG pct=%(progress._percent_str)s speed=%(progress._speed_str)s eta=%(progress._eta_str)s',
    '-f', quality,
    '-o', OUTPUT_TEMPLATE,
    url,
  ];
  return { cmd: 'yt-dlp', args, cwd, env: {} };
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

module.exports = defineAdapter({
  name: 'ytdlp',
  priority: 50,
  matches,
  plan,
  parseProgress,
  collectOutputs,
});
