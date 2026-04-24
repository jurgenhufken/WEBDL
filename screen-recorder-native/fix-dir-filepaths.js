const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const pool = new Pool({ connectionString: 'postgres://localhost/webdl' });

function generateThumb(videoPath, thumbPath) {
  return new Promise((resolve) => {
    const args = [
      '-y', '-v', 'error',
      '-i', videoPath,
      '-ss', '00:00:02.000',
      '-vframes', '1',
      '-q:v', '5',
      '-vf', 'scale=-1:480',
      thumbPath
    ];
    const proc = spawn('/opt/homebrew/bin/ffmpeg', args, { stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

async function run() {
  const res = await pool.query("SELECT id, filepath, title FROM downloads WHERE status = 'completed' AND filepath IS NOT NULL");
  let fixed = 0;
  for (const row of res.rows) {
    if (!fs.existsSync(row.filepath)) continue;
    const stat = fs.statSync(row.filepath);
    if (stat.isDirectory()) {
      console.log(`Fixing directory filepath for ID ${row.id}: ${row.filepath}`);
      const files = fs.readdirSync(row.filepath).filter(f => !f.endsWith('.json') && !f.endsWith('.part') && !f.endsWith('.ytdl'));
      if (files.length === 0) continue;
      
      // Sorteer op meest recent gewijzigd
      files.sort((a, b) => fs.statSync(path.join(row.filepath, b)).mtimeMs - fs.statSync(path.join(row.filepath, a)).mtimeMs);
      
      const primary = path.join(row.filepath, files[0]);
      console.log(`  -> Found primary file: ${primary}`);
      
      await pool.query("UPDATE downloads SET filepath = $1, filename = $2, filesize = $3 WHERE id = $4", [
        primary,
        files[0],
        fs.statSync(primary).size,
        row.id
      ]);
      
      const thumbPath = primary + '._thumb.jpg';
      await generateThumb(primary, thumbPath);
      await pool.query("UPDATE downloads SET is_thumb_ready = true WHERE id = $1", [row.id]);
      
      fixed++;
    }
  }
  console.log(`Fixed ${fixed} entries.`);
  pool.end();
}

run().catch(console.error);
