// src/api/routes-jobs.js — REST voor /api/jobs.
'use strict';

const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isSlaveUrl, delegateToSlave } = require('../queue/slave-router');
const { classifyLane, defaultJobPriority } = require('../db/repo');

const BATCH_MANIFEST_DIR = process.env.WEBDL_BATCH_MANIFEST_DIR
  || path.join(process.cwd(), 'tmp', 'batch-manifests');

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function ensureBatchManifestDir() {
  await fs.promises.mkdir(BATCH_MANIFEST_DIR, { recursive: true });
}

// Detecteer URLs die uit meerdere items bestaan (playlist/kanaal/shorts-tab).
// Als een URL een playlist-list param heeft of een kanaal/shorts-pagina is,
// moet de hub auto-expanden ipv één enkele job maken.
function isMultiItemUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const pathname = u.pathname.toLowerCase();
    const isYoutubeHost = host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com');
    const isXvideosHost = host === 'xvideos.com' || host.endsWith('.xvideos.com') || host === 'xvideos.red' || host.endsWith('.xvideos.red');
    const isXhomealoneHost = host === 'xhomealone.com' || host.endsWith('.xhomealone.com');
    const isRedgifsHost = host === 'redgifs.com' || host.endsWith('.redgifs.com');
    if (isXvideosHost) {
      return !/^\/video[./]/i.test(pathname);
    }
    if (isXhomealoneHost) {
      return !/^\/videos\/\d+\//i.test(pathname);
    }
    if (isRedgifsHost) {
      if (/^\/users\/[^/]+\/?$/.test(pathname)) return true;
      if (/^\/users\/[^/]+\/collections\/[^/]+\/?$/.test(pathname)) return true;
      if (/^\/niches\/[^/]+\/?$/.test(pathname)) return true;
      if (/^\/(?:gifs\/[^/]+|search(?:\/gifs)?|browse)\/?$/.test(pathname)) return true;
      return false;
    }
    if (!isYoutubeHost) return false;
    // /playlist?list=... of watch?list=... (playlist param met echte waarde)
    const list = u.searchParams.get('list');
    if (list && !/^RD|^UL|^WL$/.test(list)) {
      // Mix-/autoplay-lijsten (beginnen met RD) en WatchLater (WL) zijn niet
      // stabiel uitbreidbaar — die behandelen we als single-video.
      return true;
    }
    // Kanaal-pagina's en tabs
    if (/^\/@[^/]+\/?(shorts|videos|streams|live)?\/?$/.test(pathname)) return true;
    if (/^\/(channel|c|user)\//.test(pathname)) return true;
    return false;
  } catch { return false; }
}

function canonicalExpandUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    u.hash = '';
    if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') {
      const list = u.searchParams.get('list');
      if (list && !/^RD|^UL|^WL$/i.test(list)) {
        return `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`;
      }
      u.search = '';
      u.hostname = host === 'youtu.be' ? 'www.youtube.com' : u.hostname;
      u.pathname = u.pathname.replace(/\/+$/, '') || '/';
      return u.toString();
    }
    return u.toString();
  } catch {
    return String(url || '').trim();
  }
}

function stableExpandGroupId(url) {
  return crypto.createHash('sha1').update(canonicalExpandUrl(url)).digest('hex').slice(0, 12);
}

function normalizeVipergirlsThreadUrl(url, { wholeThread = true } = {}) {
  try {
    const u = new URL(String(url || ''));
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'viper.to' || host.endsWith('.viper.to')) {
      u.hostname = 'vipergirls.to';
    }
    if (u.hostname.toLowerCase().replace(/^www\./, '') === 'vipergirls.to') {
      const m = String(u.pathname || '').match(/\/threads\/(?:threads\/)*(\d+)(-[^/?#]+)?(?:\/(?:threads\/(?:threads\/)*)?\d+(?:-[^/?#]+)?)*?(?:\/page\d+)?\/?$/i)
        || String(u.pathname || '').match(/\/threads\/(?:threads\/)*(\d+)(-[^/?#]+)?/i);
      if (m && wholeThread) {
        u.pathname = `/threads/${m[1]}${m[2] || ''}`;
        u.search = '';
        u.hash = '';
      }
    }
    return u.toString();
  } catch {}
  return String(url || '');
}

function normalizeSourceContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  const out = { ...ctx };
  if (out.url && /(?:vipergirls\.to|viper\.to)\/threads\//i.test(String(out.url))) {
    out.url = normalizeVipergirlsThreadUrl(out.url, { wholeThread: true });
  }
  return out;
}

function normalizeTranslatedProxyUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
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
    return String(url || '');
  }
}

function canonicalDedupeUrl(url) {
  const raw = normalizeTranslatedProxyUrl(url);
  try {
    const u = new URL(String(raw || '').trim());
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    u.hostname = host;
    u.hash = '';
    if ((host === 'youtube.com' || host.endsWith('.youtube.com')) && u.searchParams.get('v')) {
      return `youtube:${u.searchParams.get('v')}`;
    }
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id) return `youtube:${id}`;
    }
    for (const key of Array.from(u.searchParams.keys())) {
      if (/^(utm_|fbclid$|gclid$|dclid$|yclid$|mc_|promo$|ref$|src$|source$)/i.test(key)) {
        u.searchParams.delete(key);
      }
    }
    const params = Array.from(u.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    for (const [key, val] of params) u.searchParams.append(key, val);
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString().toLowerCase();
  } catch (_) {
    return String(raw || '').trim().toLowerCase();
  }
}

function isFootFetishClubBrowserOnlyUrl(url) {
  try {
    const normalized = normalizeTranslatedProxyUrl(url);
    const u = new URL(String(normalized || '').trim());
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== 'foot-fetish.club' && !host.endsWith('.foot-fetish.club')) return false;
    return /^\/(?:threads|attachments)\//i.test(u.pathname);
  } catch (_) {
    return false;
  }
}

function isRefreshableCollectionUrl(url, adapterName = '') {
  try {
    const u = new URL(String(url || '').trim());
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const pathname = u.pathname.replace(/\/+$/, '') || '/';
    if (adapterName === 'reddit' || host === 'reddit.com' || host.endsWith('.reddit.com')) {
      return /^\/(?:r|user)\/[^/]+$/i.test(pathname);
    }
    if (host === 'vipergirls.to' || host.endsWith('.vipergirls.to') || host === 'viper.to' || host.endsWith('.viper.to')) {
      return /^\/threads\/\d+(?:-[^/?#]+)?$/i.test(pathname);
    }
    if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) {
      if (/^\/hashtag\/[A-Za-z0-9_]{1,139}$/i.test(pathname)) return true;
      return /^\/(?!i\/|home$|explore$|search$|settings$|messages$|notifications$)[A-Za-z0-9_]{1,20}$/i.test(pathname);
    }
    return false;
  } catch (_) {
    return false;
  }
}

function isArchiveDownloadUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    return /\.(?:zip|rar|7z|tar|gz|tgz|bz2|xz|cbz|cbr)(?:$|[?#])/i.test(u.pathname || '');
  } catch (_) {
    return false;
  }
}

function isFileLockerUrl(url) {
  try {
    const host = new URL(String(url || '').trim()).hostname.replace(/^www\./i, '').toLowerCase();
    return [
      'filejoker.net',
      'fileboom.me',
      'fboom.me',
      'rapidgator.net',
      'katfile.com',
      'tezfiles.com',
      'filespace.com',
      'uploadgig.com',
      'uploaded.net',
      'nitroflare.com',
    ].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch (_) {
    return false;
  }
}

async function withUrlDedupeLock(repo, url, fn) {
  const key = canonicalDedupeUrl(url);
  const deadline = Date.now() + 8000;
  for (;;) {
    const client = await repo.pool.connect();
    let locked = false;
    try {
      const result = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [key]);
      const lockValue = result && result.rows && result.rows[0] ? result.rows[0].locked : undefined;
      locked = lockValue === undefined ? true : lockValue === true || lockValue === 't';
      if (locked) {
        try {
          return await fn();
        } finally {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
        }
      }
    } finally {
      client.release();
    }
    if (Date.now() >= deadline) {
      throw Object.assign(new Error('Dedupe-lock is nog bezet; probeer dezelfde URL zo opnieuw'), { httpStatus: 409 });
    }
    await new Promise((resolve) => setTimeout(resolve, 100 + Math.floor(Math.random() * 150)));
  }
}

async function expandAndEnqueue({ repo, queue, adapters, url, priority, options, maxAttempts, force }) {
  const adapter = adapters.find((a) => a.expandPlaylist && a.matches(url));
  if (!adapter || !adapter.expandPlaylist) {
    throw Object.assign(new Error('Geen adapter met playlist-expand voor deze URL'), { httpStatus: 400 });
  }
  const canonicalUrl = canonicalExpandUrl(url);
  const groupId = options && options.expandGroup ? String(options.expandGroup) : stableExpandGroupId(canonicalUrl);
  if (!force) {
    const existingGroup = await repo.getGroupSummary(groupId)
      || await repo.findGroupSummaryByExpandUrl([canonicalUrl, url].filter(Boolean));
    if (existingGroup && Number(existingGroup.jobs || 0) > 0) {
      return {
        total: Number(existingGroup.total || existingGroup.jobs || 0),
        queued: 0,
        duplicates: Number(existingGroup.jobs || 0),
        skipped: 0,
        paused: Number(existingGroup.paused || 0),
        errors: 0,
        groupId: existingGroup.group_id || groupId,
        playlistName: existingGroup.name || existingGroup.display_name || canonicalUrl,
        existing: true,
        duplicate: true,
        jobs: [],
      };
    }
  }
  const entries = await adapter.expandPlaylist(url, options || {});
  if (!entries || entries.length === 0) {
    return { total: 0, queued: 0, duplicates: 0, errors: 0, jobs: [] };
  }

  let playlistName = url;
  try {
    const u = new URL(canonicalUrl || url);
    const pathParts = u.pathname.split('/').filter(Boolean);
    if (pathParts[0] && pathParts[0].startsWith('@')) playlistName = pathParts[0];
    else if (pathParts.length >= 2) playlistName = pathParts.slice(0, 2).join('/');
    else if (u.searchParams.get('list')) playlistName = 'Playlist ' + u.searchParams.get('list').slice(0, 12);
    else playlistName = u.hostname.replace('www.', '') + u.pathname;
  } catch {}

  // Titels die nooit zullen downloaden — skip ze vóór ze in de queue gaan
  const SKIP_TITLES = /^\[(Deleted video|Private video|Unavailable video)\]$/i;
  const activeLimit = intEnv('WEBDL_EXPAND_ACTIVE_LIMIT', 300);

  let queued = 0, duplicates = 0, errors = 0, skipped = 0, paused = 0;
  const jobs = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    // Skip verwijderde/private/unavailable videos
    if (SKIP_TITLES.test(String(entry.title || '').trim())) {
      skipped++;
      continue;
    }
    try {
      if (!force) {
        const existing = await repo.findRecentJobByUrl(entry.url);
        if (existing) { duplicates++; continue; }
        const existingDownload = await repo.findGalleryDownloadByUrl(entry.url);
        if (existingDownload) { duplicates++; continue; }
      }
      const originalLane = classifyLane(entry.url, adapter.name);
      const shouldPause = activeLimit > 0 && queued >= activeLimit;
      const job = await queue.enqueue({
        url: entry.url,
        adapter: adapter.name,
        priority: Number.isFinite(Number(priority)) ? priority : defaultJobPriority(entry.url, adapter.name),
        options: {
          ...options,
          expandGroup: groupId,
          expandName: playlistName,
          expandUrl: canonicalUrl,
          expandOriginalUrl: url,
          expandIndex: i + 1,
          expandTotal: entries.length,
          ...(shouldPause ? { pauseLane: originalLane, paused_at: new Date().toISOString(), autoPausedByExpandLimit: true } : {}),
          videoTitle: entry.title || undefined,
          thumbnail: entry.thumbnail || undefined,
          channel: entry.channel || options.channel || undefined,
          youtubeChannelId: entry.channelId || undefined,
          youtubeChannelUrl: entry.channelUrl || undefined,
          playlistTitle: entry.playlistTitle || options.playlistTitle || undefined,
        },
        maxAttempts,
        lane: shouldPause ? 'paused' : originalLane,
      });
      jobs.push({ id: job.id, url: entry.url, title: entry.title, thumbnail: entry.thumbnail || undefined });
      if (shouldPause) paused++;
      else queued++;
    } catch (_e) {
      errors++;
    }
  }
  return { total: entries.length, queued, duplicates, skipped, paused, errors, groupId, playlistName, jobs };
}

function hostnameFromUrl(value) {
  try {
    return new URL(String(value || '')).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_) {
    return '';
  }
}

function requestedPriorityFromBody(body) {
  const value = Number(body && body.priority);
  return Number.isFinite(value) ? Math.round(value) : null;
}

function uniqueUrls(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const url = String(value || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function sourceContextLookupKey(value) {
  try {
    const normalized = normalizeTranslatedProxyUrl(value);
    const u = new URL(String(normalized || '').trim());
    u.hash = '';
    return u.toString();
  } catch (_) {
    return String(value || '').trim();
  }
}

function pickSourceContextForUrl(options, url) {
  const map = options && options.webdl_source_contexts && typeof options.webdl_source_contexts === 'object'
    ? options.webdl_source_contexts
    : null;
  const fallback = options && options.sourceContext && typeof options.sourceContext === 'object'
    ? normalizeSourceContext(options.sourceContext)
    : null;
  if (!map) return fallback;

  const raw = String(url || '').trim();
  const normalized = sourceContextLookupKey(raw);
  for (const key of [raw, normalized]) {
    if (key && map[key] && typeof map[key] === 'object') return normalizeSourceContext(map[key]);
  }

  for (const [key, ctx] of Object.entries(map)) {
    if (!ctx || typeof ctx !== 'object') continue;
    if (sourceContextLookupKey(key) === normalized) return normalizeSourceContext(ctx);
  }
  return fallback;
}

const K2S_AUTH_KEYS = [
  'WEBDL_KEEP2SHARE_AUTH_TOKEN',
  'KEEP2SHARE_AUTH_TOKEN',
  'K2S_AUTH_TOKEN',
  'WEBDL_KEEP2SHARE_ACCESS_TOKEN',
  'KEEP2SHARE_ACCESS_TOKEN',
  'K2S_ACCESS_TOKEN',
  'WEBDL_KEEP2SHARE_USERNAME',
  'KEEP2SHARE_USERNAME',
  'K2S_USERNAME',
  'WEBDL_KEEP2SHARE_COOKIE',
  'KEEP2SHARE_COOKIE',
  'K2S_COOKIE',
  'WEBDL_KEEP2SHARE_X_BC',
  'KEEP2SHARE_X_BC',
  'K2S_X_BC',
  'WEBDL_KEEP2SHARE_XBC',
  'KEEP2SHARE_XBC',
  'K2S_XBC',
];

function keep2ShareAuthRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

function keep2ShareAuthType(key) {
  const normalized = String(key || '').toUpperCase();
  if (normalized.includes('USERNAME')) return 'username';
  if (normalized.includes('COOKIE')) return 'cookie';
  if (normalized.includes('X_BC') || normalized.includes('XBC')) return 'x_bc';
  if (normalized.includes('ACCESS_TOKEN')) return 'access_token';
  if (normalized.includes('AUTH_TOKEN')) return 'auth_token';
  return 'other';
}

function summarizeK2sAuthKeys(keys) {
  const entries = Array.from(new Set((keys || []).map((key) => String(key || '').toUpperCase()).filter(Boolean)));
  const types = Array.from(new Set(entries.map(keep2ShareAuthType))).sort();
  return { keyCount: entries.length, types };
}

function parseEnvAssignment(line) {
  const m = String(line || '').match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i);
  if (!m) return null;
  return {
    key: String(m[1] || '').toUpperCase(),
    value: String(m[2] || '').trim().replace(/^['"]|['"]$/g, ''),
  };
}

function scanK2sEnvFile(filePath, keys = K2S_AUTH_KEYS) {
  const wanted = new Set(keys.map((k) => String(k || '').toUpperCase()));
  const result = {
    source: filePath,
    kind: 'env_file',
    exists: false,
    readable: false,
    configured: false,
    keyCount: 0,
    types: [],
    status: 'missing_file',
  };

  try {
    if (!fs.existsSync(filePath)) return result;
    result.exists = true;
    const found = [];
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const entry = parseEnvAssignment(line);
      if (entry && wanted.has(entry.key) && entry.value) found.push(entry.key);
    }
    const summary = summarizeK2sAuthKeys(found);
    result.readable = true;
    result.configured = summary.keyCount > 0;
    result.keyCount = summary.keyCount;
    result.types = summary.types;
    result.status = result.configured ? 'configured' : 'empty';
  } catch (e) {
    result.exists = true;
    result.status = 'unreadable';
  }
  return result;
}

function scanK2sProcessEnv(env = process.env, keys = K2S_AUTH_KEYS) {
  const found = keys.filter((key) => String(env && env[key] || '').trim());
  const summary = summarizeK2sAuthKeys(found);
  return {
    source: 'process.env',
    kind: 'process_env',
    exists: true,
    readable: true,
    configured: summary.keyCount > 0,
    keyCount: summary.keyCount,
    types: summary.types,
    status: summary.keyCount > 0 ? 'configured' : 'empty',
  };
}

function getKeep2ShareAuthPreflight({ root = keep2ShareAuthRoot(), env = process.env } = {}) {
  const sources = [
    scanK2sProcessEnv(env),
    scanK2sEnvFile(path.join(root, 'screen-recorder-native', '.env')),
    scanK2sEnvFile(path.join(root, 'webdl-hub', '.env')),
  ];
  const configured = sources.some((source) => source.configured);
  const types = Array.from(new Set(sources.flatMap((source) => source.types))).sort();

  return {
    service: 'keep2share',
    readOnly: true,
    configured,
    sources,
    credentialTypes: types,
    queueGate: {
      localConfigPass: configured,
      meaning: configured
        ? 'Lokale K2S-config is aanwezig genoeg om de hub queue-gate te passeren.'
        : 'Lokale K2S-config ontbreekt; de hub queue-gate blokkeert nieuwe K2S-jobs.',
    },
    remoteAcceptance: {
      checked: false,
      status: 'not_checked',
      meaning: 'Deze read-only preflight doet geen K2S API/web-request en bewijst dus niet dat K2S de token, cookie of sessie accepteert.',
    },
  };
}

function hasKeep2ShareApiAuthConfigured() {
  return getKeep2ShareAuthPreflight().configured;
}

function simpleServerBaseUrl() {
  return String(
    process.env.WEBDL_SIMPLE_SERVER_URL ||
    process.env.SIMPLE_SERVER_URL ||
    'http://127.0.0.1:35729'
  ).trim().replace(/\/+$/, '');
}

function keep2ShareRemotePreflightFailure(preflight) {
  const checks = Array.isArray(preflight && preflight.checks) ? preflight.checks : [];
  const fileResolve = checks.find((check) => check && check.name === 'file_resolve');
  const reason = fileResolve && fileResolve.reason
    ? String(fileResolve.reason)
    : preflight && preflight.remoteAcceptance && preflight.remoteAcceptance.status
      ? `remote status ${preflight.remoteAcceptance.status}`
      : 'K2S file preflight rejected';
  return redactSecretText(reason);
}

async function assertKeep2ShareRemotePreflight(url, { timeoutMs = 15000 } = {}) {
  const endpoint = `${simpleServerBaseUrl()}/api/keep2share/preflight?url=${encodeURIComponent(url)}`;
  let res;
  try {
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
      ? AbortSignal.timeout(Math.max(1000, timeoutMs))
      : undefined;
    res = await fetch(endpoint, { signal });
  } catch (e) {
    throw Object.assign(
      new Error(`Keep2Share preflight kon simple-server niet bereiken: ${e && e.message ? e.message : String(e)}`),
      { httpStatus: 503 },
    );
  }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    throw Object.assign(
      new Error(`Keep2Share preflight faalde via simple-server: HTTP ${res.status}`),
      { httpStatus: 503 },
    );
  }
  if (!data || !data.remoteAcceptance || data.remoteAcceptance.accepted !== true) {
    throw Object.assign(
      new Error(`Keep2Share file is niet resolvebaar met huidige auth: ${keep2ShareRemotePreflightFailure(data)}`),
      { httpStatus: 409, preflight: data },
    );
  }
  return data;
}

function parsePositiveInt(value, fallback = null) {
  const n = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function keep2ShareFileIdFromUrl(url) {
  try {
    const u = new URL(String(url || ''));
    const host = String(u.hostname || '').toLowerCase().replace(/^www\./, '');
    if (!(host === 'keep2share.cc' || host === 'k2s.cc' || host === 'k2s.io' || host.endsWith('.keep2share.cc') || host.endsWith('.k2s.cc') || host.endsWith('.k2s.io'))) {
      return '';
    }
    const m = String(u.pathname || '').match(/^\/file\/([^/?#]+)/i);
    return m && m[1] ? decodeURIComponent(m[1]).trim().toLowerCase() : '';
  } catch (_) {
    return '';
  }
}

function redactSecretText(value) {
  return String(value || '')
    .replace(/((?:auth|token|cookie|password|secret|x[_-]?bc)[^=&\s:]{0,32}\s*[=:]\s*)[^\s&,"'}]+/ig, '$1[redacted]')
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/ig, '$1[redacted]');
}

function redactSecrets(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 8) return '[redacted-depth]';
  if (typeof value === 'string') return redactSecretText(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1));
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (/(auth|token|cookie|password|secret|x[_-]?bc)/i.test(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = redactSecrets(val, depth + 1);
    }
  }
  return out;
}

function parseJsonField(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return null;
  }
}

function hubJobIdFromMetadata(metadata) {
  const parsed = parseJsonField(metadata);
  const direct = parsed && parsePositiveInt(parsed.hub_job_id);
  if (direct) return direct;
  const m = String(metadata || '').match(/"hub_job_id"\s*:\s*"?([0-9]+)"?/);
  return m ? parsePositiveInt(m[1]) : null;
}

function mediaExtFromPath(value) {
  const m = String(value || '').toLowerCase().match(/\.([a-z0-9]{2,5})(?:$|[?#])/);
  return m ? m[1] : '';
}

function isImageExt(ext) {
  return /^(jpe?g|png|webp|gif|avif|bmp|tiff?)$/i.test(String(ext || ''));
}

function isMediaExt(ext) {
  return /^(jpe?g|png|webp|gif|avif|bmp|tiff?|mp4|webm|mkv|mov|m4v|avi|wmv|flv|ts|m2ts|mpg|mpeg|ogv|3gp|3g2)$/i.test(String(ext || ''));
}

function uniqNumbers(values) {
  return Array.from(new Set((values || []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)));
}

function sanitizeJob(row) {
  if (!row) return null;
  return {
    ...row,
    options: redactSecrets(parseJsonField(row.options) || row.options || {}),
    error: row.error ? redactSecretText(row.error) : row.error,
  };
}

function sanitizeDownload(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: redactSecrets(parseJsonField(row.metadata) || row.metadata || null),
    error: row.error ? redactSecretText(row.error) : row.error,
  };
}

function galleryVisibilityForDownload(download, files) {
  const relatedFiles = (files || []).filter((file) => Number(file.download_id) === Number(download.id));
  const directExt = mediaExtFromPath(download.filepath || download.filename || download.url);
  const hasDirectMedia = Boolean(download.filepath && isMediaExt(directExt));
  const directReady = hasDirectMedia && (download.is_thumb_ready === true || isImageExt(directExt));
  const visibleFiles = relatedFiles.filter((file) => {
    const ext = mediaExtFromPath(file.relpath);
    return isMediaExt(ext) && (file.is_thumb_ready === true || download.is_thumb_ready === true || isImageExt(ext));
  });
  const importableFiles = relatedFiles.filter((file) => {
    const ext = mediaExtFromPath(file.relpath);
    return file.relpath && isMediaExt(ext) && (file.filesize === null || file.filesize === undefined || Number(file.filesize) > 0);
  });
  const reasons = [];
  if (download.status !== 'completed') reasons.push(`download_status_${download.status || 'unknown'}`);
  if (!hasDirectMedia && !importableFiles.length) reasons.push('no_importable_media_path');
  if (download.status === 'completed' && hasDirectMedia && !directReady && !visibleFiles.length) reasons.push('thumb_not_ready_for_default_gallery_filter');
  if (download.status === 'completed' && relatedFiles.length && !visibleFiles.length && !directReady) reasons.push('download_files_not_thumb_ready');
  if (download.status === 'completed' && !relatedFiles.length && !hasDirectMedia) reasons.push('no_download_files_indexed');
  return {
    downloadId: download.id,
    defaultGalleryVisible: download.status === 'completed' && (directReady || visibleFiles.length > 0),
    hasDirectMedia,
    directThumbReady: directReady,
    indexedFiles: relatedFiles.length,
    importableFiles: importableFiles.length,
    visibleFiles: visibleFiles.length,
    reasons,
  };
}

function lifecycleSummary({ jobs, downloads, visibility, mismatches }) {
  if (!jobs.length && !downloads.length) {
    return { state: 'not_found', reason: 'Geen hub-job of simple-server download gevonden voor deze invoer.' };
  }
  if (mismatches.length) {
    return { state: 'mismatch', reason: mismatches[0].message };
  }
  if (jobs.some((job) => job.status === 'running') || downloads.some((download) => ['pending', 'queued', 'downloading', 'postprocessing'].includes(download.status))) {
    return { state: 'active', reason: 'Er is nog actieve hub- of simple-server lifecycle-status.' };
  }
  if (jobs.some((job) => job.status === 'failed') || downloads.some((download) => download.status === 'error')) {
    return { state: 'failed', reason: 'De lifecycle eindigt in een foutstatus; zie hub logs of download.error.' };
  }
  if (visibility.some((item) => item.defaultGalleryVisible)) {
    return { state: 'visible', reason: 'Minstens een gekoppelde completed download is zichtbaar onder de standaard galleryfilters.' };
  }
  if (downloads.some((download) => download.status === 'completed')) {
    return { state: 'completed_hidden', reason: 'Er is een completed download, maar de standaard galleryfilter toont hem waarschijnlijk niet.' };
  }
  return { state: 'known', reason: 'Er is lifecycle-context gevonden, zonder actieve, failed of zichtbaar-completed conclusie.' };
}

async function diagnoseLifecycle(repo, { jobId = null, downloadId = null, url = '', limit = 8 } = {}) {
  const schema = repo.schema;
  const jobsTable = `"${schema}".jobs`;
  const logsTable = `"${schema}".logs`;
  const filesTable = `"${schema}".files`;
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 8));
  const k2sId = keep2ShareFileIdFromUrl(url);

  const jobWhere = [];
  const jobParams = [];
  if (jobId) {
    jobParams.push(jobId);
    jobWhere.push(`id = $${jobParams.length}`);
  }
  if (downloadId) {
    jobParams.push(String(downloadId));
    jobWhere.push(`options->>'simple_server_download_id' = $${jobParams.length}`);
  }
  if (url) {
    jobParams.push(url);
    const urlParam = jobParams.length;
    if (k2sId) {
      jobParams.push(k2sId);
      jobWhere.push(`(url = $${urlParam} OR substring(lower(url) from '(?:keep2share\\.cc|k2s\\.cc|k2s\\.io)/file/([^/?#]+)') = $${jobParams.length})`);
    } else {
      jobWhere.push(`url = $${urlParam}`);
    }
  }
  jobParams.push(safeLimit);
  const jobs = jobWhere.length
    ? (await repo.pool.query(
      `SELECT * FROM ${jobsTable}
        WHERE ${jobWhere.map((part) => `(${part})`).join(' OR ')}
        ORDER BY id DESC
        LIMIT $${jobParams.length}`,
      jobParams,
    )).rows
    : [];

  const simpleIds = uniqNumbers([
    downloadId,
    ...jobs.map((job) => job.options && (parseJsonField(job.options) || job.options).simple_server_download_id),
  ]);
  const jobIds = uniqNumbers([jobId, ...jobs.map((job) => job.id)]);
  const jobUrls = Array.from(new Set(jobs.map((job) => String(job.url || '').trim()).filter(Boolean))).slice(0, 25);

  const downloadWhere = [];
  const downloadParams = [];
  if (simpleIds.length) {
    downloadParams.push(simpleIds);
    downloadWhere.push(`d.id = ANY($${downloadParams.length}::bigint[])`);
  }
  if (jobIds.length) {
    downloadParams.push(jobIds);
    downloadWhere.push(`NULLIF(substring(COALESCE(d.metadata, '') from '"hub_job_id"\\s*:\\s*"?([0-9]+)"?'), '')::bigint = ANY($${downloadParams.length}::bigint[])`);
  }
  if (url) {
    downloadParams.push(url);
    const urlParam = downloadParams.length;
    if (k2sId) {
      downloadParams.push(k2sId);
      downloadWhere.push(`(d.source_url = $${urlParam} OR d.url = $${urlParam}
        OR substring(lower(d.source_url) from '(?:keep2share\\.cc|k2s\\.cc|k2s\\.io)/file/([^/?#]+)') = $${downloadParams.length}
        OR substring(lower(d.url) from '(?:keep2share\\.cc|k2s\\.cc|k2s\\.io)/file/([^/?#]+)') = $${downloadParams.length})`);
    } else {
      downloadWhere.push(`(d.source_url = $${urlParam} OR d.url = $${urlParam})`);
    }
  }
  if (jobUrls.length) {
    downloadParams.push(jobUrls);
    downloadWhere.push(`(d.source_url = ANY($${downloadParams.length}::text[]) OR d.url = ANY($${downloadParams.length}::text[]))`);
  }
  downloadParams.push(safeLimit);
  const downloads = downloadWhere.length
    ? (await repo.pool.query(
      `SELECT d.id, d.url, d.source_url, d.platform, d.channel, d.title, d.status,
              d.filepath, d.filename, d.filesize, d.format, d.is_thumb_ready,
              d.error, d.metadata, d.created_at, d.updated_at, d.finished_at
         FROM public.downloads d
        WHERE ${downloadWhere.map((part) => `(${part})`).join(' OR ')}
        ORDER BY d.id DESC
        LIMIT $${downloadParams.length}`,
      downloadParams,
    )).rows
    : [];

  const metadataJobIds = uniqNumbers(downloads.map((download) => hubJobIdFromMetadata(download.metadata)));
  const missingJobIds = metadataJobIds.filter((id) => !jobIds.includes(id));
  let extraJobs = [];
  if (missingJobIds.length) {
    extraJobs = (await repo.pool.query(
      `SELECT * FROM ${jobsTable}
        WHERE id = ANY($1::bigint[])
        ORDER BY id DESC
        LIMIT $2`,
      [missingJobIds, safeLimit],
    )).rows;
  }
  const allJobs = [...jobs, ...extraJobs].filter((job, index, arr) => arr.findIndex((other) => Number(other.id) === Number(job.id)) === index);
  const allJobIds = uniqNumbers(allJobs.map((job) => job.id));
  const allDownloadIds = uniqNumbers(downloads.map((download) => download.id));

  const [logs, files, downloadFiles] = await Promise.all([
    allJobIds.length
      ? repo.pool.query(
        `SELECT * FROM ${logsTable}
          WHERE job_id = ANY($1::bigint[])
          ORDER BY ts DESC
          LIMIT $2`,
        [allJobIds, Math.min(200, safeLimit * 25)],
      ).then((result) => result.rows)
      : [],
    allJobIds.length
      ? repo.pool.query(
        `SELECT * FROM ${filesTable}
          WHERE job_id = ANY($1::bigint[])
          ORDER BY id DESC
          LIMIT $2`,
        [allJobIds, Math.min(200, safeLimit * 25)],
      ).then((result) => result.rows)
      : [],
    allDownloadIds.length
      ? repo.pool.query(
        `SELECT id, download_id, relpath, filesize, is_thumb_ready, created_at, updated_at, mtime_ms
           FROM public.download_files
          WHERE download_id = ANY($1::bigint[])
          ORDER BY id DESC
          LIMIT $2`,
        [allDownloadIds, Math.min(300, safeLimit * 50)],
      ).then((result) => result.rows)
      : [],
  ]);

  const sanitizedJobs = allJobs.map(sanitizeJob);
  const sanitizedDownloads = downloads.map(sanitizeDownload);
  const sanitizedLogs = logs.map((log) => ({ ...log, msg: redactSecretText(log.msg) }));
  const sanitizedFiles = files.map((file) => ({ ...file, path: redactSecretText(file.path) }));
  const sanitizedDownloadFiles = downloadFiles.map((file) => ({ ...file, relpath: redactSecretText(file.relpath) }));
  const visibility = downloads.map((download) => galleryVisibilityForDownload(download, downloadFiles));
  const mismatches = [];

  for (const job of allJobs) {
    const opts = parseJsonField(job.options) || job.options || {};
    const linkedDownloadId = parsePositiveInt(opts.simple_server_download_id);
    const linkedDownload = linkedDownloadId ? downloads.find((download) => Number(download.id) === linkedDownloadId) : null;
    if (job.adapter === 'slave-delegate' && job.status === 'running' && !linkedDownloadId) {
      mismatches.push({ code: 'slave_delegate_running_without_simple_server_download_id', jobId: job.id, message: `Hub-job ${job.id} draait zonder simple_server_download_id.` });
    }
    if (job.status === 'failed' && linkedDownload && linkedDownload.status === 'completed') {
      mismatches.push({ code: 'hub_failed_download_completed', jobId: job.id, downloadId: linkedDownload.id, message: `Hub-job ${job.id} is failed terwijl download ${linkedDownload.id} completed is.` });
    }
    if (job.status === 'done' && job.adapter === 'slave-delegate' && !linkedDownload) {
      mismatches.push({ code: 'hub_done_without_download_row', jobId: job.id, message: `Hub-job ${job.id} is done maar er is geen gekoppelde downloadrij gevonden.` });
    }
  }
  for (const item of visibility) {
    if (!item.defaultGalleryVisible && downloads.find((download) => Number(download.id) === Number(item.downloadId))?.status === 'completed') {
      mismatches.push({ code: 'completed_download_not_visible_in_default_gallery', downloadId: item.downloadId, message: `Download ${item.downloadId} is completed maar niet zichtbaar onder de standaard galleryfilters.`, reasons: item.reasons });
    }
  }

  return {
    service: 'job-lifecycle',
    readOnly: true,
    input: { jobId, downloadId, url: url || null },
    summary: lifecycleSummary({ jobs: allJobs, downloads, visibility, mismatches }),
    hub: {
      jobs: sanitizedJobs,
      logs: sanitizedLogs,
      files: sanitizedFiles,
    },
    simpleServer: {
      downloads: sanitizedDownloads,
      downloadFiles: sanitizedDownloadFiles,
    },
    gallery: {
      visibility,
    },
    mismatches,
  };
}

async function mapWithConcurrency(values, limit, fn) {
  const out = new Array(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(values.length || 1, limit || 1)) }, async () => {
    while (next < values.length) {
      const index = next++;
      out[index] = await fn(values[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function createJobsRouter({ repo, queue, adapters, detect, k2sAuthRoot, k2sAuthEnv }) {
  const r = express.Router();

  async function enqueueOneUrl({ url, hint = null, options = {}, maxAttempts = 3, force = false, requestedPriority = null, lockHeld = false }) {
    const sourceContext = pickSourceContextForUrl(options, url);
    const contextUrl = sourceContext?.url || options.contextUrl || options.pageUrl || '';
    const sourcePlatform = String(sourceContext?.platform || options.platform || '').toLowerCase();
    const vipergirlsWholeThread = options.vipergirlsWholeThread !== false;
    const isVipergirlsContext = sourcePlatform === 'vipergirls'
      || /(?:vipergirls\.to|viper\.to)\/threads\//i.test(String(contextUrl || ''));
    const inputUrl = normalizeTranslatedProxyUrl(url);
    const isThreadUrl = /(?:vipergirls\.to|viper\.to)\/threads\//i.test(String(inputUrl || ''));
    const jobUrl = isThreadUrl ? normalizeVipergirlsThreadUrl(inputUrl, { wholeThread: vipergirlsWholeThread }) : inputUrl;
    if (isFootFetishClubBrowserOnlyUrl(jobUrl)) {
      throw Object.assign(
        new Error('Foot-Fetish.Club vereist browser-cookies. Gebruik de toolbar browser-upload/fullscale route; server-jobs worden geblokkeerd om 403/done-met-0-bestanden te voorkomen.'),
        { httpStatus: 409 },
      );
    }
    if (!lockHeld) {
      return withUrlDedupeLock(repo, jobUrl, () => enqueueOneUrl({
        url,
        hint,
        options,
        maxAttempts,
        force,
        requestedPriority,
        lockHeld: true,
      }));
    }
    if (!hint && isVipergirlsContext && contextUrl && !isThreadUrl && !isArchiveDownloadUrl(jobUrl) && !isFileLockerUrl(jobUrl)) {
      const threadUrl = normalizeVipergirlsThreadUrl(contextUrl, { wholeThread: vipergirlsWholeThread });
      return withUrlDedupeLock(repo, threadUrl, async () => {
        if (!force) {
          const existing = await repo.findRecentJobByUrl(threadUrl, { statuses: ['queued', 'running'] });
          if (existing) return { ...existing, duplicate: true, redirected_from: url };
        }
        const priority = requestedPriority ?? defaultJobPriority(threadUrl, 'gallerydl');
        return queue.enqueue({
          url: threadUrl,
          adapter: 'gallerydl',
          priority,
          options: {
            ...options,
            platform: 'vipergirls',
            channel: sourceContext?.channel || options.channel || '',
            title: sourceContext?.title || options.title || '',
            contextUrl: threadUrl,
            redirected_from_host_url: url,
          },
          maxAttempts,
        });
      });
    }

    const slave = isSlaveUrl(jobUrl);
    if (slave && !hint) {
      if (slave.platform === 'keep2share' && !hasKeep2ShareApiAuthConfigured()) {
        throw Object.assign(
          new Error('Keep2Share auth ontbreekt. Zet K2S_COOKIE/K2S_X_BC, K2S_ACCESS_TOKEN/WEBDL_KEEP2SHARE_AUTH_TOKEN of K2S_USERNAME/K2S_PASSWORD in screen-recorder-native/.env of webdl-hub/.env voordat K2S wordt gequeued.'),
          { httpStatus: 409 },
        );
      }
      const slavePriority = requestedPriority ?? defaultJobPriority(url, 'slave-delegate');
      if (!force) {
        const existingDownload = await repo.findGalleryDownloadByUrl(jobUrl);
        if (existingDownload) {
          return {
            id: existingDownload.id,
            status: existingDownload.status,
            platform: existingDownload.platform,
            title: existingDownload.title || existingDownload.filename || existingDownload.filepath,
            duplicate: true,
            delegated: true,
            slave_platform: slave.platform,
            simple_server_download_id: existingDownload.id,
            existing_source: 'gallery',
          };
        }
      }
      if (slave.platform === 'keep2share') {
        await assertKeep2ShareRemotePreflight(jobUrl);
      }
      const bookJob = await queue.enqueue({
        url: jobUrl,
        adapter: 'slave-delegate',
        priority: slavePriority,
        options: {
          ...options,
          delegated_to: 'simple-server',
          slave_platform: slave.platform,
        },
        maxAttempts: 1,
      });
      const originalUrl = sourceContext?.url || options.contextUrl || options.pageUrl || '';
      const originalSite = hostnameFromUrl(originalUrl) || sourceContext?.platform || options.platform || '';
      const result = await delegateToSlave(repo.pool, {
        url: jobUrl,
        platform: slave.platform,
        metadata: {
          delegated_from_hub: true,
          hub_job_id: bookJob.id,
          source_context: sourceContext,
          source_site: originalSite || null,
          original_site: originalSite || null,
          original_platform: sourceContext?.platform || options.platform || null,
          original_channel: sourceContext?.channel || options.channel || null,
          original_title: sourceContext?.title || options.title || null,
          original_url: originalUrl || null,
        },
        priority: slavePriority,
      });
      await repo.pool.query(
        `UPDATE ${repo.schema}.jobs
            SET status = 'running',
                started_at = now(),
                locked_by = 'slave-' || $1::text,
                locked_at = now(),
                options = options || jsonb_build_object(
                  'simple_server_download_id', $1::text,
                  'was_duplicate', $2::boolean
                )
          WHERE id = $3`,
        [result.downloadId, !!result.duplicate, bookJob.id],
      );
      await repo.appendLog(
        bookJob.id,
        'info',
        `↪️  Gedelegeerd naar simple-server (${slave.platform}, download #${result.downloadId}${result.duplicate ? `, dupe van status=${result.existingStatus}` : ''}); wacht op voltooiing...`,
      );
      const freshJob = await repo.getJob(bookJob.id);
      return {
        ...freshJob,
        delegated: true,
        slave_platform: slave.platform,
        simple_server_download_id: result.downloadId,
        duplicate: !!result.duplicate,
      };
    }

    const adapter = detect(jobUrl, adapters, { hint });
    if (!adapter) {
      throw Object.assign(new Error('geen passende adapter voor deze URL'), { httpStatus: 400 });
    }
    const priority = requestedPriority ?? defaultJobPriority(jobUrl, adapter.name);
    if (!force) {
      const refreshable = isRefreshableCollectionUrl(jobUrl, adapter.name);
      const activeStatuses = ['queued', 'running'];
      const existing = await repo.findRecentJobByUrl(jobUrl, refreshable ? { statuses: activeStatuses } : {});
      if (existing) return { ...existing, duplicate: true };
      const existingDownload = await repo.findGalleryDownloadByUrl(jobUrl, refreshable ? { statuses: activeStatuses } : {});
      if (existingDownload) {
        return {
          id: existingDownload.id,
          status: existingDownload.status,
          platform: existingDownload.platform,
          title: existingDownload.title || existingDownload.filename || existingDownload.filepath,
          duplicate: true,
          existing_source: 'gallery',
        };
      }
    }
    const jobOptions = sourceContext
      ? {
          ...options,
          sourceContext,
          contextUrl: options.contextUrl || sourceContext.url || '',
          platform: options.platform || sourceContext.platform || '',
          channel: options.channel || sourceContext.channel || '',
          title: options.title || sourceContext.title || '',
        }
      : options;
    return queue.enqueue({ url: jobUrl, adapter: adapter.name, priority, options: jobOptions, maxAttempts });
  }

  // ─── Enqueue single URL ─────────────────────────────────────────────────────
  r.post('/', async (req, res, next) => {
    try {
      const { url, adapter: hint, options = {}, maxAttempts = 3, force = false } = req.body || {};
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url ontbreekt' });
      }
      const requestedPriority = requestedPriorityFromBody(req.body);
      const isExpandedRequest = !hint && isMultiItemUrl(url);

      // Auto-expand: als URL een playlist/kanaal/shorts-tab is, expanden
      // we 'm automatisch naar losse jobs ipv één enkele queue-entry.
      if (isExpandedRequest) {
        try {
          const result = await expandAndEnqueue({
            repo, queue, adapters, url, priority: requestedPriority, options, maxAttempts, force,
          });
          return res.status(201).json({ expanded: true, ...result });
        } catch (e) {
          if (e && e.httpStatus === 400) return res.status(400).json({ error: e.message });
          // Bij expand-fout: fallthrough naar single-job behandeling hieronder
          // als fallback, zodat minstens de hoofd-video in de queue komt.
        }
      }

      const job = await enqueueOneUrl({
        url, hint, options, maxAttempts, force, requestedPriority,
      });
      res.status(job.duplicate ? 200 : 201).json(job);
    } catch (e) {
      if (e && e.httpStatus) return res.status(e.httpStatus).json({ error: e.message });
      next(e);
    }
  });

  // ─── Batch enqueue ──────────────────────────────────────────────────────────
  async function enqueueBatchRows({ urls, hint, batchOptions, maxAttempts, force, requestedPriority }) {
    const results = await mapWithConcurrency(urls, 8, async (url) => {
      try {
        const job = await enqueueOneUrl({
          url,
          hint,
          options: batchOptions,
          maxAttempts,
          force,
          requestedPriority,
        });
        return { success: true, url, job, duplicate: !!job.duplicate };
      } catch (e) {
        return { success: false, url, error: String(e.message || e) };
      }
    });
    return {
      success: true,
      total: urls.length,
      queued: results.filter((row) => row.success && !row.duplicate).length,
      duplicates: results.filter((row) => row.success && row.duplicate).length,
      errors: results.filter((row) => !row.success).length,
      jobs: results.filter((row) => row.success).map((row) => row.job),
      failed: results.filter((row) => !row.success).slice(0, 50),
    };
  }

  r.post('/batch-file', async (req, res, next) => {
    try {
      const { adapter: hint, options = {}, metadata = {}, maxAttempts = 3, force = false } = req.body || {};
      const urls = uniqueUrls(req.body && req.body.urls);
      if (!urls.length) return res.status(400).json({ error: 'urls ontbreekt' });
      const requestedPriority = requestedPriorityFromBody(req.body);
      const batchOptions = {
        ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
        ...(options && typeof options === 'object' && !Array.isArray(options) ? options : {}),
      };
      const batchId = crypto.randomBytes(8).toString('hex');
      await ensureBatchManifestDir();
      const manifestFile = path.join(BATCH_MANIFEST_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${batchId}.json`);
      await fs.promises.writeFile(
        manifestFile,
        JSON.stringify({
          batchId,
          createdAt: new Date().toISOString(),
          total: urls.length,
          hint: hint || null,
          maxAttempts,
          force: force === true,
          requestedPriority,
          options: batchOptions,
          urls,
        }, null, 2),
      );

      setImmediate(async () => {
        try {
          const chunkSize = Math.max(1, intEnv('WEBDL_BATCH_FILE_CHUNK_SIZE', 100));
          const totals = { queued: 0, duplicates: 0, errors: 0 };
          console.log(JSON.stringify({ t: new Date().toISOString(), lvl: 'info', msg: 'batch_file.start', batchId, total: urls.length, manifestFile }));
          for (let offset = 0; offset < urls.length; offset += chunkSize) {
            const chunk = urls.slice(offset, offset + chunkSize);
            const result = await enqueueBatchRows({
              urls: chunk,
              hint,
              batchOptions,
              maxAttempts,
              force,
              requestedPriority,
            });
            totals.queued += result.queued;
            totals.duplicates += result.duplicates;
            totals.errors += result.errors;
            console.log(JSON.stringify({
              t: new Date().toISOString(),
              lvl: 'info',
              msg: 'batch_file.chunk',
              batchId,
              offset,
              size: chunk.length,
              queued: result.queued,
              duplicates: result.duplicates,
              errors: result.errors,
            }));
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          console.log(JSON.stringify({ t: new Date().toISOString(), lvl: 'info', msg: 'batch_file.done', batchId, total: urls.length, ...totals }));
        } catch (e) {
          console.log(JSON.stringify({ t: new Date().toISOString(), lvl: 'error', msg: 'batch_file.error', batchId, err: String(e.message || e) }));
        }
      });

      res.status(202).json({
        success: true,
        accepted: true,
        batchId,
        total: urls.length,
        manifestFile,
      });
    } catch (e) { next(e); }
  });

  r.post('/batch', async (req, res, next) => {
    try {
      const { adapter: hint, options = {}, metadata = {}, maxAttempts = 3, force = false } = req.body || {};
      const urls = uniqueUrls(req.body && req.body.urls);
      if (!urls.length) return res.status(400).json({ error: 'urls ontbreekt' });
      const requestedPriority = requestedPriorityFromBody(req.body);
      const batchOptions = {
        ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
        ...(options && typeof options === 'object' && !Array.isArray(options) ? options : {}),
      };
      const result = await enqueueBatchRows({ urls, hint, batchOptions, maxAttempts, force, requestedPriority });
      res.status(201).json(result);
    } catch (e) { next(e); }
  });

  // ─── Expand playlist/channel → enqueue individual videos ────────────────────
  r.post('/expand', async (req, res, next) => {
    try {
      const { url, options = {}, maxAttempts = 3, force = false } = req.body || {};
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url ontbreekt' });
      }
      const priority = requestedPriorityFromBody(req.body);
      const result = await expandAndEnqueue({
        repo, queue, adapters, url, priority, options, maxAttempts, force,
      });
      res.status(201).json(result);
    } catch (e) {
      if (e && e.httpStatus === 400) return res.status(400).json({ error: e.message });
      if (e.message && e.message.includes('not a playlist')) {
        return res.status(400).json({ error: 'Dit is geen playlist of kanaal. Gebruik de gewone download.', detail: e.message });
      }
      next(e);
    }
  });

  // ─── List jobs ──────────────────────────────────────────────────────────────
  r.get('/', async (req, res, next) => {
    try {
      const { status, limit, offset } = req.query;
      const jobs = await repo.listJobs({
        status,
        limit: limit ? Math.min(500, parseInt(limit, 10)) : 200,
        offset: offset ? parseInt(offset, 10) : 0,
      });
      res.json({ jobs });
    } catch (e) { next(e); }
  });

  r.get('/meta/stats', async (_req, res, next) => {
    try {
      const [stats, lanes, groups, diagnostics] = await Promise.all([
        repo.getJobStats(),
        repo.getLaneStats(),
        repo.listGroups({ limit: 80 }),
        repo.getQueueDiagnostics(),
      ]);
      res.json({ stats, lanes, groups, diagnostics });
    } catch (e) { next(e); }
  });

  r.get('/meta/k2s-preflight', (_req, res, next) => {
    try {
      res.json(getKeep2ShareAuthPreflight({ root: k2sAuthRoot, env: k2sAuthEnv }));
    } catch (e) { next(e); }
  });

  r.get('/meta/lifecycle', async (req, res, next) => {
    try {
      const jobId = parsePositiveInt(req.query.job_id || req.query.jobId);
      const downloadId = parsePositiveInt(req.query.download_id || req.query.downloadId);
      const url = String(req.query.url || '').trim();
      const limit = parsePositiveInt(req.query.limit, 8);
      if (!jobId && !downloadId && !url) {
        return res.status(400).json({ error: 'Geef job_id, download_id of url mee.' });
      }
      res.json(await diagnoseLifecycle(repo, { jobId, downloadId, url, limit }));
    } catch (e) { next(e); }
  });

  r.get('/group/:groupId', async (req, res, next) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 1500;
      const jobs = await repo.listJobsByGroup(req.params.groupId, { limit });
      res.json({ jobs });
    } catch (e) { next(e); }
  });

  // ─── Job detail ─────────────────────────────────────────────────────────────
  r.get('/:id', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ongeldig ID' });
      const job = await repo.getJob(id);
      if (!job) return res.status(404).json({ error: 'niet gevonden' });
      const [files, logs] = await Promise.all([repo.listFiles(id), repo.listLogs(id, { limit: 100 })]);
      res.json({ job, files, logs });
    } catch (e) { next(e); }
  });

  r.post('/:id/retry', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ongeldig ID' });
      const j = await repo.retryJob(id);
      if (!j) return res.status(404).json({ error: 'niet gevonden' });
      res.json(j);
    } catch (e) { next(e); }
  });

  r.post('/:id/cancel', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const j = await queue.cancel(id);
      if (!j) return res.status(404).json({ error: 'niet gevonden of niet cancelbaar' });
      res.json(j);
    } catch (e) { next(e); }
  });

  r.post('/:id/pause', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ongeldig ID' });
      const j = await queue.pause(id);
      if (!j) return res.status(404).json({ error: 'niet gevonden of niet pauzeerbaar' });
      await repo.appendLog(id, 'info', '⏸️ gepauzeerd');
      res.json(j);
    } catch (e) { next(e); }
  });

  r.post('/:id/resume', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ongeldig ID' });
      const j = await queue.resume(id);
      if (!j) return res.status(404).json({ error: 'niet gevonden of niet hervatbaar' });
      await repo.appendLog(id, 'info', '▶ hervat');
      res.json(j);
    } catch (e) { next(e); }
  });

  r.post('/:id/priority', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const priority = Number(req.body && req.body.priority);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ongeldig ID' });
      if (!Number.isFinite(priority)) return res.status(400).json({ error: 'priority ontbreekt' });
      const j = await queue.setPriority(id, Math.round(priority));
      if (!j) return res.status(404).json({ error: 'niet gevonden' });
      await repo.appendLog(id, 'info', `prioriteit gezet op ${Math.round(priority)}`);
      res.json(j);
    } catch (e) { next(e); }
  });

  // ─── Bulk actions ──────────────────────────────────────────────────────────
  r.post('/bulk', async (req, res, next) => {
    try {
      const { action, groupId } = req.body || {};
      const schema = repo.schema;
      const groupFilter = groupId
        ? `AND options->>'expandGroup' = '${groupId.replace(/'/g, "''")}'`
        : '';

      let result;
      switch (action) {
        case 'cancel-queued':
          result = await repo.pool.query(
            `UPDATE "${schema}".jobs SET status='cancelled', finished_at=now(), locked_by=NULL, locked_at=NULL
              WHERE status='queued' ${groupFilter} RETURNING id`);
          res.json({ action, affected: result.rows.length, ids: result.rows.map(r => r.id) });
          break;

        case 'pause-queued':
          result = await repo.pool.query(
            `UPDATE "${schema}".jobs
                SET lane='paused',
                    options = options || jsonb_build_object('pauseLane', lane, 'paused_at', now()),
                    locked_by=NULL,
                    locked_at=NULL
              WHERE status='queued' AND lane <> 'paused' ${groupFilter}
              RETURNING id`);
          res.json({ action, affected: result.rows.length, ids: result.rows.map(r => r.id) });
          break;

        case 'resume-paused':
          result = await repo.pool.query(
            `UPDATE "${schema}".jobs
                SET lane = COALESCE(NULLIF(options->>'pauseLane', ''), lane),
                    options = options - 'paused_at' - 'pauseLane',
                    attempts = CASE WHEN attempts >= max_attempts THEN 0 ELSE attempts END,
                    error = NULL
              WHERE status='queued' AND lane='paused' ${groupFilter}
              RETURNING id`);
          res.json({ action, affected: result.rows.length, ids: result.rows.map(r => r.id) });
          break;

        case 'retry-failed':
          result = await repo.pool.query(
            `UPDATE "${schema}".jobs SET status='queued', error=NULL, locked_by=NULL, locked_at=NULL, finished_at=NULL,
                    attempts = GREATEST(0, attempts - 1)
              WHERE status='failed' ${groupFilter} RETURNING id`);
          res.json({ action, affected: result.rows.length, ids: result.rows.map(r => r.id) });
          break;

        case 'clear-done':
          result = await repo.pool.query(
            `DELETE FROM "${schema}".jobs WHERE status='done' ${groupFilter} RETURNING id`);
          // Also clean up related files and logs
          if (result.rows.length > 0) {
            const ids = result.rows.map(r => r.id);
            await repo.pool.query(`DELETE FROM "${schema}".files WHERE job_id = ANY($1::int[])`, [ids]);
            await repo.pool.query(`DELETE FROM "${schema}".logs WHERE job_id = ANY($1::int[])`, [ids]);
          }
          res.json({ action, affected: result.rows.length });
          break;

        default:
          return res.status(400).json({ error: `Onbekende actie: ${action}` });
      }
    } catch (e) { next(e); }
  });

  return r;
}

module.exports = {
  createJobsRouter,
  _test: {
    getKeep2ShareAuthPreflight,
    keep2ShareAuthType,
    parseEnvAssignment,
    scanK2sEnvFile,
    scanK2sProcessEnv,
    diagnoseLifecycle,
    redactSecrets,
    galleryVisibilityForDownload,
    keep2ShareFileIdFromUrl,
    assertKeep2ShareRemotePreflight,
    keep2ShareRemotePreflightFailure,
  },
};
