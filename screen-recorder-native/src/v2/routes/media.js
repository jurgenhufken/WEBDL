'use strict';
/**
 * Routes: Media — Pijler: Viewer + Bibliotheek
 * 
 * /api/media/recent-files  → Gallery data
 * /api/stats               → Statistieken
 * /media/thumb             → Thumbnail serving
 * /media/file              → Direct file serving
 * /media/stream            → MKV→MP4 remuxing
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

module.exports = function mountMediaRoutes(app, ctx) {
  const { queries, config } = ctx;
  const BASE_DIR = config.BASE_DIR;

  // --- API: Recent files (gallery data) ---
  app.get('/api/media/recent-files', async (req, res) => {
    try {
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '120', 10) || 120));
      const rows = await queries.getRecentFiles.all(limit);

      const items = rows.map(row => ({
        id: String(row.id),
        kind: 'd',
        type: inferMediaType(row.filepath),
        title: row.title || path.basename(row.filepath || ''),
        platform: row.platform || 'other',
        channel: row.channel || 'unknown',
        src: `/media/file?kind=d&id=${row.id}`,
        thumb: row.thumbnail || `/media/thumb?kind=d&id=${row.id}`,
        created_at: row.finished_at || row.created_at,
      }));

      res.json({ success: true, items, total: items.length });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // --- API: Stats ---
  app.get('/api/stats', async (req, res) => {
    try {
      const stats = await queries.getStats.get();
      res.json({
        success: true,
        stats: {
          downloads: parseInt(stats.downloads || 0),
          screenshots: parseInt(stats.screenshots || 0),
          download_files: parseInt(stats.download_files || 0),
        },
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // --- Thumb serving ---
  app.get('/media/thumb', async (req, res) => {
    try {
      const kind = String(req.query.kind || 'd');
      const id = parseInt(req.query.id, 10);
      if (!Number.isFinite(id)) return res.status(400).end();

      const row = kind === 'd'
        ? await queries.getDownload.get(id)
        : null;
      if (!row || !row.filepath) return res.status(404).end();

      // Check for .jpg thumbnail next to the file
      const fp = String(row.filepath);
      const thumbPath = fp.replace(/\.[^.]+$/, '.jpg');
      if (fs.existsSync(thumbPath)) {
        return res.sendFile(thumbPath);
      }

      // Fallback: remote thumbnail URL
      if (row.thumbnail && row.thumbnail.startsWith('http')) {
        return res.redirect(row.thumbnail);
      }

      res.status(404).end();
    } catch (e) {
      res.status(500).end();
    }
  });

  // --- Direct file serving ---
  app.get('/media/file', async (req, res) => {
    try {
      const kind = String(req.query.kind || 'd');
      const id = parseInt(req.query.id, 10);
      if (!Number.isFinite(id)) return res.status(400).end();

      const row = kind === 'd'
        ? await queries.getDownload.get(id)
        : null;
      if (!row || !row.filepath) return res.status(404).end();

      const fp = path.resolve(row.filepath);
      if (!fs.existsSync(fp)) return res.status(404).end();

      res.sendFile(fp);
    } catch (e) {
      res.status(500).end();
    }
  });

  // --- MKV→MP4 stream (remux) ---
  app.get('/media/stream', async (req, res) => {
    try {
      const id = parseInt(req.query.id, 10);
      if (!Number.isFinite(id)) return res.status(400).end();

      const row = await queries.getDownload.get(id);
      if (!row || !row.filepath) return res.status(404).end();

      const fp = path.resolve(row.filepath);
      const ext = path.extname(fp).toLowerCase();

      // MP4/WebM: serve directly
      if (ext === '.mp4' || ext === '.webm') {
        return res.sendFile(fp);
      }

      // MKV/AVI: check for cached .stream.mp4
      const cached = fp.replace(/\.[^.]+$/, '.stream.mp4');
      if (fs.existsSync(cached)) {
        return res.sendFile(cached);
      }

      // Remux on-the-fly
      const ffmpegPath = config.FFMPEG || 'ffmpeg';
      const tmpOut = cached + '.tmp';
      const args = [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', fp,
        '-c', 'copy',
        '-movflags', '+faststart',
        '-f', 'mp4', tmpOut,
      ];

      const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let aborted = false;

      res.on('close', () => {
        if (!aborted) { aborted = true; try { proc.kill('SIGKILL'); } catch (e) {} }
      });

      proc.on('close', (code) => {
        if (aborted) return;
        if (code === 0) {
          try { fs.renameSync(tmpOut, cached); } catch (e) {}
          res.sendFile(cached);
        } else {
          try { fs.unlinkSync(tmpOut); } catch (e) {}
          if (!res.headersSent) res.status(500).end();
        }
      });

      proc.on('error', () => {
        if (!res.headersSent) res.status(500).end();
      });
    } catch (e) {
      if (!res.headersSent) res.status(500).end();
    }
  });
};

// --- Helper ---
function inferMediaType(fp) {
  if (!fp) return 'file';
  const ext = path.extname(fp).toLowerCase();
  if (['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.ts'].includes(ext)) return 'video';
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) return 'image';
  return 'file';
}
