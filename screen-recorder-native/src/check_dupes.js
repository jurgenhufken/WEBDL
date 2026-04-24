const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query(`
    SELECT filepath, COUNT(*) as cnt 
    FROM downloads 
    WHERE metadata LIKE '%4k-watcher%' 
    GROUP BY filepath 
    HAVING COUNT(*) > 1 
    ORDER BY cnt DESC 
    LIMIT 10
  `);
  console.log(`Duplicate filepaths: ${res.rows.length}`);
  res.rows.forEach(r => console.log(`  ${r.cnt}x ${(r.filepath||'').slice(-60)}`));
  client.end();
})();
