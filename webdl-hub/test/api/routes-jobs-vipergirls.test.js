'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createJobsRouter } = require('../../src/api/routes-jobs');

function createTestRepo(calls) {
  return {
    pool: {
      async connect() {
        return {
          async query(sql, params = []) {
            calls.push({ method: 'pool.connect.query', sql, params });
            return { rows: [] };
          },
          release() {},
        };
      },
    },
    async findRecentJobByUrl(url, options = {}) {
      calls.push({ method: 'findRecentJobByUrl', url, options });
      if (Array.isArray(options.statuses)) return null;
      return { id: 'old-done', url, status: 'done' };
    },
    async findGalleryDownloadByUrl(url, options = {}) {
      calls.push({ method: 'findGalleryDownloadByUrl', url, options });
      if (Array.isArray(options.statuses)) return null;
      return { id: 'old-download', url, status: 'completed', platform: 'vipergirls' };
    },
  };
}

function createTestQueue(calls) {
  return {
    async enqueue(job) {
      calls.push({ method: 'enqueue', job });
      return { id: 'new-job', status: 'queued', ...job };
    },
  };
}

async function startTestServer({ repo, queue }) {
  const app = express();
  app.use(express.json());
  app.use('/api/jobs', createJobsRouter({
    repo,
    queue,
    adapters: [{ name: 'gallerydl' }],
    detect: () => ({ name: 'gallerydl' }),
  }));
  app.use((err, _req, res, _next) => res.status(500).json({ error: String(err.message || err) }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
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

test('Vipergirls hele-thread scan wordt niet geblokkeerd door oude afgeronde jobs', async (t) => {
  const calls = [];
  const repo = createTestRepo(calls);
  const queue = createTestQueue(calls);
  const { server, base } = await startTestServer({ repo, queue });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await postJSON(base, '/api/jobs', {
    url: 'https://vipergirls.to/threads/12345-test-thread/page2',
  });

  assert.equal(result.status, 201);
  assert.equal(result.data.id, 'new-job');
  assert.equal(result.data.url, 'https://vipergirls.to/threads/12345-test-thread');
  assert.equal(result.data.duplicate, undefined);

  const recentCall = calls.find((call) => call.method === 'findRecentJobByUrl');
  assert.deepEqual(recentCall.options, { statuses: ['queued', 'running'] });
  assert.ok(calls.some((call) => call.method === 'enqueue'));
});

test('Vipergirls host-media redirect dedupet alleen actieve hele-thread jobs', async (t) => {
  const calls = [];
  const repo = createTestRepo(calls);
  const queue = createTestQueue(calls);
  const { server, base } = await startTestServer({ repo, queue });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await postJSON(base, '/api/jobs', {
    url: 'https://imgbox.com/example-host-file',
    options: {
      sourceContext: {
        platform: 'vipergirls',
        url: 'https://vipergirls.to/threads/67890-big-thread/page4',
        channel: 'vipergirls',
        title: 'big thread',
      },
    },
  });

  assert.equal(result.status, 201);
  assert.equal(result.data.id, 'new-job');
  assert.equal(result.data.url, 'https://vipergirls.to/threads/67890-big-thread');

  const recentCall = calls.find((call) => call.method === 'findRecentJobByUrl');
  assert.equal(recentCall.url, 'https://vipergirls.to/threads/67890-big-thread');
  assert.deepEqual(recentCall.options, { statuses: ['queued', 'running'] });

  const enqueueCall = calls.find((call) => call.method === 'enqueue');
  assert.equal(enqueueCall.job.adapter, 'gallerydl');
  assert.equal(enqueueCall.job.options.contextUrl, 'https://vipergirls.to/threads/67890-big-thread');
});

test('X/Twitter profielen worden niet geblokkeerd door eerder gesyncte media', async (t) => {
  const calls = [];
  const repo = createTestRepo(calls);
  const queue = createTestQueue(calls);
  const { server, base } = await startTestServer({ repo, queue });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await postJSON(base, '/api/jobs', {
    url: 'https://x.com/solesjoi',
  });

  assert.equal(result.status, 201);
  assert.equal(result.data.id, 'new-job');
  assert.equal(result.data.url, 'https://x.com/solesjoi');

  const recentCall = calls.find((call) => call.method === 'findRecentJobByUrl');
  const downloadCall = calls.find((call) => call.method === 'findGalleryDownloadByUrl');
  assert.deepEqual(recentCall.options, { statuses: ['queued', 'running'] });
  assert.deepEqual(downloadCall.options, { statuses: ['queued', 'running'] });
  assert.ok(calls.some((call) => call.method === 'enqueue'));
});

test('/batch-file accepteert snel en verwerkt manifest op achtergrond', async (t) => {
  const previousChunkSize = process.env.WEBDL_BATCH_FILE_CHUNK_SIZE;
  process.env.WEBDL_BATCH_FILE_CHUNK_SIZE = '1';

  const calls = [];
  const repo = createTestRepo(calls);
  const queue = createTestQueue(calls);
  const { server, base } = await startTestServer({ repo, queue });
  let manifestFile = '';

  t.after(async () => {
    if (previousChunkSize === undefined) delete process.env.WEBDL_BATCH_FILE_CHUNK_SIZE;
    else process.env.WEBDL_BATCH_FILE_CHUNK_SIZE = previousChunkSize;
    await new Promise((resolve) => server.close(resolve));
    if (manifestFile) await fs.unlink(manifestFile).catch(() => {});
  });

  const result = await postJSON(base, '/api/jobs/batch-file', {
    urls: [
      'https://x.com/hashtag/FEETJOI?src=hashtag_click',
      'https://x.com/hashtag/FEETJOI?src=hashtag_click',
      'https://x.com/solesjoi',
    ],
    metadata: { queued_from: 'test' },
    priority: 10,
  });

  assert.equal(result.status, 202);
  assert.equal(result.data.success, true);
  assert.equal(result.data.accepted, true);
  assert.equal(result.data.total, 2);
  assert.match(result.data.batchId, /^[a-f0-9]{16}$/);
  manifestFile = result.data.manifestFile;

  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  assert.equal(manifest.total, 2);
  assert.deepEqual(manifest.urls, [
    'https://x.com/hashtag/FEETJOI?src=hashtag_click',
    'https://x.com/solesjoi',
  ]);
  assert.equal(manifest.requestedPriority, 10);

  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 1000;
    const poll = () => {
      const enqueued = calls.filter((call) => call.method === 'enqueue');
      if (enqueued.length === 2) return resolve();
      if (Date.now() > deadline) return reject(new Error(`expected 2 enqueues, got ${enqueued.length}`));
      setTimeout(poll, 20);
    };
    poll();
  });

  const enqueued = calls.filter((call) => call.method === 'enqueue');
  assert.deepEqual(enqueued.map((call) => call.job.url), [
    'https://x.com/hashtag/FEETJOI?src=hashtag_click',
    'https://x.com/solesjoi',
  ]);
  assert.ok(enqueued.every((call) => call.job.priority === 10));
});
