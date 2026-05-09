'use strict';

const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('../config');

const SAFE_EXT_BY_TYPE = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif'],
  ['image/bmp', '.bmp'],
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/quicktime', '.mov'],
]);

const IMAGE_VIDEO_TYPE_RE = /^(?:image|video)\//i;
const THUMBNAIL_BASENAME_RE = /\.(?:md|th|thumb|thumbnail|preview|small)\.(?:jpe?g|png|gif|webp|bmp|avif)$/i;
const PARTIAL_BASENAME_RE = /(?:^|[._-])(?:temp|partial|part|download)(?:[._-]|$)/i;

function sanitizeSegment(value, fallback = 'untitled') {
  const clean = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w .()[\]-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return clean || fallback;
}

function normalizeContentType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function extensionFor(contentType, filename) {
  const fromName = path.extname(String(filename || '')).toLowerCase();
  if (/^\.(?:jpe?g|png|gif|webp|avif|bmp|mp4|webm|mov)$/i.test(fromName)) return fromName;
  return SAFE_EXT_BY_TYPE.get(normalizeContentType(contentType)) || '';
}

function safeFilename(filename, contentType, fallbackSeed = 'media') {
  const ext = extensionFor(contentType, filename) || '.bin';
  const base = sanitizeSegment(path.basename(String(filename || ''), path.extname(String(filename || ''))), fallbackSeed);
  return `${base}${ext}`;
}

function isImportableBrowserMedia({ filename, contentType, size }) {
  const type = normalizeContentType(contentType);
  if (!IMAGE_VIDEO_TYPE_RE.test(type)) return false;
  if (!Number.isFinite(size) || size <= 0) return false;
  const base = path.basename(String(filename || ''));
  if (PARTIAL_BASENAME_RE.test(base)) return false;
  if (THUMBNAIL_BASENAME_RE.test(base)) return false;
  return true;
}

function mediaFormat(contentType, filename) {
  const ext = extensionFor(contentType, filename);
  if (ext) return ext.slice(1);
  const type = normalizeContentType(contentType);
  const subtype = type.split('/')[1] || '';
  return subtype || 'bin';
}

async function uniquePath(dir, filename) {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  for (let i = 1; i < 10_000; i += 1) {
    try {
      await fs.access(candidate);
      candidate = path.join(dir, `${stem}-${i}${ext}`);
    } catch (_) {
      return candidate;
    }
  }
  throw new Error('geen unieke bestandsnaam gevonden');
}

function createBrowserMediaRouter({ repo }) {
  const r = express.Router();
  const rawLimit = process.env.WEBDL_BROWSER_MEDIA_BODY_LIMIT || '250mb';

  r.post('/', express.raw({ type: '*/*', limit: rawLimit }), async (req, res, next) => {
    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const sourceUrl = String(req.query.sourceUrl || req.headers['x-webdl-source-url'] || '').trim();
      const pageUrl = String(req.query.pageUrl || req.headers['x-webdl-page-url'] || '').trim();
      const requestedContentType = normalizeContentType(req.query.contentType || req.headers['content-type']);
      const filename = safeFilename(req.query.filename || '', requestedContentType, 'browser-media');
      if (!sourceUrl) return res.status(400).json({ error: 'sourceUrl ontbreekt' });
      if (!isImportableBrowserMedia({ filename, contentType: requestedContentType, size: body.length })) {
        return res.status(415).json({ error: 'geen importeerbare fullscale image/video' });
      }

      const existing = await repo.pool.query(
        `SELECT id, filepath, status
           FROM public.downloads
          WHERE source_url = $1 OR url = $1
          ORDER BY id DESC
          LIMIT 1`,
        [sourceUrl],
      );
      if (existing.rows[0]) {
        return res.status(200).json({
          success: true,
          duplicate: true,
          download: existing.rows[0],
        });
      }

      const title = sanitizeSegment(req.query.title || filename, path.basename(filename, path.extname(filename)));
      const channel = sanitizeSegment(req.query.channel || 'Foot-Fetish.Club', 'Foot-Fetish.Club');
      const platform = sanitizeSegment(req.query.platform || 'foot-fetish.club', 'foot-fetish.club');
      const today = new Date().toISOString().slice(0, 10);
      const dir = path.join(config.downloadRoot, 'browser', platform, today);
      await fs.mkdir(dir, { recursive: true });
      const filePath = await uniquePath(dir, filename);
      await fs.writeFile(filePath, body, { flag: 'wx' });
      const stat = await fs.stat(filePath);
      const now = new Date();
      const metadata = {
        browser_uploaded: true,
        adapter: 'browser-media',
        source_site: platform,
        source_page_url: pageUrl || null,
        source_url: sourceUrl,
        webdl_image_quality: requestedContentType.startsWith('image/') ? 'browser_fullscale' : null,
        webdl_was_thumbnail_url: false,
      };

      const client = await repo.pool.connect();
      let inserted;
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `INSERT INTO public.downloads
            (url, platform, channel, title, filename, filepath, filesize, format,
             status, progress, metadata, source_url, created_at, updated_at, finished_at, is_thumb_ready)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                   'completed', 100, $9::jsonb, $10, $11, $11, $11, false)
           RETURNING id, url, platform, channel, title, filename, filepath, filesize, status`,
          [
            sourceUrl,
            platform,
            channel,
            title,
            path.basename(filePath),
            filePath,
            stat.size,
            mediaFormat(requestedContentType, filePath),
            JSON.stringify(metadata),
            sourceUrl,
            now,
          ],
        );
        inserted = result.rows[0];
        await client.query(
          `INSERT INTO public.download_files (download_id, relpath, filesize, mtime_ms, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (download_id, relpath) DO UPDATE
              SET filesize = EXCLUDED.filesize,
                  mtime_ms = EXCLUDED.mtime_ms,
                  updated_at = EXCLUDED.updated_at`,
          [inserted.id, filePath, stat.size, Math.round(stat.mtimeMs), now.toISOString(), now],
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        try { await fs.unlink(filePath); } catch (_) {}
        throw e;
      } finally {
        client.release();
      }

      res.status(201).json({ success: true, duplicate: false, download: inserted });
    } catch (e) {
      next(e);
    }
  });

  return r;
}

module.exports = {
  createBrowserMediaRouter,
  isImportableBrowserMedia,
  safeFilename,
};
