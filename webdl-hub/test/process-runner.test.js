// test/process-runner.test.js — line-splitter + echte spawn van `node -e`.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createLineSplitter, runProcess } = require('../src/util/process-runner');

test('LineSplitter splitst op \\n en \\r', () => {
  const lines = [];
  const s = createLineSplitter((l) => lines.push(l));
  s.feed('hello\nworld\r');
  s.feed('abc');
  s.flush();
  assert.deepEqual(lines, ['hello', 'world', 'abc']);
});

test('runProcess vangt stdout-lijnen van `node -e`', async () => {
  const lines = [];
  const p = runProcess({
    cmd: process.execPath,
    args: ['-e', 'console.log("a"); console.log("b");'],
  });
  p.on('line', ({ stream, line }) => lines.push([stream, line]));
  const { code } = await p.done;
  assert.equal(code, 0);
  assert.deepEqual(lines, [['stdout', 'a'], ['stdout', 'b']]);
});

test('runProcess propageert non-zero exit', async () => {
  const p = runProcess({ cmd: process.execPath, args: ['-e', 'process.exit(7)'] });
  const { code } = await p.done;
  assert.equal(code, 7);
});

test('runProcess crasht niet als binary ontbreekt (ENOENT → reject)', async () => {
  // Regressie: voorheen werd 'error' op de EE opnieuw geëmit zonder
  // listener, wat een uncaught exception gaf en de server liet crashen.
  const p = runProcess({ cmd: '__niet_bestaande_binary_xyz__', args: [] });
  await assert.rejects(p.done, (err) => err && /ENOENT|not found/i.test(String(err.message || err)));
});
