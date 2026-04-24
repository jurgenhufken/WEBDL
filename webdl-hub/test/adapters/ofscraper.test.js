// test/adapters/ofscraper.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const a = require('../../src/adapters/ofscraper');

test('matches onlyfans.com', () => {
  assert.equal(a.matches('https://onlyfans.com/someuser'), true);
  assert.equal(a.matches('https://www.onlyfans.com/x'), true);
  assert.equal(a.matches('https://instagram.com/x'), false);
});

test('urlToUsername haalt segment uit pad', () => {
  assert.equal(a._urlToUsername('https://onlyfans.com/johndoe'), 'johndoe');
  assert.equal(a._urlToUsername('https://onlyfans.com/johndoe/'), 'johndoe');
});

test('urlToUsername faalt zonder pad', () => {
  assert.throws(() => a._urlToUsername('https://onlyfans.com/'), /gebruikersnaam/);
});

test('plan zet SAVE_PATH en cwd', () => {
  const p = a.plan('https://onlyfans.com/johndoe', { cwd: '/tmp/of' });
  assert.equal(p.cmd, 'ofscraper');
  assert.equal(p.cwd, '/tmp/of');
  assert.equal(p.env.OFSCRAPER_SAVE_PATH, '/tmp/of');
  assert.ok(p.args.includes('-u'));
  assert.ok(p.args.includes('johndoe'));
});

test('parseProgress pakt X/Y media', () => {
  assert.deepEqual(a.parseProgress('Processed 4/20 media'), { pct: 20 });
  assert.equal(a.parseProgress('hello'), null);
});
