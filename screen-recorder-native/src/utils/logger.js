const fs = require('fs');
const path = require('path');
const util = require('util');
const config = require('../config');

class Logger {
  constructor() {
    this.stream = null;
    this.init();
  }

  init() {
    try {
      if (config.LOG_FILE) {
        const dir = path.dirname(config.LOG_FILE);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        this.stream = fs.createWriteStream(config.LOG_FILE, { flags: 'a' });
      }
    } catch (e) {
      console.warn('Failed to initialize log file stream:', e.message);
      this.stream = null;
    }
  }

  formatArgs(args) {
    return Array.from(args).map((x) => {
      try {
        if (typeof x === 'string') return x;
        return util.inspect(x, { depth: 5, maxArrayLength: 120 });
      } catch (e) {
        return String(x);
      }
    }).join(' ');
  }

  write(level, args) {
    if (!this.stream) return;
    try {
      const ts = new Date().toISOString();
      const msg = this.formatArgs(args);
      this.stream.write(`[${ts}] ${String(level).toUpperCase()} ${msg}\n`);
    } catch (e) {
      // Ignore write errors to prevent crashes
    }
  }

  log(...args) {
    this.write('LOG', args);
    origLog(...args);
  }

  info(...args) {
    this.write('INFO', args);
    origLog(...args);
  }

  warn(...args) {
    this.write('WARN', args);
    origWarn(...args);
  }

  error(...args) {
    this.write('ERROR', args);
    origError(...args);
  }

  debug(...args) {
    this.write('DEBUG', args);
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
      origLog(...args);
    }
  }
}

// Preserve original console methods
const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
const origError = console.error.bind(console);

const logger = new Logger();

// Override global console
console.log = (...args) => logger.log(...args);
console.info = (...args) => logger.info(...args);
console.warn = (...args) => logger.warn(...args);
console.error = (...args) => logger.error(...args);

module.exports = logger;
