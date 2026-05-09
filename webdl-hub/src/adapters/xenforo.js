// src/adapters/xenforo.js — XenForo thread media downloader for allowlisted forums.
'use strict';

const path = require('node:path');
const { defineAdapter } = require('./base');
const { collectOutputsRecursive } = require('./_fs');

const HOSTS = [
  'foot-fetish.club',
];

function normalizeTranslatedProxyUrl(url) {
  try {
    const u = new URL(String(url || ''));
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'translated.turbopages.org') return u.toString();

    const parts = u.pathname.split('/').filter(Boolean);
    const schemeIndex = parts.findIndex((p) => p === 'http' || p === 'https');
    if (schemeIndex < 0 || !parts[schemeIndex + 1]) return u.toString();

    const scheme = parts[schemeIndex];
    const targetHost = parts[schemeIndex + 1];
    const targetPath = '/' + parts.slice(schemeIndex + 2).join('/');
    return `${scheme}://${targetHost}${targetPath}${u.search}${u.hash}`;
  } catch (_) {
    return url;
  }
}

function supportedHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^www\./, '');
  return HOSTS.some((d) => h === d || h.endsWith('.' + d));
}

function matches(url) {
  try {
    const normalized = normalizeTranslatedProxyUrl(url);
    const u = new URL(normalized);
    if (!/^https?:$/.test(u.protocol)) return false;
    if (!supportedHost(u.hostname)) return false;
    return /^\/threads\/[^/]+/i.test(u.pathname);
  } catch (_) {
    return false;
  }
}

function plan(url, opts = {}) {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'xenforo-dl.js');
  const targetUrl = normalizeTranslatedProxyUrl(url);
  return {
    cmd: process.execPath,
    args: [scriptPath, targetUrl, opts.cwd],
    cwd: opts.cwd,
    env: { ...process.env },
    timeoutMs: Number.parseInt(process.env.WEBDL_XENFORO_TIMEOUT_MS || String(30 * 60 * 1000), 10),
    idleTimeoutMs: Number.parseInt(process.env.WEBDL_XENFORO_IDLE_TIMEOUT_MS || String(180 * 1000), 10),
    logStdout: true,
  };
}

function parseProgress(line) {
  const match = String(line || '').match(/\[xenforo-progress\] (\d+)\/(\d+)/);
  if (!match) return null;
  const current = Number.parseInt(match[1], 10);
  const total = Number.parseInt(match[2], 10);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return null;
  return { pct: (current / total) * 100 };
}

module.exports = defineAdapter({
  name: 'xenforo',
  priority: 75,
  matches,
  plan,
  parseProgress,
  collectOutputs: collectOutputsRecursive,
});
