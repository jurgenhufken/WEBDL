// test/smoke.test.js — sanity check dat de testrunner werkt.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

test('node:test runner werkt', () => {
  assert.equal(1 + 1, 2);
});
