const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function getFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const st = fs.statSync(dir);
  if (!st.isDirectory()) return [dir];
  let res = [];
  try {
    for (const item of fs.readdirSync(dir)) {
      if (item.startsWith('.')) continue;
      const full = path.join(dir, item);
      const st2 = fs.statSync(full);
      if (st2.isDirectory()) {
        res = res.concat(getFiles(full));
      } else {
        if (/\.(jpg|jpeg|png|webp|gif|mp4|mov|avi|mkv|webm)$/i.test(full)) {
          res.push({ path: full, size: st2.size, mtime: st2.mtimeMs });
        }
      }
    }
  } catch (e) { }
  return res;
}

async function run() {
  const pool = new Pool({ connectionString: 'postgresql://jurgen@localhost:5432/webdl' });
  const downloads = await pool.query("SELECT id, filepath FROM downloads WHERE platform IN ('pornpics', '4kdownloader') AND status = 'completed' AND filepath IS NOT NULL");
  let added = 0;
  for (const row of downloads.rows) {
    const dir = path.resolve(row.filepath);
    if (!fs.existsSync(dir)) continue;
    try {
      const files = getFiles(dir);
      for (const f of files) {
        const rel = path.relative('/Users/jurgen/Downloads/WEBDL', f.path);
        await pool.query(
          "INSERT INTO download_files (download_id, relpath, filesize, mtime_ms, created_at, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(download_id, relpath) DO NOTHING",
          [row.id, rel, f.size, f.mtime]
        );
        added++;
        if (added % 3000 === 0) console.log('Synced', added, 'files...');
      }
    } catch (e) { }
  }
  console.log('Finished syncing! Total synced:', added);
  await pool.end();
}
run().catch(console.error);
