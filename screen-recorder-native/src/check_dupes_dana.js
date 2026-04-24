const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const r = await client.query(`
    SELECT d.id, d.title, d.channel, d.filepath, d.status, d.created_at
    FROM downloads d
    WHERE d.title LIKE '%1000572662%'
    ORDER BY d.id DESC
  `);
  console.log(`Found ${r.rows.length} items matching "1000572662":`);
  for (const row of r.rows) {
    console.log(`  #${row.id} ${row.status} ch=${(row.channel||'').slice(0,20)} path=${(row.filepath||'').slice(-50)}`);
  }
  client.end();
})();
