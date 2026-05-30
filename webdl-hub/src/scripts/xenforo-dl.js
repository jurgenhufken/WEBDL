#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

let cheerio;
try {
  cheerio = require('cheerio');
} catch (_) {
  console.error('[xenforo] FOUT: cheerio niet gevonden. Draai npm install in webdl-hub.');
  process.exit(1);
}

const urlArg = process.argv[2];
const outDir = process.argv[3] || process.cwd();
const cookie = process.env.WEBDL_XENFORO_COOKIE
  || process.env.WEBDL_FOOT_FETISH_CLUB_COOKIE
  || process.env.FOOT_FETISH_CLUB_COOKIE
  || '';

if (!urlArg) {
  console.error('Gebruik: node xenforo-dl.js <thread-url> [outdir]');
  process.exit(1);
}

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

const pageOnly = urlArg.includes('#page-only') || urlArg.includes('&pageOnly=1');
const scrapeAll = !pageOnly && process.env.WEBDL_XENFORO_SCRAPE_ALL !== '0';
const maxPages = Number.parseInt(process.env.WEBDL_XENFORO_MAX_PAGES || '0', 10);
const delayMs = Number.parseInt(process.env.WEBDL_XENFORO_DELAY_MS || '500', 10);
const dryRun = process.env.WEBDL_XENFORO_DRY_RUN === '1';
const allowVisibleFallback = process.env.WEBDL_XENFORO_ALLOW_VISIBLE_FALLBACK === '1';
const baseUrlStr = normalizeTranslatedProxyUrl(urlArg).split('#')[0].replace('&pageOnly=1', '');

const MEDIA_EXT_RE = /\.(jpe?g|png|webp|gif|avif|bmp|tiff?|mp4|webm|mov|m4v)(?:[?#].*)?$/i;
const HEADER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
let stopping = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    console.error(`[xenforo] Stop gevraagd (${signal}); rond huidige stap af en stop.`);
  });
}

function throwIfStopping() {
  if (stopping) throw new Error('Gestopt op verzoek');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanFilename(name, fallback) {
  const raw = decodeHtml(name || fallback || 'xenforo_media')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (raw || fallback || 'xenforo_media').slice(0, 180);
}

function extensionFromContentType(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (type === 'image/jpeg') return '.jpg';
  if (type === 'image/png') return '.png';
  if (type === 'image/webp') return '.webp';
  if (type === 'image/gif') return '.gif';
  if (type === 'image/avif') return '.avif';
  if (type === 'video/mp4') return '.mp4';
  if (type === 'video/webm') return '.webm';
  if (type === 'video/quicktime') return '.mov';
  return '';
}

function filenameFromDisposition(value) {
  const header = String(value || '');
  const star = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) {
    try { return decodeURIComponent(star[1]); } catch (_) {}
  }
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : '';
}

function filenameFromUrl(url, fallback) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    const xenforoAttachment = last.match(/^(.+)-([a-z0-9]+)\.\d+$/i);
    if (xenforoAttachment) return cleanFilename(xenforoAttachment[1].replace(/-([a-z0-9]+)$/i, '.$1'), fallback);
    return cleanFilename(last, fallback);
  } catch (_) {
    return cleanFilename(fallback, 'xenforo_media');
  }
}

function ensureExtension(filename, url, contentType) {
  if (path.extname(filename)) return filename;
  let ext = '';
  try {
    const fromUrl = path.extname(new URL(url).pathname);
    if (fromUrl && fromUrl.length <= 6) ext = fromUrl;
  } catch (_) {}
  if (!ext) ext = extensionFromContentType(contentType);
  return ext ? `${filename}${ext}` : filename;
}

async function uniquePath(dir, filename) {
  const parsed = path.parse(filename);
  let candidate = path.join(dir, filename);
  let index = 2;
  while (fs.existsSync(candidate) || fs.existsSync(`${candidate}.part`)) {
    candidate = path.join(dir, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function requestHeaders(referer) {
  const headers = {
    'User-Agent': HEADER_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  };
  if (referer) headers.Referer = referer;
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function fetchHtml(url) {
  throwIfStopping();
  console.log(`[xenforo] Fetching page: ${url}`);
  const res = await fetch(url, { headers: requestHeaders(url), redirect: 'follow' });
  throwIfStopping();
  if (!res.ok) throw new Error(`HTTP ${res.status} op ${url}`);
  return res.text();
}

function shouldSkipMediaUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const p = u.pathname.toLowerCase();
    const leaf = decodeURIComponent(p.split('/').filter(Boolean).pop() || '');
    return h.includes('twemoji')
      || h.includes('emoji')
      || p.includes('/twemoji/')
      || p.includes('/emoji/')
      || p.includes('/emojis/')
      || p.includes('/data/assets/')
      || p.includes('/data/avatars/')
      || p.includes('/styles/')
      || p.includes('/js/')
      || p.includes('/css.php')
      || p.includes('/smilies/')
      || p.includes('/reactions/')
      || p.includes('/logo')
      || /^[\p{Extended_Pictographic}\uFE0F\u200D]+\.png$/u.test(leaf);
  } catch (_) {
    return true;
  }
}

function textHasLetterOrDigit(value) {
  return /[\p{L}\p{N}]/u.test(String(value || ''));
}

function isEmojiOnlyLabel(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 24) return false;
  return !textHasLetterOrDigit(text) && /[\p{Extended_Pictographic}]/u.test(text);
}

function shouldSkipElement($, el, url, name = '') {
  if (shouldSkipMediaUrl(url)) return true;
  if (isEmojiOnlyLabel(name)) return true;
  const node = $(el);
  const marker = [
    node.attr('class'),
    node.attr('alt'),
    node.attr('title'),
    node.attr('data-shortname'),
    node.attr('data-smilie'),
    node.closest('.reaction, .reactionsBar, .message-avatar, .avatar, .smilie, .emoji, .bbCodeBlock, nav, header, footer').attr('class'),
  ].filter(Boolean).join(' ').toLowerCase();
  return /\b(?:reaction|smilie|emoji|avatar|logo|icon|sprite)\b/.test(marker);
}

function isVisibleAttachmentImage(url) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    return p.includes('/data/attachments/') && MEDIA_EXT_RE.test(p);
  } catch (_) {
    return false;
  }
}

function isLikelyThumbnailMediaUrl(url) {
  try {
    const u = new URL(url);
    const host = String(u.hostname || '').toLowerCase();
    const p = String(u.pathname || '').toLowerCase();
    if (/^(?:thumbs?|thumbnails?)\d*\./i.test(host)) return true;
    if (/\/(?:thumb|thumbs|thumbnail|thumbnails|preview|previews|small|mini|square)\//i.test(p)) return true;
    if (/\.(?:th|thumb|thumbnail|preview|small|md)\.(?:jpe?g|png|gif|webp|bmp|avif)(?:$|[?#])/i.test(url)) return true;
    if (/(?:^|[-_.\/])(?:thumb|thumbnail|preview|small|mini)(?:[-_.\/]|$)/i.test(p)) return true;
    return false;
  } catch (_) {
    return false;
  }
}

function isDownloadableMediaUrl(url) {
  if (shouldSkipMediaUrl(url)) return false;
  if (isLikelyThumbnailMediaUrl(url)) return false;
  try {
    const p = new URL(url).pathname.toLowerCase();
    return p.includes('/attachments/') || MEDIA_EXT_RE.test(p);
  } catch (_) {
    return false;
  }
}

function addMedia(items, seen, item) {
  const urls = [item.url, item.fallbackUrl].filter(Boolean);
  const key = urls.join(' -> ');
  if (!item.url || seen.has(key)) return;
  seen.add(key);
  items.push(item);
}

function extractMediaFromPage(html, pageUrl, items, seen) {
  const $ = cheerio.load(html);
  const scopes = $('article.message-body, section.message-attachments, .bbWrapper');
  const roots = scopes.length ? scopes : $('body');

  roots.find('a[href*="/attachments/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const url = new URL(href, pageUrl).toString();
    const img = $(el).find('img').first();
    const fallbackRaw = img.attr('data-src') || img.attr('src') || '';
    const fallbackUrl = fallbackRaw ? new URL(fallbackRaw, pageUrl).toString() : '';
    const name = img.attr('alt') || img.attr('title') || $(el).find('.file-name').first().text() || filenameFromUrl(url);
    if (shouldSkipElement($, el, url, name)) return;
    addMedia(items, seen, {
      url,
      fallbackUrl: allowVisibleFallback && fallbackUrl && isVisibleAttachmentImage(fallbackUrl) && !isLikelyThumbnailMediaUrl(fallbackUrl) ? fallbackUrl : '',
      filename: cleanFilename(name, filenameFromUrl(url)),
      pageUrl,
    });
  });

  roots.find('a[href], img[src], img[data-src], video[src], source[src]').each((_, el) => {
    const attrib = $(el).attr('href') || $(el).attr('data-src') || $(el).attr('src');
    if (!attrib) return;
    const url = new URL(attrib, pageUrl).toString();
    const name = $(el).attr('alt') || $(el).attr('title') || filenameFromUrl(url);
    if (shouldSkipElement($, el, url, name)) return;
    if (!isDownloadableMediaUrl(url)) return;
    const parentAttachment = $(el).closest('a[href*="/attachments/"]');
    if (parentAttachment.length && isVisibleAttachmentImage(url)) return;
    addMedia(items, seen, {
      url,
      fallbackUrl: '',
      filename: cleanFilename(name, filenameFromUrl(url)),
      pageUrl,
    });
  });
}

function nextPageUrl(html, pageUrl) {
  const $ = cheerio.load(html);
  const href = $('link[rel="next"]').attr('href')
    || $('a.pageNav-jump--next, a.pageNavSimple-el--next, a[rel="next"]').first().attr('href');
  if (!href) return '';
  return new URL(href, pageUrl).toString();
}

async function downloadAttempt(mediaUrl, referer, filenameHint) {
  throwIfStopping();
  const res = await fetch(mediaUrl, {
    headers: requestHeaders(referer),
    redirect: 'follow',
  });
  throwIfStopping();
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (/text\/html/i.test(contentType)) throw new Error('HTML response in plaats van media');
  const dispositionName = filenameFromDisposition(res.headers.get('content-disposition'));
  const filename = ensureExtension(
    cleanFilename(dispositionName || filenameHint || filenameFromUrl(mediaUrl), 'xenforo_media'),
    mediaUrl,
    contentType,
  );
  return { res, filename };
}

async function downloadMedia(item, index, total) {
  throwIfStopping();
  console.log(`[xenforo-progress] ${index}/${total}`);

  let attempt;
  let usedUrl = item.url;
  try {
    attempt = await downloadAttempt(item.url, item.pageUrl, item.filename);
  } catch (primaryError) {
    if (!item.fallbackUrl) throw primaryError;
    console.log(`[xenforo] Full attachment niet beschikbaar (${primaryError.message}); gebruik zichtbare image fallback.`);
    usedUrl = item.fallbackUrl;
    attempt = await downloadAttempt(item.fallbackUrl, item.pageUrl, item.filename);
  }

  const dest = await uniquePath(outDir, attempt.filename);
  const part = `${dest}.part`;
  console.log(`[xenforo] Downloaden: ${path.basename(dest)} <- ${usedUrl}`);
  throwIfStopping();
  const stream = fs.createWriteStream(part);
  if (attempt.res.body && attempt.res.body.getReader) {
    await pipeline(Readable.fromWeb(attempt.res.body), stream);
  } else {
    await pipeline(attempt.res.body, stream);
  }
  throwIfStopping();
  await fsp.rename(part, dest);
  console.log(`[xenforo] Opgeslagen: ${path.basename(dest)}`);
}

async function main() {
  await fsp.mkdir(outDir, { recursive: true });

  const queue = [baseUrlStr];
  const scraped = new Set();
  const media = [];
  const seenMedia = new Set();

  while (queue.length) {
    throwIfStopping();
    const currentUrl = queue.shift();
    if (!currentUrl || scraped.has(currentUrl)) continue;
    if (maxPages > 0 && scraped.size >= maxPages) break;
    scraped.add(currentUrl);

    const html = await fetchHtml(currentUrl);
    throwIfStopping();
    extractMediaFromPage(html, currentUrl, media, seenMedia);

    if (scrapeAll) {
      const next = nextPageUrl(html, currentUrl);
      if (next && !scraped.has(next)) queue.push(next);
    }
  }

  console.log(`[xenforo] Pagina's gescand: ${scraped.size}`);
  console.log(`[xenforo] Gevonden media-items: ${media.length}`);
  if (media.length === 0) {
    console.log('[xenforo] Geen media gevonden. Mogelijk is een login-cookie nodig.');
    return;
  }
  if (dryRun) {
    for (const item of media.slice(0, 10)) {
      console.log(`[xenforo] dry-run media: ${item.filename} <- ${item.url}${item.fallbackUrl ? ` (fallback ${item.fallbackUrl})` : ''}`);
    }
    console.log('[xenforo] Dry-run actief; niets gedownload.');
    return;
  }

  for (let i = 0; i < media.length; i += 1) {
    throwIfStopping();
    try {
      await downloadMedia(media[i], i + 1, media.length);
      if (delayMs > 0) await sleep(delayMs);
    } catch (e) {
      console.error(`[xenforo] Mislukt: ${media[i].filename || media[i].url} - ${e.message}`);
    }
  }

  console.log('[xenforo] Klaar met alle downloads.');
}

main().catch((e) => {
  console.error('[xenforo] Fatale fout:', e);
  process.exit(1);
});
