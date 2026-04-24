const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query(`SELECT id, status, platform, url, title FROM downloads WHERE status = 'pending' OR status = 'queued' OR status = 'downloading' ORDER BY id DESC LIMIT 10;`);
  console.log('=== Still pending/queued/downloading ===');
  res.rows.forEach(r => console.log(`  #${r.id} status=${r.status} plat=${r.platform} url=${(r.url||'').slice(0,80)}`));
  client.end();
})();
