const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  // Find all completed downloads where is_thumb_ready=true but thumbnail file doesn't exist
  const res = await client.query(`
    SELECT id, filepath, thumbnail, is_thumb_ready
    FROM downloads 
    WHERE status = 'completed' AND is_thumb_ready = true
      AND filepath IS NOT NULL AND filepath != ''
    ORDER BY id DESC
    LIMIT 2000
  `);
  
  let broken = 0;
  for (const r of res.rows) {
    const fp = String(r.filepath || '').trim();
    if (!fp) continue;
    // Check if thumb file exists
    const ext = path.extname(fp);
    const thumbPath = fp.replace(new RegExp(ext.replace('.', '\\.') + '$'), '_thumb_v3.jpg');
    if (!fs.existsSync(thumbPath)) {
      // For images, the image itself IS the thumb - that's fine
      if (/\.(jpg|jpeg|png|gif|webp)$/i.test(fp) && fs.existsSync(fp)) {
        continue; // Image file exists, it can be its own thumb
      }
      // Thumb is truly missing - reset so it gets regenerated
      await client.query(`UPDATE downloads SET is_thumb_ready = false WHERE id = $1`, [r.id]);
      broken++;
    }
  }
  
  console.log(`Fixed ${broken} downloads with missing thumbnails (reset is_thumb_ready=false)`);
  client.end();
})();
