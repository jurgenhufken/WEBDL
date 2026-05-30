// src/adapters/tdl.js — Telegram via lokale Telethon downloader.
'use strict';

const path = require('node:path');
const { defineAdapter } = require('./base');
const { collectOutputsRecursive } = require('./_fs');

const DEFAULT_SCRIPT = path.resolve(__dirname, '..', '..', '..', 'telegram-channel-download.py');

function pickPositiveInt(...values) {
  for (const value of values) {
    const n = Number.parseInt(String(value || ''), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function matches(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    return /(^|\.)t\.me$/i.test(u.hostname) || /(^|\.)telegram\.me$/i.test(u.hostname);
  } catch { return false; }
}

function plan(url, opts = {}) {
  const script = process.env.WEBDL_TELEGRAM_SCRIPT || DEFAULT_SCRIPT;
  const python = process.env.WEBDL_PYTHON || '/usr/bin/python3';
  const args = [script, url, opts.cwd];
  const messageLimit = pickPositiveInt(opts.telegramMessageLimit, opts.messageLimit, opts.limit, process.env.WEBDL_TELEGRAM_MESSAGE_LIMIT);
  const parallel = pickPositiveInt(opts.telegramParallel, opts.parallel, process.env.WEBDL_TELEGRAM_PARALLEL) || 8;
  const mediaLimit = pickPositiveInt(opts.telegramMediaLimit, opts.mediaLimit, process.env.WEBDL_TELEGRAM_MEDIA_LIMIT);
  if (messageLimit) args.push(String(messageLimit));
  args.push('--parallel', String(parallel));
  if (mediaLimit) args.push('--media-limit', String(mediaLimit));
  if (opts.telegramWithLinked || opts.withLinked) args.push('--with-linked');
  return { cmd: python, args, cwd: opts.cwd, env: { ...process.env }, logStdout: true };
}

const PROG_RE = /(?:PROG\s+)?pct=(\d+(?:\.\d+)?)%?(?:\s+speed=([^\s]+))?/i;
const TDL_PROG_RE = /(\d+(?:\.\d+)?)%\s*@\s*([\d.]+\s*[KMGT]?i?B\/s)/i;
function parseProgress(line) {
  const m = PROG_RE.exec(line) || TDL_PROG_RE.exec(line);
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
