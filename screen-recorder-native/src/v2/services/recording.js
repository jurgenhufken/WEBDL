'use strict';
/**
 * Service: Recording — Pijler: Ingest
 * 
 * Screen recording via ffmpeg + AVFoundation (macOS).
 * Multi-stream: elke tab/URL krijgt een eigen opname.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { sanitizeName, getDownloadDir } = require('../utils/paths');

function initRecording(ctx) {
  const { config, state } = ctx;
  const FFMPEG = config.FFMPEG || '/opt/homebrew/bin/ffmpeg';
  const VIDEO_DEVICE = config.VIDEO_DEVICE || '1';
  const AUDIO_DEVICE = config.AUDIO_DEVICE || 'none';
  const VIDEO_CODEC = config.VIDEO_CODEC || 'h264_videotoolbox';

  /**
   * Start een opname
   */
  async function start(recId, metadata) {
    if (state.activeRecordings.has(recId)) {
      return { success: false, error: 'Al bezig met opnemen', needsForce: true };
    }

    const platform = metadata.platform || 'other';
    const channel = metadata.channel || 'unknown';
    const title = metadata.title || 'untitled';
    const dir = getDownloadDir(config.BASE_DIR, platform, channel);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = sanitizeName(`${platform}__${channel}__${title}`).slice(0, 100);
    const filename = `recording_${baseName}_${timestamp}.mp4`;
    const filepath = path.join(dir, filename);

    // ffmpeg args voor AVFoundation
    const wantsAudio = AUDIO_DEVICE !== 'none';
    const inputDevice = wantsAudio
      ? `${VIDEO_DEVICE}:${AUDIO_DEVICE}`
      : `${VIDEO_DEVICE}`;

    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'avfoundation',
      '-framerate', '30',
      '-i', inputDevice,
      '-c:v', VIDEO_CODEC,
      '-b:v', '8000k',
    ];

    if (wantsAudio) {
      args.push('-c:a', 'aac', '-b:a', '192k');
    }

    args.push('-y', filepath);

    console.log(`🔴 [recording] #${recId} Starting: ${filepath}`);

    const proc = spawn(FFMPEG, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    state.activeRecordings.set(recId, {
      process: proc,
      filepath,
      filename,
      metadata,
      startedAt: Date.now(),
    });

    proc.on('close', (code) => {
      console.log(`⬛ [recording] #${recId} Stopped (code ${code})`);
      state.activeRecordings.delete(recId);

      // Index in DB
      if (code === 0 && fs.existsSync(filepath)) {
        indexRecording(recId, filepath, metadata).catch(() => {});
      }
    });

    proc.on('error', (err) => {
      console.error(`[recording] #${recId} Error:`, err.message);
      state.activeRecordings.delete(recId);
    });

    return {
      success: true,
      action: 'start-recording',
      file: filename,
      dir,
      recId,
    };
  }

  /**
   * Stop een opname
   */
  function stop(recId) {
    // Zoek de session
    let session = null;
    let activeRecId = null;

    if (recId && state.activeRecordings.has(recId)) {
      session = state.activeRecordings.get(recId);
      activeRecId = recId;
    } else if (state.activeRecordings.size > 0) {
      // Fallback: eerste actieve opname
      activeRecId = state.activeRecordings.keys().next().value;
      session = state.activeRecordings.get(activeRecId);
    }

    if (!session) {
      return { success: false, error: 'Geen actieve opname' };
    }

    const proc = session.process;
    const filepath = session.filepath;

    // Stuur 'q' naar ffmpeg stdin voor nette afsluiting
    try { proc.stdin.write('q'); } catch (e) {}
    setTimeout(() => {
      try { proc.kill('SIGINT'); } catch (e) {}
    }, 3000);
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (e) {}
    }, 8000);

    state.activeRecordings.delete(activeRecId);

    return {
      success: true,
      action: 'stop-recording',
      file: filepath,
      recId: activeRecId,
    };
  }

  /**
   * Indexeer een opname in de database
   */
  async function indexRecording(recId, filepath, metadata) {
    try {
      const filesize = fs.statSync(filepath).size;
      const filename = path.basename(filepath);
      const platform = metadata.platform || 'recording';
      const channel = metadata.channel || 'unknown';
      const title = metadata.title || filename;

      await ctx.db.query(
        `INSERT INTO screenshots (filepath, filename, filesize, platform, channel, title, source_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [filepath, filename, filesize, platform, channel, title, metadata.url || '']
      );

      // Schedule thumb
      if (ctx.services.thumbs) ctx.services.thumbs.schedule(filepath);
    } catch (e) {
      console.error(`[recording] Index error:`, e.message);
    }
  }

  /**
   * Lijst actieve opnames
   */
  function listActive() {
    const list = [];
    for (const [id, session] of state.activeRecordings) {
      list.push({
        recId: id,
        filepath: session.filepath,
        startedAt: session.startedAt,
        duration: Math.round((Date.now() - session.startedAt) / 1000),
        metadata: session.metadata,
      });
    }
    return list;
  }

  return { start, stop, listActive };
}

module.exports = { initRecording };
