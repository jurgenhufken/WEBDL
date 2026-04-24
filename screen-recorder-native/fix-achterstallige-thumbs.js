const { Pool } = require('pg');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: 'postgres://localhost/webdl' });

const FFMPEG = '/opt/homebrew/bin/ffmpeg';

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
    const proc = spawn(FFMPEG, args, { stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

async function run() {
  console.log("Zoeken naar achterstallige thumbs...");
  const res = await pool.query("SELECT id, filepath FROM downloads WHERE status = 'completed' AND (is_thumb_ready = false OR is_thumb_ready IS NULL) AND filepath IS NOT NULL AND filepath != ''");
  
  const tasks = res.rows;
  console.log(`Gevonden: ${tasks.length} items.`);

  let successCount = 0;
  let failCount = 0;

  for (const row of tasks) {
    if (!fs.existsSync(row.filepath)) {
      failCount++;
      continue;
    }

    const stat = fs.statSync(row.filepath);
    if (!stat.isFile()) continue;

    const ext = path.extname(row.filepath).toLowerCase();
    if (!['.mp4', '.mkv', '.webm', '.mov', '.avi'].includes(ext)) {
      // Als het een afbeelding is, is thumb ready
      await pool.query("UPDATE downloads SET is_thumb_ready = true WHERE id = $1", [row.id]);
      continue;
    }

    const thumbPath = row.filepath + '._thumb.jpg';
    
    // Genereren
    const ok = await generateThumb(row.filepath, thumbPath);
    if (ok && fs.existsSync(thumbPath)) {
      await pool.query("UPDATE downloads SET is_thumb_ready = true WHERE id = $1", [row.id]);
      successCount++;
      process.stdout.write('✓');
    } else {
      failCount++;
      process.stdout.write('x');
    }
  }

  console.log(`\n\nKlaar! ${successCount} succesvol gegenereerd, ${failCount} overgeslagen/fouten.`);
  pool.end();
}

run().catch(console.error);
