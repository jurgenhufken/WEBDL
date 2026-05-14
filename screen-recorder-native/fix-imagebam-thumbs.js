#!/usr/bin/env node
/**
 * Fix imagebam thumbnail downloads: convert thumbs*.imagebam.com URLs
 * to imagebam.com/view/HASH wrapper pages and re-queue for full-size download.
 *
 * 1. Finds all downloads with thumbs*.imagebam.com URLs (completed/error)
 * 2. Marks them as 'superseded'
 * 3. Queues the converted wrapper URLs via the hub
 */

const { Pool } = require('pg');
const http = require('http');

const POSTGRES_URL = process.env.POSTGRES_URL || 'postgres://localhost/webdl';
const SERVER_PORT = Number(process.env.SERVER_PORT || 35729);
const DRY_RUN = process.argv.includes('--dry-run');

const pool = new Pool({ connectionString: POSTGRES_URL });

function thumbUrlToWrapper(thumbUrl) {
  try {
    const u = new URL(thumbUrl);
    // Match both old hex hashes (01dffd1129685634.jpg) and new short IDs (MEEFHMH_t.jpg)
    const m = u.pathname.match(/\/([a-z0-9]+?)(?:_t)?\.[a-z]+$/i);
    if (m && m[1]) {
      return `https://www.imagebam.com/view/${m[1]}`;
    }
  } catch (e) {}
  return null;
}

function postJson(port, path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 120000,
    }, (res) => {
      let chunks = '';
      res.on('data', (chunk) => { chunks += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)); } catch (e) { resolve({ raw: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Fix imagebam thumbnail downloads`);
  console.log(`Database: ${POSTGRES_URL}`);
  console.log(`Server: localhost:${SERVER_PORT}`);
  console.log('');

  // Find all imagebam thumb downloads
  const { rows } = await pool.query(`
    SELECT id, url, platform, channel, source_url, title, status, filesize
    FROM downloads
    WHERE url ~* 'thumbs?\\d*\\.imagebam\\.com'
    AND status IN ('completed', 'error', 'superseded')
    ORDER BY channel, id
  `);

  console.log(`Found ${rows.length} imagebam thumbnail downloads to fix`);
  if (!rows.length) {
    await pool.end();
    return;
  }

  // Group by channel for batch processing
  const byChannel = {};
  let convertedCount = 0;
  let skipCount = 0;

  for (const row of rows) {
    const wrapperUrl = thumbUrlToWrapper(row.url);
    if (!wrapperUrl) {
      console.warn(`  ⚠ Could not convert: ${row.url}`);
      skipCount++;
      continue;
    }
    if (!byChannel[row.channel]) {
      byChannel[row.channel] = {
        platform: row.platform,
        channel: row.channel,
        source_url: row.source_url,
        title: row.title,
        urls: [],
        ids: [],
      };
    }
    byChannel[row.channel].urls.push(wrapperUrl);
    byChannel[row.channel].ids.push(row.id);
    convertedCount++;
  }

  console.log(`Converted: ${convertedCount} URLs across ${Object.keys(byChannel).length} channels`);
  console.log(`Skipped: ${skipCount}`);
  console.log('');

  if (DRY_RUN) {
    for (const [channel, info] of Object.entries(byChannel)) {
      console.log(`  ${channel}: ${info.urls.length} URLs`);
      for (const url of info.urls.slice(0, 3)) console.log(`    ${url}`);
      if (info.urls.length > 3) console.log(`    ... +${info.urls.length - 3} more`);
    }
    console.log('\nRe-run without --dry-run to apply');
    await pool.end();
    return;
  }

  // Step 1: Mark old thumb downloads as superseded
  const allIds = rows.map(r => r.id);
  const { rowCount } = await pool.query(`
    UPDATE downloads SET status = 'superseded', updated_at = NOW()
    WHERE id = ANY($1::bigint[])
  `, [allIds]);
  console.log(`✓ Marked ${rowCount} old thumb downloads as superseded`);

  // Step 2: Queue wrapper URLs via hub per channel
  let totalQueued = 0;
  let totalDuplicates = 0;
  let totalErrors = 0;

  for (const [channel, info] of Object.entries(byChannel)) {
    console.log(`\n→ Queueing ${info.urls.length} URLs for ${channel} (in chunks of 50)...`);
    // Chunk into batches of 50 to prevent hub timeouts
    const chunkSize = 50;
    for (let i = 0; i < info.urls.length; i += chunkSize) {
      const chunk = info.urls.slice(i, i + chunkSize);
      const chunkNum = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(info.urls.length / chunkSize);
      try {
        const result = await postJson(SERVER_PORT, '/download/batch', {
          urls: chunk,
          metadata: {
            platform: info.platform,
            channel: info.channel,
            url: info.source_url,
            title: info.title,
            webdl_batch_kind: 'imagebam_thumb_fix',
          },
          force: false,
        });

        if (result && result.success !== false) {
          const q = Number(result.queued || (result.downloads ? result.downloads.length : 0)) || 0;
          totalQueued += q;
          totalDuplicates += Number(result.duplicates) || 0;
          console.log(`  ✓ chunk ${chunkNum}/${totalChunks}: queued ${q}`);
        } else {
          totalErrors += chunk.length;
          console.log(`  ✗ chunk ${chunkNum}/${totalChunks}: ${JSON.stringify(result).substring(0, 150)}`);
        }
      } catch (e) {
        totalErrors += chunk.length;
        console.error(`  ✗ chunk ${chunkNum}/${totalChunks} error: ${e.message}`);
      }
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Done!`);
  console.log(`  Superseded: ${rowCount} old thumb downloads`);
  console.log(`  Queued: ${totalQueued} full-size wrapper URLs`);
  console.log(`  Duplicates: ${totalDuplicates}`);
  console.log(`  Errors: ${totalErrors}`);

  await pool.end();
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
