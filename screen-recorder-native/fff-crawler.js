#!/usr/bin/env node
/**
 * FFF Giga Crawler — Progressive Playwright-based
 * Crawls forum pages and immediately processes threads as they're found.
 * No waiting for full index — downloads start within seconds.
 */
const { firefox } = require('playwright');
const http = require('http');

const FORUM_URL = process.argv[2] || 'https://footfetishforum.com/forums/initiation-archive.35/';
const SERVER = 'http://localhost:35729';
const BATCH_SIZE = 50;
const PAGE_DELAY = 1500;
const THREAD_DELAY = 800;

let stats = { forumPages: 0, threads: 0, threadPages: 0, urls: 0, queued: 0, duplicates: 0, errors: 0 };
const processedThreads = new Set();

function postJson(endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(`${SERVER}/${endpoint}`);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { resolve({ raw: buf }); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function queueBatch(urls, meta) {
  if (!urls.length) return;
  for (const url of urls) {
    try {
      const res = await postJson('download', { url, metadata: meta });
      if (res.duplicate || res.bumped) stats.duplicates++;
      else if (res.success) stats.queued++;
      else stats.errors++;
    } catch (e) {
      stats.errors++;
    }
  }
}

async function extractImageUrls(page) {
  return page.evaluate(() => {
    const urls = new Set();
    document.querySelectorAll('a[href]').forEach(a => {
      const h = a.href || '';
      if (/upload\.footfetishforum\.com\/image\//i.test(h)) urls.add(h);
      if (/imagebam\.com/i.test(h)) urls.add(h);
      if (/pixhost\.to/i.test(h)) urls.add(h);
      if (/vipr\.im/i.test(h)) urls.add(h);
      if (/imx\.to/i.test(h)) urls.add(h);
      if (/imgbox\.com/i.test(h)) urls.add(h);
    });
    document.querySelectorAll('.message-body img[src], .bbWrapper img[src]').forEach(img => {
      const s = img.src || '';
      if (/\.(jpg|jpeg|png|gif|webp)/i.test(s) && !/avatar|smil|emoji|icon/i.test(s)) urls.add(s);
    });
    document.querySelectorAll('a[href*="/attachments/"]').forEach(a => {
      const h = a.href || '';
      if (/footfetishforum\.com\/attachments\//i.test(h)) urls.add(h);
    });
    return [...urls];
  });
}

async function getThreadLinks(page) {
  return page.evaluate(() => {
    const links = new Set();
    document.querySelectorAll('a[href*="/threads/"]').forEach(a => {
      const h = (a.href || '').replace(/#.*$/, '').replace(/\/page-\d+\/?$/, '/');
      if (/footfetishforum\.com\/threads\//.test(h)) links.add(h);
    });
    return [...links];
  });
}

async function getNextPage(page) {
  return page.evaluate(() => {
    const next = document.querySelector('.pageNav-jump--next');
    return next && next.href ? next.href : null;
  });
}

function printStatus() {
  process.stdout.write(`\r  📊 ${stats.forumPages}fp | ${stats.threads}t | ${stats.threadPages}tp | ${stats.urls} urls | ✅${stats.queued} | ♻️${stats.duplicates} | ❌${stats.errors}   `);
}

async function crawlThread(page, threadUrl, meta) {
  let url = threadUrl;
  const allUrls = [];

  while (url) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(600);
      stats.threadPages++;

      const title = await page.title().catch(() => '');
      const imageUrls = await extractImageUrls(page);
      allUrls.push(...imageUrls);
      stats.urls += imageUrls.length;

      // Queue immediately in batches
      while (allUrls.length >= BATCH_SIZE) {
        const batch = allUrls.splice(0, BATCH_SIZE);
        await queueBatch(batch, { ...meta, title });
        printStatus();
      }

      url = await getNextPage(page);
      if (url) await page.waitForTimeout(THREAD_DELAY);
    } catch (e) {
      stats.errors++;
      break;
    }
  }

  // Queue remaining
  if (allUrls.length) {
    const title = await page.title().catch(() => '');
    await queueBatch(allUrls, { ...meta, title });
    printStatus();
  }
}

(async () => {
  console.log(`\n🔥 FFF Giga Crawler (Progressive)`);
  console.log(`📍 Forum: ${FORUM_URL}`);
  console.log(`📡 Server: ${SERVER}\n`);

  const browser = await firefox.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0',
  });
  const page = await context.newPage();

  // Progressive: crawl forum pages, immediately process each batch of threads
  let forumUrl = FORUM_URL;

  while (forumUrl) {
    try {
      await page.goto(forumUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(PAGE_DELAY);
      stats.forumPages++;

      const threads = await getThreadLinks(page);
      const newThreads = threads.filter(t => !processedThreads.has(t));
      newThreads.forEach(t => processedThreads.add(t));

      console.log(`\n📂 Forum p${stats.forumPages}: ${newThreads.length} nieuwe threads (totaal: ${processedThreads.size})`);

      // Immediately crawl these threads
      for (let i = 0; i < newThreads.length; i++) {
        const threadUrl = newThreads[i];
        stats.threads++;
        const short = threadUrl.replace('https://footfetishforum.com/threads/', '').slice(0, 50);
        process.stdout.write(`\n  🧵 [${stats.threads}] ${short}`);

        const meta = {
          platform: 'footfetishforum',
          channel: 'Initiation Archive',
          webdl_batch_kind: 'fff_giga_playwright',
        };

        await crawlThread(page, threadUrl, meta);
        await page.waitForTimeout(THREAD_DELAY);
      }

      forumUrl = await page.goto(forumUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        .then(() => getNextPage(page))
        .catch(() => null);

      // Re-navigate to forum to get next page link
      if (stats.forumPages > 0) {
        // We need to go back to forum page to get next link
        const currentForumPage = FORUM_URL.replace(/\/$/, '') + `/page-${stats.forumPages + 1}`;
        try {
          await page.goto(currentForumPage, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(800);
          const hasThreads = await getThreadLinks(page);
          if (hasThreads.length === 0) {
            console.log(`\n\n📋 Geen threads meer op pagina ${stats.forumPages + 1}, klaar met forum index.`);
            forumUrl = null;
          } else {
            forumUrl = currentForumPage;
          }
        } catch (e) {
          forumUrl = null;
        }
      }
    } catch (e) {
      console.error(`\n  Forum error: ${e.message}`);
      stats.errors++;
      break;
    }
  }

  await browser.close();

  console.log(`\n\n✅ Klaar!`);
  console.log(`📊 Forum: ${stats.forumPages}p | Threads: ${stats.threads} | Pages: ${stats.threadPages}`);
  console.log(`   URLs: ${stats.urls} | Queued: ${stats.queued} | Dup: ${stats.duplicates} | Err: ${stats.errors}`);
})();
