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

  // --- API: Recent files (gallery data) with cursor pagination ---
  app.get('/api/media/recent-files', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '120', 10) || 120));
      const type = String(req.query.type || 'all').toLowerCase();
      const cursorRaw = String(req.query.cursor || '').trim();
      const sort = String(req.query.sort || 'recent').toLowerCase();
      const searchQuery = String(req.query.q || '').trim().toLowerCase();

      // Decode cursor (offset-based for simplicity)
      let offset = 0;
      if (cursorRaw) {
        try {
          const decoded = JSON.parse(Buffer.from(cursorRaw, 'base64').toString());
          offset = decoded.offset || 0;
        } catch (e) { offset = 0; }
      }

      // Build dynamic query
      const orderCol = sort === 'oldest'
        ? 'COALESCE(d.finished_at, d.created_at) ASC'
        : 'COALESCE(d.finished_at, d.created_at) DESC';

      let whereExtra = '';
      const params = [];
      let paramIdx = 0;

      if (searchQuery) {
        paramIdx++;
        whereExtra += ` AND (LOWER(d.title) LIKE $${paramIdx} OR LOWER(d.channel) LIKE $${paramIdx} OR LOWER(d.platform) LIKE $${paramIdx})`;
        params.push(`%${searchQuery}%`);
      }

      paramIdx++;
      const limitParam = paramIdx;
      params.push(limit + 1);
      paramIdx++;
      const offsetParam = paramIdx;
      params.push(offset);

      const sql = `SELECT d.id, 'd' AS kind, d.platform, d.channel, d.title, d.status,
              d.thumbnail, d.filepath, d.created_at, d.finished_at,
              d.source_url, d.url, d.description, d.duration, d.filesize, d.filename
       FROM downloads d
       WHERE d.status = 'completed' AND d.filepath IS NOT NULL AND d.filepath != ''
       ${whereExtra}
       ORDER BY COALESCE(d.finished_at, d.created_at) ${sort === 'oldest' ? 'ASC' : 'DESC'}
       LIMIT $${limitParam} OFFSET $${offsetParam}`;

      const { rows } = await ctx.db.query(sql, params);
      const hasMore = rows.length > limit;
      const resultRows = hasMore ? rows.slice(0, limit) : rows;

      const items = resultRows
        .filter(row => {
          if (type === 'all') return true;
          const mt = inferMediaType(row.filepath);
          if (type === 'video') return mt === 'video';
          if (type === 'image') return mt === 'image';
          return true;
        })
        .map(row => makeItem(row));

      const nextOffset = offset + resultRows.length;
      const nextCursor = hasMore
        ? Buffer.from(JSON.stringify({ offset: nextOffset })).toString('base64')
        : '';

      res.json({
        success: true,
        items,
        next_cursor: nextCursor,
        done: !hasMore,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // --- API: Channels list ---
  app.get('/api/media/channels', async (req, res) => {
    try {
      const limit = Math.min(800, parseInt(req.query.limit || '200', 10) || 200);
      const offset = parseInt(req.query.offset || '0', 10) || 0;
      const rows = await queries.getMediaChannels.all(limit, offset);
      res.json({ success: true, channels: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // --- API: Channel files ---
  app.get('/api/media/channel-files', async (req, res) => {
    try {
      const platform = String(req.query.platform || '').trim();
      const channel = String(req.query.channel || '').trim();
      if (!platform || !channel) return res.status(400).json({ success: false, error: 'platform en channel zijn vereist' });

      const limit = Math.min(500, parseInt(req.query.limit || '120', 10) || 120);
      const cursorRaw = String(req.query.cursor || '').trim();
      let offset = 0;
      if (cursorRaw) {
        try {
          const decoded = JSON.parse(Buffer.from(cursorRaw, 'base64').toString());
          offset = decoded.offset || 0;
        } catch (e) { offset = 0; }
      }

      const rows = await queries.getChannelFiles.all(platform, channel, limit + 1, offset);
      const hasMore = rows.length > limit;
      const resultRows = hasMore ? rows.slice(0, limit) : rows;
      const items = resultRows.map(row => makeItem(row));
      const nextOffset = offset + resultRows.length;
      const nextCursor = hasMore
        ? Buffer.from(JSON.stringify({ offset: nextOffset })).toString('base64')
        : '';

      res.json({ success: true, items, next_cursor: nextCursor, done: !hasMore });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // --- API: Directories (mappenlijst) ---
  app.get('/api/directories', async (req, res) => {
    try {
      const { rows } = await ctx.db.query(
        `SELECT DISTINCT platform FROM downloads WHERE status = 'completed' AND filepath IS NOT NULL ORDER BY platform`
      );
      const dirs = rows.map(r => r.platform);
      res.json({ success: true, directories: dirs });
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

      let fp = null;
      let thumbnail = null;

      if (kind === 'p') {
        const { rows } = await ctx.db.query('SELECT file_abs FROM download_files WHERE id = $1', [id]);
        if (rows[0]) fp = rows[0].file_abs;
      } else {
        const row = await queries.getDownload.get(id);
        if (row) { fp = row.filepath; thumbnail = row.thumbnail; }
      }

      if (!fp) return res.status(404).end();

      // Check for .jpg thumbnail next to the file
      const thumbPath = fp.replace(/\.[^.]+$/, '.jpg');
      if (fs.existsSync(thumbPath) && !fs.statSync(thumbPath).isDirectory()) {
        return res.sendFile(thumbPath);
      }

      // If filepath is a directory, look for thumbs inside
      try {
        if (fs.statSync(fp).isDirectory()) {
          const files = fs.readdirSync(fp).filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png'));
          if (files.length > 0) return res.sendFile(path.join(fp, files[0]));
        }
      } catch (e) {}

      // Fallback: remote thumbnail URL
      if (thumbnail && thumbnail.startsWith('http')) {
        return res.redirect(thumbnail);
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

      let fp = null;

      if (kind === 'p') {
        // download_files entry
        const { rows } = await ctx.db.query('SELECT file_abs FROM download_files WHERE id = $1', [id]);
        if (rows[0]) fp = rows[0].file_abs;
      } else {
        // downloads entry
        const row = await queries.getDownload.get(id);
        if (row && row.filepath) fp = row.filepath;
      }

      if (!fp) return res.status(404).end();
      fp = path.resolve(fp);

      // If filepath is a directory, find the primary media file
      try {
        const stat = fs.statSync(fp);
        if (stat.isDirectory()) {
          const { findPrimaryFile } = require('../utils/paths');
          const primary = findPrimaryFile(fp);
          if (primary) fp = primary;
          else return res.status(404).end();
        }
      } catch (e) {
        return res.status(404).end();
      }

      if (!fs.existsSync(fp)) return res.status(404).end();

      // Set correct MIME type
      const ext = path.extname(fp).toLowerCase();
      const mimeTypes = {
        '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
        '.m4v': 'video/mp4', '.avi': 'video/x-msvideo',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp',
      };
      if (mimeTypes[ext]) res.setHeader('Content-Type', mimeTypes[ext]);

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

// --- Helpers ---
function inferMediaType(fp) {
  if (!fp) return 'file';
  const ext = path.extname(fp).toLowerCase();
  if (['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.ts'].includes(ext)) return 'video';
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) return 'image';
  return 'file';
}

function makeItem(row) {
  const fp = row.filepath || '';
  const mt = inferMediaType(fp);
  const ext = path.extname(fp).toLowerCase();
  const kind = row.kind || 'd';
  const needsStream = ['.mkv', '.avi', '.ts'].includes(ext) && kind === 'd';

  return {
    id: String(row.id),
    kind,
    type: mt,
    title: row.title || path.basename(fp),
    platform: row.platform || 'other',
    channel: row.channel || 'unknown',
    src: needsStream
      ? `/media/stream?id=${row.id}`
      : `/media/file?kind=${kind}&id=${row.id}`,
    thumb: row.thumbnail || `/media/thumb?kind=${kind}&id=${row.id}`,
    created_at: row.finished_at || row.created_at,
    duration: row.duration || null,
    filesize: row.filesize || 0,
    description: row.description || '',
    url: row.url || row.source_url || '',
  };
}
