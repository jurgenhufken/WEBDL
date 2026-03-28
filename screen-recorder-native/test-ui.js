const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://jurgen@localhost:5432/webdl' });
const sql = `
  SELECT 'p' AS kind, f.relpath AS id, d.channel
  FROM download_files f JOIN downloads d ON d.id = f.download_id WHERE d.channel = 'matilda_tilda'
`;
pool.query(sql).then(res => { console.log('p rows:', res.rowCount); process.exit(); });
