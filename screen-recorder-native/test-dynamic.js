const pg = require('pg');
const pool = new pg.Pool({ connectionString: 'postgresql://jurgen@localhost:5432/webdl' });
const { initDb } = require('./src/database') || {}; // wait this is wrong
