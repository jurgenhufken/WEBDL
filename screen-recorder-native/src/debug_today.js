const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  const res = await client.query(`
    SELECT id, platform, title, 
           created_at, finished_at,
           COALESCE(finished_at, updated_at, created_at) as sort_ts
    FROM downloads 
    WHERE status = 'completed'
      AND COALESCE(finished_at, updated_at, created_at)::date = CURRENT_DATE
    ORDER BY COALESCE(finished_at, updated_at, created_at) DESC
    LIMIT 15
  `);
  console.log(`Items with today's date: ${res.rows.length}`);
  res.rows.forEach(r => console.log(`  #${r.id} ${r.platform} ${r.finished_at} ${(r.title||'').slice(0,40)}`));
  
  client.end();
})();
