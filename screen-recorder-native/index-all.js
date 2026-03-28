const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BASE_DIR = '/Volumes/HDD - One Touch/WEBDL';
const pool = new Pool({ connectionString: 'postgresql://jurgen@localhost:5432/webdl' });

function listMediaFilesInDir(rootDirAbs, maxFiles = 8000) {
  const out = [];
  try {
    const root = path.resolve(String(rootDirAbs || ''));
    if (!fs.existsSync(root)) return out;
    const st = fs.statSync(root);
    if (!st.isDirectory()) return out;

    const queue = [{ d: root, depth: 0 }];
    const mediaExts = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif', '.heic', '.heif']);

    while (queue.length) {
      const cur = queue.shift();
      let entries = [];
      try { entries = fs.readdirSync(cur.d, { withFileTypes: true }); } catch (e) { continue; }

      for (const entry of entries) {
        if (!entry || !entry.name || entry.name.startsWith('.')) continue;
        const fullPath = path.join(cur.d, entry.name);

        if (entry.isDirectory()) {
          queue.push({ d: fullPath, depth: cur.depth + 1 });
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = String(path.extname(entry.name)).toLowerCase();
        if (!mediaExts.has(ext)) continue;
        out.push(path.resolve(fullPath));
      }
    }
  } catch (e) {}
  return out;
}

async function fixAllPlatforms() {
  console.log('Starting universal DB indexer for all platforms...');
  try {
    // Select ALL completed downloads that don't have enough files in download_files
    const res = await pool.query(`
      SELECT d.id, d.filepath, d.created_at, d.platform, d.channel 
      FROM downloads d
      LEFT JOIN (
        SELECT download_id, COUNT(*) as c FROM download_files GROUP BY download_id
      ) f ON f.download_id = d.id
      WHERE d.status = 'completed' 
        AND d.filepath IS NOT NULL AND TRIM(d.filepath) != ''
        AND COALESCE(f.c, 0) < 2
    `);
    console.log('Found potentially missing indexed downloads:', res.rowCount);
    let totalFiles = 0;
    
    for (const row of res.rows) {
      const dir = row.filepath;
      if (!dir || !fs.existsSync(dir)) continue;
      
      const files = listMediaFilesInDir(dir, 8000);
      if (files.length <= 1) continue;
      
      console.log(`Indexing [${row.platform}/${row.channel}] at ${dir}`);
      console.log('-> Found', files.length, 'files');
      
      let added = 0;
      for (const abs of files) {
        const rel = path.relative(BASE_DIR, abs);
        const st = fs.statSync(abs);
        const sql = `
          INSERT INTO download_files (download_id, relpath, filesize, mtime_ms, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT(download_id, relpath) DO UPDATE SET
            filesize=excluded.filesize,
            mtime_ms=excluded.mtime_ms
        `;
        try {
          await pool.query(sql, [row.id, rel, st.size, Math.floor(st.mtimeMs), row.created_at, row.created_at]);
          added++;
          totalFiles++;
        } catch (e) {}
      }
      console.log('-> Fixed DB:', added, 'items placed in download_files');
    }
    console.log('SUCCESS! Added total missing files:', totalFiles);
  } catch(e) {
    console.error(e);
  }
  process.exit();
}

fixAllPlatforms().catch(console.error);
