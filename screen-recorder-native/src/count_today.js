const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query(`
    SELECT platform, COUNT(*) as cnt 
    FROM downloads 
    WHERE finished_at > NOW() - INTERVAL '2 hours'
      AND status = 'completed'
    GROUP BY platform 
    ORDER BY cnt DESC;
  `);
  console.log('=== Completed in last 2 hours ===');
  let total = 0;
  res.rows.forEach(r => { console.log(`  ${r.platform}: ${r.cnt}`); total += parseInt(r.cnt); });
  console.log(`  TOTAL: ${total}`);
  client.end();
})();
