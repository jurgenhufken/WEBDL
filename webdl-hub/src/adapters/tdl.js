// src/adapters/tdl.js — Telegram via tdl (github.com/iyear/tdl).
'use strict';

const { defineAdapter } = require('./base');
const { collectOutputsRecursive } = require('./_fs');

function matches(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    return /(^|\.)t\.me$/i.test(u.hostname) || /(^|\.)telegram\.me$/i.test(u.hostname);
  } catch { return false; }
}

function plan(url, opts = {}) {
  // `tdl dl -u <url> -d <dir>`: download single message of album.
  const args = ['dl', '-u', url, '-d', opts.cwd];
  return { cmd: 'tdl', args, cwd: opts.cwd, env: {} };
}

// tdl toont voortgang als "50.0% @ 1.2MB/s" op stderr.
const PROG_RE = /(\d+(?:\.\d+)?)%\s*@\s*([\d.]+\s*[KMGT]?i?B\/s)/i;
function parseProgress(line) {
  const m = PROG_RE.exec(line);
  if (!m) return null;
  const pct = Number.parseFloat(m[1]);
  if (!Number.isFinite(pct)) return null;
  return { pct, speed: m[2] };
}

module.exports = defineAdapter({
  name: 'tdl',
  priority: 95,
  matches,
  plan,
  parseProgress,
  collectOutputs: collectOutputsRecursive,
});
