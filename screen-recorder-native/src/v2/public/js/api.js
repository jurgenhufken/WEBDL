/**
 * WEBDL 0.2 — API module
 * 
 * Alle server communicatie op één plek.
 * Andere modules importeren niets van hier — ze krijgen data via callbacks.
 */
const API = {
  async get(path) {
    const res = await fetch(path, { cache: 'no-store' });
    return res.json();
  },

  async post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return res.json();
  },

  // --- Endpoints ---
  async getRecentFiles(opts = {}) {
    const params = new URLSearchParams();
    params.set('limit', opts.limit || 60);
    if (opts.type && opts.type !== 'all') params.set('type', opts.type);
    if (opts.cursor) params.set('cursor', opts.cursor);
    if (opts.sort) params.set('sort', opts.sort);
    if (opts.q) params.set('q', opts.q);
    return this.get('/api/media/recent-files?' + params);
  },

  async getChannels(limit = 800) {
    return this.get('/api/media/channels?limit=' + limit);
  },

  async getChannelFiles(platform, channel, opts = {}) {
    const params = new URLSearchParams();
    params.set('platform', platform);
    params.set('channel', channel);
    params.set('limit', opts.limit || 60);
    if (opts.cursor) params.set('cursor', opts.cursor);
    if (opts.type && opts.type !== 'all') params.set('type', opts.type);
    return this.get('/api/media/channel-files?' + params);
  },

  async getStats() {
    return this.get('/api/stats');
  },

  async getDirectories() {
    return this.get('/api/directories');
  },

  async startDownload(url, metadata) {
    return this.post('/download', { url, metadata });
  },

  async batchDownload(urls, metadata) {
    return this.post('/download/batch', { urls, metadata });
  },
};
