'use strict';
/**
 * Service: Download Queue — Pijler: Ingest
 * 
 * Beheert de download wachtrij:
 * - Accepteert nieuwe jobs
 * - Controleert concurrency per lane
 * - Start downloads via de dispatcher
 * - Handelt cancellation af
 * 
 * Ontvangt ctx, geen globals.
 */

// Lane concurrency limiten
const LANE_LIMITS = {
  heavy: 3,       // yt-dlp, gallery-dl, ofscraper
  light: 5,       // direct file downloads
  recording: 2,   // screen recordings
};

// Welke platforms zijn "heavy"?
const HEAVY_PLATFORMS = new Set([
  'youtube', 'vimeo', 'twitch', 'twitter', 'reddit',
  'instagram', 'tiktok', 'onlyfans', 'patreon', 'telegram',
  'pornhub', 'xvideos', 'xhamster', 'wikifeet', 'wikifeetx',
  'kinky', 'footfetishforum', 'aznudefeet',
]);

function initQueue(ctx) {
  const { state, queries } = ctx;

  function determineLane(platform) {
    return HEAVY_PLATFORMS.has(platform) ? 'heavy' : 'light';
  }

  function countActiveInLane(lane) {
    let count = 0;
    for (const [, platform] of state.jobPlatform) {
      if (determineLane(platform) === lane) count++;
    }
    return count;
  }

  // Voeg een job toe aan de queue
  function enqueue(downloadId, url, platform, channel, title, metadata) {
    state.queuedJobs.push({ downloadId, url, platform, channel, title, metadata });
    state.jobPlatform.set(downloadId, platform);
    state.jobLane.set(downloadId, determineLane(platform));
    scheduleNext();
  }

  // Probeer de volgende job te starten
  function scheduleNext() {
    if (state.isShuttingDown) return;
    if (state.queuedJobs.length === 0) return;

    // Vind een job die gestart kan worden
    for (let i = 0; i < state.queuedJobs.length; i++) {
      const job = state.queuedJobs[i];
      if (state.cancelledJobs.has(job.downloadId)) {
        state.queuedJobs.splice(i, 1);
        i--;
        continue;
      }
      if (state.startingJobs.has(job.downloadId)) continue;

      const lane = determineLane(job.platform);
      const active = countActiveInLane(lane);
      const limit = LANE_LIMITS[lane] || 3;

      if (active < limit) {
        state.queuedJobs.splice(i, 1);
        startJob(job);
        // Schedule opnieuw voor de volgende
        if (state.queuedJobs.length > 0) {
          clearTimeout(state.schedulerTimer);
          state.schedulerTimer = setTimeout(scheduleNext, 100);
        }
        return;
      }
    }
  }

  async function startJob(job) {
    const { downloadId, url, platform, channel, title, metadata } = job;
    state.startingJobs.add(downloadId);

    try {
      await queries.updateDownloadStatus.run('downloading', 0, null, downloadId);

      // Dispatch naar de juiste downloader (wordt later uitgebreid)
      const dispatcher = ctx.services.dispatcher;
      if (dispatcher) {
        await dispatcher.dispatch(downloadId, url, platform, channel, title, metadata);
      } else {
        console.log(`[queue] No dispatcher available, would download: ${url}`);
        await queries.updateDownloadStatus.run('error', 0, 'No dispatcher configured', downloadId);
      }
    } catch (e) {
      console.error(`[queue] Error starting job ${downloadId}:`, e.message);
      try {
        await queries.updateDownloadStatus.run('error', 0, e.message, downloadId);
      } catch (e2) {}
    } finally {
      state.startingJobs.delete(downloadId);
    }
  }

  // Cancel een download
  async function cancel(downloadId) {
    state.cancelledJobs.add(downloadId);

    // Kill actief proces
    const proc = state.activeProcesses.get(downloadId);
    if (proc) {
      try { proc.kill('SIGTERM'); } catch (e) {}
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) {} }, 3000);
      state.activeProcesses.delete(downloadId);
    }

    // Update DB
    try {
      await queries.updateDownloadStatus.run('cancelled', 0, null, downloadId);
    } catch (e) {}
  }

  // Cleanup finished job state
  function onJobFinished(downloadId) {
    state.activeProcesses.delete(downloadId);
    state.jobPlatform.delete(downloadId);
    state.jobLane.delete(downloadId);
    state.startingJobs.delete(downloadId);
    // Probeer de volgende te starten
    scheduleNext();
  }

  return {
    enqueue,
    cancel,
    onJobFinished,
    scheduleNext,
    determineLane,
    countActiveInLane,
    LANE_LIMITS,
  };
}

module.exports = { initQueue };
