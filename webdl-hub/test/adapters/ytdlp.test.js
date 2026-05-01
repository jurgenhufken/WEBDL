// test/adapters/ytdlp.test.js — matches + parseProgress + plan.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const ytdlp = require('../../src/adapters/ytdlp');

test('matches alleen http(s)', () => {
  assert.equal(ytdlp.matches('https://youtu.be/abc'), true);
  assert.equal(ytdlp.matches('http://x.com/'), true);
  assert.equal(ytdlp.matches('ftp://x/'), false);
  assert.equal(ytdlp.matches('nope'), false);
});

test('plan bouwt yt-dlp-argv met output-template', () => {
  const p = ytdlp.plan('https://youtu.be/abc', { cwd: '/tmp/jobdir' });
  assert.equal(p.cmd, 'yt-dlp');
  assert.equal(p.cwd, '/tmp/jobdir');
  assert.ok(p.args.includes('-o'));
  assert.ok(p.args.some((a) => a.includes('[%(id)s]')));
  assert.ok(p.args.at(-1) === 'https://youtu.be/abc');
});

test('plan gebruikt single-file voorkeur voor directe videosites', () => {
  const p = ytdlp.plan('https://www.xvideos.com/video.abc/title', { cwd: '/tmp/jobdir' });
  const formatIndex = p.args.indexOf('-f');
  assert.equal(p.args[formatIndex + 1], 'best/bv*+ba');
});

test('plan houdt merge-voorkeur voor zware sites', () => {
  const p = ytdlp.plan('https://www.youtube.com/watch?v=abc', { cwd: '/tmp/jobdir' });
  const formatIndex = p.args.indexOf('-f');
  assert.equal(p.args[formatIndex + 1], 'bv*+ba/best');
  assert.ok(p.idleTimeoutMs > 0);
  assert.ok(p.timeoutMs > 0);
});

test('plan behandelt losse TikTok videos als directe video', () => {
  const p = ytdlp.plan('https://www.tiktok.com/@user/video/1234567890123456789', { cwd: '/tmp/jobdir' });
  const formatIndex = p.args.indexOf('-f');
  assert.equal(p.args[formatIndex + 1], 'best/bv*+ba');
  assert.ok(p.args.includes('--impersonate'));
});

test('plan houdt TikTok tags/profielen in zware mode', () => {
  const p = ytdlp.plan('https://www.tiktok.com/tag/girlfoot', { cwd: '/tmp/jobdir' });
  const formatIndex = p.args.indexOf('-f');
  assert.equal(p.args[formatIndex + 1], 'bv*+ba/best');
});

test('parseProgress matcht onze custom template', () => {
  const line = 'PROG pct= 42.5% speed=1.23MiB/s eta=00:12';
  const r = ytdlp.parseProgress(line);
  assert.equal(r.pct, 42.5);
  assert.equal(r.speed, '1.23MiB/s');
  assert.equal(r.eta, '00:12');
});

test('parseProgress retourneert null voor andere lijnen', () => {
  assert.equal(ytdlp.parseProgress('[info] Downloading webpage'), null);
  assert.equal(ytdlp.parseProgress(''), null);
  assert.equal(ytdlp.parseProgress('PROG pct=notanumber% speed=x eta=y'), null);
});
