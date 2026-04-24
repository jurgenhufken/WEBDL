const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query(`
    SELECT COUNT(*) as cnt, 
           SUM(CASE WHEN created_at::date = CURRENT_DATE THEN 1 ELSE 0 END) as today_created,
           SUM(CASE WHEN finished_at::date = CURRENT_DATE THEN 1 ELSE 0 END) as today_finished
    FROM downloads 
    WHERE platform IN ('4kdownloader','youtube','videodownloadhelper') 
      AND metadata LIKE '%4k-watcher%'
  `);
  console.log('4K imports:', res.rows[0]);
  
  // Show the most recent footfetishforum items to confirm they're visible
  const res2 = await client.query(`
    SELECT id, title, COALESCE(finished_at, updated_at, created_at) as ts
    FROM downloads 
    WHERE platform = 'footfetishforum' AND status = 'completed'
    ORDER BY COALESCE(finished_at, updated_at, created_at) DESC
    LIMIT 5
  `);
  console.log('\nNewest footfetishforum:');
  res2.rows.forEach(r => console.log(`  #${r.id} ${r.ts} ${(r.title||'').slice(0,40)}`));
  
  client.end();
})();
