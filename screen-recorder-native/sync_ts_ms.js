const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

async function syncMtime() {
  const client = new Client('postgres://localhost/webdl');
  await client.connect();

  console.log('Fetching downloads to sync mtime...');
  const res = await client.query(`
    SELECT id, filepath, platform FROM downloads 
    WHERE filepath IS NOT NULL AND filepath != '' AND status = 'completed' AND ts_ms IS NULL
  `);
  
  let updated = 0;
  for (const row of res.rows) {
    let absPath = row.filepath;
    if (!path.isAbsolute(absPath)) {
      absPath = path.join(DOWNLOADS_DIR, absPath);
    }
    
    try {
      const stats = fs.statSync(absPath);
      // For directories, statSync gets the dir mtime, which might not be the original date.
      // But for files (like mp4), it gets the exact original date if yt-dlp set it.
      if (stats.isFile()) {
        const mtimeMs = stats.mtimeMs;
        await client.query('UPDATE downloads SET ts_ms = $1 WHERE id = $2', [Math.floor(mtimeMs), row.id]);
        updated++;
      }
    } catch (err) {
      // Ignore missing files
    }
  }

  console.log(`Updated ts_ms for ${updated} downloads.`);
  await client.end();
}

syncMtime().catch(console.error);
