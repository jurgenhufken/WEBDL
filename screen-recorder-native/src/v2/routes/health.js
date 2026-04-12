'use strict';
/**
 * Routes: Health — /health, /status
 * 
 * Altijd het eerste dat werkt. Binnen 0 seconden na startup.
 */

module.exports = function mountHealthRoutes(app, ctx) {
  const { state } = ctx;

  app.get('/health', (req, res) => {
    res.json({
      success: true,
      status: state.isShuttingDown ? 'shutting_down' : 'running',
      version: 'v2',
      serverTime: new Date().toISOString(),
    });
  });

  app.get('/status', async (req, res) => {
    try {
      const stats = await ctx.queries.getStats.get();
      res.json({
        success: true,
        version: 'v2',
        stats: {
          downloads: parseInt(stats.downloads || 0),
          screenshots: parseInt(stats.screenshots || 0),
          download_files: parseInt(stats.download_files || 0),
        },
        state: {
          activeProcesses: state.activeProcesses.size,
          queuedJobs: state.queuedJobs.length,
          thumbGenQueue: state.thumbGenQueue.length,
          isShuttingDown: state.isShuttingDown,
        },
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
};
