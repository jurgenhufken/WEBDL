// src/adapters/reddit.js — Reddit via BDFR (Bulk Downloader for Reddit).
'use strict';

const { defineAdapter } = require('./base');
const { collectOutputsRecursive } = require('./_fs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defaultBdfrCommand() {
  if (process.env.WEBDL_REDDIT_BDFR) return process.env.WEBDL_REDDIT_BDFR;
  const nodePython = process.version.match(/^v(\d+\.\d+)/)?.[1] || '3.9';
  const candidates = [
    path.join(os.homedir(), 'Library', 'Python', nodePython, 'bin', 'bdfr'),
    path.join(os.homedir(), 'Library', 'Python', '3.9', 'bin', 'bdfr'),
    path.join(os.homedir(), '.local', 'bin', 'bdfr'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || 'bdfr';
}

function matches(url) {
  try {
    const u = new URL(String(url || ''));
    if (!/^https?:$/.test(u.protocol)) return false;
    const h = String(u.hostname || '').toLowerCase();
    return h === 'reddit.com' || h.endsWith('.reddit.com') || h === 'redd.it' || h.endsWith('.redd.it');
  } catch (_) {
    return false;
  }
}

function postIdFromUrl(url) {
  try {
    const u = new URL(String(url || ''));
    const h = String(u.hostname || '').toLowerCase();
    const p = String(u.pathname || '');
    if (h === 'redd.it' || h.endsWith('.redd.it')) return p.replace(/^\/+/, '').split('/')[0] || '';
    const m = p.match(/^\/(?:r\/[^\/?#]+|(?:user|u)\/[^\/?#]+)\/comments\/([a-z0-9]+)/i);
    return m && m[1] ? m[1] : '';
  } catch (_) {
    return '';
  }
}

function sourceArgs(url) {
  const id = postIdFromUrl(url);
  if (id) return ['--link', id];

  const u = new URL(String(url || ''));
  const p = String(u.pathname || '');
  const sub = p.match(/^\/r\/([^\/?#]+)/i);
  if (sub && sub[1]) return ['--subreddit', decodeURIComponent(sub[1])];

  const user = p.match(/^\/(?:user|u)\/([^\/?#]+)/i);
  if (user && user[1]) return ['--user', decodeURIComponent(user[1]), '--submitted'];

  throw new Error('Reddit URL wordt niet ondersteund door BDFR');
}

function plan(url, opts = {}) {
  const cmd = defaultBdfrCommand();
  const args = [
    'download',
    opts.cwd,
    '--folder-scheme', '',
    '--file-scheme', '{SUBREDDIT}_{REDDITOR}_{TITLE}_{POSTID}',
    '--filename-restriction-scheme', 'linux',
    '--no-dupes',
    '--search-existing',
    '--max-wait-time', String(opts.maxWaitTime || process.env.WEBDL_REDDIT_BDFR_MAX_WAIT_TIME || 120),
  ];

  const config = String(opts.bdfrConfig || process.env.WEBDL_REDDIT_BDFR_CONFIG || '').trim();
  if (config) args.push('--config', config);

  const limit = Number(opts.limit || process.env.WEBDL_REDDIT_BDFR_LIMIT || 0);
  if (Number.isFinite(limit) && limit > 0) args.push('-L', String(Math.floor(limit)));

  args.push(...sourceArgs(url));
  return { cmd, args, cwd: opts.cwd, env: {}, logStdout: true };
}

function parseProgress(line) {
  const text = String(line || '');
  const m = text.match(/\b(\d+)\s+of\s+(\d+)\b/i) || text.match(/\b(\d+)\/(\d+)\b/);
  if (!m) return null;
  const done = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null;
  return { pct: Math.max(0, Math.min(99, (done / total) * 100)) };
}

module.exports = defineAdapter({
  name: 'reddit',
  priority: 85,
  matches,
  plan,
  parseProgress,
  collectOutputs: collectOutputsRecursive,
});

module.exports._postIdFromUrl = postIdFromUrl;
module.exports._sourceArgs = sourceArgs;
module.exports._defaultBdfrCommand = defaultBdfrCommand;
