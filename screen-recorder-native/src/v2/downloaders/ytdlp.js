'use strict';
/**
 * Downloader: yt-dlp — Pijler: Ingest
 * 
 * Handelt downloads af voor: YouTube, Vimeo, Twitch, PornHub, TikTok, etc.
 * yt-dlp downloadt video + audio en merged ze.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getDownloadDir, findPrimaryFile } = require('../utils/paths');

async function download(ctx, downloadId, url, platform, channel, title, metadata) {
  const { config, state, queries } = ctx;
  const YTDLP = config.YT_DLP || '/opt/homebrew/bin/yt-dlp';
  const FFMPEG = config.FFMPEG || '/opt/homebrew/bin/ffmpeg';
  const BASE_DIR = config.BASE_DIR;

  const dir = getDownloadDir(BASE_DIR, platform, channel);

  // yt-dlp argumenten
  const args = [
    '--no-warnings',
    '--no-playlist',
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--merge-output-format', 'mp4',
    '--ffmpeg-location', path.dirname(FFMPEG),
    '-o', path.join(dir, '%(title)s.%(ext)s'),
    '--restrict-filenames',
    '--cookies-from-browser', 'firefox',
  ];

  // YouTube-specifieke opties
  if (platform === 'youtube') {
    args.push('--embed-thumbnail', '--embed-metadata');
  }

  args.push(url);

  console.log(`[yt-dlp] #${downloadId} Starting: ${url.slice(0, 80)}`);

  return new Promise((resolve) => {
    const proc = spawn(YTDLP, args, {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    state.activeProcesses.set(downloadId, proc);

    let stderr = '';
    let lastProgress = 0;

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      // Parse progress: [download]  45.2% of ...
      const m = text.match(/(\d+\.?\d*)%/);
      if (m) {
        const progress = Math.min(99, Math.round(parseFloat(m[1])));
        if (progress > lastProgress + 2) {
          lastProgress = progress;
          queries.updateDownloadStatus.run('downloading', progress, null, downloadId).catch(() => {});
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
        const primary = findPrimaryFile(dir);
        console.log(`[yt-dlp] #${downloadId} ✅ Done: ${primary ? path.basename(primary) : 'file(s) downloaded'}`);

        try {
          const filepath = primary || dir;
          const filename = primary ? path.basename(primary) : title;
          const filesize = primary ? fs.statSync(primary).size : 0;

          await ctx.db.query(
            `UPDATE downloads SET status=$1, progress=$2, filepath=$3, filename=$4, filesize=$5,
             updated_at=CURRENT_TIMESTAMP, finished_at=CURRENT_TIMESTAMP WHERE id=$6`,
            ['completed', 100, filepath, filename, filesize, downloadId]
          );
        } catch (e) {
          console.error(`[yt-dlp] #${downloadId} DB update error:`, e.message);
        }
      } else {
        const errMsg = stderr.slice(0, 500) || `Exit code ${code}`;
        console.error(`[yt-dlp] #${downloadId} ❌ Failed: ${errMsg.slice(0, 100)}`);
        try {
          await queries.updateDownloadStatus.run('error', 0, errMsg, downloadId);
        } catch (e) {}
      }

      if (ctx.services.queue) ctx.services.queue.onJobFinished(downloadId);
      resolve();
    });

    proc.on('error', async (err) => {
      console.error(`[yt-dlp] #${downloadId} Spawn error:`, err.message);
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
