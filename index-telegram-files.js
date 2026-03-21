#!/usr/bin/env node
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'screen-recorder-native/webdl.db');
const BASE_DIR = path.join(process.env.HOME, 'Downloads/WEBDL');
const TELEGRAM_DIR = path.join(BASE_DIR, 'telegram/test');

const db = new Database(DB_PATH);

// Create download record
const insertDownload = db.prepare(`
  INSERT INTO downloads (url, platform, channel, title, status, progress, filepath, metadata, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const upsertDownloadFile = db.prepare(`
  INSERT INTO download_files (download_id, filepath, filesize, mtime_ms, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(download_id, filepath) DO UPDATE SET
    filesize = excluded.filesize,
    mtime_ms = excluded.mtime_ms,
    updated_at = excluded.updated_at
`);

try {
  const now = new Date().toISOString();
  
  // Create download record
  const result = insertDownload.run(
    'https://t.me/c/2594686490',
    'telegram',
    'chat_2594686490',
    'Social Media Soles (manual index)',
    'completed',
    100,
    TELEGRAM_DIR,
    JSON.stringify({ tool: 'manual_index', indexed_at: now }),
    now,
    now
  );
  
  const downloadId = result.lastInsertRowid;
  console.log(`✅ Created download record #${downloadId}`);
  
  // Index all video files
  const files = fs.readdirSync(TELEGRAM_DIR);
  let count = 0;
  
  for (const file of files) {
    if (/\.(mp4|webm|mkv|avi|mov|MOV|jpg|jpeg|png|gif|webp)$/i.test(file)) {
      const fullPath = path.join(TELEGRAM_DIR, file);
      const st = fs.statSync(fullPath);
      
      if (st.isFile()) {
        const relPath = path.relative(BASE_DIR, fullPath);
        await upsertDownloadFile.run(
          downloadId,
          relPath,
          st.size,
          Math.floor(st.mtimeMs),
          now
        );
        count++;
      }
    }
  }
  
  console.log(`📂 Indexed ${count} files in download_files table`);
  console.log(`✅ Done! Files should now appear in gallery`);
  
} catch (e) {
  console.error('❌ Error:', e.message);
  process.exit(1);
} finally {
  db.close();
}
