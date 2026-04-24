const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  // Reset stuck downloads to pending so they get retried
  const r = await client.query(`
    UPDATE downloads SET status = 'pending', progress = 0
    WHERE status = 'downloading' AND updated_at < NOW() - INTERVAL '3 minutes'
    RETURNING id, platform, title
  `);
  console.log(`Reset ${r.rows.length} vastzittende downloads:`);
  r.rows.forEach(row => console.log(`  #${row.id} ${row.platform} ${(row.title||'').slice(0,40)}`));
  client.end();
})();
