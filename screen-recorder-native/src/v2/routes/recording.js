'use strict';
/**
 * Routes: Recording — Pijler: Ingest
 * 
 * POST /start-recording   → Start opname
 * POST /stop-recording    → Stop opname
 * GET  /recording/status  → Actieve opnames
 */

module.exports = function mountRecordingRoutes(app, ctx) {

  app.post('/start-recording', async (req, res) => {
    try {
      const { metadata = {}, force } = req.body || {};
      const recId = String(metadata.url || req.body.url || 'default_rec').trim();

      // Force restart
      if (force && ctx.state.activeRecordings.has(recId)) {
        ctx.services.recording.stop(recId);
        await new Promise(r => setTimeout(r, 800));
      }

      const result = await ctx.services.recording.start(recId, metadata);
      res.json(result);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/stop-recording', (req, res) => {
    try {
      const recId = String(
        (req.body && (req.body.id || req.body.tabId || (req.body.metadata && req.body.metadata.url))) || ''
      ).trim();

      const result = ctx.services.recording.stop(recId || null);
      res.json(result);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/recording/status', (req, res) => {
    const active = ctx.services.recording.listActive();
    res.json({
      success: true,
      isRecording: active.length > 0,
      recordings: active,
    });
  });
};
