#!/usr/bin/env node
/**
 * Retry script for FootFetishForum Initiation Archive
 * 
 * This script:
 * 1. Finds all error'd downloads from the Initiation Archive
 * 2. Categorises them by error type
 * 3. Retries retryable items via the server's /download/:id/retry endpoint
 * 4. For upload.footfetishforum.com wrapper URLs, resets them to original wrapper URL
 *    so the server's resolver can try again with fresh Cloudflare cookies
 * 5. Reports progress
 */

const { Client } = require('pg');

const SERVER_PORT = 35729;
const SERVER_BASE = `http://localhost:${SERVER_PORT}`;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/webdl';

// Delay between retries to not overwhelm the server
const RETRY_DELAY_MS = 300;
// Max concurrent retries
const BATCH_SIZE = 5;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function retryDownload(id) {
  const res = await fetch(`${SERVER_BASE}/download/${id}/retry`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for download #${id}`);
  }
  return res.json();
}

async function main() {
  const client = new Client(DATABASE_URL);
  await client.connect();

  console.log('📊 Analysing Initiation Archive errors...\n');

  // Get all error items from Initiation Archive
  const { rows: errorItems } = await client.query(`
    SELECT id, url, channel, title, source_url, error, status
    FROM downloads
    WHERE platform = 'footfetishforum'
    AND (
      source_url ILIKE '%initiat%' 
      OR channel ILIKE '%initiat%' 
      OR source_url = 'https://footfetishforum.com/forums/initiation-archive.35/'
    )
    AND status = 'error'
    ORDER BY id
  `);

  console.log(`Found ${errorItems.length} error'd items total\n`);

  // Categorise
  const categories = {
    wrapperResolve: [],     // "Kon wrapper media URL niet resolven"
    ytdlpUnsupported: [],   // yt-dlp can't handle upload.footfetishforum URLs
    corrupt: [],            // Corrupt/truncated
    cloudflare403: [],      // 403/Cloudflare blocks
    renameError: [],        // File rename errors
    other: []
  };

  for (const item of errorItems) {
    const err = String(item.error || '');
    if (err.includes('wrapper media URL niet resolven')) {
      categories.wrapperResolve.push(item);
    } else if (err.includes('Unsupported URL')) {
      categories.ytdlpUnsupported.push(item);
    } else if (err.includes('Corrupt/truncated')) {
      categories.corrupt.push(item);
    } else if (err.includes('403') || err.includes('Cloudflare')) {
      categories.cloudflare403.push(item);
    } else if (err.includes('rename') || err.includes('No such file')) {
      categories.renameError.push(item);
    } else {
      categories.other.push(item);
    }
  }

  console.log('📋 Error breakdown:');
  console.log(`  - Wrapper resolve failed: ${categories.wrapperResolve.length}`);
  console.log(`  - yt-dlp unsupported URL: ${categories.ytdlpUnsupported.length}`);
  console.log(`  - Corrupt/truncated:      ${categories.corrupt.length}`);
  console.log(`  - 403/Cloudflare:         ${categories.cloudflare403.length}`);
  console.log(`  - File rename errors:     ${categories.renameError.length}`);
  console.log(`  - Other:                  ${categories.other.length}`);
  console.log('');

  // ALL error types are retryable — the server code handles each type:
  // - wrapper URLs: server will try resolveHtmlWrapperToDirectMedia again
  // - yt-dlp unsupported: server tries curl direct download as fallback
  // - corrupt: will re-download
  // - 403: may work with fresh cookies/session
  // - rename: transient filesystem error
  const retryable = errorItems;

  console.log(`🔄 Retrying ${retryable.length} items...\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < retryable.length; i += BATCH_SIZE) {
    const batch = retryable.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(item => retryDownload(item.id))
    );

    for (let j = 0; j < results.length; j++) {
      const item = batch[j];
      const result = results[j];
      if (result.status === 'fulfilled') {
        success++;
        if (success % 50 === 0 || success === 1) {
          console.log(`  ✅ ${success}/${retryable.length} retried (latest: #${item.id})`);
        }
      } else {
        failed++;
        console.log(`  ❌ #${item.id} retry failed: ${result.reason?.message || result.reason}`);
      }
    }

    if (i + BATCH_SIZE < retryable.length) {
      await sleep(RETRY_DELAY_MS);
    }
  }

  console.log(`\n✅ Done! ${success} retried, ${failed} failed`);

  // Now check overall status
  const { rows: [stats] } = await client.query(`
    SELECT 
      COUNT(*) as totaal,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'downloading') as downloading,
      COUNT(*) FILTER (WHERE status = 'error') as errors
    FROM downloads
    WHERE platform = 'footfetishforum'
    AND (
      source_url ILIKE '%initiat%' 
      OR channel ILIKE '%initiat%' 
      OR source_url = 'https://footfetishforum.com/forums/initiation-archive.35/'
    )
  `);

  console.log('\n📊 Current Initiation Archive status:');
  console.log(`  Total:       ${stats.totaal}`);
  console.log(`  Completed:   ${stats.completed}`);
  console.log(`  Pending:     ${stats.pending}`);
  console.log(`  Downloading: ${stats.downloading}`);
  console.log(`  Errors:      ${stats.errors}`);

  await client.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
