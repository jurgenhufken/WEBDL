'use strict';
/**
 * Downloader: gallery-dl — Pijler: Ingest
 * 
 * Handelt downloads af voor: Twitter, Reddit, Wikifeet, Instagram, etc.
 * gallery-dl downloadt alle media van een pagina/profiel.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getDownloadDir, findMediaFiles, findPrimaryFile } = require('../utils/paths');

async function download(ctx, downloadId, url, platform, channel, title, metadata) {
  const { config, state, queries } = ctx;
  const GALLERY_DL = config.GALLERY_DL || `${require('os').homedir()}/.local/bin/gallery-dl`;
  const BASE_DIR = config.BASE_DIR;

  // Output directory
  const dir = getDownloadDir(BASE_DIR, platform, channel);

  // Build args
  const args = [];

  // Twitter: conversations + cookies
  if (platform === 'twitter') {
    args.push('--cookies-from-browser', 'firefox');
    args.push('-o', 'conversations=true', '-o', 'replies=true');
  }

  // Reddit: cookies
  if (platform === 'reddit') {
    args.push('--cookies-from-browser', 'firefox');
  }

  // Instagram: cookies
  if (platform === 'instagram') {
    args.push('--cookies-from-browser', 'firefox');
  }

  args.push(url);

  console.log(`[gallery-dl] #${downloadId} Starting: ${url.slice(0, 80)}`);
  console.log(`[gallery-dl] #${downloadId} Dir: ${dir}`);

  return new Promise((resolve) => {
    const proc = spawn(GALLERY_DL, args, {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    state.activeProcesses.set(downloadId, proc);

    let stderr = '';
    let fileCount = 0;

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        // gallery-dl prints downloaded file paths to stdout
        if (line.includes('/') || line.includes('\\')) {
          fileCount++;
        }
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-2000);
    });

    proc.on('close', async (code) => {
      state.activeProcesses.delete(downloadId);

      if (code === 0) {
        // Succes: vind het primaire bestand
        const primary = findPrimaryFile(dir);
        const allFiles = findMediaFiles(dir);

        console.log(`[gallery-dl] #${downloadId} ✅ Done: ${allFiles.length} files`);

        try {
          // Update met het primaire bestand
          const filepath = primary || dir;
          const filename = primary ? path.basename(primary) : `(${allFiles.length} files)`;
          const filesize = primary ? fs.statSync(primary).size : 0;

          await ctx.db.query(
            `UPDATE downloads SET status=$1, progress=$2, filepath=$3, filename=$4, filesize=$5, 
             updated_at=CURRENT_TIMESTAMP, finished_at=CURRENT_TIMESTAMP WHERE id=$6`,
            ['completed', 100, filepath, filename, filesize, downloadId]
          );
        } catch (e) {
          console.error(`[gallery-dl] #${downloadId} DB update error:`, e.message);
        }
      } else {
        // Error
        const errMsg = stderr.slice(0, 500) || `Exit code ${code}`;
        console.error(`[gallery-dl] #${downloadId} ❌ Failed: ${errMsg.slice(0, 100)}`);
        try {
          await queries.updateDownloadStatus.run('error', 0, errMsg, downloadId);
        } catch (e) {}
      }

      // Signal queue: job is klaar, start de volgende
      if (ctx.services.queue) ctx.services.queue.onJobFinished(downloadId);
      resolve();
    });

    proc.on('error', async (err) => {
      console.error(`[gallery-dl] #${downloadId} Spawn error:`, err.message);
      state.activeProcesses.delete(downloadId);
      try {
        await queries.updateDownloadStatus.run('error', 0, err.message, downloadId);
      } catch (e) {}
      if (ctx.services.queue) ctx.services.queue.onJobFinished(downloadId);
      resolve();
    });
  });
}

module.exports = { download };
