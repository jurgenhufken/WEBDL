// test/api/routes-legacy.test.js — legacy downloads router zonder echte DB.
'use strict';

const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createLegacyRouter } = require('../../src/api/routes-legacy');

function startTestServer(repo) {
  const app = express();
  app.use(express.json());
  app.use('/api/downloads', createLegacyRouter({ repo }));
  app.use((err, _req, res, _next) => res.status(500).json({ error: String(err.message || err) }));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function getJSON(base, path) {
  const res = await fetch(base + path);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('legacy downloads meta-routes staan voor /:id', async (t) => {
  const calls = [];
  const repo = {
    schema: 'webdl_test',
    pool: {
      async query(sql, params = []) {
        calls.push({ sql, params });
        if (sql.includes('FROM "webdl_test".jobs')) {
          return { rows: [{ status: 'queued', count: 1 }] };
        }
        if (sql.includes('FROM public.downloads WHERE status IN')) {
          return { rows: [{ status: 'completed', count: 2 }] };
        }
        if (sql.includes('SELECT platform, status')) {
          return { rows: [{ platform: 'youtube', status: 'completed', count: 2 }] };
        }
        if (sql.includes('SELECT * FROM public.downloads WHERE id')) {
          return { rows: [] };
        }
        throw new Error('onverwachte query: ' + sql);
      },
    },
  };
  const { server, base } = await startTestServer(repo);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const stats = await getJSON(base, '/api/downloads/meta/stats');
  assert.equal(stats.status, 200);
  assert.deepEqual(stats.data.hub, { queued: 1 });
  assert.deepEqual(stats.data.legacy, { completed: 2 });

  const platforms = await getJSON(base, '/api/downloads/meta/platforms');
  assert.equal(platforms.status, 200);
  assert.deepEqual(platforms.data.platforms, [{ platform: 'youtube', status: 'completed', count: 2 }]);

  const detail = await getJSON(base, '/api/downloads/meta');
  assert.equal(detail.status, 400);
  assert.match(detail.data.error, /ongeldig ID/);

  assert.equal(
    calls.some((call) =>
      call.sql.includes('SELECT * FROM public.downloads WHERE id') && call.params[0] === 'meta'),
    false,
  );
});
