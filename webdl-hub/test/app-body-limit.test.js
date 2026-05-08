// test/app-body-limit.test.js — JSON body limits for large extension batches.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../src/app');

function quietLogger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, with: () => quietLogger() };
}

async function withServer(fn) {
  const repo = {};
  const logger = quietLogger();
  const { server } = buildApp({ repo, adapters: [], logger });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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

test('default JSON limit accepts extension batch-sized payloads above old 256kb cap', async () => {
  const previous = process.env.WEBDL_JSON_BODY_LIMIT;
  delete process.env.WEBDL_JSON_BODY_LIMIT;
  try {
    await withServer(async (base) => {
      const { status, data } = await postJSON(base, '/api/jobs', {
        padding: 'x'.repeat(300 * 1024),
      });
      assert.equal(status, 400);
      assert.match(data.error, /url ontbreekt/);
    });
  } finally {
    if (previous === undefined) delete process.env.WEBDL_JSON_BODY_LIMIT;
    else process.env.WEBDL_JSON_BODY_LIMIT = previous;
  }
});

test('oversized JSON returns explicit 413 instead of a generic 500', async () => {
  const previous = process.env.WEBDL_JSON_BODY_LIMIT;
  process.env.WEBDL_JSON_BODY_LIMIT = '1kb';
  try {
    await withServer(async (base) => {
      const { status, data } = await postJSON(base, '/api/jobs', {
        padding: 'x'.repeat(2 * 1024),
      });
      assert.equal(status, 413);
      assert.match(data.error, /Request body te groot/);
      assert.match(data.error, /WEBDL_JSON_BODY_LIMIT/);
    });
  } finally {
    if (previous === undefined) delete process.env.WEBDL_JSON_BODY_LIMIT;
    else process.env.WEBDL_JSON_BODY_LIMIT = previous;
  }
});
