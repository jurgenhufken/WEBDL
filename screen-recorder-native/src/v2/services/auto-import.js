'use strict';
/**
 * Service: Auto Import — Pijler: Ingest/Bibliotheek
 * 
 * Scant bekende mappen op nieuwe bestanden en indexeert ze.
 * Start pas na een delay (30s) zodat de server snel opstart.
 * 
 * Blauwdruk: "de app is een gast" — scan alleen op bekende plekken,
 * niet de hele disk. Throttle I/O.
 */
const fs = require('fs');
const path = require('path');

const SCAN_INTERVAL_MS = 5 * 60 * 1000;  // Elke 5 minuten
const STARTUP_DELAY_MS = 30 * 1000;       // 30s na startup
const BATCH_SIZE = 50;                     // Max bestanden per scan-ronde

function initAutoImport(ctx) {
  const { config, state, db } = ctx;
  const BASE_DIR = config.BASE_DIR;
  let timer = null;

  /**
   * Start de scanner na een delay
   */
  function start() {
    console.log(`[auto-import] Will start scanning in ${STARTUP_DELAY_MS / 1000}s`);
    setTimeout(() => {
      if (state.isShuttingDown) return;
      scan();
      timer = setInterval(() => {
        if (!state.isShuttingDown) scan();
      }, SCAN_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
  }

  /**
   * Scan BASE_DIR voor nieuwe mediabestanden
   */
  async function scan() {
    if (state.isShuttingDown) return;

    const MEDIA_EXTS = new Set([
      '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.ts',
      '.jpg', '.jpeg', '.png', '.gif', '.webp',
    ]);

    let indexed = 0;
    try {
      // Scan platform directories
      const platforms = fs.readdirSync(BASE_DIR).filter(name => {
        try { return fs.statSync(path.join(BASE_DIR, name)).isDirectory(); } catch (e) { return false; }
      });

      for (const platform of platforms) {
        if (state.isShuttingDown || indexed >= BATCH_SIZE) break;
        const platformDir = path.join(BASE_DIR, platform);

        const channels = fs.readdirSync(platformDir).filter(name => {
          try { return fs.statSync(path.join(platformDir, name)).isDirectory(); } catch (e) { return false; }
        });

        for (const channel of channels) {
          if (state.isShuttingDown || indexed >= BATCH_SIZE) break;
          const channelDir = path.join(platformDir, channel);

          let files;
          try { files = fs.readdirSync(channelDir); } catch (e) { continue; }

          for (const file of files) {
            if (indexed >= BATCH_SIZE) break;
            const ext = path.extname(file).toLowerCase();
            if (!MEDIA_EXTS.has(ext)) continue;

            const filepath = path.join(channelDir, file);

            // Check of dit bestand al in download_files staat
            try {
              const { rows } = await db.query(
                `SELECT 1 FROM download_files WHERE file_abs = $1 LIMIT 1`,
                [filepath]
              );
              if (rows.length > 0) continue; // Al geïndexeerd

              // Schedule thumb generation
              if (ctx.services.thumbs) {
                ctx.services.thumbs.schedule(filepath);
              }

              indexed++;
            } catch (e) {
              // download_files table might not exist, skip
              continue;
            }
          }
        }
      }

      if (indexed > 0) {
        console.log(`[auto-import] Scheduled ${indexed} thumbnails`);
      }
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error(`[auto-import] Scan error:`, e.message);
      }
    }
  }

  function stop() {
    if (timer) clearInterval(timer);
  }

  return { start, stop, scan };
}

module.exports = { initAutoImport };
