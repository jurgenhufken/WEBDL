const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query(`
    SELECT status, COUNT(*) as cnt
    FROM downloads
    WHERE platform = 'footfetishforum'
      AND created_at > NOW() - INTERVAL '4 hours'
    GROUP BY status ORDER BY status
  `);
  console.log('FFF laatste 4 uur:');
  res.rows.forEach(r => console.log(`  ${r.status}: ${r.cnt}`));
  const res2 = await client.query(`SELECT COUNT(*) as cnt FROM downloads WHERE platform='footfetishforum' AND status IN ('pending','queued')`);
  console.log(`Wachtrij: ${res2.rows[0].cnt}`);
  const res3 = await client.query(`SELECT COUNT(*) as cnt FROM downloads WHERE status='downloading'`);
  console.log(`Actief downloading: ${res3.rows[0].cnt}`);
  client.end();
})();
