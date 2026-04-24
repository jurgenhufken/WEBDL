const { Client } = require('pg');
const fs = require('fs');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  // Fix thumb_ready for images (images are their own thumb)
  const r = await client.query(`
    SELECT id, filepath FROM downloads 
    WHERE platform='footfetishforum' AND status='completed' AND is_thumb_ready=false
      AND created_at::date = CURRENT_DATE
  `);
  let fixed = 0;
  for (const row of r.rows) {
    if (row.filepath && fs.existsSync(row.filepath) && /\.(jpg|jpeg|png|gif|webp)$/i.test(row.filepath)) {
      await client.query(`UPDATE downloads SET is_thumb_ready = true WHERE id = $1`, [row.id]);
      fixed++;
      console.log(`  ✅ #${row.id} thumb_ready=true (image is own thumb)`);
    } else {
      console.log(`  ⏳ #${row.id} ${row.filepath ? 'exists=' + fs.existsSync(row.filepath) : 'no path'}`);
    }
  }
  
  // Fix missing download_files
  const r2 = await client.query(`
    SELECT id, filepath FROM downloads d
    WHERE d.platform='footfetishforum' AND d.status='completed' AND d.created_at::date = CURRENT_DATE
      AND NOT EXISTS (SELECT 1 FROM download_files df WHERE df.download_id = d.id)
  `);
  for (const row of r2.rows) {
    if (row.filepath && fs.existsSync(row.filepath)) {
      const rel = row.filepath.replace('/Users/jurgen/Downloads/WEBDL/', '');
      const st = fs.statSync(row.filepath);
      await client.query(
        `INSERT INTO download_files (download_id, relpath, mtime_ms) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [row.id, rel, st.mtimeMs]
      );
      console.log(`  ✅ #${row.id} download_files added: ${rel.slice(-50)}`);
    }
  }
  
  console.log(`\nFixed ${fixed} thumbs, ${r2.rows.length} download_files`);
  client.end();
})();
