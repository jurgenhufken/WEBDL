const fs = require('fs');
const path = require('path');
const { createDb } = require('./db-adapter.js');

async function run() {
  const db = await createDb('/tmp/noop.db');
  const downloads = await db.pool.query("SELECT id, filepath FROM downloads WHERE platform = 'pornpics' AND status = 'completed' AND filepath IS NOT NULL");
  let added = 0;
  for (const row of downloads.rows) {
    const dir = path.resolve(row.filepath);
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (!/\.(jpg|jpeg|png|webp|gif)$/i.test(f)) continue;
        const full = path.join(dir, f);
        const st = fs.statSync(full);
        const rel = path.relative('/Users/jurgen/Downloads/WEBDL', full);
        
        await db.pool.query(
          "INSERT INTO download_files (download_id, relpath, filesize, mtime_ms, created_at, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(download_id, relpath) DO NOTHING",
          [row.id, rel, st.size, st.mtimeMs]
        );
        added++;
        if (added % 3000 === 0) console.log('Synced', added, 'files...');
      }
    } catch (e) { }
  }
  console.log('Finished syncing! Total files discovered in pornpics:', added);
  db.close();
  process.exit(0);
}
run().catch(console.error);
