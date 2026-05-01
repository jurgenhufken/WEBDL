// Import keep2share bestanden als individuele downloads-records zodat de gallery ze toont
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: 'postgresql://jurgen@localhost:5432/webdl' });
const BASE_DIR = '/Users/jurgen/Downloads/WEBDL';
const K2S_DIR = path.join(BASE_DIR, '_Keep2Share');

const MEDIA_EXTS = new Set([
  '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.wmv', '.flv', '.ts',
]);

async function run() {
  // Zoek alle submappen in _Keep2Share (elk is een "channel")
  const channels = fs.readdirSync(K2S_DIR).filter(name => {
    try { return fs.statSync(path.join(K2S_DIR, name)).isDirectory(); } catch { return false; }
  });

  console.log(`Gevonden channels: ${channels.join(', ')}`);
  let totalAdded = 0;
  let totalSkipped = 0;

  for (const channel of channels) {
    const channelDir = path.join(K2S_DIR, channel);

    // Vind alle mediabestanden
    const files = fs.readdirSync(channelDir).filter(f => {
      const ext = path.extname(f).toLowerCase();
      if (!MEDIA_EXTS.has(ext) || f.startsWith('.')) return false;
      // Skip thumbnails
      if (f.includes('_thumb') || f.includes('_thumb_v3')) return false;
      return true;
    });

    console.log(`Channel "${channel}": ${files.length} bestanden gevonden`);

    for (const file of files) {
      const absPath = path.join(channelDir, file);
      const ext = path.extname(file).toLowerCase().replace('.', '');
      const title = path.basename(file, path.extname(file));
      let stat;
      try { stat = fs.statSync(absPath); } catch { continue; }

      // Check of dit bestand al als download-record bestaat
      const { rows: existing } = await pool.query(
        `SELECT id FROM downloads WHERE filepath = $1 LIMIT 1`,
        [absPath]
      );

      if (existing.length > 0) {
        totalSkipped++;
        continue;
      }

      // Maak een individueel download-record aan
      await pool.query(`
        INSERT INTO downloads (url, status, platform, channel, title, filename, filepath, filesize, format, source_url, created_at, updated_at, finished_at)
        VALUES ($1, 'completed', 'keep2share', $2, $3, $4, $5, $6, $7, 'https://keep2share.cc',
                to_timestamp($8 / 1000.0), to_timestamp($8 / 1000.0), to_timestamp($8 / 1000.0))
      `, [
        `https://keep2share.cc/${channel}/${encodeURIComponent(file)}`,
        channel,
        title,
        file,
        absPath,
        stat.size,
        ext,
        stat.mtimeMs
      ]);
      totalAdded++;
    }
  }

  // Ruim het oude map-record op (als dat bestaat)
  await pool.query(`DELETE FROM downloads WHERE platform = 'keep2share' AND filepath LIKE '%_Keep2Share/%' AND filepath NOT LIKE '%.%'`);

  console.log(`\nKlaar! ${totalAdded} nieuwe items toegevoegd, ${totalSkipped} al aanwezig.`);
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
