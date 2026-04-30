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

const BASE_DIR = process.env.WEBDL_BASE_DIR || '/Users/jurgen/Downloads/WEBDL';
const VIDEO_EXTS = ['mp4','webm','mkv','mov','m4v','avi','flv','ts'];
const IMAGE_EXTS = ['jpg','jpeg','png','gif','webp','avif','bmp'];
const MEDIA_EXTS = [...VIDEO_EXTS, ...IMAGE_EXTS];
const AUX_RELPATH_RE = String.raw`(_thumb(_v[0-9]+)?\.(jpe?g|png|webp)$|_logo\.(jpe?g|png|webp)$|\.(json|part|tmp|ytdl)$)`;
const MEDIA_EXT_SQL = MEDIA_EXTS.map(e => `'${e}'`).join(',');

async function ensureSchema() {
  await pool.query('ALTER TABLE download_files ADD COLUMN IF NOT EXISTS rating double precision');
}

function fileExt(filePath, format) {
  return format ? String(format).toLowerCase() : path.extname(filePath || '').replace('.', '').toLowerCase();
}

function mapItem(row) {
  const ext = fileExt(row.filepath, row.format);
  const isVideo = VIDEO_EXTS.includes(ext);
  const filename = row.filename || path.basename(row.filepath || '');
  return {
    ...row,
    id: String(row.id),
    rating_id: row.rating_id || row.id,
    filename,
    ext,
    type: isVideo ? 'video' : 'image',
  };
}

async function resolveMediaPath(idRaw) {
  const id = String(idRaw || '');
  const fileMatch = id.match(/^file-(\d+)$/);
  if (fileMatch) {
    const { rows } = await pool.query('SELECT relpath FROM download_files WHERE id=$1', [fileMatch[1]]);
    if (!rows.length || !rows[0].relpath) return null;
    return path.resolve(BASE_DIR, rows[0].relpath);
  }
  const numericId = parseInt(id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  const { rows } = await pool.query('SELECT filepath FROM downloads WHERE id=$1', [numericId]);
  return rows.length ? rows[0].filepath : null;
}

function buildItemFilters({ req, params, fileExpr, extExpr, ratingExpr }) {
  const platform = req.query.platform ? String(req.query.platform) : null;
  const channel = req.query.channel ? String(req.query.channel) : null;
  const q = req.query.q ? String(req.query.q).trim() : null;
  const minRating = req.query.min_rating != null ? Number(req.query.min_rating) : null;
  const mediaType = req.query.media_type ? String(req.query.media_type) : null;
  const tagId = req.query.tag_id ? parseInt(req.query.tag_id, 10) : null;

  const where = [`d.status = 'completed'`, `${fileExpr} IS NOT NULL`, `${fileExpr} <> ''`];
  if (platform) { params.push(platform); where.push(`d.platform = $${params.length}`); }
  if (channel)  { params.push(channel);  where.push(`d.channel = $${params.length}`); }
  if (q) {
    params.push('%' + q.toLowerCase() + '%');
    where.push(`(LOWER(COALESCE(d.title, d.filename, '')) LIKE $${params.length} OR LOWER(${fileExpr}) LIKE $${params.length})`);
  }
  if (Number.isFinite(minRating)) { params.push(minRating); where.push(`${ratingExpr} >= $${params.length}`); }
  if (mediaType === 'video') { where.push(`lower(${extExpr}) IN (${VIDEO_EXTS.map(e=>`'${e}'`).join(',')})`); }
  if (mediaType === 'image') { where.push(`lower(${extExpr}) IN (${IMAGE_EXTS.map(e=>`'${e}'`).join(',')})`); }
  if (Number.isFinite(tagId)) {
    params.push(tagId);
    where.push(`d.id IN (
      SELECT dt.download_id
        FROM download_tags dt
        JOIN tags t ON t.name = dt.tag
       WHERE t.id = $${params.length}
    )`);
  }
  return where;
}

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
    const sort = String(req.query.sort || 'recent'); // recent | random | rating
    const sourceLimit = limit + offset;
    const params = [];
    const directWhere = buildItemFilters({
      req, params,
      fileExpr: 'd.filepath',
      extExpr: "COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))",
      ratingExpr: 'd.rating',
    });
    directWhere.push(`NOT EXISTS (
      SELECT 1 FROM download_files mf
       WHERE mf.download_id = d.id
         AND mf.relpath !~* '${AUX_RELPATH_RE}'
         AND lower(regexp_replace(mf.relpath, '^.*\\.', '')) IN (${MEDIA_EXT_SQL})
    )`);
    const fileWhere = buildItemFilters({
      req, params,
      fileExpr: 'df.relpath',
      extExpr: "regexp_replace(df.relpath, '^.*\\.', '')",
      ratingExpr: 'df.rating',
    });
    fileWhere.push(`df.relpath !~* '${AUX_RELPATH_RE}'`);
    fileWhere.push(`lower(regexp_replace(df.relpath, '^.*\\.', '')) IN (${MEDIA_EXT_SQL})`);

    const directOrder = sort === 'random'
      ? 'RANDOM()'
      : sort === 'rating'
        ? 'd.rating DESC NULLS LAST, d.id DESC'
        : 'd.id DESC';
    const fileOrder = sort === 'random'
      ? 'RANDOM()'
      : sort === 'rating'
        ? 'df.rating DESC NULLS LAST, df.id DESC'
        : 'df.id DESC';
    const orderBy = sort === 'random'
      ? 'RANDOM()'
      : sort === 'rating'
        ? 'rating DESC NULLS LAST, source_order DESC'
        : 'source_order DESC';

    params.push(sourceLimit, limit, offset);
    const sql = `
      WITH direct_items AS (
          SELECT 'download' AS item_kind,
                 d.id::text AS id, d.id AS rating_id,
                 d.url, d.source_url, d.platform, d.channel, d.title, d.filename,
                 d.filepath, d.filesize, d.format, d.rating, d.is_thumb_ready,
                 d.finished_at, d.created_at,
                 COALESCE(d.finished_at, d.updated_at, d.created_at) AS sort_ts,
                 d.id::bigint AS source_order
            FROM downloads d
           WHERE ${directWhere.join(' AND ')}
           ORDER BY ${directOrder}
           LIMIT $${params.length - 2}
      ),
      file_items AS (
          SELECT 'file' AS item_kind,
                 'file-' || df.id::text AS id, d.id AS rating_id,
                 d.url, d.source_url, d.platform, d.channel, d.title,
                 regexp_replace(df.relpath, '^.*/', '') AS filename,
                 df.relpath AS filepath, df.filesize,
                 regexp_replace(df.relpath, '^.*\\.', '') AS format,
                 df.rating, COALESCE(df.is_thumb_ready, d.is_thumb_ready) AS is_thumb_ready,
                 d.finished_at, d.created_at,
                 COALESCE(to_timestamp(NULLIF(df.mtime_ms,0) / 1000.0)::timestamp, df.updated_at, d.finished_at, d.updated_at, d.created_at) AS sort_ts,
                 (1000000000000 + df.id)::bigint AS source_order
            FROM download_files df
            JOIN downloads d ON d.id = df.download_id
           WHERE ${fileWhere.join(' AND ')}
           ORDER BY ${fileOrder}
           LIMIT $${params.length - 2}
      )
      SELECT *
        FROM (
          SELECT * FROM direct_items
          UNION ALL
          SELECT * FROM file_items
        ) media_items
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const { rows } = await pool.query(sql, params);

    const items = rows.map(mapItem);
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
    const params = [];
    const directWhere = buildItemFilters({
      req, params,
      fileExpr: 'd.filepath',
      extExpr: "COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\\.', ''))",
      ratingExpr: 'd.rating',
    });
    directWhere.push(`NOT EXISTS (
      SELECT 1 FROM download_files mf
       WHERE mf.download_id = d.id
         AND mf.relpath !~* '${AUX_RELPATH_RE}'
         AND lower(regexp_replace(mf.relpath, '^.*\\.', '')) IN (${MEDIA_EXTS.map(e=>`'${e}'`).join(',')})
    )`);
    const fileWhere = buildItemFilters({
      req, params,
      fileExpr: 'df.relpath',
      extExpr: "regexp_replace(df.relpath, '^.*\\.', '')",
      ratingExpr: 'df.rating',
    });
    fileWhere.push(`df.relpath !~* '${AUX_RELPATH_RE}'`);
    fileWhere.push(`lower(regexp_replace(df.relpath, '^.*\\.', '')) IN (${MEDIA_EXTS.map(e=>`'${e}'`).join(',')})`);
    if (since) {
      params.push(since);
      directWhere.push(`COALESCE(d.finished_at, d.updated_at, d.created_at) > $${params.length}::timestamp`);
      fileWhere.push(`COALESCE(to_timestamp(NULLIF(df.mtime_ms,0) / 1000.0)::timestamp, df.updated_at, d.finished_at, d.updated_at, d.created_at) > $${params.length}::timestamp`);
    }

    const sql = `
      SELECT *
        FROM (
          SELECT 'download' AS item_kind,
                 d.id::text AS id, d.id AS rating_id,
                 d.url, d.source_url, d.platform, d.channel, d.title, d.filename,
                 d.filepath, d.filesize, d.format, d.rating, d.is_thumb_ready,
                 d.finished_at, d.created_at,
                 COALESCE(d.finished_at, d.updated_at, d.created_at) AS sort_ts
            FROM downloads d
           WHERE ${directWhere.join(' AND ')}
          UNION ALL
          SELECT 'file' AS item_kind,
                 'file-' || df.id::text AS id, d.id AS rating_id,
                 d.url, d.source_url, d.platform, d.channel, d.title,
                 regexp_replace(df.relpath, '^.*/', '') AS filename,
                 df.relpath AS filepath, df.filesize,
                 regexp_replace(df.relpath, '^.*\\.', '') AS format,
                 df.rating, COALESCE(df.is_thumb_ready, d.is_thumb_ready) AS is_thumb_ready,
                 d.finished_at, d.created_at,
                 COALESCE(to_timestamp(NULLIF(df.mtime_ms,0) / 1000.0)::timestamp, df.updated_at, d.finished_at, d.updated_at, d.created_at) AS sort_ts
            FROM download_files df
            JOIN downloads d ON d.id = df.download_id
           WHERE ${fileWhere.join(' AND ')}
        ) media_items
      ORDER BY sort_ts DESC, id DESC
      LIMIT 200`;
    const { rows } = await pool.query(sql, params);
    const items = rows.map(mapItem);
    res.json({ items, since, count: items.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Platforms lijst ───────────────────────────────────────────────────────
app.get('/api/platforms', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT platform, COUNT(*) AS count
      FROM (
        SELECT d.platform
          FROM downloads d
         WHERE d.status = 'completed'
           AND d.filepath IS NOT NULL AND d.filepath <> ''
           AND NOT EXISTS (
             SELECT 1 FROM download_files mf
              WHERE mf.download_id = d.id
                AND mf.relpath !~* '${AUX_RELPATH_RE}'
                AND lower(regexp_replace(mf.relpath, '^.*\\.', '')) IN (${MEDIA_EXTS.map(e=>`'${e}'`).join(',')})
           )
        UNION ALL
        SELECT d.platform
          FROM download_files df
          JOIN downloads d ON d.id = df.download_id
         WHERE d.status = 'completed'
           AND df.relpath !~* '${AUX_RELPATH_RE}'
           AND lower(regexp_replace(df.relpath, '^.*\\.', '')) IN (${MEDIA_EXTS.map(e=>`'${e}'`).join(',')})
      ) media_items
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
    const platformClause = platform ? `AND d.platform = $1` : '';
    if (platform) params.push(platform);
    const { rows } = await pool.query(`
      SELECT channel, platform, COUNT(*) AS count
      FROM (
        SELECT d.channel, d.platform
          FROM downloads d
         WHERE d.status = 'completed'
           AND d.filepath IS NOT NULL AND d.filepath <> ''
           ${platformClause}
           AND NOT EXISTS (
             SELECT 1 FROM download_files mf
              WHERE mf.download_id = d.id
                AND mf.relpath !~* '${AUX_RELPATH_RE}'
                AND lower(regexp_replace(mf.relpath, '^.*\\.', '')) IN (${MEDIA_EXTS.map(e=>`'${e}'`).join(',')})
           )
        UNION ALL
        SELECT d.channel, d.platform
          FROM download_files df
          JOIN downloads d ON d.id = df.download_id
         WHERE d.status = 'completed'
           ${platformClause}
           AND df.relpath !~* '${AUX_RELPATH_RE}'
           AND lower(regexp_replace(df.relpath, '^.*\\.', '')) IN (${MEDIA_EXTS.map(e=>`'${e}'`).join(',')})
      ) media_items
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
    const rawId = String(req.body.id || '');
    const fileMatch = rawId.match(/^file-(\d+)$/);
    const id = fileMatch ? Number(fileMatch[1]) : parseInt(rawId, 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'id vereist' });
    let rating = null;
    if (req.body.rating !== null && req.body.rating !== '') {
      const r = Number(req.body.rating);
      if (!Number.isFinite(r)) return res.status(400).json({ error: 'rating ongeldig' });
      rating = Math.max(0, Math.min(5, Math.round(r * 2) / 2));
    }
    const result = fileMatch
      ? await pool.query('UPDATE download_files SET rating=$1, updated_at=now() WHERE id=$2', [rating, id])
      : await pool.query('UPDATE downloads SET rating=$1, updated_at=now() WHERE id=$2', [rating, id]);
    if (!result.rowCount) return res.status(404).json({ error: 'niet gevonden' });
    res.json({ success: true, id: fileMatch ? `file-${id}` : id, rating });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── File stream: serveert bestanden van disk ──────────────────────────────
app.get('/media/:id', async (req, res) => {
  try {
    const fp = await resolveMediaPath(req.params.id);
    if (!fp) return res.status(404).send('not found');
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
    const fp = await resolveMediaPath(req.params.id);
    if (!fp) return res.status(404).send('not found');
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
    const id = String(req.body.id || '');
    if (!id) return res.status(400).json({ error: 'id vereist' });
    const fp = await resolveMediaPath(id);
    if (!fp) return res.status(404).json({ error: 'niet gevonden' });
    require('node:child_process').execFile('open', ['-R', fp], { timeout: 5000 }, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`webdl-gallery listening on http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error('webdl-gallery schema init failed:', e);
    process.exit(1);
  });
