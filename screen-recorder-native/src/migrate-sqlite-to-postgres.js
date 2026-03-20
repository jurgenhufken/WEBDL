const fs = require('fs');
const os = require('os');
const path = require('path');

const Database = require('better-sqlite3');
const { Client } = require('pg');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq >= 0 ? a.slice(2, eq) : a.slice(2);
      const val = eq >= 0 ? a.slice(eq + 1) : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '1');
      out[key] = val;
      continue;
    }
    out._.push(a);
  }
  return out;
}

function buildMultiRowInsertSql(table, columns, rowCount) {
  const colCount = columns.length;
  const values = [];
  let p = 1;
  for (let r = 0; r < rowCount; r++) {
    const row = [];
    for (let c = 0; c < colCount; c++) {
      row.push(`$${p++}`);
    }
    values.push(`(${row.join(', ')})`);
  }
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')}`;
}

function buildOnConflictClause({ table, columns, mode }) {
  const m = String(mode || 'skip').trim().toLowerCase();
  if (m !== 'skip' && m !== 'upsert') return '';

  let conflictCols = null;
  if (table === 'download_files') conflictCols = ['download_id', 'relpath'];
  else if (table === 'download_tags') conflictCols = ['download_id', 'tag'];
  else conflictCols = ['id'];

  if (m === 'skip') return ` ON CONFLICT (${conflictCols.join(', ')}) DO NOTHING`;

  const updateCols = columns.filter((c) => !conflictCols.includes(c));
  if (!updateCols.length) return ` ON CONFLICT (${conflictCols.join(', ')}) DO NOTHING`;

  const setSql = updateCols.map((c) => `${c}=EXCLUDED.${c}`).join(', ');
  let whereSql = '';
  if (columns.includes('updated_at') && (table === 'downloads' || table === 'screenshots' || table === 'download_files')) {
    whereSql = ' WHERE EXCLUDED.updated_at IS NOT NULL AND (' + table + '.updated_at IS NULL OR EXCLUDED.updated_at > ' + table + '.updated_at)';
  }
  return ` ON CONFLICT (${conflictCols.join(', ')}) DO UPDATE SET ${setSql}${whereSql}`;
}

function getSqliteTableColumnsSet(sqliteDb, table) {
  try {
    const rows = sqliteDb.prepare(`PRAGMA table_info(${table})`).all();
    const set = new Set();
    for (const r of rows || []) {
      const name = r && r.name ? String(r.name) : '';
      if (name) set.add(name);
    }
    return set;
  } catch (e) {
    return new Set();
  }
}

function buildSqliteSelectList(sqliteColsSet, columns) {
  const parts = [];
  for (const c of columns) {
    if (sqliteColsSet.has(c)) parts.push(c);
    else parts.push(`NULL AS ${c}`);
  }
  return parts.join(', ');
}

function formatMs(ms) {
  const n = Math.max(0, Number(ms) || 0);
  const s = Math.floor(n / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (x) => String(x).padStart(2, '0');
  if (hh > 0) return `${hh}:${pad(mm)}:${pad(ss)}`;
  return `${mm}:${pad(ss)}`;
}

function fmtInt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return Math.trunc(x).toLocaleString('en-US');
}

function fmtPct(done, total) {
  const d = Number(done);
  const t = Number(total);
  if (!Number.isFinite(d) || !Number.isFinite(t) || t <= 0) return '';
  return `${(100 * (d / t)).toFixed(1)}%`;
}

async function copySqliteTableToPostgres({
  sqliteDb,
  pgClient,
  table,
  columns,
  batchRows,
  dryRun,
  mode,
  progress
}) {
  const colCount = columns.length;
  const sqliteColsSet = getSqliteTableColumnsSet(sqliteDb, table);
  const selectList = buildSqliteSelectList(sqliteColsSet, columns);
  const stmt = sqliteDb.prepare(`SELECT ${selectList} FROM ${table} ORDER BY id ASC`);

  let totalExpected = null;
  try {
    const r = sqliteDb.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
    totalExpected = r && r.c != null ? Number(r.c) : null;
    if (!Number.isFinite(totalExpected)) totalExpected = null;
  } catch (e) {
    totalExpected = null;
  }

  const startedAt = Date.now();
  let lastPrintAt = 0;
  const shouldPrint = () => {
    if (!progress) return false;
    const now = Date.now();
    if (!lastPrintAt) return true;
    return (now - lastPrintAt) >= 800;
  };
  const printProgress = (force) => {
    if (!progress) return;
    const now = Date.now();
    if (!force && !shouldPrint()) return;
    lastPrintAt = now;
    const elapsedMs = Math.max(1, now - startedAt);
    const rate = total > 0 ? (total / (elapsedMs / 1000)) : 0;
    const pct = totalExpected != null ? fmtPct(total, totalExpected) : '';
    const etaMs = (totalExpected != null && rate > 0) ? ((totalExpected - total) / rate) * 1000 : null;
    const etaStr = etaMs != null && Number.isFinite(etaMs) ? formatMs(etaMs) : '';
    const totalStr = totalExpected != null ? fmtInt(totalExpected) : '?';
    const line = `[${table}] ${fmtInt(total)}/${totalStr}${pct ? ' (' + pct + ')' : ''} | ${rate ? rate.toFixed(1) : '0.0'} rows/s | elapsed ${formatMs(elapsedMs)}${etaStr ? ' | eta ' + etaStr : ''}${dryRun ? ' | dry-run' : ''}\n`;
    try { process.stderr.write(line); } catch (e) {}
  };

  let total = 0;
  let batch = [];

  const flush = async () => {
    if (!batch.length) return;
    if (!dryRun) {
      const sql = buildMultiRowInsertSql(table, columns, batch.length) + buildOnConflictClause({ table, columns, mode });
      const values = batch.flat();
      await pgClient.query(sql, values);
    }
    batch = [];
    printProgress(false);
  };

  for (const row of stmt.iterate()) {
    const vals = [];
    for (let i = 0; i < colCount; i++) {
      const k = columns[i];
      vals.push(row[k] == null ? null : row[k]);
    }
    batch.push(vals);
    total++;
    if (batch.length >= batchRows) {
      await flush();
    }
  }

  await flush();
  printProgress(true);
  return total;
}

async function setIdentitySequenceToMax({ pgClient, table, idColumn }) {
  const maxRes = await pgClient.query(`SELECT MAX(${idColumn})::bigint AS max_id FROM ${table}`);
  const maxId = maxRes && maxRes.rows && maxRes.rows[0] ? maxRes.rows[0].max_id : null;
  const seqRes = await pgClient.query(`SELECT pg_get_serial_sequence('${table}', '${idColumn}') AS seq`);
  const seq = seqRes && seqRes.rows && seqRes.rows[0] ? seqRes.rows[0].seq : null;
  if (!seq) return;

  if (maxId == null) {
    await pgClient.query('SELECT setval($1, 1, false)', [seq]);
  } else {
    await pgClient.query('SELECT setval($1, $2, true)', [seq, maxId]);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const defaultSqlitePath = path.join(os.homedir(), 'Downloads', 'WEBDL', 'webdl.db');
  const sqlitePath = String(args.sqlite || process.env.WEBDL_SQLITE_DB_PATH || defaultSqlitePath);
  const schemaPath = String(args.schema || path.join(__dirname, 'postgres-schema.sql'));
  const databaseUrl = String(args.databaseUrl || args.db || process.env.DATABASE_URL || 'postgres://localhost/webdl');
  const reset = String(args.reset || '0') !== '0';
  const dryRun = String(args.dryRun || args['dry-run'] || '0') !== '0';
  const mode = String(args.mode || 'skip').trim().toLowerCase();
  const progress = String(args.progress || '1') !== '0';
  const batchRowsRaw = parseInt(String(args.batch || '250'), 10);
  const batchRows = Number.isFinite(batchRowsRaw) ? Math.max(1, Math.min(1000, batchRowsRaw)) : 250;

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite db bestaat niet: ${sqlitePath}`);
  }
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file bestaat niet: ${schemaPath}`);
  }

  const sqliteDb = new Database(sqlitePath, { readonly: true });
  const pgClient = new Client({ connectionString: databaseUrl });

  try {
    await pgClient.connect();

    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    if (!dryRun) {
      await pgClient.query(schemaSql);

      try { await pgClient.query('ALTER TABLE downloads ADD COLUMN IF NOT EXISTS rating DOUBLE PRECISION'); } catch (e) {}
      try { await pgClient.query('ALTER TABLE downloads ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP'); } catch (e) {}
      try { await pgClient.query('ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS rating DOUBLE PRECISION'); } catch (e) {}
      try { await pgClient.query('ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP'); } catch (e) {}

      if (reset) {
        await pgClient.query('TRUNCATE TABLE download_tags, download_files, vdh_hints, screenshots, downloads RESTART IDENTITY CASCADE');
      }
      await pgClient.query('BEGIN');
    }

    const counts = {};

    counts.downloads = await copySqliteTableToPostgres({
      sqliteDb,
      pgClient,
      table: 'downloads',
      columns: [
        'id',
        'url',
        'platform',
        'channel',
        'title',
        'description',
        'duration',
        'thumbnail',
        'filename',
        'filepath',
        'filesize',
        'format',
        'status',
        'progress',
        'error',
        'metadata',
        'rating',
        'source_url',
        'created_at',
        'updated_at',
        'finished_at'
      ],
      batchRows,
      dryRun,
      mode,
      progress
    });

    counts.screenshots = await copySqliteTableToPostgres({
      sqliteDb,
      pgClient,
      table: 'screenshots',
      columns: ['id', 'url', 'platform', 'channel', 'title', 'filename', 'filepath', 'filesize', 'rating', 'created_at', 'updated_at'],
      batchRows,
      dryRun,
      mode,
      progress
    });

    counts.vdh_hints = await copySqliteTableToPostgres({
      sqliteDb,
      pgClient,
      table: 'vdh_hints',
      columns: ['id', 'url', 'platform', 'channel', 'title', 'created_at'],
      batchRows,
      dryRun,
      mode,
      progress
    });

    counts.download_files = await copySqliteTableToPostgres({
      sqliteDb,
      pgClient,
      table: 'download_files',
      columns: ['id', 'download_id', 'relpath', 'filesize', 'mtime_ms', 'created_at', 'updated_at'],
      batchRows,
      dryRun,
      mode,
      progress
    });

    counts.download_tags = await copySqliteTableToPostgres({
      sqliteDb,
      pgClient,
      table: 'download_tags',
      columns: ['id', 'download_id', 'tag', 'created_at'],
      batchRows,
      dryRun,
      mode,
      progress
    });

    if (!dryRun) {
      await pgClient.query('COMMIT');

      await setIdentitySequenceToMax({ pgClient, table: 'downloads', idColumn: 'id' });
      await setIdentitySequenceToMax({ pgClient, table: 'screenshots', idColumn: 'id' });
      await setIdentitySequenceToMax({ pgClient, table: 'vdh_hints', idColumn: 'id' });
      await setIdentitySequenceToMax({ pgClient, table: 'download_files', idColumn: 'id' });
      await setIdentitySequenceToMax({ pgClient, table: 'download_tags', idColumn: 'id' });
    }

    process.stdout.write(JSON.stringify({
      success: true,
      dryRun,
      reset,
      mode,
      sqlitePath,
      databaseUrl,
      batchRows,
      counts
    }, null, 2));
    process.stdout.write('\n');
  } catch (e) {
    try {
      if (!dryRun) await pgClient.query('ROLLBACK');
    } catch (e2) {}
    throw e;
  } finally {
    try { sqliteDb.close(); } catch (e) {}
    try { await pgClient.end(); } catch (e) {}
  }
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e));
  process.stderr.write('\n');
  process.exit(1);
});
