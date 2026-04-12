'use strict';
/**
 * Downloader: Direct File — Pijler: Ingest
 * 
 * Downloadt directe bestandslinks (jpg, mp4, etc.) via HTTP.
 */
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { getDownloadDir } = require('../utils/paths');

async function download(ctx, downloadId, url, platform, channel, title, metadata) {
  const { config, state, queries } = ctx;
  const BASE_DIR = config.BASE_DIR;
  const dir = getDownloadDir(BASE_DIR, platform, channel);

  // Bestandsnaam uit URL
  let filename;
  try {
    const u = new URL(url);
    filename = decodeURIComponent(path.basename(u.pathname)) || 'download.bin';
  } catch (e) {
    filename = 'download.bin';
  }

  const filepath = path.join(dir, filename);
  console.log(`[direct] #${downloadId} Starting: ${url.slice(0, 80)} → ${filename}`);

  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;

    const req = client.get(url, { timeout: 30000 }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`[direct] #${downloadId} Redirect → ${res.headers.location.slice(0, 80)}`);
        download(ctx, downloadId, res.headers.location, platform, channel, title, metadata).then(resolve);
        return;
      }

      if (res.statusCode !== 200) {
        queries.updateDownloadStatus.run('error', 0, `HTTP ${res.statusCode}`, downloadId).catch(() => {});
        if (ctx.services.queue) ctx.services.queue.onJobFinished(downloadId);
        resolve();
        return;
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      let lastProgress = 0;

      const ws = fs.createWriteStream(filepath);

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const progress = Math.min(99, Math.round((downloadedBytes / totalBytes) * 100));
          if (progress > lastProgress + 5) {
            lastProgress = progress;
            queries.updateDownloadStatus.run('downloading', progress, null, downloadId).catch(() => {});
          }
        }
      });

      res.pipe(ws);

      ws.on('finish', async () => {
        console.log(`[direct] #${downloadId} ✅ Done: ${filename} (${(downloadedBytes / 1024 / 1024).toFixed(1)} MB)`);
        try {
          await ctx.db.query(
            `UPDATE downloads SET status=$1, progress=$2, filepath=$3, filename=$4, filesize=$5,
             updated_at=CURRENT_TIMESTAMP, finished_at=CURRENT_TIMESTAMP WHERE id=$6`,
            ['completed', 100, filepath, filename, downloadedBytes, downloadId]
          );
        } catch (e) {}
        if (ctx.services.queue) ctx.services.queue.onJobFinished(downloadId);
        resolve();
      });

      ws.on('error', async (err) => {
        console.error(`[direct] #${downloadId} Write error:`, err.message);
        try { await queries.updateDownloadStatus.run('error', 0, err.message, downloadId); } catch (e) {}
        if (ctx.services.queue) ctx.services.queue.onJobFinished(downloadId);
        resolve();
      });
    });

    state.activeProcesses.set(downloadId, { kill: () => req.destroy() });

    req.on('error', async (err) => {
      console.error(`[direct] #${downloadId} Request error:`, err.message);
      state.activeProcesses.delete(downloadId);
      try { await queries.updateDownloadStatus.run('error', 0, err.message, downloadId); } catch (e) {}
      if (ctx.services.queue) ctx.services.queue.onJobFinished(downloadId);
      resolve();
    });

    req.on('timeout', () => {
      req.destroy(new Error('Timeout'));
    });
  });
}

module.exports = { download };
