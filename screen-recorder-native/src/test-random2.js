const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query('EXPLAIN ANALYZE SELECT * FROM downloads WHERE id > (SELECT MAX(id) - 400000 FROM downloads) ORDER BY RANDOM() LIMIT 120;');
  console.log(res.rows.map(r => r["QUERY PLAN"]).join('\n'));
  client.end();
})();
