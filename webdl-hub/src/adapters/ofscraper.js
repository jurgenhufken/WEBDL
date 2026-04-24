// src/adapters/ofscraper.js — OnlyFans via ofscraper CLI.
// NB: ofscraper gebruikt zijn eigen config + sessie; we ondersteunen hier
// alleen "scrape van één gebruiker". URL of `of/<username>` is input.
'use strict';

const { defineAdapter } = require('./base');
const { collectOutputsRecursive } = require('./_fs');

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

function plan(url, opts = {}) {
  const user = urlToUsername(url);
  // ofscraper heeft geen generieke --output flag; we laten het z'n eigen
  // download-dir schrijven naar opts.cwd via env. Veel builds honoreren
  // OFSCRAPER_METADATA/OFSCRAPER_SAVE_PATH; we zetten beide + cwd als fallback.
  const args = [
    '--no-live',
    '-u', user,
    '-p', 'low',
    '-l', 'off',
  ];
  const env = {
    OFSCRAPER_SAVE_PATH: opts.cwd,
    OFSCRAPER_METADATA: opts.cwd,
  };
  return { cmd: 'ofscraper', args, cwd: opts.cwd, env };
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
  collectOutputs: collectOutputsRecursive,
});
module.exports._urlToUsername = urlToUsername;
