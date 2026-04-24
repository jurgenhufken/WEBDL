const { Client } = require('pg');
const fs = require('fs');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query(`
    SELECT id, status, channel, title, filename, filepath, url,
           created_at, finished_at
    FROM downloads 
    WHERE platform = 'footfetishforum'
    ORDER BY id DESC LIMIT 25
  `);
  for (const r of res.rows) {
    const exists = r.filepath ? fs.existsSync(r.filepath) : false;
    const st = r.status === 'completed' ? '✅' : r.status === 'error' ? '❌' : r.status === 'cancelled' ? '🚫' : '⏳';
    console.log(`${st} #${r.id} ${r.status.padEnd(12)} ch=${(r.channel||'?').slice(0,25).padEnd(25)} file=${exists?'OK':'MISS'} ${(r.filename||'').slice(0,40)}`);
    if (r.status === 'error' || r.status === 'cancelled' || !exists) {
      console.log(`   url=${(r.url||'').slice(0,80)}`);
    }
  }
  client.end();
})();
