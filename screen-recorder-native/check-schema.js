const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://jurgen@localhost:5432/webdl' });
pool.query(`
SELECT conname, pg_get_constraintdef(c.oid) 
FROM pg_constraint c 
JOIN pg_namespace n ON n.oid = c.connamespace 
WHERE contype IN ('u', 'p') AND conrelid = 'download_files'::regclass;
`).then(res => {
  console.log('unique constraints:', res.rows);
  process.exit();
}).catch(console.error);
