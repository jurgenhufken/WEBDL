// src/router/detect.js — URL → beste adapter (hoogste priority wint).
'use strict';

function detect(url, adapters, { hint } = {}) {
  if (hint) {
    const hinted = adapters.find((a) => a.name === hint);
    if (!hinted) throw new Error(`Onbekende adapter-hint: "${hint}"`);
    if (!hinted.matches(url)) {
      throw new Error(`Adapter "${hint}" matcht deze URL niet.`);
    }
    return hinted;
  }
  const matching = adapters.filter((a) => a.matches(url));
  if (matching.length === 0) return null;
  matching.sort((a, b) => b.priority - a.priority);
  return matching[0];
}

module.exports = { detect };
