const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  // How many FFF completed today in DB
  const r1 = await client.query(`SELECT COUNT(*) as cnt FROM downloads WHERE platform='footfetishforum' AND status='completed' AND COALESCE(finished_at,updated_at,created_at)::date = CURRENT_DATE`);
  
  // How many download_files today
  const r2 = await client.query(`SELECT COUNT(*) as cnt FROM download_files df JOIN downloads d ON d.id=df.download_id WHERE d.platform='footfetishforum' AND d.status='completed' AND COALESCE(d.finished_at,d.updated_at,d.created_at)::date = CURRENT_DATE`);
  
  // How many have is_thumb_ready = false
  const r3 = await client.query(`SELECT COUNT(*) as cnt FROM downloads WHERE platform='footfetishforum' AND status='completed' AND is_thumb_ready = false AND created_at::date = CURRENT_DATE`);
  
  // How many have NO download_files entry
  const r4 = await client.query(`SELECT COUNT(*) as cnt FROM downloads d WHERE d.platform='footfetishforum' AND d.status='completed' AND d.created_at::date = CURRENT_DATE AND NOT EXISTS (SELECT 1 FROM download_files df WHERE df.download_id = d.id)`);
  
  console.log(`DB downloads voltooid vandaag: ${r1.rows[0].cnt}`);
  console.log(`download_files entries vandaag: ${r2.rows[0].cnt}`);
  console.log(`Thumb NIET klaar: ${r3.rows[0].cnt}`);
  console.log(`GEEN download_files entry: ${r4.rows[0].cnt}`);
  
  client.end();
})();
