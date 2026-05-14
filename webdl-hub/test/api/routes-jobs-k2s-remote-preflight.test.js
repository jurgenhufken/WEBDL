'use strict';

const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createJobsRouter } = require('../../src/api/routes-jobs');

async function startSimplePreflightServer(handler) {
  const server = http.createServer((req, res) => {
    if (!req.url.startsWith('/api/keep2share/preflight')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    const data = handler(req);
    res.writeHead(data.httpStatus || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data.body || data));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

function createRepo(calls) {
  return {
    schema: 'webdl',
    pool: {
      async connect() {
        return {
          async query(sql, params = []) {
            calls.push({ method: 'connect.query', sql, params });
            return { rows: [] };
          },
          release() {},
        };
      },
      async query(sql, params = []) {
        calls.push({ method: 'pool.query', sql, params });
        if (sql.includes('INSERT INTO downloads')) return { rows: [{ id: 987 }] };
        return { rows: [] };
      },
    },
    async findGalleryDownloadByUrl(url) {
      calls.push({ method: 'findGalleryDownloadByUrl', url });
      return null;
    },
    async appendLog(id, level, msg) {
      calls.push({ method: 'appendLog', id, level, msg });
    },
    async getJob(id) {
      calls.push({ method: 'getJob', id });
      return { id, url: 'https://k2s.cc/file/good123', adapter: 'slave-delegate', status: 'running', options: { simple_server_download_id: '987' } };
    },
  };
}

function createQueue(calls) {
  return {
    async enqueue(job) {
      calls.push({ method: 'enqueue', job });
      return { id: 123, status: 'queued', ...job };
    },
  };
}

async function startJobsServer({ repo, queue }) {
  const app = express();
  app.use(express.json());
  app.use('/api/jobs', createJobsRouter({
    repo,
    queue,
    adapters: [],
    detect: () => null,
  }));
  app.use((err, _req, res, _next) => res.status(500).json({ error: String(err.message || err) }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function postJSON(base, requestPath, body) {
  const res = await fetch(base + requestPath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('K2S queue blokkeert voordat er een job of downloadrij komt als remote file preflight rejected is', async (t) => {
  const oldCookie = process.env.K2S_COOKIE;
  const oldSimple = process.env.WEBDL_SIMPLE_SERVER_URL;
  process.env.K2S_COOKIE = 'auth_id=fake; sess=fake';
  const simple = await startSimplePreflightServer(() => ({
    service: 'keep2share',
    readOnly: true,
    remoteAcceptance: { checked: true, accepted: false, status: 'rejected' },
    checks: [{ name: 'file_resolve', checked: true, accepted: false, status: 'rejected', reason: 'auth_token=secret rejected' }],
  }));
  process.env.WEBDL_SIMPLE_SERVER_URL = simple.base;
  const calls = [];
  const { server, base } = await startJobsServer({ repo: createRepo(calls), queue: createQueue(calls) });
  t.after(async () => {
    if (oldCookie === undefined) delete process.env.K2S_COOKIE; else process.env.K2S_COOKIE = oldCookie;
    if (oldSimple === undefined) delete process.env.WEBDL_SIMPLE_SERVER_URL; else process.env.WEBDL_SIMPLE_SERVER_URL = oldSimple;
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => simple.server.close(resolve));
  });

  const result = await postJSON(base, '/api/jobs', { url: 'https://k2s.cc/file/bad123' });

  assert.equal(result.status, 409);
  assert.match(result.data.error, /Keep2Share file is niet resolvebaar/);
  assert.equal(JSON.stringify(result.data).includes('secret'), false);
  assert.equal(calls.some((call) => call.method === 'enqueue'), false);
  assert.equal(calls.some((call) => call.method === 'pool.query' && String(call.sql).includes('INSERT INTO downloads')), false);
});

test('K2S queue gaat door als remote file preflight accepted is', async (t) => {
  const oldCookie = process.env.K2S_COOKIE;
  const oldSimple = process.env.WEBDL_SIMPLE_SERVER_URL;
  process.env.K2S_COOKIE = 'auth_id=fake; sess=fake';
  const simple = await startSimplePreflightServer(() => ({
    service: 'keep2share',
    readOnly: true,
    remoteAcceptance: { checked: true, accepted: true, status: 'accepted' },
    checks: [{ name: 'file_resolve', checked: true, accepted: true, status: 'accepted', reason: 'ok' }],
  }));
  process.env.WEBDL_SIMPLE_SERVER_URL = simple.base;
  const calls = [];
  const { server, base } = await startJobsServer({ repo: createRepo(calls), queue: createQueue(calls) });
  t.after(async () => {
    if (oldCookie === undefined) delete process.env.K2S_COOKIE; else process.env.K2S_COOKIE = oldCookie;
    if (oldSimple === undefined) delete process.env.WEBDL_SIMPLE_SERVER_URL; else process.env.WEBDL_SIMPLE_SERVER_URL = oldSimple;
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => simple.server.close(resolve));
  });

  const result = await postJSON(base, '/api/jobs', { url: 'https://k2s.cc/file/good123' });

  assert.equal(result.status, 201);
  assert.equal(result.data.delegated, true);
  assert.equal(result.data.simple_server_download_id, 987);
  assert.ok(calls.some((call) => call.method === 'enqueue'));
  assert.ok(calls.some((call) => call.method === 'pool.query' && String(call.sql).includes('INSERT INTO downloads')));
});
