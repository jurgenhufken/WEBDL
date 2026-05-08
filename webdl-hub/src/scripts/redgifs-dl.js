#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const API_ROOT = 'https://api.redgifs.com';
const WEB_ROOT = 'https://www.redgifs.com';
const USER_AGENT = process.env.WEBDL_REDGIFS_USER_AGENT
  || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function usage() {
  console.error('usage: redgifs-dl.js <url> <output-dir>');
}

function sanitizeFilePart(value, fallback = 'redgifs') {
  const cleaned = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w .()[\]-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  return cleaned || fallback;
}

function redgifsIdFromUrl(value) {
  const raw = String(value || '').trim();
  if (/^[A-Za-z0-9]+$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const pathParts = u.pathname.split('/').filter(Boolean);
    if (host === 'redgifs.com' || host.endsWith('.redgifs.com')) {
      if ((pathParts[0] === 'watch' || pathParts[0] === 'ifr') && pathParts[1]) return pathParts[1];
      if (pathParts.length === 1 && /^[A-Za-z0-9]+$/.test(pathParts[0])) return pathParts[0];
    }
    if (host === 'gfycat.com' || host.endsWith('.gfycat.com')) {
      return pathParts[pathParts.length - 1] || '';
    }
    if (host === 'gifdeliverynetwork.com' || host.endsWith('.gifdeliverynetwork.com')) {
      return (pathParts[pathParts.length - 1] || '').replace(/\.(mp4|webm|gif)$/i, '');
    }
    if (host === 'redgifs.com' || host.endsWith('.redgifs.com')) {
      return (pathParts[pathParts.length - 1] || '').replace(/\.(mp4|webm|gif)$/i, '');
    }
  } catch {}
  return '';
}

function isDirectMediaUrl(value) {
  try {
    const u = new URL(String(value || ''));
    return /^https?:$/.test(u.protocol) && /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(u.pathname);
  } catch {
    return false;
  }
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

async function gifInfo(id) {
  const token = await temporaryToken();
  const data = await requestJson(`${API_ROOT}/v2/gifs/${encodeURIComponent(String(id).toLowerCase())}`, { token });
  if (!data.gif || typeof data.gif !== 'object') throw new Error(`Redgifs gaf geen gif-metadata terug voor ${id}`);
  return data.gif;
}

function bestVideoUrl(gif, fallbackUrl = '') {
  const urls = gif && gif.urls && typeof gif.urls === 'object' ? gif.urls : {};
  return String(urls.hd || urls.sd || urls.webm || urls.gif || fallbackUrl || '').trim();
}

function titleForGif(gif, id) {
  return sanitizeFilePart(gif.title || gif.tags?.join(' ') || gif.userName || id || 'redgifs', 'redgifs');
}

async function downloadFile(url, targetPath) {
  const res = await fetch(url, {
    headers: {
      accept: 'video/mp4,video/webm,video/*,*/*',
      referer: WEB_ROOT + '/',
      'user-agent': USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);

  const total = Number(res.headers.get('content-length')) || 0;
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const out = fs.createWriteStream(targetPath);
  let done = 0;
  let lastPct = -1;

  for await (const chunk of res.body) {
    done += chunk.length;
    if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
    if (total > 0) {
      const pct = Math.max(0, Math.min(99, (done / total) * 100));
      if (pct - lastPct >= 1) {
        lastPct = pct;
        console.log(`PROG pct=${pct.toFixed(1)}% speed=? eta=?`);
      }
    }
  }
  await new Promise((resolve, reject) => out.end((err) => err ? reject(err) : resolve()));
  console.log('PROG pct=100.0% speed=? eta=0');
}

async function main() {
  const url = process.argv[2];
  const outDir = process.argv[3] || process.cwd();
  if (!url) {
    usage();
    process.exit(2);
  }

  const id = redgifsIdFromUrl(url);
  if (!id && !isDirectMediaUrl(url)) throw new Error('Geen Redgifs ID in URL gevonden');

  let gif = null;
  let mediaUrl = '';
  if (id) {
    gif = await gifInfo(id);
    mediaUrl = bestVideoUrl(gif);
  }
  if (!mediaUrl && isDirectMediaUrl(url)) mediaUrl = url;
  if (!mediaUrl) throw new Error(`Geen downloadbare Redgifs media-URL gevonden voor ${id}`);

  const extFromUrl = path.extname(new URL(mediaUrl).pathname).toLowerCase();
  const ext = extFromUrl && /^\.(mp4|webm|mov|m4v|gif)$/.test(extFromUrl) ? extFromUrl : '.mp4';
  const finalId = gif?.id || id || path.basename(new URL(mediaUrl).pathname, ext);
  const title = titleForGif(gif || {}, finalId);
  const base = `${title} [${sanitizeFilePart(finalId, 'redgifs')}]`;
  const targetPath = path.join(outDir, `${base}${ext}`);
  const infoPath = path.join(outDir, `${base}.info.json`);

  await downloadFile(mediaUrl, targetPath);
  await fsp.writeFile(infoPath, JSON.stringify({
    id: finalId,
    title,
    fulltitle: gif?.title || title,
    webpage_url: `https://www.redgifs.com/watch/${finalId}`,
    original_url: url,
    url: mediaUrl,
    extractor_key: 'Redgifs',
    uploader: gif?.userName || '',
    uploader_id: gif?.userName || '',
    channel: gif?.userName || '',
    channel_id: gif?.userName || '',
    duration: gif?.duration || null,
    timestamp: gif?.createDate ? Math.floor(Date.parse(gif.createDate) / 1000) : null,
    thumbnail: gif?.urls?.poster || gif?.urls?.thumbnail || gif?.urls?.vthumbnail || '',
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}

module.exports = {
  redgifsIdFromUrl,
  isDirectMediaUrl,
  bestVideoUrl,
  sanitizeFilePart,
};
