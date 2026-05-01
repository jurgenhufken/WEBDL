// src/queue/slave-poller.js
// Achtergrond-poller die slave-delegated downloads volgt en hun status
// terugkoppelt naar de bijbehorende hub-job. Bij voltooiing:
//  1. importeert file(s) uit public.downloads naar webdl.files
//  2. genereert thumbnail via hub pipeline (als die nog ontbreekt)
//  3. markeert hub-job als 'done'
'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const FFMPEG = process.env.WEBDL_FFMPEG || '/opt/homebrew/bin/ffmpeg';
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi', '.flv', '.ts']);

function generateThumbnail(videoPath) {
  return new Promise((resolve) => {
    const ext = path.extname(videoPath).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) return resolve(null);
    const dir = path.dirname(videoPath);
    const base = path.basename(videoPath, path.extname(videoPath));
    const thumbPath = path.join(dir, `${base}_thumb.jpg`);
    if (fsSync.existsSync(thumbPath)) return resolve(thumbPath);
    execFile(
      FFMPEG,
      ['-y', '-i', videoPath, '-ss', '00:00:02', '-vframes', '1', '-vf', 'scale=320:-1', '-q:v', '6', thumbPath],
      { timeout: 30_000 },
      (err) => resolve(err || !fsSync.existsSync(thumbPath) ? null : thumbPath),
    );
  });
}

function startSlavePoller({ repo, logger, intervalMs = 5000 }) {
  let stopping = false;

  async function processOne(row) {
    const hubJobId = Number(row.hub_job_id);
    if (!Number.isFinite(hubJobId) || hubJobId <= 0) return;

    const hubJob = await repo.getJob(hubJobId);
    if (!hubJob || hubJob.status === 'done' || hubJob.status === 'failed' || hubJob.status === 'cancelled') {
      return; // al afgehandeld of niet meer bestaand
    }

    // Slave error? Markeer hub-job failed.
    if (row.slave_status === 'error') {
      await repo.failJob(hubJobId, row.slave_error || 'slave download failed', { retry: false });
      await repo.appendLog(hubJobId, 'error', `❌ slave error: ${row.slave_error || 'unknown'}`);
      logger.info('slave.failed', { hubJob: hubJobId, downloadId: row.id });
      return;
    }

    // Slave voltooid? Importeer file + thumb + mark done.
    if (row.slave_status === 'completed') {
      if (!row.filepath) {
        await repo.failJob(hubJobId, 'slave download completed without a file path', { retry: false });
        await repo.appendLog(hubJobId, 'error', '❌ slave klaar gemeld, maar zonder bestandspad');
        logger.warn('slave.completed_without_file', { hubJob: hubJobId, downloadId: row.id });
        return;
      }
      try {
        // Bestands-metadata uit filesystem
        let size = null;
        try { const st = await fs.stat(row.filepath); size = st.size; } catch (_) {}

        // File toevoegen aan webdl.files
        await repo.addFile(hubJobId, { path: row.filepath, size, mime: null, checksum: null });

        // Thumb genereren via hub pipeline (als het een video is en nog geen thumb heeft)
        const ext = path.extname(row.filepath).toLowerCase();
        let thumbGenerated = false;
        if (VIDEO_EXTS.has(ext)) {
          const thumb = await generateThumbnail(row.filepath);
          if (thumb) thumbGenerated = true;
        }

        await repo.appendLog(
          hubJobId,
          'info',
          `✅ slave klaar: ${path.basename(row.filepath)} (${size ? Math.round(size / 1024) + ' KB' : '?'}${thumbGenerated ? ', thumb gegenereerd' : ''})`,
        );
        await repo.completeJob(hubJobId);
        logger.info('slave.done', { hubJob: hubJobId, downloadId: row.id, filepath: row.filepath });
      } catch (e) {
        logger.warn('slave.handoff.error', { hubJob: hubJobId, err: String(e.message || e) });
      }
    }
  }

  async function tick() {
    try {
      // Vind hub-jobs in status='running' met slave-delegate adapter die een
      // simple_server_download_id hebben en waarvan de downloads rij klaar
      // of mislukt is.
      const { rows } = await repo.pool.query(
        `SELECT
           (j.options->>'simple_server_download_id')::bigint AS download_id,
           j.id AS hub_job_id,
           d.status    AS slave_status,
           d.filepath  AS filepath,
           d.error     AS slave_error,
           d.id        AS id
         FROM ${repo.schema}.jobs j
         JOIN downloads d
           ON d.id = (j.options->>'simple_server_download_id')::bigint
         WHERE j.status = 'running'
           AND j.adapter = 'slave-delegate'
           AND d.status IN ('completed','error','cancelled')
         LIMIT 50`,
      );
      for (const row of rows) {
        if (stopping) break;
        await processOne(row);
      }
    } catch (e) {
      logger.warn('slave.poller.error', { err: String(e.message || e) });
    }
  }

  async function loop() {
    while (!stopping) {
      await tick();
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  const loopPromise = loop();
  return { stop: async () => { stopping = true; await loopPromise; } };
}

module.exports = { startSlavePoller };
