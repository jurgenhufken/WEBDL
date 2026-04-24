const { Client } = require('pg');
const fs = require('fs');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  // Get ALL 4K imports that have a filepath we can check
  const res = await client.query(`
    SELECT id, filepath
    FROM downloads 
    WHERE metadata LIKE '%4k-watcher%'
      AND filepath IS NOT NULL 
      AND filepath != ''
      AND finished_at::date = CURRENT_DATE
  `);
  
  console.log(`Found ${res.rows.length} 4K imports with today's timestamp to fix`);
  let fixed = 0, skipped = 0;
  
  for (const row of res.rows) {
    try {
      if (!row.filepath || !fs.existsSync(row.filepath)) { skipped++; continue; }
      const st = fs.statSync(row.filepath);
      const fileMtime = new Date(st.mtimeMs).toISOString();
      // Only fix if the file is NOT actually from today
      const fileDate = new Date(st.mtimeMs);
      const today = new Date();
      if (fileDate.toDateString() === today.toDateString()) { skipped++; continue; } // Actually from today, leave it
      
      await client.query(
        `UPDATE downloads SET created_at = $1, updated_at = $1, finished_at = $1 WHERE id = $2`,
        [fileMtime, row.id]
      );
      fixed++;
    } catch (e) { skipped++; }
  }
  
  console.log(`Fixed: ${fixed}, Skipped (actually today or missing): ${skipped}`);
  client.end();
})();
