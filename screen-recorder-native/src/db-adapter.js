const Database = require('better-sqlite3');
const { Pool } = require('pg');

function adaptSqlPlaceholders(sql) {
  const input = String(sql || '');
  let counter = 1;
  return input.replace(/\?/g, () => `$${counter++}`);
}

function maybeAddReturningIdForInsert(sql) {
  const raw = String(sql || '');
  const trimmed = raw.trim();
  if (!/^insert\s+into\b/i.test(trimmed)) return raw;
  if (/\breturning\b/i.test(trimmed)) return raw;
  const withoutTrailingSemicolon = raw.replace(/;\s*$/g, '');
  return `${withoutTrailingSemicolon} RETURNING id`;
}

function createDb({ engine, sqlitePath, databaseUrl }) {
  const normalized = String(engine || 'sqlite').trim().toLowerCase();
  const isPostgres = normalized === 'postgres' || normalized === 'pg';

  if (isPostgres) {
    const pool = new Pool({ connectionString: String(databaseUrl || '') });
    return {
      engine: 'postgres',
      isPostgres: true,
      isSqlite: false,
      pool,
      prepare(sql) {
        const rawSql = maybeAddReturningIdForInsert(sql);
        
        function buildExec(args) {
          let pgSql = rawSql;
          const pgArgs = [];
          let counter = 1;
          pgSql = pgSql.replace(/\?/g, () => {
            if (counter - 1 >= args.length) return '?';
            const val = args[counter - 1];
            counter++;
            if (typeof val === 'number') {
              return String(val);
            }
            pgArgs.push(val);
            return `$${pgArgs.length}`;
          });
          if (pgSql.includes('UNION ALL') && pgSql.includes('LIMIT')) {
            console.log('[DEBUG-SQL]', pgSql.substring(Math.max(0, pgSql.length - 100)).trim());
            console.log('[DEBUG-ARGS]', pgArgs);
          }
          return { pgSql, pgArgs };
        }

        return {
          source: rawSql,
          get: async (...args) => {
            const { pgSql, pgArgs } = buildExec(args);
            const res = await pool.query(pgSql, pgArgs.length ? pgArgs : undefined);
            return res.rows[0];
          },
          all: async (...args) => {
            const { pgSql, pgArgs } = buildExec(args);
            const res = await pool.query(pgSql, pgArgs.length ? pgArgs : undefined);
            return res.rows;
          },
          run: async (...args) => {
            const { pgSql, pgArgs } = buildExec(args);
            const res = await pool.query(pgSql, pgArgs.length ? pgArgs : undefined);
            const id = res.rows && res.rows[0] && (res.rows[0].id ?? res.rows[0].download_id ?? res.rows[0].screenshot_id);
            return { lastInsertRowid: id ?? null, changes: res.rowCount };
          },
          iterate: async function* (...args) {
            const rows = await this.all(...args);
            for (const row of rows) yield row;
          }
        };
      },
      query(text, params) {
        return pool.query(text, params);
      },
      async close() {
        await pool.end();
      }
    };
  }

  const db = new Database(String(sqlitePath || ''));
  return {
    engine: 'sqlite',
    isPostgres: false,
    isSqlite: true,
    sqlite: db,
    prepare(sql) {
      return db.prepare(sql);
    },
    exec(sql) {
      return db.exec(sql);
    },
    pragma(...args) {
      return db.pragma(...args);
    },
    transaction(fn) {
      return db.transaction(fn);
    },
    close() {
      db.close();
    }
  };
}

module.exports = { createDb };
