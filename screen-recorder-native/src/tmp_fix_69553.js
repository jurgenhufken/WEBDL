const { Client } = require('pg');
const c = new Client({connectionString:'postgresql://jurgen@localhost:5432/webdl'});
(async()=>{
  await c.connect();
  const res = await c.query("UPDATE downloads SET status='error', error='Orphaned download task interrupted' WHERE status='downloading' AND id=69553");
  console.log('Updated: ' + res.rowCount);
  await c.end();
})();
