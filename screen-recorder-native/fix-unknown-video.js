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
  const res = await pool.query("SELECT id, filepath, title FROM downloads WHERE status = 'completed' AND id > 191950 ORDER BY id DESC");
  let fixed = 0;
  for (const row of res.rows) {
    if (!fs.existsSync(row.filepath)) continue;
    const stat = fs.statSync(row.filepath);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(row.filepath).filter(f => f.endsWith('.unknown_video'));
      if (files.length === 0) continue;
      
      files.sort((a, b) => fs.statSync(path.join(row.filepath, b)).size - fs.statSync(path.join(row.filepath, a)).size);
      
      const primary = path.join(row.filepath, files[0]);
      const newPrimary = primary.replace('.unknown_video', '.jpg');
      fs.renameSync(primary, newPrimary);
      
      console.log(`Renamed and fixed: ${newPrimary}`);
      
      await pool.query("UPDATE downloads SET filepath = $1, filename = $2, filesize = $3 WHERE id = $4", [
        newPrimary,
        path.basename(newPrimary),
        fs.statSync(newPrimary).size,
        row.id
      ]);
      
      const thumbPath = newPrimary + '._thumb.jpg';
      await generateThumb(newPrimary, thumbPath);
      await pool.query("UPDATE downloads SET is_thumb_ready = true WHERE id = $1", [row.id]);
      
      fixed++;
    }
  }
  console.log(`Fixed ${fixed} recent entries with .unknown_video.`);
  pool.end();
}

run().catch(console.error);
