#!/usr/bin/env node
// Migreer pending simple-server downloads naar webdl-hub jobs.
// Gebruik:
//   node scripts/migrate-from-simple-server.js [--platform=youtube] [--limit=100] [--dry-run]
//
// Voor elke pending download:
//  1. Skip als URL al als hub-job bestaat (queued/running/done)
//  2. Maak nieuwe hub-job (adapter + lane auto-classified)
//  3. Markeer simple-server download als 'superseded' met metadata ref naar hub-job-id
'use strict';

const { Pool } = require('pg');
const { classifyLane } = require('../src/db/repo');
const config = require('../src/config');

const args = process.argv.slice(2).reduce((acc, a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) acc[m[1]] = m[2] ?? true;
  return acc;
}, {});

const platformFilter = args.platform || 'youtube';
const limit = Number.parseInt(args.limit, 10) || 100;
const dryRun = Boolean(args['dry-run']);

// Map simple-server platform → hub adapter
const ADAPTER_MAP = {
  youtube: 'ytdlp',
  'youtube-shorts': 'ytdlp',
  vimeo: 'ytdlp',
  tiktok: 'ytdlp',
  twitch: 'ytdlp',
  reddit: 'ytdlp',
  instagram: 'instaloader',
  onlyfans: 'ofscraper',
  telegram: 'tdl',
  imgur: 'gallerydl',
  danbooru: 'gallerydl',
  gelbooru: 'gallerydl',
  pixiv: 'gallerydl',
  tumblr: 'gallerydl',
  twitter: 'gallerydl',
  'x.com': 'gallerydl',
};

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const client = await pool.connect();
  try {
    console.log(`Migratie: platform=${platformFilter}, limit=${limit}${dryRun ? ', DRY RUN' : ''}`);

    const { rows: pending } = await client.query(
      `SELECT id, url, platform, title, channel
         FROM downloads
        WHERE status = 'pending' AND platform = $1
        ORDER BY id ASC
        LIMIT $2`,
      [platformFilter, limit],
    );
    console.log(`Gevonden ${pending.length} pending ${platformFilter} items`);
    if (pending.length === 0) return;

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of pending) {
      const adapter = ADAPTER_MAP[String(row.platform || '').toLowerCase()];
      if (!adapter) {
        console.warn(`  ⚠️  id=${row.id} platform=${row.platform}: geen adapter mapping`);
        skipped++;
        continue;
      }

      // Skip als hub al een job voor deze URL heeft (queued/running/done)
      const { rows: existing } = await client.query(
        `SELECT id, status FROM ${config.dbSchema}.jobs
           WHERE url = $1 AND status IN ('queued','running','done')
           LIMIT 1`,
        [row.url],
      );
      if (existing.length > 0) {
        skipped++;
        continue;
      }

      const lane = classifyLane(row.url, adapter);

      if (dryRun) {
        console.log(`  DRY: would create hub job for #${row.id} url=${row.url.slice(0, 60)} adapter=${adapter} lane=${lane}`);
        migrated++;
        continue;
      }

      try {
        await client.query('BEGIN');
        const { rows: [hubJob] } = await client.query(
          `INSERT INTO ${config.dbSchema}.jobs (url, adapter, status, lane, options)
           VALUES ($1, $2, 'queued', $3, $4::jsonb)
           RETURNING id`,
          [
            row.url,
            adapter,
            lane,
            JSON.stringify({ migrated_from_download_id: row.id, title: row.title, channel: row.channel }),
          ],
        );
        await client.query(
          `UPDATE downloads
              SET status = 'superseded',
                  metadata = (
                    COALESCE(NULLIF(metadata, '')::jsonb, '{}'::jsonb)
                    || jsonb_build_object('migrated_to_hub_job_id', $1::text)
                  )::text
            WHERE id = $2`,
          [hubJob.id, row.id],
        );
        await client.query('COMMIT');
        migrated++;
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`  ❌ id=${row.id}: ${e.message}`);
        errors++;
      }
    }

    console.log(`\n✅ Migratie klaar: ${migrated} gemigreerd, ${skipped} overgeslagen, ${errors} errors`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
