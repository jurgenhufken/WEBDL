// src/adapters/redgifs.js — Redgifs via temporary-token API.
'use strict';

const path = require('node:path');
const { defineAdapter } = require('./base');
const { collectOutputsRecursive } = require('./_fs');

const API_ROOT = 'https://api.redgifs.com';
const WEB_ROOT = 'https://www.redgifs.com';
const USER_AGENT = process.env.WEBDL_REDGIFS_USER_AGENT
  || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const DEFAULT_EXPAND_LIMIT = Number.parseInt(process.env.WEBDL_REDGIFS_EXPAND_LIMIT || '300', 10) || 300;

function hostMatches(hostname) {
  const h = String(hostname || '').replace(/^www\./, '').toLowerCase();
  return h === 'redgifs.com'
    || h.endsWith('.redgifs.com')
    || h === 'gifdeliverynetwork.com'
    || h.endsWith('.gifdeliverynetwork.com')
    || h === 'gfycat.com'
    || h.endsWith('.gfycat.com');
}

function matches(url) {
  try {
    const u = new URL(String(url || ''));
    return /^https?:$/.test(u.protocol) && hostMatches(u.hostname);
  } catch {
    return false;
  }
}

function isExpandableUrl(url) {
  try {
    const u = new URL(String(url || ''));
    if (!hostMatches(u.hostname)) return false;
    const p = String(u.pathname || '');
    return /^\/users\/[^/]+\/?$/i.test(p)
      || /^\/users\/[^/]+\/collections\/[^/]+\/?$/i.test(p)
      || /^\/niches\/[^/]+\/?$/i.test(p)
      || /^\/(?:gifs\/[^/]+|search(?:\/gifs)?|browse)\/?$/i.test(p);
  } catch {
    return false;
  }
}

function redgifsIdFromUrl(value) {
  const raw = String(value || '').trim();
  if (/^[A-Za-z0-9]+$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean);
    if (host === 'redgifs.com' || host.endsWith('.redgifs.com')) {
      if ((parts[0] === 'watch' || parts[0] === 'ifr') && parts[1]) return parts[1];
      if (parts.length === 1 && /^[A-Za-z0-9]+$/.test(parts[0])) return parts[0];
    }
    if (host === 'gfycat.com' || host.endsWith('.gfycat.com')) return parts[parts.length - 1] || '';
    if (host === 'gifdeliverynetwork.com' || host.endsWith('.gifdeliverynetwork.com')) {
      return (parts[parts.length - 1] || '').replace(/\.(mp4|webm|gif)$/i, '');
    }
  } catch {}
  return '';
}

function plan(url, opts = {}) {
  return {
    cmd: process.execPath,
    args: [path.join(__dirname, '..', 'scripts', 'redgifs-dl.js'), url, opts.cwd],
    cwd: opts.cwd,
    env: {},
    logStdout: true,
    timeoutMs: Number.parseInt(process.env.WEBDL_REDGIFS_TIMEOUT_MS || String(45 * 60 * 1000), 10),
    idleTimeoutMs: Number.parseInt(process.env.WEBDL_REDGIFS_IDLE_TIMEOUT_MS || String(120 * 1000), 10),
  };
}

async function requestJson(url, { token = '', method = 'GET' } = {}) {
  const headers = {
    accept: 'application/json, text/plain, */*',
    origin: WEB_ROOT,
    referer: WEB_ROOT + '/',
    'user-agent': USER_AGENT,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) {
    const detail = data && (data.message || data.description || data.error) ? `: ${data.message || data.description || data.error}` : '';
    throw new Error(`Redgifs API ${res.status}${detail}`);
  }
  return data || {};
}

async function temporaryToken() {
  const configured = String(process.env.WEBDL_REDGIFS_TOKEN || '').trim();
  if (configured) return configured.replace(/^Bearer\s+/i, '');
  const data = await requestJson(`${API_ROOT}/v2/auth/temporary`);
  if (!data.token) throw new Error('Redgifs temporary token ontbreekt');
  return String(data.token);
}

async function apiCall(endpoint, params = {}) {
  const token = await temporaryToken();
  const u = new URL(`${API_ROOT}${endpoint}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  return requestJson(u.toString(), { token });
}

function entryFromGif(gif) {
  const id = String(gif && gif.id || '').trim();
  if (!id) return null;
  return {
    id,
    title: gif.title || gif.tags?.join(' ') || gif.userName || id,
    url: `https://www.redgifs.com/watch/${id}`,
    thumbnail: gif.urls?.poster || gif.urls?.thumbnail || gif.urls?.vthumbnail || '',
    channel: gif.userName || '',
  };
}

async function expandPaginated(endpoint, params, limit = DEFAULT_EXPAND_LIMIT, key = 'gifs') {
  const out = [];
  let page = Math.max(1, Number.parseInt(params.page || '1', 10) || 1);
  const count = Math.max(1, Math.min(100, Number.parseInt(params.count || '100', 10) || 100));
  while (out.length < limit) {
    const data = await apiCall(endpoint, { ...params, page, count });
    const rows = Array.isArray(data[key]) ? data[key] : [];
    for (const gif of rows) {
      const entry = entryFromGif(gif);
      if (entry) out.push(entry);
      if (out.length >= limit) break;
    }
    const pages = Number(data.pages) || page;
    if (page >= pages || rows.length === 0) break;
    page += 1;
  }
  return out;
}

function queryParams(url) {
  try {
    const u = new URL(String(url || ''));
    return Object.fromEntries(u.searchParams.entries());
  } catch {
    return {};
  }
}

async function expandPlaylist(url, opts = {}) {
  const limit = Math.max(1, Number.parseInt(opts.limit || opts.redgifsLimit || DEFAULT_EXPAND_LIMIT, 10) || DEFAULT_EXPAND_LIMIT);
  const u = new URL(String(url || ''));
  const p = String(u.pathname || '');
  const params = queryParams(url);

  let m = p.match(/^\/users\/([^/]+)\/collections\/([^/]+)\/?$/i);
  if (m) {
    return expandPaginated(`/v2/users/${encodeURIComponent(m[1].toLowerCase())}/collections/${encodeURIComponent(m[2])}/gifs`, params, limit);
  }

  m = p.match(/^\/users\/([^/]+)\/?$/i);
  if (m) {
    return expandPaginated(`/v2/users/${encodeURIComponent(m[1].toLowerCase())}/search`, { order: 'new', ...params }, limit);
  }

  m = p.match(/^\/niches\/([^/]+)\/?$/i);
  if (m) {
    return expandPaginated(`/v2/niches/${encodeURIComponent(m[1])}/gifs`, { order: 'new', ...params }, limit);
  }

  m = p.match(/^\/gifs\/([^/]+)\/?$/i);
  if (m) {
    return expandPaginated('/v2/gifs/search', { search_text: decodeURIComponent(m[1]), ...params }, limit);
  }

  if (/^\/(?:search(?:\/gifs)?|browse)\/?$/i.test(p)) {
    const endpoint = /^\/search/i.test(p) ? '/v2/search/gifs' : '/v2/gifs/search';
    return expandPaginated(endpoint, { order: 'new', ...params }, limit);
  }

  throw new Error('Redgifs URL is geen collectie/search/profile URL');
}

function parseProgress(line) {
  const m = String(line || '').match(/^PROG pct=\s*([\d.]+)%\s+speed=\s*(\S+)\s+eta=\s*(\S+)/);
  if (!m) return null;
  const pct = Number.parseFloat(m[1]);
  return Number.isFinite(pct) ? { pct, speed: m[2], eta: m[3] } : null;
}

module.exports = defineAdapter({
  name: 'redgifs',
  priority: 88,
  matches,
  plan,
  parseProgress,
  collectOutputs: collectOutputsRecursive,
  expandPlaylist,
});

module.exports._hostMatches = hostMatches;
module.exports._isExpandableUrl = isExpandableUrl;
module.exports._redgifsIdFromUrl = redgifsIdFromUrl;
module.exports._entryFromGif = entryFromGif;
