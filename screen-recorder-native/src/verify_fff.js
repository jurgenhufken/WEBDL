const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query(`SELECT id, status, url, filename, filesize FROM downloads WHERE id >= 160594 AND id <= 160603;`);
  console.log('=== footfetishforum Initiation Post downloads ===');
  res.rows.forEach(r => console.log(`  #${r.id} ${r.status} size=${r.filesize} file=${r.filename}`));
  
  const res2 = await client.query(`SELECT COUNT(*) FROM downloads WHERE platform = '4kdownloader' AND created_at > NOW() - INTERVAL '1 hour';`);
  console.log(`\n4K downloads indexed in last hour: ${res2.rows[0].count}`);
  
  client.end();
})();
