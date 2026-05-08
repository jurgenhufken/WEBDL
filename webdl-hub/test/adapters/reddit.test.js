// test/adapters/reddit.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const a = require('../../src/adapters/reddit');

test('matches Reddit hosts', () => {
  assert.equal(a.matches('https://www.reddit.com/r/test/comments/abc/title/'), true);
  assert.equal(a.matches('https://redd.it/abc'), true);
  assert.equal(a.matches('https://youtube.com/watch?v=1'), false);
  assert.equal(a.matches('ftp://reddit.com/r/test'), false);
});

test('sourceArgs maakt BDFR sources', () => {
  assert.deepEqual(a._sourceArgs('https://www.reddit.com/r/test/comments/abc/title/'), ['--link', 'abc']);
  assert.deepEqual(a._sourceArgs('https://redd.it/abc'), ['--link', 'abc']);
  assert.deepEqual(a._sourceArgs('https://www.reddit.com/r/test/'), ['--subreddit', 'test']);
  assert.deepEqual(a._sourceArgs('https://www.reddit.com/user/someone/'), ['--user', 'someone', '--submitted']);
});

test('plan roept bdfr download met workdir en source', () => {
  const p = a.plan('https://www.reddit.com/r/test/comments/abc/title/', { cwd: '/tmp/reddit-job', limit: 12 });
  assert.equal(p.cmd, a._defaultBdfrCommand());
  assert.equal(p.cwd, '/tmp/reddit-job');
  assert.deepEqual(p.args.slice(0, 2), ['download', '/tmp/reddit-job']);
  assert.ok(p.args.includes('--folder-scheme'));
  assert.ok(p.args.includes('--file-scheme'));
  assert.ok(p.args.includes('-L'));
  assert.deepEqual(p.args.slice(-2), ['--link', 'abc']);
});

test('parseProgress haalt eenvoudige teller uit logs', () => {
  assert.deepEqual(a.parseProgress('Downloaded 3 of 10 submissions'), { pct: 30 });
  assert.equal(a.parseProgress('Program complete'), null);
});
