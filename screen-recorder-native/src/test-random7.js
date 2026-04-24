const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query(`SELECT platform, COUNT(*) FROM (SELECT platform FROM downloads TABLESAMPLE SYSTEM(10) WHERE status = 'completed' AND filepath IS NOT NULL ORDER BY RANDOM() LIMIT 120) sub GROUP BY platform;`);
  console.log(res.rows);
  client.end();
})();
