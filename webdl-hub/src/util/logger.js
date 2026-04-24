// src/util/logger.js — minimalistische JSON-lines logger.
'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function createLogger({ level = 'info' } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function emit(lvl, msg, extra) {
    if (LEVELS[lvl] < threshold) return;
    const line = JSON.stringify({
      t: new Date().toISOString(),
      lvl,
      msg,
      ...(extra || {}),
    });
    if (lvl === 'warn' || lvl === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }

  function withBindings(bindings) {
    return {
      debug: (msg, extra) => emit('debug', msg, { ...bindings, ...(extra || {}) }),
      info:  (msg, extra) => emit('info',  msg, { ...bindings, ...(extra || {}) }),
      warn:  (msg, extra) => emit('warn',  msg, { ...bindings, ...(extra || {}) }),
      error: (msg, extra) => emit('error', msg, { ...bindings, ...(extra || {}) }),
      with:  (b) => withBindings({ ...bindings, ...b }),
    };
  }

  return {
    debug: (msg, extra) => emit('debug', msg, extra),
    info:  (msg, extra) => emit('info',  msg, extra),
    warn:  (msg, extra) => emit('warn',  msg, extra),
    error: (msg, extra) => emit('error', msg, extra),
    with: withBindings,
  };
}

module.exports = { createLogger, LEVELS };
