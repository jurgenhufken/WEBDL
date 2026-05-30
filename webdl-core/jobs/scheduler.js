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
 * BELANGRIJK: /download leest platform/channel uit `metadata.X`, niet top-level.
 * Plus: voor items van een forum-scan (zoals vipergirls/imagebam), MOET de
 * source-URL (thread-page) en pin-flags meegegeven worden, anders detectt
 * de server platform=imagebam en derived channel uit URL.
 *
 * @param {Item} item
 * @param {string} channel       Gallery-channel (bv. 'thread_5271987_...')
 * @param {string} platform      Source-platform (bv. 'vipergirls')
 * @param {string} sourceUrl     Parent page-URL (thread/forum-page)
 * @param {string} downloadEndpoint
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function dispatchItem(item, channel, platform, sourceUrl, downloadEndpoint) {
  try {
    const resp = await fetch(downloadEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: item.url,
        metadata: {
          // /download handler leest deze velden uit `metadata.X`:
          platform,
          channel,
          title: item.title || '',
          url: sourceUrl,                  // parent context — thread page
          // Pin-flags: server moet onze platform+channel respecteren,
          // niet detectPlatform(item.url) (zou imagebam returnen).
          webdl_pin_context: true,
          original_platform: platform,
          original_channel: channel,
          // Source-context wordt door pickSourceContextForUrl gebruikt:
          source_context: {
            url: sourceUrl,
            platform,
            channel,
            title: item.title || '',
          },
        },
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

  await dispatchItemsParallel(result.items, job.channel, source.id, job.sourceUrl, downloadEndpoint, job);
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
  if (job.cancelled) {
    job.status = 'cancelled';
    jobLog(job, `cancelled before page-1 dispatch`);
    return;
  }
  job.title = first.title || '';
  job.channel = first.channel || job.channel;
  const allPages = (first.paginationUrls && first.paginationUrls.length) ? first.paginationUrls : [job.sourceUrl];
  job.pagesTotal = allPages.length;
  // pagesScanned = "currently working on" zodat UI direct iets toont.
  // Het is meer 'pagesInProgress' dan 'pagesDone' — duidelijker voor user.
  job.pagesScanned = 1;
  jobLog(job, `pages discovered: ${job.pagesTotal}, items page 1: ${first.items.length}`);

  // Dispatch page-1 items in parallel chunks
  job.itemsTotal += first.items.length;
  await dispatchItemsParallel(first.items, job.channel, source.id, job.sourceUrl, downloadEndpoint, job);

  // 2026-05-30 (Jürgen): walk pages in REVERSE order (laatste page eerst).
  // Oudere threads hebben pages 1..N waarvan pages 1..oldMax al gescand zijn
  // bij vorige runs. Nieuwe content komt op de LAATSTE pages binnen. Door
  // reverse te walken vinden we nieuwe K2S URLs ASAP; oude duplicates komen
  // pas op het einde en worden door dedup-check geskipt.
  // Early-stop heuristic: als 3 opeenvolgende pages 100% duplicates leveren,
  // stop want we zijn in al-gescande oude pages beland.
  let consecutiveAllDup = 0;
  for (let i = allPages.length - 1; i >= 1; i--) {
    if (job.cancelled) {
      job.status = 'cancelled';
      jobLog(job, `cancelled at page ${i + 1}/${allPages.length}`);
      return;
    }
    job.pagesScanned = allPages.length - i + 1; // UI: hoeveel pages al gescand
    job.updatedAt = new Date().toISOString();
    const pageUrl = allPages[i];
    let pageResult;
    try {
      pageResult = await source.inspect(pageUrl, { timeoutMs: 20000 });
    } catch (e) {
      jobLog(job, `page ${i + 1} inspect FAIL: ${String((e && e.message) || e)}`);
      continue;
    }
    job.itemsTotal += pageResult.items.length;
    const before = job.itemsDispatched;
    // sourceUrl = job.sourceUrl (root thread, niet pageUrl) zodat alle items
    // van deze whole-thread scan in hetzelfde channel komen.
    await dispatchItemsParallel(pageResult.items, job.channel, source.id, job.sourceUrl, downloadEndpoint, job);
    const newlyDispatched = job.itemsDispatched - before;
    const allDup = pageResult.items.length > 0 && newlyDispatched === 0;
    consecutiveAllDup = allDup ? consecutiveAllDup + 1 : 0;
    jobLog(job, `page ${i + 1}/${allPages.length}: ${pageResult.items.length} items, ${newlyDispatched} new${allDup ? ' (all dup)' : ''}`);
    if (consecutiveAllDup >= 3) {
      jobLog(job, `early-stop: 3 opeenvolgende pages 100% duplicate (we zijn in oude gescande zone)`);
      break;
    }
    // Rate-limit: niet hammeren
    if (source.features.rateLimitPerMin && source.features.rateLimitPerMin > 0) {
      const sleepMs = Math.ceil(60000 / source.features.rateLimitPerMin);
      await new Promise((r) => setTimeout(r, sleepMs));
    }
  }

  job.status = 'done';
  jobLog(job, `whole-thread done: ${allPages.length}p gescand, ${job.itemsDispatched} ok, ${job.itemsError} fail`);
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

/**
 * Dispatch items in parallel chunks i.p.v. sequentieel — voorkomt dat
 * groot-thread scans (1000+ items/page) uren duren door per-item HTTP
 * latency naar /download. Bij localhost is dispatch latency ~50-200ms per
 * call (dedup-check + INSERT + enqueue). Concurrency 10 = ~10x speedup
 * zonder /download endpoint te overspoelen.
 * @param {Item[]} items
 * @param {string} channel
 * @param {string} platform
 * @param {string} sourceUrl
 * @param {string} downloadEndpoint
 * @param {Job} job
 * @param {number} [concurrency]
 */
async function dispatchItemsParallel(items, channel, platform, sourceUrl, downloadEndpoint, job, concurrency = 10) {
  for (let offset = 0; offset < items.length; offset += concurrency) {
    if (job && job.cancelled) return;
    const chunk = items.slice(offset, offset + concurrency);
    const results = await Promise.all(
      chunk.map((item) => dispatchItem(item, channel, platform, sourceUrl, downloadEndpoint))
    );
    for (let i = 0; i < results.length; i++) {
      if (results[i].ok) job.itemsDispatched++;
      else { job.itemsError++; }
    }
    job.updatedAt = new Date().toISOString();
  }
}

/**
 * Mark een job als cancelled. runWholeThread / runSingleOrPage / dispatchItemsParallel
 * checken job.cancelled bij elke iteratie en stoppen netjes.
 * @param {number} id
 * @returns {boolean} true als job bestond + cancelled is gemarkeerd
 */
function cancel(id) {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.status === 'done' || job.status === 'cancelled' || job.status === 'error') return false;
  job.cancelled = true;
  jobLog(job, `cancel requested`);
  return true;
}

module.exports = { start, get, listRecent, cancel, /** @internal */ _jobs: jobs };
