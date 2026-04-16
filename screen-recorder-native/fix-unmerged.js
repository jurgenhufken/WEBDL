#!/usr/bin/env node
/**
 * Fix unmerged yt-dlp downloads:
 * 1. Find downloads with .f###.mp4/.m4a filepath
 * 2. Merge video+audio streams
 * 3. Update DB filepath
 * 4. Clean up stream files
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

async function main() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: 'postgres://localhost/webdl' });

  // Find all downloads with unmerged stream filepaths
  const { rows } = await pool.query(`
    SELECT id, filepath, title FROM downloads
    WHERE (filepath LIKE '%.f1%.m4a' OR filepath LIKE '%.f2%.mp4' OR filepath LIKE '%.f3%.mp4' OR filepath LIKE '%.f4%.mp4')
    AND status = 'completed'
    ORDER BY id DESC
  `);

  console.log(`Found ${rows.length} unmerged downloads`);

  for (const r of rows) {
    const fp = String(r.filepath || '').trim();
    if (!fp) continue;
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) {
      console.log(`  #${r.id} dir missing: ${dir}`);
      continue;
    }

    const files = fs.readdirSync(dir);

    // Check if merged file already exists
    const mergedFile = files.find(f => f.endsWith('.mp4') && !/\.f\d+\.mp4$/i.test(f) && !f.includes('.temp'));
    if (mergedFile) {
      const mergedPath = path.join(dir, mergedFile);
      console.log(`  #${r.id} already merged → ${mergedFile} (${Math.round(fs.statSync(mergedPath).size/1024)}KB)`);
      await pool.query('UPDATE downloads SET filepath = $1 WHERE id = $2', [mergedPath, r.id]);
      // Clean up stream files
      for (const f of files.filter(f => /\.f\d+\.(mp4|m4a)$/i.test(f))) {
        const streamPath = path.join(dir, f);
        fs.unlinkSync(streamPath);
        console.log(`    cleaned: ${f}`);
      }
      continue;
    }

    // Find video and audio streams to merge
    const videoStream = files.find(f => /\.f\d+\.mp4$/i.test(f));
    const audioStream = files.find(f => /\.f\d+\.m4a$/i.test(f));

    if (videoStream && audioStream) {
      const vPath = path.join(dir, videoStream);
      const aPath = path.join(dir, audioStream);
      const baseName = videoStream.replace(/\.f\d+\.mp4$/i, '.mp4');
      const outPath = path.join(dir, baseName);

      console.log(`  #${r.id} merging: ${videoStream} + ${audioStream}`);
      try {
        execSync(`/opt/homebrew/bin/ffmpeg -i "${vPath}" -i "${aPath}" -c copy -movflags +faststart "${outPath}" -y`, {
          timeout: 120000,
          stdio: 'pipe'
        });
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1024) {
          await pool.query('UPDATE downloads SET filepath = $1 WHERE id = $2', [outPath, r.id]);
          fs.unlinkSync(vPath);
          fs.unlinkSync(aPath);
          console.log(`  ✅ #${r.id} merged → ${baseName} (${Math.round(fs.statSync(outPath).size/1024)}KB)`);
        }
      } catch (e) {
        console.log(`  ❌ #${r.id} merge failed: ${(e.message || '').slice(0, 80)}`);
      }
    } else if (audioStream && !videoStream) {
      // Audio-only — filepath points to m4a, keep as-is but log
      console.log(`  ⚠️  #${r.id} audio-only (no video stream found)`);
    } else {
      console.log(`  ⚠️  #${r.id} incomplete: video=${!!videoStream} audio=${!!audioStream}`);
    }
  }

  await pool.end();
  console.log('\n✅ Klaar!');
}

main().catch(e => { console.error('❌', e); process.exit(1); });
