// test/db/repo.test.js — tegen echte Postgres, schema webdl_test.
// Wordt automatisch geskipt als DB niet bereikbaar is.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Client } = require('pg');
const { migrate } = require('../../src/db/migrate');
const { createRepo, classifyLane } = require('../../src/db/repo');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://jurgen@localhost:5432/webdl';
const TEST_SCHEMA = 'webdl_test';

test('classifyLane zet losse TikTok videos in de snelle video-lane', () => {
  assert.equal(classifyLane('https://www.tiktok.com/@user/video/1234567890123456789', 'ytdlp'), 'video');
});

test('classifyLane houdt TikTok tags en profielen in process-video', () => {
  assert.equal(classifyLane('https://www.tiktok.com/tag/girlfoot', 'ytdlp'), 'process-video');
  assert.equal(classifyLane('https://www.tiktok.com/@toetokqueen', 'ytdlp'), 'process-video');
});

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

test('DB-tests', { concurrency: false }, async (t) => {
  if (!(await canConnect())) {
    t.skip('PostgreSQL niet bereikbaar op ' + DATABASE_URL);
    return;
  }
  await migrate({ schema: TEST_SCHEMA, databaseUrl: DATABASE_URL });
  const repo = createRepo({ databaseUrl: DATABASE_URL, schema: TEST_SCHEMA });

  t.after(async () => {
    const c = new Client({ connectionString: DATABASE_URL });
    await c.connect();
    await c.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await c.end();
    await repo.close();
  });

  await t.test('ping werkt', async () => {
    assert.equal(await repo.ping(), true);
  });

  await t.test('createJob + getJob + listJobs', async () => {
    await repo.truncateAll();
    const j = await repo.createJob({ url: 'https://x/a', adapter: 'ytdlp', priority: 5 });
    assert.equal(j.status, 'queued');
    assert.equal(j.attempts, 0);
    const again = await repo.getJob(j.id);
    assert.equal(again.url, 'https://x/a');
    const list = await repo.listJobs({ status: 'queued' });
    assert.equal(list.length, 1);
  });

  await t.test('claimNextJob: priority + FIFO', async () => {
    await repo.truncateAll();
    const a = await repo.createJob({ url: 'u1', adapter: 'ytdlp', priority: 0 });
    const b = await repo.createJob({ url: 'u2', adapter: 'ytdlp', priority: 10 });
    const c = await repo.createJob({ url: 'u3', adapter: 'ytdlp', priority: 10 });
    const first  = await repo.claimNextJob('w1');
    const second = await repo.claimNextJob('w1');
    const third  = await repo.claimNextJob('w1');
    assert.equal(first.id,  b.id);
    assert.equal(second.id, c.id);
    assert.equal(third.id,  a.id);
    assert.equal(first.status, 'running');
    assert.equal(first.attempts, 1);
  });

  await t.test('claimNextJob wist oude foutstatus bij retry', async () => {
    await repo.truncateAll();
    const j = await repo.createJob({ url: 'u1', adapter: 'ytdlp' });
    await repo.claimNextJob('w1');
    await repo.failJob(j.id, 'oude fout', { retry: true });
    const claimed = await repo.claimNextJob('w2');
    assert.equal(claimed.status, 'running');
    assert.equal(claimed.error, null);
    assert.equal(claimed.finished_at, null);
  });

  await t.test('SKIP LOCKED: parallelle claims → 1 winnaar', async () => {
    await repo.truncateAll();
    await repo.createJob({ url: 'u1', adapter: 'ytdlp' });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => repo.claimNextJob('w' + i)),
    );
    const claimed = results.filter((x) => x !== null);
    assert.equal(claimed.length, 1);
  });

  await t.test('claimNextJob negeert slave-delegate bookkeeping jobs', async () => {
    await repo.truncateAll();
    await repo.createJob({ url: 'https://bunkr.cr/f/x', adapter: 'slave-delegate', lane: 'image' });
    const claimed = await repo.claimNextJob('w', { lane: 'image' });
    assert.equal(claimed, null);
  });

  await t.test('completeJob zet status done', async () => {
    await repo.truncateAll();
    const j = await repo.createJob({ url: 'u', adapter: 'ytdlp' });
    await repo.claimNextJob('w');
    const done = await repo.completeJob(j.id);
    assert.equal(done.status, 'done');
    assert.equal(done.progress_pct, 100);
    assert.equal(done.locked_by, null);
    assert.ok(done.finished_at);
  });

  await t.test('failJob retry of final', async () => {
    await repo.truncateAll();
    const j1 = await repo.createJob({ url: 'u', adapter: 'ytdlp' });
    await repo.claimNextJob('w');
    const retried = await repo.failJob(j1.id, 'boom', { retry: true });
    assert.equal(retried.status, 'queued');
    assert.equal(retried.error, 'boom');

    const j2 = await repo.createJob({ url: 'u2', adapter: 'ytdlp' });
    await repo.claimNextJob('w');
    const failed = await repo.failJob(j2.id, 'final', { retry: false });
    assert.equal(failed.status, 'failed');
    assert.ok(failed.finished_at);
  });

  await t.test('cancelJob werkt alleen op queued/running', async () => {
    await repo.truncateAll();
    const j = await repo.createJob({ url: 'u', adapter: 'ytdlp' });
    const cancelled = await repo.cancelJob(j.id);
    assert.equal(cancelled.status, 'cancelled');
    const again = await repo.cancelJob(j.id);
    assert.equal(again, null);
  });

  await t.test('files + logs CRUD', async () => {
    await repo.truncateAll();
    const j = await repo.createJob({ url: 'u', adapter: 'ytdlp' });
    await repo.addFile(j.id, { path: '/tmp/a.mp4', size: 1234 });
    await repo.addFile(j.id, { path: '/tmp/b.mp4', size: 2345 });
    const files = await repo.listFiles(j.id);
    assert.equal(files.length, 2);
    assert.equal(Number(files[0].size), 1234);

    await repo.appendLog(j.id, 'info', 'hello');
    await repo.appendLog(j.id, 'warn', 'heads up');
    const logs = await repo.listLogs(j.id);
    assert.equal(logs.length, 2);
    assert.equal(logs[0].level, 'warn');
  });

  await t.test('updateProgress schrijft pct', async () => {
    await repo.truncateAll();
    const j = await repo.createJob({ url: 'u', adapter: 'ytdlp' });
    await repo.updateProgress(j.id, 37.5);
    const again = await repo.getJob(j.id);
    assert.equal(Math.round(again.progress_pct * 10) / 10, 37.5);
  });
});
