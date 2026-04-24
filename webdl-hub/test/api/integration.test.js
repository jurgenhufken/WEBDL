// test/api/integration.test.js — start echte server, hit API, verify response.
// Skip als Postgres niet bereikbaar is.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Client } = require('pg');
const { migrate } = require('../../src/db/migrate');
const { createRepo } = require('../../src/db/repo');
const { createLogger } = require('../../src/util/logger');
const { buildApp } = require('../../src/app');
const ytdlp = require('../../src/adapters/ytdlp');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://jurgen@localhost:5432/webdl';
const TEST_SCHEMA = 'webdl_test_api';

async function canConnect() {
  try {
    const c = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

// Stille logger, zodat test-output leesbaar blijft.
function quietLogger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, with: () => quietLogger() };
}

async function postJSON(base, path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
async function getJSON(base, path) {
  const res = await fetch(base + path);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('API-integratie', { concurrency: false }, async (t) => {
  if (!(await canConnect())) {
    t.skip('PostgreSQL niet bereikbaar op ' + DATABASE_URL);
    return;
  }
  await migrate({ schema: TEST_SCHEMA, databaseUrl: DATABASE_URL });
  const repo = createRepo({ databaseUrl: DATABASE_URL, schema: TEST_SCHEMA });
  const logger = quietLogger();
  const { server } = buildApp({ repo, adapters: [ytdlp], logger });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((r) => server.close(r));
    const c = new Client({ connectionString: DATABASE_URL });
    await c.connect();
    await c.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await c.end();
    await repo.close();
  });

  await t.test('/api/health → db up', async () => {
    const { status, data } = await getJSON(base, '/api/health');
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.db, 'up');
  });

  await t.test('/api/adapters bevat ytdlp', async () => {
    const { data } = await getJSON(base, '/api/adapters');
    assert.ok(data.adapters.some((a) => a.name === 'ytdlp'));
  });

  let jobId;
  await t.test('POST /api/jobs met URL → auto-detect ytdlp', async () => {
    await repo.truncateAll();
    const { status, data } = await postJSON(base, '/api/jobs', {
      url: 'https://www.youtube.com/watch?v=TEST_ID',
    });
    assert.equal(status, 201);
    assert.equal(data.adapter, 'ytdlp');
    assert.equal(data.status, 'queued');
    jobId = data.id;
  });

  await t.test('POST /api/jobs zonder url → 400', async () => {
    const { status, data } = await postJSON(base, '/api/jobs', {});
    assert.equal(status, 400);
    assert.match(data.error, /url ontbreekt/);
  });

  await t.test('POST /api/jobs met ftp → 400 geen adapter', async () => {
    const { status, data } = await postJSON(base, '/api/jobs', { url: 'ftp://x/y' });
    assert.equal(status, 400);
    assert.match(data.error, /geen passende adapter/);
  });

  await t.test('GET /api/jobs lijst bevat onze job', async () => {
    const { data } = await getJSON(base, '/api/jobs');
    assert.ok(data.jobs.some((j) => j.id === jobId));
  });

  await t.test('GET /api/jobs/:id → job + files + logs', async () => {
    const { status, data } = await getJSON(base, '/api/jobs/' + jobId);
    assert.equal(status, 200);
    assert.equal(data.job.id, jobId);
    assert.ok(Array.isArray(data.files));
    assert.ok(Array.isArray(data.logs));
  });

  await t.test('GET /api/jobs/999999 → 404', async () => {
    const { status } = await getJSON(base, '/api/jobs/999999');
    assert.equal(status, 404);
  });

  await t.test('POST cancel → status cancelled', async () => {
    const { status, data } = await postJSON(base, '/api/jobs/' + jobId + '/cancel', {});
    assert.equal(status, 200);
    assert.equal(data.status, 'cancelled');
  });

  await t.test('POST retry op cancelled job → queued', async () => {
    const { data } = await postJSON(base, '/api/jobs/' + jobId + '/retry', {});
    assert.equal(data.status, 'queued');
  });

  await t.test('URL-dedupe: tweede POST met zelfde URL → duplicate:true + 200', async () => {
    await repo.truncateAll();
    const url = 'https://www.youtube.com/watch?v=DEDUPE1';
    const first = await postJSON(base, '/api/jobs', { url });
    assert.equal(first.status, 201);
    assert.equal(first.data.duplicate, undefined);
    const second = await postJSON(base, '/api/jobs', { url });
    assert.equal(second.status, 200);
    assert.equal(second.data.duplicate, true);
    assert.equal(second.data.id, first.data.id);
  });

  await t.test('URL-dedupe: force:true negeert bestaande job', async () => {
    await repo.truncateAll();
    const url = 'https://www.youtube.com/watch?v=DEDUPE2';
    const first = await postJSON(base, '/api/jobs', { url });
    const forced = await postJSON(base, '/api/jobs', { url, force: true });
    assert.equal(forced.status, 201);
    assert.notEqual(forced.data.id, first.data.id);
    assert.equal(forced.data.duplicate, undefined);
  });

  await t.test('URL-dedupe: failed/cancelled blokkeren niet', async () => {
    await repo.truncateAll();
    const url = 'https://www.youtube.com/watch?v=DEDUPE3';
    const first = await postJSON(base, '/api/jobs', { url });
    // markeer gefaald (final)
    await repo.failJob(first.data.id, 'test', { retry: false });
    const second = await postJSON(base, '/api/jobs', { url });
    assert.equal(second.status, 201);
    assert.notEqual(second.data.id, first.data.id);
  });

  await t.test('statische frontend wordt geserveerd', async () => {
    const res = await fetch(base + '/index.html');
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.match(text, /WebDL-Hub/);
    assert.match(text, /app\.js/);
  });
});
