const { Client } = require('pg');
const fs = require('fs');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
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
        [row.id, rel, Math.round(st.mtimeMs)]
      );
      console.log(`  ✅ #${row.id} ${rel.slice(-50)}`);
    }
  }
  console.log(`Fixed ${r2.rows.length} items`);
  client.end();
})();
