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

test('plan gebruikt lokale Telethon downloader', () => {
  const p = a.plan('https://t.me/channel/123', { cwd: '/tmp/tg', telegramParallel: 6, telegramMediaLimit: 10 });
  assert.equal(p.cmd, 'python3');
  assert.match(p.args[0], /telegram-channel-download\.py$/);
  assert.equal(p.args[1], 'https://t.me/channel/123');
  assert.equal(p.args[2], '/tmp/tg');
  assert.deepEqual(p.args.slice(3), ['--parallel', '6', '--media-limit', '10']);
  assert.equal(p.logStdout, true);
});

test('parseProgress parset script en tdl voortgang', () => {
  assert.equal(a.parseProgress('PROG pct=25.0%').pct, 25);
  const r = a.parseProgress('downloading 50.0% @ 1.2MB/s eta 3s');
  assert.equal(r.pct, 50);
  assert.match(r.speed, /1\.2/);
});

test('parseProgress negeert andere regels', () => {
  assert.equal(a.parseProgress('[INFO] starting'), null);
});
