const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query(`SELECT id, status, platform, title, filename FROM downloads WHERE filename LIKE '%recording%' ORDER BY id DESC LIMIT 5;`);
  console.log(res.rows);
  client.end();
})();
