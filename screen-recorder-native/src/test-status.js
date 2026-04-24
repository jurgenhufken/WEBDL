const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query(`SELECT id, status, platform, channel, title FROM downloads WHERE status != 'completed' AND status != 'failed' AND status != 'error';`);
  console.log(res.rows);
  client.end();
})();
