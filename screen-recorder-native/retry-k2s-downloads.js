#!/usr/bin/env node
/**
 * Retry script for Keep2Share failed downloads
 * 
 * Retries all K2S error'd downloads via the server's retry endpoint.
 * K2S errors are typically auth/cookie issues that may resolve with fresh sessions.
 */

const { Client } = require('pg');

const SERVER_PORT = 35729;
const SERVER_BASE = `http://localhost:${SERVER_PORT}`;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/webdl';

const RETRY_DELAY_MS = 500;
const BATCH_SIZE = 3; // K2S is slower, smaller batches

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function retryDownload(id) {
  const res = await fetch(`${SERVER_BASE}/download/${id}/retry`, { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for download #${id}`);
  return res.json();
}

async function main() {
  const client = new Client(DATABASE_URL);
  await client.connect();

  console.log('📊 Analysing Keep2Share downloads...\n');

  // Overview
  const { rows: overview } = await client.query(`
    SELECT status, COUNT(*) as aantal
    FROM downloads
    WHERE platform = 'keep2share' OR url LIKE '%k2s.cc%' OR url LIKE '%keep2share%'
    GROUP BY status
    ORDER BY aantal DESC
  `);

  console.log('Current K2S status:');
  for (const row of overview) {
    console.log(`  ${row.status}: ${row.aantal}`);
  }
  console.log('');

  // Get error items
  const { rows: errorItems } = await client.query(`
    SELECT id, url, error
    FROM downloads
    WHERE (platform = 'keep2share' OR url LIKE '%k2s.cc%' OR url LIKE '%keep2share%')
    AND status = 'error'
    ORDER BY id
  `);

  console.log(`Found ${errorItems.length} error'd K2S items\n`);

  if (errorItems.length === 0) {
    console.log('Nothing to retry!');
    await client.end();
    return;
  }

  // Error breakdown
  const errTypes = {};
  for (const item of errorItems) {
    const err = String(item.error || '').substring(0, 80);
    errTypes[err] = (errTypes[err] || 0) + 1;
  }
  console.log('Error types:');
  for (const [err, count] of Object.entries(errTypes).sort((a, b) => b[1] - a[1])) {
    console.log(`  [${count}] ${err}`);
  }
  console.log('');

  console.log(`🔄 Retrying ${errorItems.length} K2S downloads...\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < errorItems.length; i += BATCH_SIZE) {
    const batch = errorItems.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(item => retryDownload(item.id))
    );

    for (let j = 0; j < results.length; j++) {
      const item = batch[j];
      const result = results[j];
      if (result.status === 'fulfilled') {
        success++;
        console.log(`  ✅ #${item.id} queued for retry (${success}/${errorItems.length})`);
      } else {
        failed++;
        console.log(`  ❌ #${item.id} retry failed: ${result.reason?.message || result.reason}`);
      }
    }

    if (i + BATCH_SIZE < errorItems.length) {
      await sleep(RETRY_DELAY_MS);
    }
  }

  console.log(`\n✅ Done! ${success} retried, ${failed} failed`);

  await client.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
