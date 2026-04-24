const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res1 = await client.query(`SELECT COUNT(*) FROM (SELECT * FROM downloads d TABLESAMPLE SYSTEM(10) ORDER BY RANDOM() LIMIT 2400 OFFSET 0) x;`);
  const res2 = await client.query(`SELECT COUNT(*) FROM (SELECT * FROM downloads d TABLESAMPLE SYSTEM(10) ORDER BY RANDOM() LIMIT 2400 OFFSET 2400) x;`);
  const res3 = await client.query(`SELECT COUNT(*) FROM (SELECT * FROM downloads d TABLESAMPLE SYSTEM(10) ORDER BY RANDOM() LIMIT 2400 OFFSET 15000) x;`);
  console.log(res1.rows[0], res2.rows[0], res3.rows[0]);
  client.end();
})();
