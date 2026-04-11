#!/usr/bin/env node
/**
 * Restore 4K Downloader files from imports/videodownloadhelper back to _4KDownloader/<channel>/
 * and index them in the database.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: 'postgresql://jurgen@localhost:5432/webdl' });

const SRC_DIR = '/Volumes/HDD - One Touch/WEBDL/imports/videodownloadhelper';
const DST_BASE = '/Volumes/HDD - One Touch/WEBDL/_4KDownloader';
const EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv']);
const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

// Classify a filename into a channel
function classifyFile(basename) {
  const lower = basename.toLowerCase();
  if (/tiktokayakfeet|ayak_feet|ayak_voeten/.test(lower)) return 'TiktokAYAKFeet';
  if (/beach|cyprus|turkey|batumi|greece|alanya|cleopatra|riviera|antalya|georgia.*beach/.test(lower)) return 'Main beach boss Videos';
  if (/sweet_n_salty|sweet-n-salty/.test(lower)) return 'Sweet_N_Salty Shorts';
  if (/solehub/.test(lower)) return 'SoleHubCentral Videos';
  if (/feet|toes|soles|pedicure|barefoot|foot|sock/.test(lower)) return 'Feet & Soles';
  return 'Other';
}

// Derive a clean title from the VDH-mangled filename
function cleanTitle(basename) {
  // Remove the random suffix before extension: _foz22s.mkv -> .mkv
  let name = basename.replace(/(_[a-z0-9]{5,8})(\.\w+)$/, '$2');
  // Replace underscores with spaces 
  name = name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return name;
}

const DRY_RUN = process.argv.includes('--dry-run');

(async function () {
  if (!fs.existsSync(SRC_DIR)) {
    console.error('Source directory not found:', SRC_DIR);
    process.exit(1);
  }

  const entries = fs.readdirSync(SRC_DIR);
  let moved = 0, indexed = 0, skipped = 0, errors = 0;
  const channelCounts = {};

  for (const name of entries) {
    const ext = path.extname(name).toLowerCase();
    const isVideo = EXTS.has(ext);
    const isImage = IMG_EXTS.has(ext);
    if (!isVideo && !isImage) continue;

    const srcPath = path.join(SRC_DIR, name);
    const channel = classifyFile(name);
    channelCounts[channel] = (channelCounts[channel] || 0) + 1;

    // Create destination directory
    const dstDir = path.join(DST_BASE, channel);
    if (!DRY_RUN && !fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true });
    }

    const dstPath = path.join(dstDir, name);

    // Check if destination already exists
    if (!DRY_RUN && fs.existsSync(dstPath)) {
      skipped++;
      continue;
    }

    // Move file
    if (!DRY_RUN) {
      try {
        fs.renameSync(srcPath, dstPath);
      } catch (e) {
        // Cross-device move: copy + delete
        try {
          fs.copyFileSync(srcPath, dstPath);
          fs.unlinkSync(srcPath);
        } catch (e2) {
          console.error('Move failed:', name, e2.message);
          errors++;
          continue;
        }
      }
    }
    moved++;

    // Index video in DB (not images)
    if (isVideo) {
      try {
        const { rowCount } = await pool.query(
          'SELECT id FROM downloads WHERE filepath = $1',
          [dstPath]
        );
        if (rowCount > 0) {
          continue; // Already indexed
        }

        // Also check if already indexed under imports path
        const { rowCount: srcCount } = await pool.query(
          'SELECT id FROM downloads WHERE filepath = $1',
          [srcPath]
        );
        if (srcCount > 0) {
          // Update filepath from old to new location
          await pool.query(
            'UPDATE downloads SET filepath = $1 WHERE filepath = $2',
            [dstPath, srcPath]
          );
          continue;
        }

        const st = DRY_RUN ? { mtimeMs: Date.now(), size: 0 } : fs.statSync(dstPath);
        const title = cleanTitle(name);
        const tsMs = st.mtimeMs || Date.now();
        const isoTs = new Date(Math.min(Date.now(), tsMs)).toISOString();

        if (!DRY_RUN) {
          await pool.query(`
            INSERT INTO downloads (status, platform, channel, title, filepath, filesize, created_at, updated_at, finished_at, url)
            VALUES ('completed', 'youtube', $1, $2, $3, $4, $5, $5, $5, $6)
          `, [channel, title, dstPath, st.size || 0, isoTs, 'file://' + dstPath]);
        }
        indexed++;
      } catch (e) {
        console.error('DB error:', name, e.message);
        errors++;
      }
    }
  }

  console.log('\n=== Results ===');
  console.log('Mode:', DRY_RUN ? 'DRY RUN' : 'LIVE');
  console.log('Moved:', moved);
  console.log('Indexed in DB:', indexed);
  console.log('Skipped (already exists):', skipped);
  console.log('Errors:', errors);
  console.log('\nPer channel:');
  for (const [ch, cnt] of Object.entries(channelCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cnt}\t${ch}`);
  }

  await pool.end();
  process.exit(0);
})();
