// test/adapters/instaloader.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const a = require('../../src/adapters/instaloader');

test('matches alleen instagram.com', () => {
  assert.equal(a.matches('https://www.instagram.com/p/ABC/'), true);
  assert.equal(a.matches('https://instagram.com/nasa/'), true);
  assert.equal(a.matches('https://twitter.com/x'), false);
});

test('urlToTarget: post → -shortcode', () => {
  assert.deepEqual(a._urlToTarget('https://www.instagram.com/p/CxYz123/'),
    { kind: 'post', value: '-CxYz123' });
});

test('urlToTarget: reel → -shortcode', () => {
  assert.deepEqual(a._urlToTarget('https://www.instagram.com/reel/AAA/'),
    { kind: 'post', value: '-AAA' });
});

test('urlToTarget: profiel → username', () => {
  assert.deepEqual(a._urlToTarget('https://www.instagram.com/nasa/'),
    { kind: 'profile', value: 'nasa' });
});

test('plan met post gebruikt -- separator', () => {
  const p = a.plan('https://www.instagram.com/p/ABC/', { cwd: '/tmp/j' });
  assert.equal(p.cmd, 'instaloader');
  assert.ok(p.args.includes('--'));
  assert.equal(p.args.at(-1), '-ABC');
  assert.ok(p.args.some((x) => x === '--dirname-pattern=/tmp/j'));
});

test('parseProgress pakt [ 3/10 ]', () => {
  assert.deepEqual(a.parseProgress('[ 3/10] foo.jpg'), { pct: 30 });
  assert.equal(a.parseProgress('random line'), null);
  assert.equal(a.parseProgress('[ 0/0 ]'), null);
});
