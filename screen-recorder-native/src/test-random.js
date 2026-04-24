const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query('EXPLAIN ANALYZE SELECT * FROM downloads TABLESAMPLE SYSTEM(1) LIMIT 120;');
  console.log(res.rows.map(r => r["QUERY PLAN"]).join('\n'));
  client.end();
})();
