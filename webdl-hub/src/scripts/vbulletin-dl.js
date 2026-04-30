#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

// Zorg dat we cheerio (net geïnstalleerd) kunnen inladen
let cheerio;
try {
  cheerio = require('cheerio');
} catch (e) {
  console.error('[vbulletin] FOUT: cheerio niet gevonden. Draai npm install in webdl-hub.');
  process.exit(1);
}

const urlArg = process.argv[2];
const outDir = process.argv[3] || process.cwd();
const cookie = process.env.AVF_COOKIE || '';

if (!urlArg) {
  console.error('Gebruik: node vbulletin-dl.js <url> [outdir]');
  process.exit(1);
}

const scrapeAll = urlArg.includes('#all') || urlArg.includes('&all=1');
const baseUrlStr = urlArg.split('#')[0].replace('&all=1', '');

async function fetchHtml(url) {
  console.log(`[vbulletin] Fetching page: ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cookie': cookie,
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} op ${url}`);
  return res.text();
}

async function downloadFile(url, dest, filename) {
  const target = path.join(dest, filename);
  if (fs.existsSync(target)) {
    console.log(`[vbulletin] Overgeslagen (bestaat al): ${filename}`);
    return;
  }
  
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Cookie': cookie,
      'Referer': baseUrlStr
    }
  });
  
  if (!res.ok) throw new Error(`HTTP ${res.status} bij downloaden van ${url}`);
  
  // Controleer of we per ongeluk een inlogpagina downen i.p.v. een afbeelding
  const cType = res.headers.get('content-type') || '';
  if (cType.includes('text/html')) {
    throw new Error(`Kreeg een HTML pagina i.p.v. een bestand (misschien is je AVF_COOKIE verlopen of niet juist ingesteld).`);
  }

  // Bepaal extensie als filename generiek is
  let finalName = filename;
  if (!path.extname(finalName)) {
    if (cType.includes('image/jpeg')) finalName += '.jpg';
    else if (cType.includes('image/png')) finalName += '.png';
    else if (cType.includes('video/mp4')) finalName += '.mp4';
  }

  const outPath = path.join(dest, finalName);
  
  console.log(`[vbulletin] Downloaden: ${finalName} ...`);
  const fileStream = fs.createWriteStream(outPath);
  
  // Stream de response (voor Node.js 18+ Web Streams)
  if (res.body.getReader) {
    // web stream -> async iterable -> pipeline
    const { Readable } = require('node:stream');
    await pipeline(Readable.fromWeb(res.body), fileStream);
  } else {
    // node-fetch compatible body
    await pipeline(res.body, fileStream);
  }
  
  console.log(`[vbulletin] Opgeslagen: ${finalName}`);
}

async function main() {
  const toScrape = [baseUrlStr];
  const scraped = new Set();
  const fileUrls = new Set();
  
  // 1. Verzamel URLs
  while (toScrape.length > 0) {
    const currentUrl = toScrape.shift();
    if (scraped.has(currentUrl)) continue;
    scraped.add(currentUrl);
    
    try {
      const html = await fetchHtml(currentUrl);
      const $ = cheerio.load(html);
      
      // Vind attachments
      // <a href="attachment.php?attachmentid=123"><img class="thumbnail"></a>
      $('a[href^="attachment.php"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && href.includes('attachmentid=')) {
          const abs = new URL(href, currentUrl).toString();
          const cleanUrl = abs.replace(/&s=[a-f0-9]+/, '').replace(/\?s=[a-f0-9]+&/, '?');
          fileUrls.add(cleanUrl);
        }
      });
      
      // Vind ook directe image links in posts die NIET attachment.php zijn, maar imgbox/imagebam etc.
      // We focus for now on attachments as they are the primary source.
      
      // Pagination
      if (scrapeAll) {
        const nextLinks = $('a[rel="next"], a[title^="Next Page"]');
        if (nextLinks.length > 0) {
          const nextHref = nextLinks.first().attr('href');
          if (nextHref) {
            const nextAbs = new URL(nextHref, currentUrl).toString();
            toScrape.push(nextAbs);
          }
        }
      }
    } catch (e) {
      console.error(`[vbulletin] Fout bij scrapen ${currentUrl}: ${e.message}`);
    }
  }
  
  const files = Array.from(fileUrls);
  console.log(`[vbulletin] Gevonden bestanden: ${files.length}`);
  
  if (files.length === 0) {
    console.log('[vbulletin] Geen attachments gevonden! (Log in vereist?)');
    return;
  }
  
  // 2. Download alle bestanden
  let i = 0;
  for (const fileUrl of files) {
    i++;
    let filename = `attachment_${i}.jpg`;
    try {
      const u = new URL(fileUrl);
      const attId = u.searchParams.get('attachmentid');
      if (attId) filename = `avf_${attId}.jpg`;
    } catch {}
    
    try {
      console.log(`[vbulletin-progress] ${i}/${files.length}`);
      await downloadFile(fileUrl, outDir, filename);
      // Voorkom Cloudflare blocks door een kleine pauze in te lassen
      await new Promise(resolve => setTimeout(resolve, 800));
    } catch (e) {
      console.error(`[vbulletin] Mislukt: ${filename} - ${e.message}`);
    }
  }
  
  console.log('[vbulletin] Klaar met alle downloads.');
}

main().catch(e => {
  console.error('[vbulletin] Fatale fout:', e);
  process.exit(1);
});
