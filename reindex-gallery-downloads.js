#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://jurgen@localhost:5432/webdl';
const BASE_DIR = path.join(require('os').homedir(), 'Downloads', 'WEBDL');

const pool = new Pool({ connectionString: DATABASE_URL });

async function reindexGalleryDownloads() {
  try {
    console.log('🔍 Zoeken naar gallery-dl downloads...');
    
    // Find all completed gallery-dl downloads
    const result = await pool.query(`
      SELECT id, filepath, platform, channel
      FROM downloads
      WHERE metadata::text LIKE '%gallery-dl%'
        AND status = 'completed'
        AND filepath IS NOT NULL
      ORDER BY id DESC
    `);
    
    console.log(`📦 Gevonden: ${result.rows.length} gallery-dl downloads\n`);
    
    let totalIndexed = 0;
    
    for (const download of result.rows) {
      const { id, filepath, platform, channel } = download;
      
      if (!fs.existsSync(filepath)) {
        console.log(`⚠️  #${id} - Directory niet gevonden: ${filepath}`);
        continue;
      }
      
      console.log(`📂 #${id} - ${platform}/${channel}`);
      
      const files = fs.readdirSync(filepath);
      let indexed = 0;
      
      for (const file of files) {
        try {
          const fullPath = path.join(filepath, file);
          const st = fs.statSync(fullPath);
          
          // Skip thumbnails
          if (file.includes('.thumb.') || file.includes('_thumb.') || fullPath.includes('/.thumbs/')) continue;
          
          if (st.isFile() && /\.(mp4|webm|mkv|avi|mov|jpg|jpeg|png|gif|webp)$/i.test(file)) {
            const relPath = path.relative(BASE_DIR, fullPath);
            if (relPath && !relPath.startsWith('..')) {
              await pool.query(`
                INSERT INTO download_files (download_id, relpath, filesize, mtime_ms, updated_at)
                VALUES ($1, $2, $3, $4, NOW())
                ON CONFLICT (download_id, relpath) DO UPDATE SET
                  filesize = EXCLUDED.filesize,
                  mtime_ms = EXCLUDED.mtime_ms,
                  updated_at = NOW()
              `, [id, relPath, st.size, Math.floor(st.mtimeMs)]);
              indexed++;
            }
          }
        } catch (e) {
          console.log(`   ⚠️  Error: ${file} - ${e.message}`);
        }
      }
      
      console.log(`   ✅ ${indexed} files geïndexeerd`);
      totalIndexed += indexed;
    }
    
    // Cleanup thumbnails
    console.log('\n🧹 Verwijderen thumbnail entries...');
    const cleanup = await pool.query(`
      DELETE FROM download_files
      WHERE relpath LIKE '%_thumb.jpg'
         OR relpath LIKE '%_thumb.png'
         OR relpath LIKE '%.thumb.jpg'
         OR relpath LIKE '%.thumb.png'
         OR relpath LIKE '%/.thumbs/%'
    `);
    
    console.log(`   🗑️  ${cleanup.rowCount} thumbnail entries verwijderd`);
    console.log(`\n✅ Totaal: ${totalIndexed} files geïndexeerd`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

reindexGalleryDownloads();
