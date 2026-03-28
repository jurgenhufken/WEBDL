const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://jurgen@localhost:5432/webdl' });
pool.query("SELECT * FROM downloads WHERE channel = 'matilda_tilda'").then(res => {
  console.log('matilda_tilda downloads:', res.rows.length);
  return pool.query("SELECT COUNT(*) FROM download_files f JOIN downloads d ON d.id = f.download_id WHERE d.channel = 'matilda_tilda'");
}).then(res => {
  console.log('matilda_tilda download_files:', res.rows[0].count);
  process.exit();
}).catch(console.error);
