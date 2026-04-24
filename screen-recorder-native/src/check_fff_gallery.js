const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  // Total completed FFF today
  const r1 = await client.query(`SELECT COUNT(*) as cnt FROM downloads WHERE platform='footfetishforum' AND status='completed' AND created_at::date = CURRENT_DATE`);
  console.log(`FFF voltooid vandaag: ${r1.rows[0].cnt}`);
  
  // Unique files in gallery (download_files)
  const r2 = await client.query(`SELECT COUNT(DISTINCT df.relpath) as cnt FROM download_files df JOIN downloads d ON d.id=df.download_id WHERE d.platform='footfetishforum' AND d.status='completed' AND d.created_at::date = CURRENT_DATE`);
  console.log(`Unieke bestanden in gallery vandaag: ${r2.rows[0].cnt}`);
  
  // Errored ones
  const r3 = await client.query(`SELECT id,url,title FROM downloads WHERE platform='footfetishforum' AND status='error' AND created_at::date = CURRENT_DATE`);
  if (r3.rows.length) {
    console.log(`\nMislukt:`);
    r3.rows.forEach(r => console.log(`  #${r.id} ${(r.url||'').slice(0,60)} ${(r.title||'').slice(0,30)}`));
  }
  
  // Cancelled
  const r4 = await client.query(`SELECT COUNT(*) as cnt FROM downloads WHERE platform='footfetishforum' AND status='cancelled' AND created_at::date = CURRENT_DATE`);
  console.log(`Geannuleerd vandaag: ${r4.rows[0].cnt}`);
  
  client.end();
})();
