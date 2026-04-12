'use strict';
/**
 * Service: Thumb Generator — Pijler: Bibliotheek
 * 
 * Genereert thumbnails voor video's via ffmpeg.
 * Thumbnails worden naast het bronbestand opgeslagen (.jpg).
 * 
 * De blauwdruk zegt: thumbnail = cache, niet waarheid.
 * Kan altijd opnieuw gegenereerd worden.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const MAX_CONCURRENT = 2;
const THUMB_WIDTH = 320;
const THUMB_SEEK = '00:00:03';

function initThumbGenerator(ctx) {
  const { config, state } = ctx;
  const FFMPEG = config.FFMPEG || '/opt/homebrew/bin/ffmpeg';

  /**
   * Voeg een bestand toe aan de thumb-queue
   */
  function schedule(filepath) {
    if (!filepath) return;
    const ext = path.extname(filepath).toLowerCase();
    if (!['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.ts'].includes(ext)) return;

    const thumbPath = filepath.replace(/\.[^.]+$/, '.jpg');
    if (fs.existsSync(thumbPath)) return; // Al aanwezig

    // Voorkom duplicaten in de queue
    if (state.thumbGenQueue.some(item => item.src === filepath)) return;

    state.thumbGenQueue.push({ src: filepath, dest: thumbPath });
    processNext();
  }

  /**
   * Verwerk de volgende item in de queue
   */
  function processNext() {
    if (state.isShuttingDown) return;
    if (state.thumbGenActive >= MAX_CONCURRENT) return;
    if (state.thumbGenQueue.length === 0) return;

    const item = state.thumbGenQueue.shift();
    state.thumbGenActive++;

    generateThumb(item.src, item.dest)
      .then(() => {
        state.thumbGenActive--;
        processNext();
      })
      .catch(() => {
        state.thumbGenActive--;
        processNext();
      });
  }

  /**
   * Genereer een thumbnail met ffmpeg
   */
  function generateThumb(src, dest) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(src)) return reject(new Error('Source not found'));

      const tmpDest = dest + '.tmp.jpg';
      const args = [
        '-hide_banner', '-loglevel', 'error',
        '-ss', THUMB_SEEK,
        '-i', src,
        '-vframes', '1',
        '-vf', `scale=${THUMB_WIDTH}:-2`,
        '-q:v', '4',
        '-y', tmpDest,
      ];

      const proc = spawn(FFMPEG, args, { stdio: 'ignore' });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(tmpDest)) {
          try {
            fs.renameSync(tmpDest, dest);
            resolve();
          } catch (e) {
            reject(e);
          }
        } else {
          try { fs.unlinkSync(tmpDest); } catch (e) {}
          // Retry at 00:00:00 if seeking failed
          if (THUMB_SEEK !== '00:00:00') {
            const retryArgs = [...args];
            retryArgs[retryArgs.indexOf(THUMB_SEEK)] = '00:00:00';
            const retry = spawn(FFMPEG, retryArgs, { stdio: 'ignore' });
            retry.on('close', (code2) => {
              if (code2 === 0 && fs.existsSync(tmpDest)) {
                try { fs.renameSync(tmpDest, dest); resolve(); } catch (e) { reject(e); }
              } else {
                try { fs.unlinkSync(tmpDest); } catch (e) {}
                reject(new Error(`ffmpeg exit ${code2}`));
              }
            });
            retry.on('error', reject);
          } else {
            reject(new Error(`ffmpeg exit ${code}`));
          }
        }
      });

      proc.on('error', reject);
    });
  }

  return {
    schedule,
    processNext,
    generateThumb,
    get queueLength() { return state.thumbGenQueue.length; },
    get activeCount() { return state.thumbGenActive; },
  };
}

module.exports = { initThumbGenerator };
