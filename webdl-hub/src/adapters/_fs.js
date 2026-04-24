// src/adapters/_fs.js — shared helper: recursieve file-scan van een workdir.
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function collectOutputsRecursive(workdir) {
  const out = [];
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        try {
          const st = await fs.stat(full);
          out.push({ path: full, size: st.size });
        } catch { /* race: bestand verdwenen */ }
      }
    }
  }
  await walk(workdir);
  return out;
}

module.exports = { collectOutputsRecursive };
