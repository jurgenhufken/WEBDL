// src/db/migrate.js — voert schema.sql idempotent uit voor het opgegeven schema.
//
// Gebruik:
//   node src/db/migrate.js                     → schema uit config (DB_SCHEMA, default "webdl")
//   node src/db/migrate.js --schema=webdl_test → override (voor tests)
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const config = require('../config');

const SCHEMA_PLACEHOLDER = /__SCHEMA__/g;
const VALID_SCHEMA = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function parseSchemaArg(argv) {
  const arg = argv.find((a) => a.startsWith('--schema='));
  return arg ? arg.slice('--schema='.length) : null;
}

async function migrate({ schema, databaseUrl }) {
  if (!VALID_SCHEMA.test(schema)) {
    throw new Error(`Ongeldige schema-naam: "${schema}"`);
  }
  const sqlPath = path.join(__dirname, 'schema.sql');
  const raw = fs.readFileSync(sqlPath, 'utf8');
  const sql = raw.replace(SCHEMA_PLACEHOLDER, schema);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function main() {
  const schema = parseSchemaArg(process.argv.slice(2)) || config.dbSchema;
  await migrate({ schema, databaseUrl: config.databaseUrl });
  console.log(`[migrate] schema "${schema}" up-to-date`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[migrate] mislukt:', err.message);
    process.exit(1);
  });
}

module.exports = { migrate };
