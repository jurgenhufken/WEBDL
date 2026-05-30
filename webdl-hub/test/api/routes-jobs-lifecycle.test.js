'use strict';

const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createJobsRouter } = require('../../src/api/routes-jobs');

function createLifecycleRepo(calls) {
  return {
    schema: 'webdl',
    pool: {
      async query(sql, params = []) {
        calls.push({ sql, params });
        assert.match(sql.trim(), /^SELECT\b/i);
        if (sql.includes('FROM "webdl".jobs') && sql.includes('WHERE') && sql.includes('ORDER BY id DESC')) {
          return {
            rows: [{
              id: 464,
              url: 'https://k2s.cc/file/abc123',
              adapter: 'slave-delegate',
              status: 'failed',
              options: { simple_server_download_id: '387', cookie: 'super-secret-cookie' },
              error: 'auth_token=super-secret-job-token',
            }],
          };
        }
        if (sql.includes('FROM public.downloads')) {
          return {
            rows: [{
              id: 387,
              url: 'https://k2s.cc/file/abc123',
              source_url: 'https://vipergirls.to/threads/123-test',
              platform: 'keep2share',
              channel: 'thread_123',
              title: 'test',
              status: 'completed',
              filepath: '/tmp/test.mp4',
              filename: 'test.mp4',
              filesize: 123,
              format: 'mp4',
              is_thumb_ready: false,
              error: 'cookie=super-secret-download-cookie',
              metadata: JSON.stringify({ hub_job_id: 464, auth_token: 'super-secret-download-token' }),
            }],
          };
        }
        if (sql.includes('FROM "webdl".logs')) {
          return { rows: [{ id: 1, job_id: 464, level: 'error', msg: 'bearer super-secret-bearer-token' }] };
        }
        if (sql.includes('FROM "webdl".files')) {
          return { rows: [] };
        }
        if (sql.includes('FROM public.download_files')) {
          return {
            rows: [{
              id: 99,
              download_id: 387,
              relpath: 'keep2share/test.mp4',
              filesize: 123,
              is_thumb_ready: false,
            }],
          };
        }
        return { rows: [] };
      },
    },
  };
}

async function startTestServer(repo) {
  const app = express();
  app.use(express.json());
  app.use('/api/jobs', createJobsRouter({
    repo,
    queue: {},
    adapters: [],
    detect: () => null,
  }));
  app.use((err, _req, res, _next) => res.status(500).json({ error: String(err.message || err) }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function getJSON(base, requestPath) {
  const res = await fetch(base + requestPath);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('lifecycle diagnose vereist job_id, download_id of url', async (t) => {
  const calls = [];
  const { server, base } = await startTestServer(createLifecycleRepo(calls));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await getJSON(base, '/api/jobs/meta/lifecycle');

  assert.equal(result.status, 400);
  assert.match(result.data.error, /job_id, download_id of url/);
  assert.equal(calls.length, 0);
});

test('lifecycle diagnose koppelt hub-job, simple-server download en gallery visibility read-only', async (t) => {
  const calls = [];
  const { server, base } = await startTestServer(createLifecycleRepo(calls));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await getJSON(base, '/api/jobs/meta/lifecycle?job_id=464');
  const body = JSON.stringify(result.data);

  assert.equal(result.status, 200);
  assert.equal(result.data.service, 'job-lifecycle');
  assert.equal(result.data.readOnly, true);
  assert.equal(result.data.summary.state, 'mismatch');
  assert.equal(result.data.hub.jobs[0].id, 464);
  assert.equal(result.data.simpleServer.downloads[0].id, 387);
  assert.equal(result.data.gallery.visibility[0].defaultGalleryVisible, false);
  assert.ok(result.data.mismatches.some((item) => item.code === 'hub_failed_download_completed'));
  assert.ok(result.data.mismatches.some((item) => item.code === 'completed_download_not_visible_in_default_gallery'));
  assert.equal(body.includes('super-secret'), false);
  assert.ok(calls.length > 0);
});

test('lifecycle diagnose gebruikt K2S file-id bij url lookup', async (t) => {
  const calls = [];
  const { server, base } = await startTestServer(createLifecycleRepo(calls));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await getJSON(base, '/api/jobs/meta/lifecycle?url=https%3A%2F%2Fk2s.cc%2Ffile%2Fabc123%3Fsite%3Dvipergirls.to');

  assert.equal(result.status, 200);
  assert.ok(calls.some((call) => call.params.includes('abc123')));
});
