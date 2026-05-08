'use strict';

const path = require('node:path');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.avif', '.heic', '.heif']);

function isImagePath(value) {
  const ext = path.extname(String(value || '').split(/[?#]/)[0]).toLowerCase();
  return IMAGE_EXTS.has(ext);
}

function parseUrlParts(value) {
  const s = String(value || '').trim();
  try {
    const u = new URL(s);
    return { url: u, host: String(u.hostname || '').toLowerCase(), pathname: String(u.pathname || '') };
  } catch (_) {
    return { url: null, host: '', pathname: s };
  }
}

function looksThumbnailish(value) {
  const s = String(value || '').trim();
  if (!s || !isImagePath(s)) return false;
  const { host, pathname } = parseUrlParts(s);
  const p = pathname.toLowerCase();
  if (/^(?:thumbs?|thumbnails?)\d*\./i.test(host)) return true;
  if ((host === 'vipr.im' || host.endsWith('.vipr.im')) && /^\/th\//i.test(p)) return true;
  if ((host === 'pixhost.to' || host.endsWith('.pixhost.to')) && /\/thumbs\//i.test(p)) return true;
  if (/\/(?:thumb|thumbs|thumbnail|thumbnails|preview|previews|small|mini|square)\//i.test(p)) return true;
  if (/\.(?:th|thumb|thumbnail|preview|small|md)\.(?:jpe?g|png|gif|webp|bmp|avif|heic|heif)(?:$|[?#])/i.test(s)) return true;
  if (/(?:^|[-_.\/])(?:thumb|thumbnail|preview|small|mini)(?:[-_.\/]|$)/i.test(p)) return true;
  return false;
}

function fullscaleCandidateUrl(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const { url: u, host, pathname: p } = parseUrlParts(s);
  if (!u) return '';
  if ((host === 'vipr.im' || host.endsWith('.vipr.im')) && /^\/th\//i.test(p)) {
    const m = p.match(/^\/th\/([^/]+)\/([^/?#]+\.jpe?g)$/i);
    if (m && m[1] && m[2]) {
      u.pathname = `/i/${m[1]}/${m[2]}/30.jpg`;
      return u.toString();
    }
  }
  if ((host === 'pixhost.to' || host.endsWith('.pixhost.to')) && /\/thumbs\//i.test(p)) {
    u.pathname = p.replace(/\/thumbs\//i, '/images/');
    return u.toString();
  }
  const upgradedPath = p
    .replace(/\.(?:md|th)\.(jpe?g|png|gif|webp|bmp|avif|heic|heif)$/i, '.$1')
    .replace(/(?:^|[-_.])(?:thumb|thumbnail|preview|small|mini)([-_.])([^/]+\.(?:jpe?g|png|gif|webp|bmp|avif|heic|heif))$/i, '$2');
  if (upgradedPath !== p) {
    u.pathname = upgradedPath;
    return u.toString();
  }
  return '';
}

function deriveFullscalePath(filePath, candidateUrl = '') {
  const current = String(filePath || '').trim();
  if (!current) return '';
  const dir = path.dirname(current);
  const base = path.basename(current);
  const direct = base
    .replace(/\.(?:md|th)\.(jpe?g|png|gif|webp|bmp|avif|heic|heif)$/i, '.$1')
    .replace(/(?:^|[-_.])(?:thumb|thumbnail|preview|small|mini)([-_.])([^/]+\.(?:jpe?g|png|gif|webp|bmp|avif|heic|heif))$/i, '$2');
  if (direct !== base) return path.join(dir, direct);
  try {
    const candidateBase = path.basename(new URL(candidateUrl).pathname);
    if (candidateBase && isImagePath(candidateBase)) return path.join(dir, candidateBase);
  } catch (_) {}
  return current;
}

module.exports = {
  IMAGE_EXTS,
  isImagePath,
  looksThumbnailish,
  fullscaleCandidateUrl,
  deriveFullscalePath,
};
