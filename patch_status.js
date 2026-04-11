const fs = require('fs');
let code = fs.readFileSync('/Users/jurgen/WEBDL/screen-recorder-native/src/simple-server.js', 'utf8');

// 1. rehydrateDownloadQueueWithMode
code = code.replace(
`      const metadata = parsedMeta;

      const lane = detectLane(platform, url);
      queuedJobs.set(id, { downloadId: id, url, platform, channel, title, metadata });`,
`      const metadata = parsedMeta;

      let initialProgress = 0;
      if (row.status === 'downloading' || row.status === 'postprocessing') {
        const dbProg = await getDatabaseProgress(id);
        if (dbProg != null) initialProgress = dbProg;
      }

      const lane = detectLane(platform, url);
      queuedJobs.set(id, { downloadId: id, url, platform, channel, title, metadata, progress: initialProgress });`
);

// 2. rehydrateDownloadQueue
code = code.replace(
`      const metadata = parsedMeta;

      const lane = detectLane(platform, url);
      queuedJobs.set(id, { downloadId: id, url, platform, channel, title, metadata });`,
`      const metadata = parsedMeta;

      let initialProgress = 0;
      if (row.status === 'downloading' || row.status === 'postprocessing') {
        const dbProg = await getDatabaseProgress(id);
        if (dbProg != null) initialProgress = dbProg;
      }

      const lane = detectLane(platform, url);
      queuedJobs.set(id, { downloadId: id, url, platform, channel, title, metadata, progress: initialProgress });`
);

// 3. runDownloadSchedulerSoon heavy
code = code.replace(
`    const { id, job } = picked;
    queuedJobs.delete(id);
    heavyActive++;
    startingJobs.add(id);
    try { jobPlatform.set(id, job.platform); } catch (e) {}
    if (String(job.platform || '').toLowerCase() === 'youtube') markYoutubeStarted();
    try {
      startDownload(job.downloadId, job.url, job.platform, job.channel, job.title, job.metadata)`,
`    const { id, job } = picked;
    queuedJobs.delete(id);
    heavyActive++;
    startingJobs.add(id);
    try { jobPlatform.set(id, job.platform); } catch (e) {}
    if (String(job.platform || '').toLowerCase() === 'youtube') markYoutubeStarted();
    
    // PUSH PROGRESS!
    const earlyThumb = job.metadata?.thumbnail || deriveEarlyThumbnail(job.url, job.platform);
    setDownloadActivityContext(id, { url: job.url, platform: job.platform, channel: job.channel, title: job.title, lane: 'heavy', thumbnail: earlyThumb, progress: job.progress || 0 });

    try {
      startDownload(job.downloadId, job.url, job.platform, job.channel, job.title, job.metadata)`
);

// 4. runDownloadSchedulerSoon light
code = code.replace(
`    const { id, job } = picked;
    queuedJobs.delete(id);
    lightActive++;
    startingJobs.add(id);
    try { jobPlatform.set(id, job.platform); } catch (e) {}
    if (String(job.platform || '').toLowerCase() === 'youtube') markYoutubeStarted();
    try {
      startDownload(job.downloadId, job.url, job.platform, job.channel, job.title, job.metadata)`,
`    const { id, job } = picked;
    queuedJobs.delete(id);
    lightActive++;
    startingJobs.add(id);
    try { jobPlatform.set(id, job.platform); } catch (e) {}
    if (String(job.platform || '').toLowerCase() === 'youtube') markYoutubeStarted();
    
    // PUSH PROGRESS!
    const earlyThumb = job.metadata?.thumbnail || deriveEarlyThumbnail(job.url, job.platform);
    setDownloadActivityContext(id, { url: job.url, platform: job.platform, channel: job.channel, title: job.title, lane: 'light', thumbnail: earlyThumb, progress: job.progress || 0 });

    try {
      startDownload(job.downloadId, job.url, job.platform, job.channel, job.title, job.metadata)`
);

// 5. completedDownloads query
code = code.replace(
`    dbInProgressCount = ip && Number.isFinite(Number(ip.n)) ? Number(ip.n) : 0;
  } catch (e) {
    dbStatusError = (e && e.message) ? e.message : String(e);
  }`,
`    dbInProgressCount = ip && Number.isFinite(Number(ip.n)) ? Number(ip.n) : 0;
    
    const cp = await db.prepare("SELECT COUNT(*) as c FROM downloads WHERE status = 'completed' AND url NOT LIKE 'recording:%'").get();
    dbCompletedCount = cp && Number.isFinite(Number(cp.c)) ? Number(cp.c) : 0;
  } catch (e) {
    dbStatusError = (e && e.message) ? e.message : String(e);
  }`
);

// 6. completedDownloads initialize 
code = code.replace(
`  let dbInProgressCount = null;
  let dbStatusError = null;`,
`  let dbInProgressCount = null;
  let dbStatusError = null;
  let dbCompletedCount = 0;`
);

// 7. completedDownloads return value
code = code.replace(
`    queuedDownloads: dbQueuedCount,
    pendingDownloads: dbPendingCount,
    inProgressDownloads: dbInProgressCount,
    completedDownloads: 0,
    videoDevice: VIDEO_DEVICE,`,
`    queuedDownloads: dbQueuedCount,
    pendingDownloads: dbPendingCount,
    inProgressDownloads: dbInProgressCount,
    completedDownloads: dbCompletedCount,
    videoDevice: VIDEO_DEVICE,`
);

fs.writeFileSync('/Users/jurgen/WEBDL/screen-recorder-native/src/simple-server.js', code);
console.log("Patched server");
