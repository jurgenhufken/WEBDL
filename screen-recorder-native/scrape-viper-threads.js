#!/usr/bin/env node
/**
 * Scrape all pages of viper threads and submit K2S links for download.
 */
const https = require('https');
const http = require('http');

const THREADS = [
  { url: 'https://viper.to/threads/7410887-nude-beach-collection-natural-Voyeur-txt', pages: 330, title: 'nude beach collection natural Voyeur' },
  { url: 'https://vipergirls.to/threads/7824441-Beautiful-Girls-on-the-Beach-Hidden-video-Nudists', pages: 547, title: 'Beautiful Girls on the Beach Hidden video Nudists' },
];

const K2S_RE = /https?:\/\/(k2s\.cc|keep2share\.cc|keep2share\.com|filefox\.cc|fboom\.me)\/file\/[a-zA-Z0-9]+/gi;
const SERVER = 'http://localhost:35729';
const DELAY_MS = 200; // fast scrape

// Load viper cookies from file
const fs = require('fs');
const COOKIES = fs.existsSync('/tmp/viper_cookies.txt') ? fs.readFileSync('/tmp/viper_cookies.txt', 'utf8').trim() : '';

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0', 'Cookie': COOKIES } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve, reject);
      }
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function submitDownload(k2sUrl, threadUrl, threadTitle) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      url: k2sUrl,
      metadata: { source_thread_url: threadUrl, source_thread_title: threadTitle }
    });
    const req = http.request('http://localhost:35729/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve({ error: body }); }
      });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.write(payload);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  let totalNew = 0, totalDup = 0, totalErr = 0, totalLinks = 0;
  const allSeen = new Set();

  for (const thread of THREADS) {
    console.log(`\n📄 Thread: ${thread.title} (${thread.pages} pages)`);
    console.log(`   ${thread.url}\n`);

    for (let page = 1; page <= thread.pages; page++) {
      const pageUrl = page === 1 ? thread.url : `${thread.url}/page${page}`;
      try {
        const html = await fetchPage(pageUrl);
        const matches = html.match(K2S_RE) || [];
        const unique = [...new Set(matches.map(u => u.toLowerCase()))];
        const fresh = unique.filter(u => !allSeen.has(u));
        fresh.forEach(u => allSeen.add(u));

        if (fresh.length > 0) {
          totalLinks += fresh.length;
          for (const k2sUrl of fresh) {
            const result = await submitDownload(k2sUrl, thread.url, thread.title);
            if (result.duplicate) { totalDup++; }
            else if (result.success) { totalNew++; }
            else { totalErr++; }
          }
        }

        if (page % 10 === 0 || page === thread.pages) {
          process.stdout.write(`\r   Page ${page}/${thread.pages} | Links: ${totalLinks} | New: ${totalNew} | Dup: ${totalDup} | Err: ${totalErr}`);
        }
      } catch (e) {
        // Skip failed pages
      }
      await sleep(DELAY_MS);
    }
    console.log('');
  }

  console.log(`\n✅ Done!`);
  console.log(`   Total K2S links: ${totalLinks}`);
  console.log(`   New downloads: ${totalNew}`);
  console.log(`   Duplicates: ${totalDup}`);
  console.log(`   Errors: ${totalErr}`);
}

main().catch(e => { console.error(e); process.exit(1); });
