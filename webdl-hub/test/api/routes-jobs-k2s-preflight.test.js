'use strict';

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createJobsRouter, _test } = require('../../src/api/routes-jobs');

async function startTestServer({ k2sAuthRoot, k2sAuthEnv = {} }) {
  const app = express();
  app.use(express.json());
  app.use('/api/jobs', createJobsRouter({
    repo: {},
    queue: {},
    adapters: [],
    detect: () => null,
    k2sAuthRoot,
    k2sAuthEnv,
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

async function makeAuthRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webdl-k2s-preflight-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'screen-recorder-native'), { recursive: true });
  await fs.mkdir(path.join(root, 'webdl-hub'), { recursive: true });
  return root;
}

test('K2S preflight rapporteert ontbrekende lokale auth zonder remote acceptatie te claimen', async (t) => {
  const root = await makeAuthRoot(t);
  const { server, base } = await startTestServer({ k2sAuthRoot: root, k2sAuthEnv: {} });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await getJSON(base, '/api/jobs/meta/k2s-preflight');

  assert.equal(result.status, 200);
  assert.equal(result.data.service, 'keep2share');
  assert.equal(result.data.readOnly, true);
  assert.equal(result.data.configured, false);
  assert.equal(result.data.queueGate.localConfigPass, false);
  assert.equal(result.data.remoteAcceptance.checked, false);
  assert.equal(result.data.remoteAcceptance.status, 'not_checked');
  assert.deepEqual(result.data.credentialTypes, []);
  assert.equal(result.data.sources.length, 3);
  assert.ok(result.data.sources.every((source) => Array.isArray(source.types)));
});

test('K2S preflight toont bron en type maar geen secretwaarde', async (t) => {
  const root = await makeAuthRoot(t);
  await fs.writeFile(
    path.join(root, 'screen-recorder-native', '.env'),
    'K2S_COOKIE=super-secret-cookie\nexport K2S_X_BC=super-secret-xbc\n',
    'utf8',
  );
  const { server, base } = await startTestServer({ k2sAuthRoot: root, k2sAuthEnv: {} });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await getJSON(base, '/api/jobs/meta/k2s-preflight');
  const text = JSON.stringify(result.data);
  const screenSource = result.data.sources.find((source) => String(source.source).includes('screen-recorder-native'));

  assert.equal(result.status, 200);
  assert.equal(result.data.configured, true);
  assert.equal(result.data.queueGate.localConfigPass, true);
  assert.deepEqual(result.data.credentialTypes, ['cookie', 'x_bc']);
  assert.equal(screenSource.configured, true);
  assert.equal(screenSource.keyCount, 2);
  assert.deepEqual(screenSource.types, ['cookie', 'x_bc']);
  assert.equal(text.includes('super-secret'), false);
  assert.equal(text.includes('K2S_COOKIE'), false);
  assert.equal(text.includes('K2S_X_BC'), false);
});

test('K2S preflight telt process.env auth als lokale queue-gate config', () => {
  const result = _test.getKeep2ShareAuthPreflight({
    root: path.join(os.tmpdir(), 'niet-bestaande-webdl-root'),
    env: { K2S_AUTH_TOKEN: 'token-secret' },
  });
  const envSource = result.sources.find((source) => source.kind === 'process_env');

  assert.equal(result.configured, true);
  assert.equal(result.queueGate.localConfigPass, true);
  assert.deepEqual(result.credentialTypes, ['auth_token']);
  assert.equal(envSource.configured, true);
  assert.equal(envSource.keyCount, 1);
  assert.deepEqual(envSource.types, ['auth_token']);
  assert.equal(JSON.stringify(result).includes('token-secret'), false);
});
