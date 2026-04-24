const { Client } = require('pg');
const fs = require('fs');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  // Get all 4K imports from today that have wrong timestamps
  const res = await client.query(`
    SELECT id, filepath, created_at 
    FROM downloads 
    WHERE (platform = '4kdownloader' OR platform = 'youtube' OR platform = 'videodownloadhelper')
      AND metadata LIKE '%4k-watcher%'
      AND created_at > NOW() - INTERVAL '3 hours'
  `);
  
  console.log(`Found ${res.rows.length} 4K imports to fix timestamps`);
  let fixed = 0;
  
  for (const row of res.rows) {
    try {
      if (!row.filepath || !fs.existsSync(row.filepath)) continue;
      const st = fs.statSync(row.filepath);
      const fileMtime = new Date(st.mtimeMs).toISOString();
      await client.query(
        `UPDATE downloads SET created_at = $1, updated_at = $1, finished_at = $1 WHERE id = $2`,
        [fileMtime, row.id]
      );
      fixed++;
    } catch (e) {}
  }
  
  console.log(`Fixed ${fixed} timestamps to file mtime`);
  client.end();
})();
