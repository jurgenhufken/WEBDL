#!/usr/bin/env node
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const { Client } = require('pg');

const BASE_DIR = path.join(os.homedir(), 'Downloads', 'WEBDL');
const SQLITE_PATH = path.join(BASE_DIR, 'webdl.db');
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://jurgen@localhost:5432/webdl';

async function migrate() {
  console.log('🔄 SQLite → Postgres migratie gestart...\n');
  console.log(`SQLite: ${SQLITE_PATH}`);
  console.log(`Postgres: ${DATABASE_URL}\n`);

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();

  try {
    // Migrate downloads
    console.log('📥 Migreren: downloads...');
    const downloads = sqlite.prepare('SELECT * FROM downloads ORDER BY id').all();
    let downloadCount = 0;
    for (const row of downloads) {
      try {
        await pg.query(`
          INSERT INTO downloads (
            id, url, platform, channel, title, status, progress, 
            filepath, filename, filesize, format, metadata, thumbnail,
            created_at, updated_at, finished_at, source_url
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (id) DO UPDATE SET
            url = EXCLUDED.url,
            platform = EXCLUDED.platform,
            channel = EXCLUDED.channel,
            title = EXCLUDED.title,
            status = EXCLUDED.status,
            progress = EXCLUDED.progress,
            filepath = EXCLUDED.filepath,
            filename = EXCLUDED.filename,
            filesize = EXCLUDED.filesize,
            format = EXCLUDED.format,
            metadata = EXCLUDED.metadata,
            thumbnail = EXCLUDED.thumbnail,
            updated_at = EXCLUDED.updated_at,
            finished_at = EXCLUDED.finished_at,
            source_url = EXCLUDED.source_url
        `, [
          row.id, row.url, row.platform, row.channel, row.title,
          row.status, row.progress, row.filepath, row.filename,
          row.filesize, row.format, row.metadata, row.thumbnail,
          row.created_at, row.updated_at, row.finished_at, row.source_url
        ]);
        downloadCount++;
      } catch (e) {
        console.log(`   ⚠️  Download #${row.id} fout: ${e.message}`);
      }
    }
    console.log(`   ✅ ${downloadCount}/${downloads.length} downloads gemigreerd\n`);

    // Migrate download_files
    console.log('📁 Migreren: download_files...');
    const downloadFiles = sqlite.prepare('SELECT * FROM download_files ORDER BY id').all();
    let fileCount = 0;
    for (const row of downloadFiles) {
      try {
        await pg.query(`
          INSERT INTO download_files (
            id, download_id, relpath, filesize, mtime_ms, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (download_id, relpath) DO UPDATE SET
            filesize = EXCLUDED.filesize,
            mtime_ms = EXCLUDED.mtime_ms,
            updated_at = EXCLUDED.updated_at
        `, [
          row.id, row.download_id, row.relpath, row.filesize,
          row.mtime_ms, row.created_at, row.updated_at
        ]);
        fileCount++;
      } catch (e) {
        console.log(`   ⚠️  File #${row.id} fout: ${e.message}`);
      }
    }
    console.log(`   ✅ ${fileCount}/${downloadFiles.length} files gemigreerd\n`);

    // Migrate screenshots
    console.log('📸 Migreren: screenshots...');
    const screenshots = sqlite.prepare('SELECT * FROM screenshots ORDER BY id').all();
    let screenshotCount = 0;
    for (const row of screenshots) {
      try {
        await pg.query(`
          INSERT INTO screenshots (
            id, url, filepath, metadata, created_at, rating
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE SET
            url = EXCLUDED.url,
            filepath = EXCLUDED.filepath,
            metadata = EXCLUDED.metadata,
            rating = EXCLUDED.rating
        `, [
          row.id, row.url, row.filepath, row.metadata,
          row.created_at, row.rating
        ]);
        screenshotCount++;
      } catch (e) {
        console.log(`   ⚠️  Screenshot #${row.id} fout: ${e.message}`);
      }
    }
    console.log(`   ✅ ${screenshotCount}/${screenshots.length} screenshots gemigreerd\n`);

    // Update sequences
    console.log('🔢 Updaten sequences...');
    const maxDownloadId = await pg.query('SELECT MAX(id) as max FROM downloads');
    const maxFileId = await pg.query('SELECT MAX(id) as max FROM download_files');
    const maxScreenshotId = await pg.query('SELECT MAX(id) as max FROM screenshots');

    if (maxDownloadId.rows[0].max) {
      await pg.query(`SELECT setval('downloads_id_seq', $1)`, [maxDownloadId.rows[0].max]);
      console.log(`   ✅ downloads_id_seq → ${maxDownloadId.rows[0].max}`);
    }
    if (maxFileId.rows[0].max) {
      await pg.query(`SELECT setval('download_files_id_seq', $1)`, [maxFileId.rows[0].max]);
      console.log(`   ✅ download_files_id_seq → ${maxFileId.rows[0].max}`);
    }
    if (maxScreenshotId.rows[0].max) {
      await pg.query(`SELECT setval('screenshots_id_seq', $1)`, [maxScreenshotId.rows[0].max]);
      console.log(`   ✅ screenshots_id_seq → ${maxScreenshotId.rows[0].max}`);
    }

    console.log('\n✨ Migratie compleet!');
    console.log(`\n📊 Samenvatting:`);
    console.log(`   Downloads: ${downloadCount}`);
    console.log(`   Files: ${fileCount}`);
    console.log(`   Screenshots: ${screenshotCount}`);

  } catch (err) {
    console.error('\n❌ Migratie fout:', err);
    process.exit(1);
  } finally {
    sqlite.close();
    await pg.end();
  }
}

migrate().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
