const pg = require('pg');
const pool = new pg.Pool({ connectionString: 'postgres://jurgen:@localhost:5432/webdl' });
pool.query("UPDATE downloads SET status = 'pending' WHERE status IN ('queued', 'downloading', 'postprocessing')")
  .then(res => { console.log('Reset items'); process.exit(0); });
