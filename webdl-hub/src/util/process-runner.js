// src/util/process-runner.js — spawn-wrapper met line-events.
'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

function createLineSplitter(onLine) {
  let buf = '';
  return {
    feed(chunk) {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.search(/[\r\n]/)) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.length > 0) onLine(line);
      }
    },
    flush() {
      if (buf.length > 0) { onLine(buf); buf = ''; }
    },
  };
}

function runProcess({ cmd, args = [], cwd, env, stdin = 'ignore', timeoutMs = 0, idleTimeoutMs = 0 }) {
  const ee = new EventEmitter();
  let timedOut = false;
  let idleTimedOut = false;
  let forceKillTimer = null;
  const child = spawn(cmd, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: [stdin, 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

  function killChild(sig = 'SIGTERM') {
    if (!child.pid) return;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch (_) {
      try { child.kill(sig); } catch (_) {}
    }
    if (sig === 'SIGTERM' && !forceKillTimer) {
      forceKillTimer = setTimeout(() => killChild('SIGKILL'), 15_000);
    }
  }

  let idleTimer = null;
  function clearIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }
  function bumpIdleTimer() {
    if (!idleTimeoutMs) return;
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      killChild('SIGTERM');
    }, idleTimeoutMs);
  }

  const stdoutSplitter = createLineSplitter((line) => ee.emit('line', { stream: 'stdout', line }));
  const stderrSplitter = createLineSplitter((line) => ee.emit('line', { stream: 'stderr', line }));

  child.stdout.on('data', (chunk) => { bumpIdleTimer(); stdoutSplitter.feed(chunk); });
  child.stderr.on('data', (chunk) => { bumpIdleTimer(); stderrSplitter.feed(chunk); });
  bumpIdleTimer();

  const timeoutTimer = timeoutMs ? setTimeout(() => {
    timedOut = true;
    killChild('SIGTERM');
  }, timeoutMs) : null;

  // No-op 'error' listener voorkomt dat een ontbrekende binary (ENOENT) of
  // andere spawn-fout uitbreekt naar een uncaught exception. De echte fout
  // komt uit de `done`-promise die hieronder wordt afgewezen.
  ee.on('error', () => {});

  const done = new Promise((resolve, reject) => {
    child.on('error', (err) => { ee.emit('error', err); reject(err); });
    child.on('close', (code, signal) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      clearIdleTimer();
      stdoutSplitter.flush();
      stderrSplitter.flush();
      ee.emit('exit', { code, signal, timedOut, idleTimedOut });
      resolve({ code, signal, timedOut, idleTimedOut });
    });
  });

  ee.kill = (sig = 'SIGTERM') => killChild(sig);
  ee.pid = child.pid;
  ee.done = done;
  return ee;
}

module.exports = { runProcess, createLineSplitter };
