const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BASE_DIR = '/Users/jurgen/Downloads/WEBDL';
const pool = new Pool({ connectionString: 'postgresql://jurgen@localhost:5432/webdl' });

async function run() {
  const res = await pool.query(`SELECT id, filepath FROM downloads WHERE platform = 'pornpics' AND filepath IS NOT NULL AND status = 'completed'`);
  let added = 0;
  
  for (const row of res.rows) {
    if (!row.filepath) continue;
    const dir = path.resolve(row.filepath);
    if (!fs.existsSync(dir)) continue;
    
    // Recursive read dir
    function getFiles(d) {
      if (!fs.existsSync(d)) return [];
      const st = fs.statSync(d);
      if (!st.isDirectory()) return [d];
      let res = [];
      for (const item of fs.readdirSync(d)) {
        if (item.startsWith('.')) continue; // skip dotfiles
        const full = path.join(d, item);
        const st2 = fs.statSync(full);
        if (st2.isDirectory()) {
          res = res.concat(getFiles(full));
        } else {
          // only images
          if (/\.(jpg|jpeg|png|webp|gif)$/i.test(full)) {
            res.push({ path: full, size: st2.size, mtime: st2.mtimeMs });
          }
        }
      }
      return res;
    }
    
    const files = getFiles(dir);
    for (const f of files) {
      const relpath = path.relative(BASE_DIR, f.path);
      const insert = `
        INSERT INTO download_files (download_id, relpath, filesize, mtime_ms, created_at, updated_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(download_id, relpath) DO NOTHING
      `;
      const ires = await pool.query(insert, [row.id, relpath, f.size, f.mtime]);
      added += ires.rowCount;
    }
  }
  
  console.log(`Synced ${added} missing pornpics files to download_files table!`);
  pool.end();
}

run().catch(console.error);
