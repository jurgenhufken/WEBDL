// test/adapters/tdl.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const a = require('../../src/adapters/tdl');

test('matches t.me en telegram.me', () => {
  assert.equal(a.matches('https://t.me/channel/123'), true);
  assert.equal(a.matches('https://telegram.me/foo/1'), true);
  assert.equal(a.matches('https://youtube.com/x'), false);
});

test('plan roept tdl dl met -u en -d', () => {
  const p = a.plan('https://t.me/channel/123', { cwd: '/tmp/tg' });
  assert.equal(p.cmd, 'tdl');
  assert.deepEqual(p.args.slice(0, 2), ['dl', '-u']);
  assert.equal(p.args[2], 'https://t.me/channel/123');
  assert.equal(p.args[3], '-d');
  assert.equal(p.args[4], '/tmp/tg');
});

test('parseProgress parset "50.0% @ 1.2MB/s"', () => {
  const r = a.parseProgress('downloading 50.0% @ 1.2MB/s eta 3s');
  assert.equal(r.pct, 50);
  assert.match(r.speed, /1\.2/);
});

test('parseProgress negeert andere regels', () => {
  assert.equal(a.parseProgress('[INFO] starting'), null);
});
