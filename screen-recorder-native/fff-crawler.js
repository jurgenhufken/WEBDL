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

    // 2026-05-30 (Jürgen "moet weg"): filter junk URLs voordat we toevoegen.
    // - proxy.php?image= : forum wrapper — unwrap naar de echte URL (param)
    // - twemoji / 1fXXXX.png : Unicode emoji codepoints
    // - /smilies/ /avatars/ /styles/ /images/icons : forum chrome
    // - blank.gif, spacer : transparent placeholders
    const JUNK_RE = /\/(?:twemoji|smilies|emoticons|avatars?|styles\/[^/]+\/(?:xenforo|core)\/|images\/(?:icons|buttons|misc)|blank\.gif|spacer\.|attachments\/upload)/i;
    const EMOJI_CODEPOINT_RE = /\/(?:1f[0-9a-f]{3,4}|26[0-9a-f]{2}|27[0-9a-f]{2})\.(?:png|svg|webp)$/i;
    function isJunk(u) {
      if (!u) return true;
      if (JUNK_RE.test(u)) return true;
      if (EMOJI_CODEPOINT_RE.test(u)) return true;
      return false;
    }
    function unwrapProxy(u) {
      // FFF proxy.php?image=<encoded-url>  →  echte URL
      const m = (u || '').match(/[?&]image=([^&#]+)/i);
      if (!m) return u;
      try { return decodeURIComponent(m[1]); } catch (_) { return u; }
    }
    function addUrl(u) {
      if (!u) return;
      // Eerst unwrap proxy.php wrappers
      if (/\/proxy\.php\?/i.test(u)) u = unwrapProxy(u);
      if (isJunk(u)) return;
      urls.add(u);
    }

    document.querySelectorAll('a[href]').forEach(a => {
      const h = a.href || '';
      if (/upload\.footfetishforum\.com\/image\//i.test(h)) addUrl(h);
      if (/imagebam\.com/i.test(h)) addUrl(h);
      if (/pixhost\.to/i.test(h)) addUrl(h);
      if (/vipr\.im/i.test(h)) addUrl(h);
      if (/imx\.to/i.test(h)) addUrl(h);
      if (/imgbox\.com/i.test(h)) addUrl(h);
      if (/imagetwist\.com/i.test(h)) addUrl(h);
      if (/imagevenue\.com/i.test(h)) addUrl(h);
      if (/turboimagehost\.com/i.test(h)) addUrl(h);
      if (/postimg/i.test(h)) addUrl(h);
      if (/flc\.nyc3\.digitaloceanspaces\.com/i.test(h)) addUrl(h);
      if (/cdni\.pornpics\.com/i.test(h)) addUrl(h);
      // proxy.php links die direct in een <a> staan
      if (/\/proxy\.php\?image=/i.test(h)) addUrl(h);
    });
    document.querySelectorAll('.message-body img[src], .bbWrapper img[src]').forEach(img => {
      const s = img.src || '';
      if (/\.(jpg|jpeg|png|gif|webp)/i.test(s)) addUrl(s);
    });
    document.querySelectorAll('a[href*="/attachments/"]').forEach(a => {
      const h = a.href || '';
      if (/footfetishforum\.com\/attachments\//i.test(h)) addUrl(h);
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

  // 2026-05-30 (Jürgen "posts bij elkaar"): leid thread-slug af uit URL voor
  // per-thread channel naam zodat gallery items van zelfde thread groepeert.
  // URL pattern: /threads/<slug>.<id>/
  const slugM = String(threadUrl).match(/\/threads\/([a-z0-9-]+)\.(\d+)/i);
  const slugRaw = slugM ? slugM[1] : '';
  const slugPretty = slugRaw
    .replace(/-/g, ' ')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 60);
  const threadId = slugM ? slugM[2] : '';
  const baseChannel = meta.channel || 'Initiation Archive';
  const threadChannel = slugPretty ? `${baseChannel} / ${slugPretty}` : baseChannel;
  // Strip /latest, /unread fragmenten zodat source_url stabiel is voor alle pages
  const threadSourceUrl = String(threadUrl).replace(/\/(latest|unread)\/?$/i, '/').replace(/\/page-\d+\/?$/i, '/');
  const enrichedMeta = {
    ...meta,
    channel: threadChannel,
    source_url: threadSourceUrl,
    source_thread_url: threadSourceUrl,
    source_thread_title: slugPretty,
    source_thread_id: threadId,
    webdl_pin_context: true,
  };

  while (url) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(600);
      stats.threadPages++;

      const title = await page.title().catch(() => slugPretty);
      const imageUrls = await extractImageUrls(page);
      allUrls.push(...imageUrls);
      stats.urls += imageUrls.length;

      // Queue immediately in batches
      while (allUrls.length >= BATCH_SIZE) {
        const batch = allUrls.splice(0, BATCH_SIZE);
        await queueBatch(batch, { ...enrichedMeta, title });
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
    const title = await page.title().catch(() => slugPretty);
    await queueBatch(allUrls, { ...enrichedMeta, title });
    printStatus();
  }
}

(async () => {
  console.log(`\n🔥 FFF Giga Crawler (Progressive)`);
  console.log(`📍 Forum: ${FORUM_URL}`);
  console.log(`📡 Server: ${SERVER}\n`);

  // 2026-05-30 (Jürgen): gebruik persistent profile met FFF-login-cookies.
  // Profile gemaakt door /tmp/fff_login.js. CF + login cookies blijven bewaard.
  const PROFILE = process.env.WEBDL_FFF_PROFILE || '/tmp/pw-fff-profile';
  console.log(`📁 Persistent profile: ${PROFILE}`);
  const context = await firefox.launchPersistentContext(PROFILE, {
    headless: false,
    timeout: 60000,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0',
  });
  const browser = context.browser();
  const page = context.pages()[0] || await context.newPage();

  // 2026-05-30: parse start-page uit FORUM_URL (bv. /page-3) zodat we daar
  // BEGINNEN ipv proberen /page-3/page-2 te bouwen (vorige bug → 404).
  const startPageMatch = FORUM_URL.match(/\/page-(\d+)\/?$/);
  if (startPageMatch) {
    stats.forumPages = parseInt(startPageMatch[1], 10) - 1; // -1 omdat ++ na fetch
    console.log(`📍 Start vanaf forum page ${parseInt(startPageMatch[1], 10)}`);
  }
  // Base URL zonder /page-N (zodat we /page-N kunnen toevoegen)
  const FORUM_BASE = FORUM_URL.replace(/\/page-\d+\/?$/, '/').replace(/\/$/, '');

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

      // 2026-05-30 fix: gebruik FORUM_BASE ipv FORUM_URL (die kan /page-N
      // bevatten → vorige bug bouwde .../page-3/page-2 → 404).
      const currentForumPage = FORUM_BASE + `/page-${stats.forumPages + 1}`;
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
    } catch (e) {
      console.error(`\n  Forum error: ${e.message}`);
      stats.errors++;
      break;
    }
  }

  await context.close();

  console.log(`\n\n✅ Klaar!`);
  console.log(`📊 Forum: ${stats.forumPages}p | Threads: ${stats.threads} | Pages: ${stats.threadPages}`);
  console.log(`   URLs: ${stats.urls} | Queued: ${stats.queued} | Dup: ${stats.duplicates} | Err: ${stats.errors}`);
})();
