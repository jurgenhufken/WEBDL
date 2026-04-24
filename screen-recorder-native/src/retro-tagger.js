require('dotenv').config();
const { Client } = require('pg');
const { generateTagsForMedia } = require('./v2/services/auto-tagger');

console.log(`[AUTO-TAGGER] Starting Retroactive Tagging Pipeline`);
console.log(`-----------------------------------------------------`);

async function runRetroTagger() {
  const client = new Client(process.env.DATABASE_URL || 'postgres://localhost/webdl');
  await client.connect();

  try {
    console.log(`\n=> Fetching all completed downloads...`);
    // Fetch all downloads to tag them
    const res = await client.query("SELECT id, title, filepath, channel, platform FROM downloads WHERE status = 'completed'");
    const total = res.rows.length;
    console.log(`=> Found ${total} videos to process.`);

    let processed = 0;
    let newTagsAdded = 0;
    let lastTime = Date.now();

    for (const row of res.rows) {
      const tags = generateTagsForMedia(row);
      
      if (tags.length > 0) {
        // Insert tags into download_tags
        // We use ON CONFLICT DO NOTHING to avoid duplicate tag errors per download
        const values = [];
        const placeholders = [];
        let i = 1;
        for (const tag of tags) {
          placeholders.push(`($${i++}, $${i++})`);
          values.push(row.id, tag);
        }

        const query = `
          INSERT INTO download_tags (download_id, tag) 
          VALUES ${placeholders.join(', ')} 
          ON CONFLICT ON CONSTRAINT download_tags_download_id_tag_key DO NOTHING
        `;
        
        const insertRes = await client.query(query, values);
        newTagsAdded += insertRes.rowCount || 0;
      }

      processed++;
      if (processed % 1000 === 0) {
        const now = Date.now();
        const speed = Math.floor(1000 / ((now - lastTime) / 1000));
        lastTime = now;
        process.stdout.write(`\r\x1b[K=> Processed ${processed} / ${total} videos... (Added ${newTagsAdded} new tags so far) [${speed} items/sec]`);
      }
    }

    console.log(`\n\n[OK] Retroactive Tagging Complete!`);
    console.log(`=> Automatically generated and saved ${newTagsAdded} tags across ${total} videos.`);

  } catch (err) {
    console.error(`\n[ERROR] during retro-tagging:`, err);
  } finally {
    await client.end();
  }
}

runRetroTagger();
