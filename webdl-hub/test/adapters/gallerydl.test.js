// test/adapters/gallerydl.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const a = require('../../src/adapters/gallerydl');

test('matches typische gallery-dl hosts', () => {
  assert.equal(a.matches('https://imgur.com/gallery/xyz'), true);
  assert.equal(a.matches('https://www.pixiv.net/en/artworks/123'), true);
  assert.equal(a.matches('https://twitter.com/user/status/1'), true);
  assert.equal(a.matches('https://x.com/user/status/1'), true);
  assert.equal(a.matches('https://danbooru.donmai.us/posts/1'), true);
});

test('matcht youtube/reddit NIET', () => {
  assert.equal(a.matches('https://youtube.com/watch?v=1'), false);
  assert.equal(a.matches('https://www.reddit.com/r/x/'), false);
  assert.equal(a.matches('ftp://imgur.com/a'), false);
});

test('plan zet -D naar cwd en url als laatste', () => {
  const p = a.plan('https://imgur.com/a/abc', { cwd: '/tmp/j1' });
  assert.equal(p.cmd, 'gallery-dl');
  assert.equal(p.cwd, '/tmp/j1');
  const i = p.args.indexOf('-D');
  assert.equal(p.args[i + 1], '/tmp/j1');
  assert.equal(p.args.at(-1), 'https://imgur.com/a/abc');
});

test('parseProgress is null (geen globale %)', () => {
  assert.equal(a.parseProgress('./a.jpg'), null);
});
