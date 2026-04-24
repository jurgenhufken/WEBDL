// src/adapters/base.js — contract + helpers voor adapters.
//
// Contract:
//   - name        (uniek, bijv. 'ytdlp')
//   - priority    (hoger wint bij meerdere matches)
//   - matches(url) → boolean
//   - plan(url, opts) → { cmd, args, cwd, env }
//   - parseProgress(line) → { pct?, speed?, eta? } | null
//   - collectOutputs(workdir) → [{ path, size?, mime? }]
'use strict';

function defineAdapter(spec) {
  for (const key of ['name', 'priority', 'matches', 'plan']) {
    if (spec[key] === undefined) {
      throw new Error(`Adapter mist verplichte eigenschap: ${key}`);
    }
  }
  const adapter = {
    name: spec.name,
    priority: spec.priority,
    matches: spec.matches,
    plan: spec.plan,
    parseProgress: spec.parseProgress || (() => null),
    collectOutputs: spec.collectOutputs || (async () => []),
  };
  // Optionele extensies (bijv. expandPlaylist voor playlist-URLs)
  if (spec.expandPlaylist) adapter.expandPlaylist = spec.expandPlaylist;
  return adapter;
}

module.exports = { defineAdapter };
