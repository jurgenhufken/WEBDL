const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query('SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = \'downloads\';');
  console.log(res.rows[0]);
  client.end();
})();
