'use strict';
/**
 * Routes: Downloads — Pijler: Ingest
 * 
 * POST /download       → Enkele download starten
 * POST /download/batch → Meerdere URLs in één keer
 * POST /download/:id/cancel → Download annuleren
 * GET  /download/:id   → Download status opvragen
 * GET  /downloads      → Actieve downloads lijst
 */
const { detectPlatform, deriveChannel, deriveTitle } = require('../utils/platform');

module.exports = function mountDownloadRoutes(app, ctx) {
  const { queries, state } = ctx;

  // --- Enkele download ---
  app.post('/download', async (req, res) => {
    try {
      const { url, platform: rawPlatform, channel: rawChannel, title: rawTitle, metadata } = req.body || {};
      if (!url) return res.status(400).json({ success: false, error: 'url is vereist' });

      const platform = rawPlatform || detectPlatform(url);
      const channel = rawChannel || deriveChannel(platform, url);
      const title = rawTitle || deriveTitle(url);

      // Insert in DB
      const result = await queries.insertDownload.get(url, platform, channel, title);
      const downloadId = result.id;
      console.log(`[download] #${downloadId} queued: ${platform}/${channel} — ${url.slice(0, 80)}`);

      // Enqueue
      const queue = ctx.services.queue;
      if (queue) {
        queue.enqueue(downloadId, url, platform, channel, title, metadata || {});
      }

      res.json({ success: true, downloadId, url, platform, channel, title });
    } catch (e) {
      console.error('[download] Error:', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // --- Batch download ---
  app.post('/download/batch', async (req, res) => {
    try {
      const { urls, metadata, force } = req.body || {};
      if (!Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ success: false, error: 'urls is vereist' });
      }

      const originPlatform = metadata && metadata.platform ? metadata.platform : detectPlatform(metadata && metadata.url || '');
      const created = [];
      const seen = new Set();

      for (const rawUrl of urls) {
        const url = String(rawUrl || '').trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);

        const platform = detectPlatform(url) !== 'other' ? detectPlatform(url) : originPlatform;
        const channel = metadata && metadata.channel || deriveChannel(platform, url);
        const title = metadata && metadata.title || deriveTitle(url);

        const result = await queries.insertDownload.get(url, platform, channel, title);
        const downloadId = result.id;
        created.push({ downloadId, url, platform, channel, title });

        const queue = ctx.services.queue;
        if (queue) {
          const jobMeta = { ...(metadata || {}), ...(force ? { webdl_force: true } : {}) };
          queue.enqueue(downloadId, url, platform, channel, title, jobMeta);
        }
      }

      console.log(`[download/batch] ${created.length} jobs queued`);
      res.json({ success: true, downloads: created });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // --- Cancel ---
  app.post('/download/:id/cancel', async (req, res) => {
    try {
      const downloadId = parseInt(req.params.id, 10);
      if (!Number.isFinite(downloadId)) return res.status(400).json({ success: false, error: 'invalid id' });

      const queue = ctx.services.queue;
      if (queue) await queue.cancel(downloadId);

      res.json({ success: true, downloadId });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // --- Status ---
  app.get('/download/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'invalid id' });

      const download = await queries.getDownload.get(id);
      if (!download) return res.status(404).json({ success: false, error: 'not found' });

      res.json({ success: true, download });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // --- Active downloads ---
  app.get('/downloads', async (req, res) => {
    try {
      const rows = await queries.getActiveDownloads.all();
      res.json({
        success: true,
        downloads: rows,
        queue: {
          active: state.activeProcesses.size,
          queued: state.queuedJobs.length,
        },
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
};
