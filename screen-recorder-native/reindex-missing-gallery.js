#!/usr/bin/env node
/**
 * Re-index completed folder-downloads that have no download_files entries.
 * This ensures they appear in the gallery.
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://localhost/webdl' });

const MEDIA_EXTS = new Set([
  'jpg','jpeg','png','gif','webp','bmp','svg','tiff','heic','avif','jfif',
  'mp4','mkv','avi','mov','wmv','flv','webm','m4v','ts','mpg','mpeg','3gp','ogv','m2ts','mts',
  'mp3','m4a','wav','ogg','flac','aac','wma'
]);

const SKIP_NAMES = /^(\.|thumbs?$|__MACOSX|preview|sample|\.thumbs$|\.DS_Store$)/i;
const SKIP_EXTS = new Set(['json','txt','html','log','nfo','url','torrent','srt','vtt','ass','ssa','sub','idx','exe','msi','dmg','pkg','deb','rpm','zip','rar','7z','tar','gz','bz2','xz','iso']);

function scanDir(dir, basePath, depth = 0) {
  const results = [];
  if (depth > 5) return results;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (SKIP_NAMES.test(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        results.push(...scanDir(full, basePath, depth + 1));
      } else if (e.isFile()) {
        const ext = path.extname(e.name).replace('.', '').toLowerCase();
        if (SKIP_EXTS.has(ext)) continue;
        if (!MEDIA_EXTS.has(ext)) continue;
        const relpath = path.relative(basePath, full);
        try {
          const stat = fs.statSync(full);
          results.push({ relpath, filesize: stat.size, ext });
        } catch (e) {
          results.push({ relpath, filesize: 0, ext });
        }
      }
    }
  } catch (e) {
    // Directory not accessible
  }
  return results;
}

async function main() {
  const client = await pool.connect();
  try {
    // Find completed folder-downloads without download_files entries
    const { rows } = await client.query(`
      SELECT d.id, d.filepath, d.platform, d.channel
      FROM downloads d
      WHERE d.status = 'completed'
        AND d.filepath IS NOT NULL AND d.filepath <> ''
        AND NOT EXISTS (SELECT 1 FROM download_files df WHERE df.download_id = d.id)
        AND d.filepath !~* '\\.(mp4|mkv|avi|mov|wmv|flv|webm|jpg|jpeg|png|gif|webp|mp3|m4a)$'
      ORDER BY d.id
    `);

    console.log(`Found ${rows.length} folder-downloads without indexed files`);
    
    let totalIndexed = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (let i = 0; i < rows.length; i++) {
      const { id, filepath, platform, channel } = rows[i];
      
      // Skip if directory doesn't exist
      if (!fs.existsSync(filepath)) {
        totalSkipped++;
        continue;
      }

      // Check if it's actually a directory
      let stat;
      try {
        stat = fs.statSync(filepath);
      } catch (e) {
        totalSkipped++;
        continue;
      }

      const scanPath = stat.isDirectory() ? filepath : path.dirname(filepath);
      const files = scanDir(scanPath, scanPath);

      if (files.length === 0) {
        totalSkipped++;
        continue;
      }

      // Insert files into download_files
      let inserted = 0;
      for (const file of files) {
        try {
          await client.query(`
            INSERT INTO download_files (download_id, relpath, filesize)
            VALUES ($1, $2, $3)
            ON CONFLICT (download_id, relpath) DO NOTHING
          `, [id, file.relpath, file.filesize]);
          inserted++;
        } catch (e) {
          // Skip duplicates or errors
        }
      }

      if (inserted > 0) {
        totalIndexed += inserted;
        // Mark thumb as not ready so it gets regenerated
        await client.query(`UPDATE downloads SET is_thumb_ready = false WHERE id = $1`, [id]);
      }

      if ((i + 1) % 50 === 0 || i === rows.length - 1) {
        process.stdout.write(`\r  Progress: ${i + 1}/${rows.length} downloads | ${totalIndexed} files indexed | ${totalSkipped} skipped | ${totalErrors} errors`);
      }
    }

    console.log(`\n\nDone!`);
    console.log(`  Indexed: ${totalIndexed} files`);
    console.log(`  Skipped: ${totalSkipped} downloads (dir not found or empty)`);
    console.log(`  Errors: ${totalErrors}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
