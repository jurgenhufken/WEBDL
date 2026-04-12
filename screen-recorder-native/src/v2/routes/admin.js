'use strict';
/**
 * Routes: Admin — Pijler: Beheer
 * 
 * /api/tags             → Alle tags
 * /api/tags/:kind/:id   → Tags voor een media item
 * /api/tag              → Tag toevoegen/verwijderen
 * /api/rating           → Rating opvragen/instellen
 */

module.exports = function mountAdminRoutes(app, ctx) {
  const { queries, db } = ctx;

  // --- Alle tags ---
  app.get('/api/tags', async (req, res) => {
    try {
      const tags = await queries.getAllTags.all();
      res.json({ success: true, tags });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // --- Tags voor een specifiek item ---
  app.get('/api/tags/:kind/:id', async (req, res) => {
    try {
      const kind = String(req.params.kind);
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'invalid id' });

      const tags = await queries.getMediaTags.all(kind, id);
      res.json({ success: true, tags });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // --- Tag toevoegen/verwijderen ---
  app.post('/api/tag', async (req, res) => {
    try {
      const { kind, media_id, tag, action } = req.body || {};
      if (!kind || !media_id || !tag) {
        return res.status(400).json({ success: false, error: 'kind, media_id, tag zijn vereist' });
      }

      const tagName = String(tag).trim().toLowerCase().replace(/^#/, '');
      if (!tagName) return res.status(400).json({ success: false, error: 'lege tag' });

      if (action === 'remove') {
        // Verwijder tag
        await db.query(
          `DELETE FROM media_tags WHERE kind = $1 AND media_id = $2 AND tag_id = (SELECT id FROM tags WHERE name = $3)`,
          [kind, media_id, tagName]
        );
        res.json({ success: true, action: 'removed', tag: tagName });
      } else {
        // Voeg tag toe (upsert)
        await db.query(
          `INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
          [tagName]
        );
        const { rows } = await db.query(`SELECT id FROM tags WHERE name = $1`, [tagName]);
        if (rows[0]) {
          await db.query(
            `INSERT INTO media_tags (kind, media_id, tag_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [kind, media_id, rows[0].id]
          );
        }
        res.json({ success: true, action: 'added', tag: tagName });
      }
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // --- Rating opvragen ---
  app.get('/api/rating/:kind/:id', async (req, res) => {
    try {
      const kind = String(req.params.kind);
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'invalid id' });

      const rating = await queries.getRating.get(kind, id);
      res.json({ success: true, rating: rating ? rating.rating : null });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // --- Rating instellen ---
  app.post('/api/rating', async (req, res) => {
    try {
      const { kind, media_id, rating } = req.body || {};
      if (!kind || !media_id || rating == null) {
        return res.status(400).json({ success: false, error: 'kind, media_id, rating zijn vereist' });
      }

      const value = Math.max(0, Math.min(5, parseInt(rating, 10)));

      await db.query(
        `INSERT INTO ratings (kind, media_id, rating) VALUES ($1, $2, $3)
         ON CONFLICT (kind, media_id) DO UPDATE SET rating = $3, updated_at = CURRENT_TIMESTAMP`,
        [kind, media_id, value]
      );

      res.json({ success: true, kind, media_id, rating: value });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
};
