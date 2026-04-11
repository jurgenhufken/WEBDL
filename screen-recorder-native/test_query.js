const pg = require('pg');
const pool = new pg.Pool({ connectionString: 'postgres://jurgen:@localhost:5432/webdl' });
pool.query("SELECT platform, COUNT(*) FROM downloads GROUP BY platform ORDER BY COUNT(*) DESC LIMIT 20;")
  .then(res => { console.log(res.rows); process.exit(0); });
