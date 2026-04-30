// src/api/routes-legacy.js — REST voor main server downloads (public.downloads tabel).
'use strict';

const express = require('express');
const path = require('node:path');
const fs = require('node:fs');

const MIME_MAP = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
};

function createLegacyRouter({ repo }) {
  const r = express.Router();

  // ─── List downloads ──────────────────────────────────────────────────────────
  r.get('/', async (req, res, next) => {
    try {
      const status = req.query.status || '';
      const platform = req.query.platform || '';
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '200', 10)));
      const offset = Math.max(0, parseInt(req.query.offset || '0', 10));

      const conditions = [];
      const params = [];
      let idx = 1;

      if (status) {
        conditions.push(`d.status = $${idx++}`);
        params.push(status);
      }
      if (platform) {
        conditions.push(`d.platform = $${idx++}`);
        params.push(platform);
      }

      const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      const { rows } = await repo.pool.query(`
        SELECT d.id, d.url, d.platform, d.channel, d.title, d.status, d.progress,
               d.filepath, d.thumbnail, d.filesize, d.format, d.source_url,
               d.created_at, d.updated_at, d.finished_at, d.rating
        FROM public.downloads d
        ${where}
        ORDER BY
          CASE d.status
            WHEN 'downloading' THEN 0
            WHEN 'postprocessing' THEN 1
            WHEN 'queued' THEN 2
            WHEN 'pending' THEN 3
            ELSE 4
          END,
          d.updated_at DESC NULLS LAST,
          d.id DESC
        LIMIT $${idx++} OFFSET $${idx++}
      `, [...params, limit, offset]);

      res.json({ downloads: rows, count: rows.length });
    } catch (e) { next(e); }
  });

  // Meta-routes moeten voor /:id staan, anders behandelt Express "meta" als id.
  r.get('/meta/platforms', async (_req, res, next) => {
    try {
      const { rows } = await repo.pool.query(`
        SELECT platform, status, COUNT(*)::int as count
        FROM public.downloads
        WHERE status IN ('pending', 'queued', 'downloading', 'postprocessing', 'completed', 'error')
        GROUP BY platform, status
        ORDER BY platform, status
      `);
      res.json({ platforms: rows });
    } catch (e) { next(e); }
  });

  r.get('/meta/stats', async (_req, res, next) => {
    try {
      const [hubResult, legacyResult] = await Promise.all([
        repo.pool.query(`SELECT status, COUNT(*)::int as count FROM "${repo.schema}".jobs GROUP BY status`),
        repo.pool.query(`SELECT status, COUNT(*)::int as count FROM public.downloads WHERE status IN ('pending','queued','downloading','postprocessing','completed','error','cancelled') GROUP BY status`),
      ]);

      const hub = {};
      for (const r of hubResult.rows) hub[r.status] = r.count;
      const legacy = {};
      for (const r of legacyResult.rows) legacy[r.status] = r.count;

      res.json({ hub, legacy });
    } catch (e) { next(e); }
  });

  // ─── Single download detail ──────────────────────────────────────────────────
  r.get('/:id', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ongeldig ID' });
      const { rows } = await repo.pool.query(
        'SELECT * FROM public.downloads WHERE id = $1', [id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'niet gevonden' });
      res.json({ download: rows[0] });
    } catch (e) { next(e); }
  });

  // ─── Serve media file ────────────────────────────────────────────────────────
  r.get('/:id/serve', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ongeldig ID' });
      const { rows } = await repo.pool.query(
        'SELECT filepath FROM public.downloads WHERE id = $1', [id]
      );
      if (!rows[0] || !rows[0].filepath) return res.status(404).json({ error: 'geen bestand' });

      const filePath = rows[0].filepath;
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'bestand niet op schijf' });

      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_MAP[ext] || 'application/octet-stream';
      const stat = fs.statSync(filePath);

      // Range-request support voor video streaming
      const range = req.headers.range;
      if (range && mime.startsWith('video/')) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunksize = (end - start) + 1;
        const stream = fs.createReadStream(filePath, { start, end });
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': mime,
        });
        stream.pipe(res);
      } else {
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        fs.createReadStream(filePath).pipe(res);
      }
    } catch (e) { next(e); }
  });

  // ─── Serve thumbnail ─────────────────────────────────────────────────────────
  r.get('/:id/thumb', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ongeldig ID' });
      const { rows } = await repo.pool.query(
        'SELECT filepath, thumbnail FROM public.downloads WHERE id = $1', [id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'niet gevonden' });

      const thumbPath = rows[0].thumbnail;
      if (thumbPath && fs.existsSync(thumbPath)) {
        const ext = path.extname(thumbPath).toLowerCase();
        res.setHeader('Content-Type', MIME_MAP[ext] || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=600');
        return fs.createReadStream(thumbPath).pipe(res);
      }

      // Placeholder SVG
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect fill="#1c212c" width="320" height="180"/><text x="160" y="95" text-anchor="middle" fill="#555" font-family="sans-serif" font-size="14">geen preview</text></svg>`);
    } catch (e) { next(e); }
  });

  // ─── Cancel download ─────────────────────────────────────────────────────────
  r.post('/:id/cancel', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ongeldig ID' });
      await repo.pool.query(
        "UPDATE public.downloads SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status IN ('pending', 'queued')",
        [id]
      );
      // Probeer ook via main server API te cancellen (voor actieve downloads)
      try {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 3000);
        await fetch(`http://localhost:35729/download/${id}/cancel`, {
          method: 'POST', signal: ctrl.signal
        });
      } catch (_) { /* main server misschien niet bereikbaar, DB update is genoeg */ }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ─── Retry download ──────────────────────────────────────────────────────────
  r.post('/:id/retry', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'ongeldig ID' });
      await repo.pool.query(
        "UPDATE public.downloads SET status = 'pending', progress = 0, updated_at = now() WHERE id = $1 AND status IN ('error', 'cancelled', 'failed')",
        [id]
      );
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ─── Bulk actions ────────────────────────────────────────────────────────────
  r.post('/bulk', async (req, res, next) => {
    try {
      const { action, platform } = req.body || {};
      let result;

      const params = [];
      const platformFilter = platform ? ' AND platform = $1' : '';
      if (platform) params.push(platform);

      switch (action) {
        case 'cancel-pending':
          result = await repo.pool.query(
            `UPDATE public.downloads SET status = 'cancelled', updated_at = now() WHERE status IN ('pending', 'queued')${platformFilter}`,
            params,
          );
          break;
        case 'retry-failed':
          result = await repo.pool.query(
            `UPDATE public.downloads SET status = 'pending', progress = 0, updated_at = now() WHERE status IN ('error', 'failed')${platformFilter}`,
            params,
          );
          break;
        default:
          return res.status(400).json({ error: 'Onbekende actie' });
      }
      res.json({ ok: true, affected: result.rowCount });
    } catch (e) { next(e); }
  });

  return r;
}

module.exports = { createLegacyRouter };
