// src/adapters/ofscraper.js — OnlyFans via ofscraper CLI.
// NB: ofscraper gebruikt zijn eigen config + sessie; we ondersteunen hier
// alleen "scrape van één gebruiker". URL of `of/<username>` is input.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { defineAdapter } = require('./base');
const { collectOutputsRecursive } = require('./_fs');

const DEFAULT_CONFIG_DIR = process.env.OFSCRAPER_CONFIG_DIR || '/Users/jurgen/.config/ofscraper';
const DEFAULT_PROFILE = process.env.OFSCRAPER_PROFILE || 'main_profile';

function readSaveLocation() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(DEFAULT_CONFIG_DIR, 'config.json'), 'utf8'));
    const saveLocation = cfg?.file_options?.save_location;
    return typeof saveLocation === 'string' && saveLocation.trim() ? saveLocation : null;
  } catch {
    return null;
  }
}

function matches(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    return /(^|\.)onlyfans\.com$/i.test(u.hostname);
  } catch { return false; }
}

function urlToUsername(url) {
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean);
  if (!parts[0]) throw new Error('OnlyFans URL zonder gebruikersnaam');
  return parts[0];
}

function isFinalMediaFile(filePath) {
  const base = path.basename(filePath);
  const ext = path.extname(base).toLowerCase();
  if (base.startsWith('.')) return false;
  if (base.endsWith('.part')) return false;
  if (base.endsWith('.temp') || base.endsWith('.tmp')) return false;
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.m4v', '.mov', '.webm', '.mkv'].includes(ext);
}

function plan(url, opts = {}) {
  const user = urlToUsername(url);
  // ofscraper heeft geen generieke --output flag; we laten het z'n eigen
  // download-dir schrijven naar opts.cwd via env. Veel builds honoreren
  // OFSCRAPER_METADATA/OFSCRAPER_SAVE_PATH; we zetten beide + cwd als fallback.
  const args = [
    '-cg', DEFAULT_CONFIG_DIR,
    '-r', DEFAULT_PROFILE,
    '--no-live',
    '--auth-fail',
    '-u', user,
    '-a', 'download',
    '-da', 'all',
    '-p', 'low',
    '-l', 'off',
  ];
  const env = {
    OFSCRAPER_SAVE_PATH: opts.cwd,
    OFSCRAPER_METADATA: opts.cwd,
    OFSCRAPER_CONFIG_DIR: DEFAULT_CONFIG_DIR,
    OFSCRAPER_PROFILE: DEFAULT_PROFILE,
  };
  return {
    cmd: 'ofscraper',
    args,
    cwd: opts.cwd,
    env,
    logStdout: true,
    timeoutMs: 45 * 60 * 1000,
    idleTimeoutMs: 10 * 60 * 1000,
  };
}

async function collectOutputs(workdir, opts = {}) {
  const seen = new Set();
  const out = [];
  async function addFiles(files, minMtimeMs = 0) {
    for (const file of files) {
      if (!file?.path || seen.has(file.path)) continue;
      if (!isFinalMediaFile(file.path)) continue;
      if (minMtimeMs) {
        try {
          const st = await fs.promises.stat(file.path);
          if (st.mtimeMs + 1000 < minMtimeMs) continue;
        } catch {
          continue;
        }
      }
      seen.add(file.path);
      out.push(file);
    }
  }

  await addFiles(await collectOutputsRecursive(workdir));

  const saveLocation = readSaveLocation();
  if (saveLocation && path.resolve(saveLocation) !== path.resolve(workdir)) {
    const user = opts.job?.url ? urlToUsername(opts.job.url) : null;
    const userDir = user ? path.join(saveLocation, user) : saveLocation;
    await addFiles(await collectOutputsRecursive(userDir), opts.startedAtMs || 0);
  }
  return out;
}

// ofscraper toont variabele UI; we parsen simpele "X/Y" regels als die komen.
const PROG_RE = /(\d+)\s*\/\s*(\d+)\s+(?:media|posts)/i;
function parseProgress(line) {
  const m = PROG_RE.exec(line);
  if (!m) return null;
  const done = Number.parseInt(m[1], 10);
  const total = Number.parseInt(m[2], 10);
  if (!total) return null;
  return { pct: (done / total) * 100 };
}

module.exports = defineAdapter({
  name: 'ofscraper',
  priority: 90,
  matches,
  plan,
  parseProgress,
  collectOutputs,
});
module.exports._urlToUsername = urlToUsername;
module.exports._readSaveLocation = readSaveLocation;
module.exports._isFinalMediaFile = isFinalMediaFile;
