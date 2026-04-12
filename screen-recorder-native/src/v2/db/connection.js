'use strict';
/**
 * DB Connection — Pijler: Bibliotheek
 * 
 * Verbindt met PostgreSQL. Biedt een db object met:
 *   db.query(sql, params)  → { rows }
 *   db.prepare(sql)        → { get(params), all(params), run(params) }
 *   db.end()               → sluit connectie
 * 
 * Het prepare() pattern wrapt pg queries zodat de rest van de app
 * dezelfde interface gebruikt als de huidige simple-server.
 */
const { Pool } = require('pg');

function connectDb(config) {
  const connectionString = config.POSTGRES_URL || 'postgres://localhost/webdl';
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Wrap pool in een interface die compatible is met de huidige codebase
  const db = {
    pool,

    // Direct query
    async query(sql, params = []) {
      return pool.query(sql, params);
    },

    // Prepared statement factory — compatible met simple-server's db.prepare
    prepare(sql) {
      // Converteer ? placeholders naar $1, $2, ... (pg format)
      let paramIndex = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);

      return {
        async get(...args) {
          const { rows } = await pool.query(pgSql, args);
          return rows[0] || null;
        },
        async all(...args) {
          const { rows } = await pool.query(pgSql, args);
          return rows;
        },
        async run(...args) {
          const result = await pool.query(pgSql, args);
          return {
            changes: result.rowCount,
            lastInsertRowid: result.rows && result.rows[0] ? result.rows[0].id : null,
          };
        },
      };
    },

    // Sluit pool
    async end() {
      await pool.end();
    },
  };

  return db;
}

module.exports = { connectDb };
