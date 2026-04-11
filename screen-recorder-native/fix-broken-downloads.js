#!/usr/bin/env node
/**
 * Re-queue broken footfetishforum downloads via direct PostgreSQL + API
 * 
 * Usage: node fix-broken-downloads.js [--dry-run] [--limit N] [--type attachments|images|all]
 */
const { execSync } = require('child_process');
const PSQL = '/opt/homebrew/Cellar/postgresql@16/16.13/bin/psql';
const BASE_URL = 'http://localhost:35729';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) || 100 : 100;
const typeIdx = args.indexOf('--type');
const TYPE = typeIdx >= 0 ? args[typeIdx + 1] || 'all' : 'all';

function pgQuery(sql) {
  const raw = execSync(`${PSQL} -h localhost webdl -t -A -F'|' -c "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', timeout: 30000 });
  return raw.trim().split('\n').filter(Boolean).map(line => {
    const parts = line.split('|');
    return parts;
  });
}

async function main() {
  console.log(`Fix broken downloads - DRY_RUN=${DRY_RUN}, LIMIT=${LIMIT}, TYPE=${TYPE}\n`);

  // Build WHERE clause based on type
  let urlFilter = '';
  if (TYPE === 'attachments') {
    urlFilter = "AND url LIKE '%footfetishforum.com/attachments/%'";
  } else if (TYPE === 'images') {
    urlFilter = `AND (url LIKE '%jpg.church%' OR url LIKE '%digitaloceanspaces.com%' OR url LIKE '%upload.footfetishforum.com%' OR url LIKE '%pixeldrain.com%' OR url LIKE '%pixl.li%' OR url LIKE '%bunkr.%' OR url LIKE '%jpg5.su%' OR url LIKE '%selti-delivery.ru%' OR url LIKE '%forum-area.com%')`;
  } else {
    urlFilter = `AND (url LIKE '%footfetishforum.com/attachments/%' OR url LIKE '%jpg.church%' OR url LIKE '%digitaloceanspaces.com%' OR url LIKE '%upload.footfetishforum.com%' OR url LIKE '%pixeldrain.com%' OR url LIKE '%pixl.li%' OR url LIKE '%bunkr.%' OR url LIKE '%jpg5.su%' OR url LIKE '%selti-delivery.ru%' OR url LIKE '%forum-area.com%')`;
  }

  const sql = `SELECT id, url, COALESCE(title,'untitled'), COALESCE(channel,'unknown'), COALESCE(source_url,'') FROM downloads WHERE platform='footfetishforum' AND status='error' ${urlFilter} ORDER BY id DESC LIMIT ${LIMIT}`;
  
  let rows;
  try {
    rows = pgQuery(sql);
  } catch (e) {
    console.error('PostgreSQL query failed:', e.message);
    process.exit(1);
  }

  console.log(`Found ${rows.length} retryable error downloads\n`);
  
  let success = 0, failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const [id, url, title, channel, source_url] = rows[i];
    
    if (DRY_RUN) {
      if (i < 10) console.log(`[DRY] #${id}: ${url.slice(0, 80)}`);
      continue;
    }

    try {
      const resp = await fetch(`${BASE_URL}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          force: true,
          metadata: {
            platform: 'footfetishforum',
            channel: channel || 'unknown',
            title: title || 'untitled',
            source_url: source_url || ''
          }
        })
      });
      const data = await resp.json().catch(() => null);
      if (data && data.success) {
        success++;
        if (i % 50 === 0) console.log(`  [${i+1}/${rows.length}] ✅ #${id} -> #${data.downloadId}`);
      } else {
        failed++;
        if (failed <= 3) console.log(`  ❌ #${id}: ${data ? data.error : 'no response'}`);
      }
    } catch (e) {
      failed++;
      if (failed <= 3) console.log(`  ❌ #${id}: ${e.message}`);
    }

    // Throttle: 10 per second
    if (i % 10 === 9) await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n✅ Done! Queued: ${success}, Failed: ${failed}, Total: ${rows.length}`);
  
  if (!DRY_RUN && success > 0) {
    // Mark old error entries so they don't re-appear
    try {
      const ids = rows.map(r => r[0]).join(',');
      execSync(`${PSQL} -h localhost webdl -c "UPDATE downloads SET status='superseded' WHERE id IN (${ids}) AND status='error';"`, { timeout: 10000 });
      console.log(`Marked ${rows.length} old error entries as superseded`);
    } catch (e) {
      console.log('Could not mark old entries:', e.message);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
