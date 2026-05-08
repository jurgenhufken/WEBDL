// test/adapters/redgifs.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const a = require('../../src/adapters/redgifs');

test('matcht Redgifs watch/user/legacy hosts', () => {
  assert.equal(a.matches('https://www.redgifs.com/watch/SomeClipId'), true);
  assert.equal(a.matches('https://www.redgifs.com/users/creator'), true);
  assert.equal(a.matches('https://gifdeliverynetwork.com/SomeClipId.mp4'), true);
  assert.equal(a.matches('https://example.com/watch/SomeClipId'), false);
});

test('herkent expandable Redgifs URLs', () => {
  assert.equal(a._isExpandableUrl('https://www.redgifs.com/users/creator'), true);
  assert.equal(a._isExpandableUrl('https://www.redgifs.com/users/creator/collections/abc'), true);
  assert.equal(a._isExpandableUrl('https://www.redgifs.com/watch/SomeClipId'), false);
});

test('haalt Redgifs ID uit bekende URL-vormen', () => {
  assert.equal(a._redgifsIdFromUrl('https://www.redgifs.com/watch/SomeClipId'), 'SomeClipId');
  assert.equal(a._redgifsIdFromUrl('https://redgifs.com/ifr/OtherClip'), 'OtherClip');
  assert.equal(a._redgifsIdFromUrl('https://gifdeliverynetwork.com/DirectClip.mp4'), 'DirectClip');
});

test('plan gebruikt lokale node downloader script', () => {
  const p = a.plan('https://www.redgifs.com/watch/SomeClipId', { cwd: '/tmp/redgifs-job' });
  assert.equal(p.cmd, process.execPath);
  assert.equal(p.cwd, '/tmp/redgifs-job');
  assert.equal(path.basename(p.args[0]), 'redgifs-dl.js');
  assert.equal(p.args[1], 'https://www.redgifs.com/watch/SomeClipId');
  assert.equal(p.args[2], '/tmp/redgifs-job');
});

test('parseProgress leest downloader progressregels', () => {
  assert.deepEqual(a.parseProgress('PROG pct=42.5% speed=? eta=?'), { pct: 42.5, speed: '?', eta: '?' });
  assert.equal(a.parseProgress('iets anders'), null);
});
