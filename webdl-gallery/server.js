// server.js — webdl-gallery: lichte gallery + viewer server.
// Leest direct uit de PostgreSQL 'downloads' tabel. Geen afhankelijkheid
// van simple-server of webdl-hub — alleen de gedeelde database.
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 35731);
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/webdl';

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,                        // meer ruimte voor meerdere tabs
  idleTimeoutMillis: 30000,       // idle verbindingen na 30s sluiten
  connectionTimeoutMillis: 5000,  // max 5s wachten op verbinding uit pool
  statement_timeout: 10000,       // queries langer dan 10s afbreken
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Voorkom dat de browser API-responses cached of samenvoegt tussen tabs
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// ─── Health ────────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT 1 AS ok');
    res.json({ ok: rows[0].ok === 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── Items: gepagineerde media ─────────────────────────────────────────────
app.get('/api/items', async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const platform = req.query.platform ? String(req.query.platform) : null;
    const channel = req.query.channel ? String(req.query.channel) : null;
    const q = req.query.q ? String(req.query.q).trim() : null;
    const sort = String(req.query.sort || 'recent'); // recent | random | rating
    const minRating = req.query.min_rating != null ? Number(req.query.min_rating) : null;

    const mediaType = req.query.media_type ? String(req.query.media_type) : null; // 'video'|'image'
    const tagId = req.query.tag_id ? parseInt(req.query.tag_id, 10) : null;
    const VIDEO_EXTS = ['mp4','webm','mkv','mov','m4v','avi','flv','ts'];

    const where = [`status = 'completed'`, `filepath IS NOT NULL`];
    const params = [];
    if (platform) { params.push(platform); where.push(`platform = $${params.length}`); }
    if (channel)  { params.push(channel);  where.push(`channel = $${params.length}`); }
    if (q)        { params.push('%' + q.toLowerCase() + '%'); where.push(`LOWER(COALESCE(title, filename, '')) LIKE $${params.length}`); }
    if (Number.isFinite(minRating)) { params.push(minRating); where.push(`rating >= $${params.length}`); }
    if (mediaType === 'video') { where.push(`lower(COALESCE(format,'')) IN (${VIDEO_EXTS.map(e=>`'${e}'`).join(',')})`); }
    if (mediaType === 'image') { where.push(`lower(COALESCE(format,'')) NOT IN (${VIDEO_EXTS.map(e=>`'${e}'`).join(',')})`); }
    if (Number.isFinite(tagId)) {
      params.push(tagId);
      where.push(`id IN (
        SELECT dt.download_id
          FROM download_tags dt
          JOIN tags t ON t.name = dt.tag
         WHERE t.id = $${params.length}
      )`);
    }

    const orderBy = sort === 'random'
      ? 'RANDOM()'
      : sort === 'rating'
        ? 'rating DESC NULLS LAST, COALESCE(finished_at, created_at) DESC'
        : 'COALESCE(finished_at, created_at) DESC, id DESC';

    params.push(limit, offset);
    const sql = `
      SELECT * FROM (
        SELECT DISTINCT ON (filepath)
               id, url, source_url, platform, channel, title, filename, filepath, filesize,
               format, rating, is_thumb_ready, finished_at, created_at
          FROM downloads
         WHERE ${where.join(' AND ')}
         ORDER BY filepath, COALESCE(finished_at, created_at) DESC, id DESC
      ) deduped
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const { rows } = await pool.query(sql, params);

    // Detecteer type (image/video) op ext
    const items = rows.map((r) => {
      const ext = r.format ? String(r.format).toLowerCase() : path.extname(r.filepath || '').replace('.', '').toLowerCase();
      const isVideo = ['mp4','webm','mkv','mov','m4v','avi','flv','ts'].includes(ext);
      return { ...r, ext, type: isVideo ? 'video' : 'image' };
    });

    res.json({ items, limit, offset, count: items.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Items sinds timestamp X (voor auto-refresh polling) ──────────────────
// We filteren op COALESCE(finished_at, created_at) > since omdat nieuwe
// completions vaak oude IDs hebben (pending rows die laat afgerond worden).
app.get('/api/items-since', async (req, res) => {
  try {
    const since = req.query.since ? String(req.query.since) : null;
    const platform = req.query.platform ? String(req.query.platform) : null;
    const channel = req.query.channel ? String(req.query.channel) : null;
    const q = req.query.q ? String(req.query.q).trim() : null;
    const minRating = req.query.min_rating != null ? Number(req.query.min_rating) : null;

    const where = [`status = 'completed'`, `filepath IS NOT NULL`];
    const params = [];
    if (since) {
      params.push(since);
      where.push(`COALESCE(finished_at, created_at) > $${params.length}::timestamp`);
    }
    if (platform) { params.push(platform); where.push(`platform = $${params.length}`); }
    if (channel)  { params.push(channel);  where.push(`channel = $${params.length}`); }
    if (q)        { params.push('%' + q.toLowerCase() + '%'); where.push(`LOWER(COALESCE(title, filename, '')) LIKE $${params.length}`); }
    if (Number.isFinite(minRating)) { params.push(minRating); where.push(`rating >= $${params.length}`); }

    const sql = `
      SELECT * FROM (
        SELECT DISTINCT ON (filepath)
               id, url, source_url, platform, channel, title, filename, filepath, filesize,
               format, rating, is_thumb_ready, finished_at, created_at
          FROM downloads
         WHERE ${where.join(' AND ')}
         ORDER BY filepath, COALESCE(finished_at, created_at) DESC, id DESC
      ) deduped
      ORDER BY COALESCE(finished_at, created_at) DESC, id DESC
      LIMIT 200`;
    const { rows } = await pool.query(sql, params);

    const items = rows.map((r) => {
      const ext = r.format ? String(r.format).toLowerCase() : path.extname(r.filepath || '').replace('.', '').toLowerCase();
      const isVideo = ['mp4','webm','mkv','mov','m4v','avi','flv','ts'].includes(ext);
      return { ...r, ext, type: isVideo ? 'video' : 'image' };
    });
    res.json({ items, since, count: items.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Platforms lijst ───────────────────────────────────────────────────────
app.get('/api/platforms', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT platform, COUNT(*) AS count FROM (
        SELECT DISTINCT ON (filepath)
               platform
          FROM downloads
         WHERE status = 'completed' AND filepath IS NOT NULL
         ORDER BY filepath, COALESCE(finished_at, created_at) DESC, id DESC
      ) deduped
      GROUP BY platform
      ORDER BY count DESC`);
    res.json({ platforms: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Channels lijst (per platform) ─────────────────────────────────────────
app.get('/api/channels', async (req, res) => {
  try {
    const platform = req.query.platform ? String(req.query.platform) : null;
    const params = [];
    let where = `WHERE status = 'completed' AND filepath IS NOT NULL`;
    if (platform) { params.push(platform); where += ` AND platform = $1`; }
    const { rows } = await pool.query(`
      SELECT channel, platform, COUNT(*) AS count FROM (
        SELECT DISTINCT ON (filepath)
               channel, platform
          FROM downloads
          ${where}
         ORDER BY filepath, COALESCE(finished_at, created_at) DESC, id DESC
      ) deduped
      GROUP BY channel, platform
      ORDER BY count DESC
      LIMIT 500`, params);
    res.json({ channels: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Rating bijwerken ──────────────────────────────────────────────────────
app.post('/api/rating', async (req, res) => {
  try {
    const id = parseInt(req.body.id, 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'id vereist' });
    let rating = null;
    if (req.body.rating !== null && req.body.rating !== '') {
      const r = Number(req.body.rating);
      if (!Number.isFinite(r)) return res.status(400).json({ error: 'rating ongeldig' });
      rating = Math.max(0, Math.min(5, Math.round(r * 2) / 2));
    }
    await pool.query('UPDATE downloads SET rating=$1, updated_at=now() WHERE id=$2', [rating, id]);
    res.json({ success: true, id, rating });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── File stream: serveert bestanden van disk ──────────────────────────────
app.get('/media/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query('SELECT filepath FROM downloads WHERE id=$1', [id]);
    if (!rows.length || !rows[0].filepath) return res.status(404).send('not found');
    const fp = rows[0].filepath;
    if (!fs.existsSync(fp)) return res.status(404).send('file missing');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(fp);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// ─── Thumbnail stream: _thumb.jpg of fallback naar origineel ───────────────
app.get('/thumb/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query('SELECT filepath FROM downloads WHERE id=$1', [id]);
    if (!rows.length || !rows[0].filepath) return res.status(404).send('not found');
    const fp = rows[0].filepath;
    const dir = path.dirname(fp);
    const base = path.basename(fp, path.extname(fp));
    // Probeer meerdere thumb-varianten
    const candidates = [
      path.join(dir, `${base}_thumb_v3.jpg`),
      path.join(dir, `${base}_thumb.jpg`),
      path.join(dir, `${base}.webp`),
      fp, // fallback naar origineel (voor images)
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(c);
      }
    }
    res.status(404).send('no thumb');
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// ─── Tags CRUD ─────────────────────────────────────────────────────────────
app.get('/api/tags', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM tags ORDER BY name ASC');
    res.json({ tags: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tags', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name vereist' });
    const { rows } = await pool.query(
      'INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id, name',
      [name]);
    res.json({ tag: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/tags/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const tag = await pool.query('SELECT name FROM tags WHERE id=$1', [id]);
    if (tag.rows[0]) {
      await pool.query('DELETE FROM download_tags WHERE tag=$1', [tag.rows[0].name]);
    }
    await pool.query('DELETE FROM tags WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Tags op een item
app.get('/api/items/:id/tags', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      'SELECT t.id, t.name FROM tags t JOIN download_tags dt ON t.name=dt.tag WHERE dt.download_id=$1 ORDER BY t.name',
      [id]);
    res.json({ tags: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/items/:id/tags', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id, 10);
    const tagId = parseInt(req.body.tag_id, 10);
    if (!Number.isFinite(tagId)) return res.status(400).json({ error: 'tag_id vereist' });
    const tag = await pool.query('SELECT name FROM tags WHERE id=$1', [tagId]);
    if (!tag.rows[0]) return res.status(404).json({ error: 'tag niet gevonden' });
    await pool.query(
      'INSERT INTO download_tags (download_id, tag) VALUES ($1,$2) ON CONFLICT ON CONSTRAINT download_tags_download_id_tag_key DO NOTHING',
      [itemId, tag.rows[0].name]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/items/:id/tags/:tagId', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id, 10);
    const tagId = parseInt(req.params.tagId, 10);
    const tag = await pool.query('SELECT name FROM tags WHERE id=$1', [tagId]);
    if (tag.rows[0]) {
      await pool.query('DELETE FROM download_tags WHERE download_id=$1 AND tag=$2', [itemId, tag.rows[0].name]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Finder: open bestand in macOS Finder ──────────────────────────────────
app.post('/api/finder', async (req, res) => {
  try {
    const id = parseInt(req.body.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id vereist' });
    const { rows } = await pool.query('SELECT filepath FROM downloads WHERE id=$1', [id]);
    if (!rows.length || !rows[0].filepath) return res.status(404).json({ error: 'niet gevonden' });
    const fp = rows[0].filepath;
    require('node:child_process').execFile('open', ['-R', fp], { timeout: 5000 }, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => {
  console.log(`webdl-gallery listening on http://localhost:${PORT}`);
});
