// @ts-check
// webdl-core/jobs/scheduler.js
//
// In-memory job scheduler. Eerste implementatie — DB-persistentie komt later.
// Scope: scheduler ontvangt {intent, url}, vraagt Source.inspect(url),
// dispatcht items naar bestaande /download endpoint (achter zelfde poort).
//
// Voor whole-thread intent: scheduler walkt paginationUrls op achtergrond,
// per pagina: inspect → POST items naar download-queue. User polt voortgang
// via GET /api/jobs/:id (counts updated live).

/** @typedef {import('../sources/source').Source} Source */
/** @typedef {import('../sources/source').Item} Item */
/** @typedef {import('../sources/source').InspectResult} InspectResult */

/**
 * @typedef {'queued' | 'running' | 'done' | 'error'} JobStatus
 * @typedef {'single' | 'page' | 'whole-thread' | 'forum-scan'} JobIntent
 */

/**
 * @typedef {Object} Job
 * @property {number} id
 * @property {JobIntent} intent
 * @property {string} sourceId
 * @property {string} sourceUrl
 * @property {number | null} parentJobId
 * @property {JobStatus} status
 * @property {number} itemsTotal       Items gevonden door Source.inspect
 * @property {number} itemsDispatched  POST naar /download succesvol
 * @property {number} itemsError       POST naar /download faalde
 * @property {string} channel
 * @property {string} title
 * @property {string} createdAt        ISO
 * @property {string} updatedAt        ISO
 * @property {number} pagesScanned     Voor whole-thread: hoeveel pages al verwerkt
 * @property {number} pagesTotal       Voor whole-thread: paginationUrls.length
 * @property {string} [error]
 * @property {Array<{ts: string, msg: string}>} log  Laatste 20 events
 */

let nextId = 1;
/** @type {Map<number, Job>} */
const jobs = new Map();

/**
 * @param {Job} job
 * @param {string} msg
 */
function jobLog(job, msg) {
  job.log.push({ ts: new Date().toISOString(), msg });
  if (job.log.length > 50) job.log.splice(0, job.log.length - 50);
  job.updatedAt = new Date().toISOString();
}

/**
 * @param {{ intent: JobIntent, url: string, source: Source, parentJobId?: number }} args
 * @returns {Job}
 */
function createJob({ intent, url, source, parentJobId = undefined }) {
  const now = new Date().toISOString();
  /** @type {Job} */
  const job = {
    id: nextId++,
    intent,
    sourceId: source.id,
    sourceUrl: url,
    parentJobId: parentJobId == null ? null : parentJobId,
    status: 'queued',
    itemsTotal: 0,
    itemsDispatched: 0,
    itemsError: 0,
    channel: source.deriveChannel(url),
    title: '',
    createdAt: now,
    updatedAt: now,
    pagesScanned: 0,
    pagesTotal: 0,
    log: [{ ts: now, msg: `created ${intent} for ${url}` }],
  };
  jobs.set(job.id, job);
  return job;
}

/**
 * Submit een item naar de bestaande /download endpoint.
 * @param {Item} item
 * @param {string} channel
 * @param {string} platform
 * @param {string} downloadEndpoint  bv. 'http://127.0.0.1:35729/download'
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function dispatchItem(item, channel, platform, downloadEndpoint) {
  try {
    const resp = await fetch(downloadEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: item.url,
        platform,
        channel,
        title: item.title || '',
      }),
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const data = await resp.json().catch(() => ({}));
    if (data && data.success === false) return { ok: false, error: data.error || 'unknown' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * Verwerk een 'single' of 'page' job: Source.inspect(url) → dispatch items.
 * @param {Job} job
 * @param {Source} source
 * @param {string} downloadEndpoint
 */
async function runSingleOrPage(job, source, downloadEndpoint) {
  job.status = 'running';
  jobLog(job, `inspect start`);
  let result;
  try {
    result = await source.inspect(job.sourceUrl, { timeoutMs: 25000 });
  } catch (e) {
    job.status = 'error';
    job.error = String((e && e.message) || e);
    jobLog(job, `inspect FAIL: ${job.error}`);
    return;
  }
  job.title = result.title || '';
  job.channel = result.channel || job.channel;
  job.itemsTotal = result.items.length;
  job.pagesScanned = 1;
  job.pagesTotal = 1;
  jobLog(job, `inspect ok: ${result.items.length} items`);

  if (result.items.length === 0) {
    job.status = 'done';
    jobLog(job, `done (no items)`);
    return;
  }

  for (let i = 0; i < result.items.length; i++) {
    const item = result.items[i];
    const res = await dispatchItem(item, job.channel, source.id, downloadEndpoint);
    if (res.ok) job.itemsDispatched++;
    else { job.itemsError++; jobLog(job, `dispatch FAIL ${item.url.slice(0, 80)}: ${res.error}`); }
    job.updatedAt = new Date().toISOString();
  }
  job.status = 'done';
  jobLog(job, `done: ${job.itemsDispatched} ok, ${job.itemsError} fail`);
}

/**
 * Verwerk 'whole-thread': walk alle paginationUrls, per page → inspect + dispatch.
 * Progress wordt continu bijgewerkt zodat polling live status toont.
 * @param {Job} job
 * @param {Source} source
 * @param {string} downloadEndpoint
 */
async function runWholeThread(job, source, downloadEndpoint) {
  job.status = 'running';
  jobLog(job, `whole-thread scan start`);

  // Eerst page 1 inspect — daar zit paginationUrls in
  let first;
  try {
    first = await source.inspect(job.sourceUrl, { timeoutMs: 25000 });
  } catch (e) {
    job.status = 'error';
    job.error = String((e && e.message) || e);
    jobLog(job, `inspect page 1 FAIL: ${job.error}`);
    return;
  }
  job.title = first.title || '';
  job.channel = first.channel || job.channel;
  const allPages = (first.paginationUrls && first.paginationUrls.length) ? first.paginationUrls : [job.sourceUrl];
  job.pagesTotal = allPages.length;
  jobLog(job, `pages discovered: ${job.pagesTotal}, items page 1: ${first.items.length}`);

  // Dispatch page-1 items meteen
  job.itemsTotal += first.items.length;
  for (const item of first.items) {
    const res = await dispatchItem(item, job.channel, source.id, downloadEndpoint);
    if (res.ok) job.itemsDispatched++;
    else { job.itemsError++; jobLog(job, `dispatch FAIL: ${res.error}`); }
    job.updatedAt = new Date().toISOString();
  }
  job.pagesScanned = 1;

  // Walk pages 2..N
  for (let i = 1; i < allPages.length; i++) {
    const pageUrl = allPages[i];
    let pageResult;
    try {
      pageResult = await source.inspect(pageUrl, { timeoutMs: 20000 });
    } catch (e) {
      jobLog(job, `page ${i + 1} inspect FAIL: ${String((e && e.message) || e)}`);
      continue;
    }
    job.itemsTotal += pageResult.items.length;
    for (const item of pageResult.items) {
      const res = await dispatchItem(item, job.channel, source.id, downloadEndpoint);
      if (res.ok) job.itemsDispatched++;
      else { job.itemsError++; }
      job.updatedAt = new Date().toISOString();
    }
    job.pagesScanned = i + 1;
    jobLog(job, `page ${i + 1}/${allPages.length}: +${pageResult.items.length} items`);
    // Rate-limit: niet hammeren
    if (source.features.rateLimitPerMin && source.features.rateLimitPerMin > 0) {
      const sleepMs = Math.ceil(60000 / source.features.rateLimitPerMin);
      await new Promise((r) => setTimeout(r, sleepMs));
    }
  }

  job.status = 'done';
  jobLog(job, `whole-thread done: ${job.pagesScanned}p, ${job.itemsDispatched} ok, ${job.itemsError} fail`);
}

/**
 * Start een job. Returnt direct (job draait async op achtergrond).
 * @param {{ intent: JobIntent, url: string, source: Source, downloadEndpoint?: string }} args
 * @returns {Job}
 */
function start({ intent, url, source, downloadEndpoint = 'http://127.0.0.1:35729/download' }) {
  const job = createJob({ intent, url, source });
  setImmediate(async () => {
    try {
      if (intent === 'whole-thread') {
        await runWholeThread(job, source, downloadEndpoint);
      } else {
        await runSingleOrPage(job, source, downloadEndpoint);
      }
    } catch (e) {
      job.status = 'error';
      job.error = String((e && e.message) || e);
      jobLog(job, `RUNNER CRASH: ${job.error}`);
    }
  });
  return job;
}

/**
 * @param {number} id
 * @returns {Job | null}
 */
function get(id) {
  return jobs.get(id) || null;
}

/**
 * @returns {Job[]}  Alle jobs gesorteerd nieuwste eerst
 */
function listRecent(limit = 50) {
  return Array.from(jobs.values()).sort((a, b) => b.id - a.id).slice(0, limit);
}

module.exports = { start, get, listRecent, /** @internal */ _jobs: jobs };
