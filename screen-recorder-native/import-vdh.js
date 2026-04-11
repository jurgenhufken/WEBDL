const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: 'postgresql://jurgen@localhost:5432/webdl' });
const dir = '/Volumes/HDD - One Touch/WEBDL/CAM-GIRLS/videodownloadhelper';

if (!fs.existsSync(dir)) {
    console.log('Dir not found');
    process.exit(1);
}

const entries = fs.readdirSync(dir);
const exts = new Set(['.mp4', '.mov', '.webm', '.mkv']);
let count = 0;

(async function() {
    for (const name of entries) {
        if (!exts.has(path.extname(name).toLowerCase())) continue;
        
        const fp = path.join(dir, name);
        const { rowCount } = await pool.query('SELECT id FROM downloads WHERE filepath = $1', [fp]);
        if (rowCount > 0) {
            console.log('Exists:', name);
            continue;
        }
        
        const st = fs.statSync(fp);
        const nowMs = Date.now();
        const tsMs = st.mtimeMs || nowMs;
        const fmMs = new Date(Math.min(nowMs, tsMs)).toISOString();

        await pool.query(`
            INSERT INTO downloads (status, platform, channel, title, filepath, filesize, format, created_at, updated_at, finished_at, url)
            VALUES ('completed', 'vdh', 'unknown', $1, $2, $3, $4, $5, $5, $5, $6)
        `, [name, fp, st.size || 0, path.extname(name).replace('.','') || 'mp4', fmMs, 'file://' + fp]);
        console.log('Imported:', name);
        count++;
    }
    console.log('Done! Imported ' + count + ' files.');
    process.exit(0);
})();
