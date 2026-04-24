// src/api/routes-files.js — dient bestanden van disk via /api/files/:id/serve.
'use strict';

const express = require('express');
const path = require('node:path');
const fs = require('node:fs');

const MIME_MAP = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv', '.ts': 'video/mp2t',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.json': 'application/json', '.txt': 'text/plain',
};

function createFilesRouter({ repo }) {
  const r = express.Router();

  // Serve file content by file DB id
  r.get('/:id/serve', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const files = await repo.pool.query(
        `SELECT * FROM "${repo.schema}".files WHERE id = $1`, [id],
      );
      const file = files.rows[0];
      if (!file) return res.status(404).json({ error: 'bestand niet gevonden' });

      const filePath = file.path;
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'bestand niet op schijf gevonden' });
      }

      const ext = path.extname(filePath).toLowerCase();
      const mime = file.mime || MIME_MAP[ext] || 'application/octet-stream';

      // Range-request support voor video streaming
      const stat = fs.statSync(filePath);
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

  // Serve thumbnail for a job — finds _thumb.jpg in the job's files
  r.get('/job/:jobId/thumb', async (req, res, next) => {
    try {
      const jobId = parseInt(req.params.jobId, 10);
      const files = await repo.pool.query(
        `SELECT * FROM "${repo.schema}".files WHERE job_id = $1 ORDER BY id`, [jobId],
      );

      // Zoek eerst een gegenereerde thumbnail
      let thumbFile = files.rows.find((f) =>
        /_thumb(_v\d+)?\.jpe?g$/i.test(path.basename(f.path)));

      // Fallback: eerste afbeelding
      if (!thumbFile) {
        thumbFile = files.rows.find((f) => {
          const ext = path.extname(f.path).toLowerCase();
          return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) &&
            !/_thumb/.test(path.basename(f.path));
        });
      }

      if (!thumbFile || !fs.existsSync(thumbFile.path)) {
        // Transparante 1px placeholder
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'no-cache');
        return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect fill="#1c212c" width="320" height="180"/><text x="160" y="95" text-anchor="middle" fill="#555" font-family="sans-serif" font-size="14">geen preview</text></svg>`);
      }

      const ext = path.extname(thumbFile.path).toLowerCase();
      const mime = MIME_MAP[ext] || 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=600');
      fs.createReadStream(thumbFile.path).pipe(res);
    } catch (e) { next(e); }
  });

  return r;
}

module.exports = { createFilesRouter };
