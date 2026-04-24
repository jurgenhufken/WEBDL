// test/logger.test.js — level-filter en JSON-lines output.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createLogger, LEVELS } = require('../src/util/logger');

function captureStd(fn) {
  const out = []; const err = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  process.stderr.write = (s) => { err.push(String(s)); return true; };
  try { fn(); } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { out: out.join(''), err: err.join('') };
}

test('info passeert standaard, debug wordt gefilterd', () => {
  const log = createLogger({ level: 'info' });
  const { out } = captureStd(() => {
    log.debug('hidden');
    log.info('visible', { a: 1 });
  });
  assert.ok(!out.includes('hidden'));
  const lines = out.trim().split('\n');
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.msg, 'visible');
  assert.equal(parsed.lvl, 'info');
  assert.equal(parsed.a, 1);
});

test('warn/error gaan naar stderr', () => {
  const log = createLogger({ level: 'debug' });
  const { err, out } = captureStd(() => {
    log.warn('w');
    log.error('e');
    log.info('i');
  });
  assert.match(err, /"lvl":"warn"/);
  assert.match(err, /"lvl":"error"/);
  assert.match(out, /"lvl":"info"/);
});

test('LEVELS is oplopend', () => {
  assert.ok(LEVELS.debug < LEVELS.info);
  assert.ok(LEVELS.info < LEVELS.warn);
  assert.ok(LEVELS.warn < LEVELS.error);
});
