const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  // Last 15 downloads regardless of platform
  const r = await client.query(`
    SELECT id, platform, channel, title, status, url,
           created_at, finished_at
    FROM downloads ORDER BY id DESC LIMIT 15
  `);
  console.log('=== Laatste 15 downloads ===');
  for (const row of r.rows) {
    const t = row.created_at ? new Date(row.created_at).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'}) : '?';
    const st = row.status === 'completed' ? '✅' : row.status === 'error' ? '❌' : row.status === 'cancelled' ? '🚫' : row.status === 'downloading' ? '⬇️' : '⏳';
    console.log(`${st} #${row.id} ${t} ${row.status.padEnd(12)} ${(row.platform||'?').padEnd(18)} ${(row.title||'').slice(0,40)}`);
  }
  
  // Check for any active/pending tasks
  const r2 = await client.query(`
    SELECT id, platform, channel, title, status, url
    FROM downloads 
    WHERE status IN ('pending','queued','downloading','postprocessing')
    ORDER BY id DESC LIMIT 10
  `);
  console.log(`\n=== Actieve/wachtende downloads: ${r2.rows.length} ===`);
  for (const row of r2.rows) {
    console.log(`  #${row.id} ${row.status.padEnd(12)} ${(row.platform||'?').padEnd(15)} ${(row.url||'').slice(0,60)}`);
  }
  
  client.end();
})();
