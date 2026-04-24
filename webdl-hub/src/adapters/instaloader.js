// src/adapters/instaloader.js — Instagram via instaloader CLI.
'use strict';

const { defineAdapter } = require('./base');
const { collectOutputsRecursive } = require('./_fs');

// Matcht instagram.com posts, reels, stories, profielen en highlights.
function matches(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    return /(^|\.)instagram\.com$/i.test(u.hostname);
  } catch { return false; }
}

// Kleine parser: URL → instaloader-target. Ondersteunt:
//   /p/<shortcode>/           → -- -<shortcode>
//   /reel/<shortcode>/        → -- -<shortcode>
//   /<username>/              → <username>
// Alles wat we niet herkennen valt terug op de hele pathname als target.
function urlToTarget(url) {
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean);
  if ((parts[0] === 'p' || parts[0] === 'reel' || parts[0] === 'tv') && parts[1]) {
    return { kind: 'post', value: `-${parts[1]}` };
  }
  if (parts[0] === 'stories' && parts[1]) {
    return { kind: 'profile', value: parts[1] };
  }
  if (parts[0] && !parts[0].startsWith('_')) {
    return { kind: 'profile', value: parts[0] };
  }
  return { kind: 'profile', value: url };
}

function plan(url, opts = {}) {
  const t = urlToTarget(url);
  // --dirname-pattern={target}: alles onder jobdir, géén diepe profielstructuur.
  const args = [
    '--no-compress-json',
    `--dirname-pattern=${opts.cwd}`,
    '--quiet',
  ];
  if (t.kind === 'post') {
    args.push('--', t.value);
  } else {
    args.push(t.value);
  }
  return { cmd: 'instaloader', args, cwd: opts.cwd, env: {} };
}

// instaloader rapporteert "[ 1/10] <file>" als voortgang.
const PROG_RE = /^\[\s*(\d+)\/(\d+)\s*\]/;
function parseProgress(line) {
  const m = PROG_RE.exec(line);
  if (!m) return null;
  const done = Number.parseInt(m[1], 10);
  const total = Number.parseInt(m[2], 10);
  if (!total) return null;
  return { pct: (done / total) * 100 };
}

module.exports = defineAdapter({
  name: 'instaloader',
  priority: 85,
  matches,
  plan,
  parseProgress,
  collectOutputs: collectOutputsRecursive,
});
// Extra helpers voor tests (niet onderdeel van adapter-contract).
module.exports._urlToTarget = urlToTarget;
