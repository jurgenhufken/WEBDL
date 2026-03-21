const fs = require('fs');
const path = '/Users/jurgen/WEBDL/screen-recorder-native/src/simple-server.js.pg.refactored';

const missingCode = `      return n;
    } catch (e) { return 0; }
  };

  const canStartYoutubeNow = () => {
    const active = countRuntimePlatform('youtube');
    if (active >= youtubeLimit) return false;
    const now = Date.now();
    if (lastYoutubeStartMs && now < lastYoutubeStartMs) return false;
    return true;
  };

  const markYoutubeStarted = () => {
    const base = youtubeSpacingMs;
    const jitter = youtubeJitterMs > 0 ? Math.floor(Math.random() * (youtubeJitterMs + 1)) : 0;
    lastYoutubeStartMs = Date.now() + base + jitter;
  };

  const shiftNextEligible = (queue, lane) => {
    const n = queue.length;
    for (let i = 0; i < n; i++) {
      const id = queue.shift();
      const job = queuedJobs.get(id);
      if (!job) continue;
      const plat = String(job.platform || '').toLowerCase();
      if ((plat === 'youtube' || plat === 'youtube-shorts') && !canStartYoutubeNow()) {
        queue.push(id);
        continue;
      }
      return { id, job };
    }
    return null;
  };

  let heavyActive = activeLaneCount('heavy');
  let lightActive = activeLaneCount('light');

  while (heavyActive < heavyLimit && queuedHeavy.length > 0) {
    const picked = shiftNextEligible(queuedHeavy, 'heavy');
    if (!picked) break;
    const { id, job } = picked;
    queuedJobs.delete(id);
    heavyActive++;
    startingJobs.add(id);
    try { jobPlatform.set(id, job.platform); } catch (e) {}
    if (String(job.platform || '').toLowerCase() === 'youtube') markYoutubeStarted();
    try {
      startDownload(job.downloadId, job.url, job.platform, job.channel, job.title, job.metadata)
      .catch(() => {}).finally(() => {
        startingJobs.delete(id);
        runDownloadSchedulerSoon();
      });
    } catch (e) {
      await updateDownloadStatus.run('error', 0, e.message, job.downloadId);
      jobLane.delete(job.downloadId);
      startingJobs.delete(id);
    }
  }

  while (lightActive < lightLimit && queuedLight.length > 0) {
    const picked = shiftNextEligible(queuedLight, 'light');
    if (!picked) break;
    const { id, job } = picked;
    queuedJobs.delete(id);
    lightActive++;
    startingJobs.add(id);
    try { jobPlatform.set(id, job.platform); } catch (e) {}
    if (String(job.platform || '').toLowerCase() === 'youtube') markYoutubeStarted();
    try {
      startDownload(job.downloadId, job.url, job.platform, job.channel, job.title, job.metadata)
      .catch(() => {}).finally(() => {
        startingJobs.delete(id);
        runDownloadSchedulerSoon();
      });
    } catch (e) {
      await updateDownloadStatus.run('error', 0, e.message, job.downloadId);
      jobLane.delete(job.downloadId);
      startingJobs.delete(id);
    }
  }
}

`;

try {
  let content = fs.readFileSync(path, 'utf8');
  
  // Identify the cut-off point.
  // It should be around where `countRuntimePlatform` loop ends.
  // The line `let metadataProbeTimer = null;` should be immediately after the cut.
  
  const target = 'let metadataProbeTimer = null;';
  const idx = content.indexOf(target);
  
  if (idx === -1) {
    console.error('Could not find target insertion point');
    process.exit(1);
  }
  
  // Insert missing code before the target
  const newContent = content.slice(0, idx) + missingCode + content.slice(idx);
  
  fs.writeFileSync(path, newContent, 'utf8');
  console.log('Successfully restored runDownloadScheduler.');

} catch (e) {
  console.error(e);
  process.exit(1);
}
