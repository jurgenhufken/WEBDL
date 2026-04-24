// Patch script: replace lines 12340-12394 (the SQL tree query) with filesystem scan
// and insert performRawFilesystemScan before the search endpoint
// and add channel-files fallback hook

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'src', 'simple-server.js');
const lines = fs.readFileSync(FILE, 'utf-8').split('\n');

// ──────────────────────────────────────────────────────────
// PATCH 1: Replace lines 12340-12394 (1-indexed) with filesystem tree scanner
// ──────────────────────────────────────────────────────────
const treePatch = [
  '    // Fast physical filesystem scan (replaces slow SQL tree query)',
  '    const tree = {};',
  '    let platforms = [];',
  '    try { platforms = await fs.promises.readdir(BASE_DIR, { withFileTypes: true }); }',
  '    catch(e) { /* BASE_DIR not readable */ }',
  '    for (const pEnt of platforms) {',
  '      if (!pEnt.isDirectory() || pEnt.name.startsWith(\'.\')) continue;',
  '      const p = pEnt.name;',
  '      tree[p] = { count: 0, fileCount: 0, screenshotCount: 0, channels: [] };',
  '      let channels = [];',
  '      try { channels = await fs.promises.readdir(require(\'path\').join(BASE_DIR, p), { withFileTypes: true }); }',
  '      catch(e) { continue; }',
  '      for (const cEnt of channels) {',
  '        if (!cEnt.isDirectory() || cEnt.name.startsWith(\'.\')) {',
  '          if (/\\.(mp4|webm|mkv|mov|avi|jpg|jpeg|png)$/i.test(cEnt.name)) tree[p].count++;',
  '          continue;',
  '        }',
  '        const c = cEnt.name;',
  '        let d_name = c;',
  '        if (/^thread_\\d+$/i.test(c)) d_name = \'Thread \' + c.replace(/^thread_/i, \'\');',
  '        let cEntries = [];',
  '        try { cEntries = await fs.promises.readdir(require(\'path\').join(BASE_DIR, p, c)); } catch(e) {}',
  '        let cfiles = 0;',
  '        for (const f of cEntries) {',
  '          const fn = (typeof f === \'string\') ? f : (f.name || \'\');',
  '          if (/\\.(mp4|webm|mkv|mov|avi|jpg|jpeg|png)$/i.test(fn)) cfiles++;',
  '        }',
  '        tree[p].count += cfiles;',
  '        tree[p].channels.push({ name: c, displayName: d_name, count: cfiles, fileCount: 0, screenshotCount: 0 });',
  '      }',
  '    }',
  '    _directoryTreeCache = tree;',
  '    _directoryTreeCacheTime = Date.now();',
  '    return tree;',
];

// Replace lines 12340..12394 (0-indexed: 12339..12393)
lines.splice(12339, 12393 - 12339 + 1, ...treePatch);

// After splice, line count changed. We need to find new positions for remaining patches.
// Delta = treePatch.length - (12393 - 12339 + 1) = 35 - 55 = -20
const delta1 = treePatch.length - 55;

// ──────────────────────────────────────────────────────────
// PATCH 2: Insert performRawFilesystemScan function before the search endpoint
// Find the line: "// ═══ DEDICATED SEARCH API"
// ──────────────────────────────────────────────────────────
let searchMarkerIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('DEDICATED SEARCH API')) {
    searchMarkerIdx = i;
    break;
  }
}

if (searchMarkerIdx < 0) {
  console.error('Could not find DEDICATED SEARCH API marker');
  process.exit(1);
}

const scannerFunc = [
  '',
  '// ═══ RAW FILESYSTEM BROWSER FALLBACK ═══',
  'async function performRawFilesystemScan(enabledDirs, searchQuery, typeFilter, sort, limit, cur, db) {',
  '  async function scanDirRec(dir, depth, maxDepth) {',
  '    if (depth > maxDepth) return [];',
  '    let entries;',
  '    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }',
  '    catch(e) { return []; }',
  '    let results = [];',
  '    for (const entry of entries) {',
  '      if (entry.name.startsWith(\'.\')) continue;',
  '      const fullPath = require(\'path\').join(dir, entry.name);',
  '      if (entry.isDirectory()) {',
  '        const sub = await scanDirRec(fullPath, depth + 1, maxDepth);',
  '        for (let i = 0; i < sub.length; i++) results.push(sub[i]);',
  '      } else {',
  '        const isVid = /\\.(mp4|webm|mov|mkv|avi)$/i.test(entry.name);',
  '        const isImg = /\\.(jpg|jpeg|png|webp|gif)$/i.test(entry.name);',
  '        if (typeFilter === \'video_only\' && !isVid) continue;',
  '        if (typeFilter === \'image_only\' && !isImg) continue;',
  '        if (!isVid && !isImg) continue;',
  '        results.push(fullPath);',
  '      }',
  '    }',
  '    return results;',
  '  }',
  '',
  '  let allRawPaths = [];',
  '  for (const dirObj of enabledDirs) {',
  '    if (!dirObj || typeof dirObj !== \'object\') {',
  '      const fp = require(\'path\').join(BASE_DIR, String(dirObj).trim());',
  '      allRawPaths.push(...(await scanDirRec(fp, 0, 3)));',
  '    } else {',
  '      const dPlat = String(dirObj.platform || \'\').trim();',
  '      if (dPlat.startsWith(\'/\')) continue;',
  '      if (Array.isArray(dirObj.channels) && dirObj.channels.length > 0) {',
  '        for (const c of dirObj.channels) {',
  '          allRawPaths.push(...(await scanDirRec(require(\'path\').join(BASE_DIR, dPlat, String(c).trim()), 0, 3)));',
  '        }',
  '      } else {',
  '        allRawPaths.push(...(await scanDirRec(require(\'path\').join(BASE_DIR, dPlat), 0, 3)));',
  '      }',
  '    }',
  '  }',
  '',
  '  if (searchQuery) {',
  '    const qWords = searchQuery.split(\',\').map(function(s){return s.trim();}).filter(Boolean);',
  '    allRawPaths = allRawPaths.filter(function(fp) {',
  '      const pLow = fp.toLowerCase();',
  '      for (const w of qWords) {',
  '        const ands = w.split(/[\\s+*-]+/).filter(Boolean);',
  '        let ok = true;',
  '        for (const a of ands) { if (!pLow.includes(a)) { ok = false; break; } }',
  '        if (ok) return true;',
  '      }',
  '      return false;',
  '    });',
  '  }',
  '',
  '  const fileStats = [];',
  '  for (const fp of allRawPaths) {',
  '    try { const st = await fs.promises.stat(fp); fileStats.push({ fp: fp, ts: st.mtimeMs }); } catch(e) {}',
  '  }',
  '  fileStats.sort(function(a, b) { return sort === \'oldest\' ? a.ts - b.ts : b.ts - a.ts; });',
  '',
  '  const pageOffset = cur ? (cur.rowOffset || 0) : 0;',
  '  const pageSlice = fileStats.slice(pageOffset, pageOffset + limit);',
  '',
  '  const rawItems = [];',
  '  for (const p of pageSlice) {',
  '    const relPath = require(\'path\').relative(BASE_DIR, p.fp);',
  '    rawItems.push({',
  '      kind: \'p\',',
  '      id: \'raw-\' + Math.floor(Math.random() * 9999999),',
  '      platform: \'raw\',',
  '      channel: \'folder\',',
  '      title: require(\'path\').basename(p.fp),',
  '      filepath: p.fp,',
  '      url: \'/file/\' + encodeURIComponent(relPath).replace(/%2F/g, \'/\'),',
  '      thumbnail: null,',
  '      created_at: new Date(p.ts).toISOString(),',
  '      ts: p.ts,',
  '      rating: null,',
  '    });',
  '  }',
  '',
  '  if (pageSlice.length > 0 && db && db.isPostgres) {',
  '    try {',
  '      const sqlPaths = pageSlice.map(function(x) { return x.fp; });',
  '      const binds = [];',
  '      const pms = [];',
  '      for (let i = 0; i < sqlPaths.length; i++) { pms.push(\'$\' + (i + 1)); binds.push(sqlPaths[i]); }',
  '      const qRes = await (db.readPool || db.pool).query(\'SELECT * FROM downloads WHERE filepath IN (\' + pms.join(\', \') + \')\', binds);',
  '      const map = new Map();',
  '      for (const r of qRes.rows) map.set(r.filepath, r);',
  '      for (const item of rawItems) {',
  '        const matched = map.get(item.filepath);',
  '        if (matched) {',
  '          item.id = String(matched.id);',
  '          item.kind = \'d\';',
  '          item.platform = matched.platform || \'raw\';',
  '          item.channel = matched.channel || \'folder\';',
  '          item.title = matched.title || item.title;',
  '          item.rating = matched.rating;',
  '          item.rating_kind = \'d\';',
  '          item.rating_id = matched.id;',
  '          if (matched.thumbnail) item.thumbnail = matched.thumbnail;',
  '        }',
  '      }',
  '    } catch(e) { /* DB enrichment failed, raw items still usable */ }',
  '  }',
  '',
  '  return { items: rawItems, nextOffset: pageOffset + rawItems.length, hitLimit: rawItems.length >= limit };',
  '}',
  '',
];

lines.splice(searchMarkerIdx, 0, ...scannerFunc);
const delta2 = scannerFunc.length;

// ──────────────────────────────────────────────────────────
// PATCH 3: Add fallback hook in recent-files endpoint, before "// Date range filter"
// ──────────────────────────────────────────────────────────
let dateRangeIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === '// Date range filter') {
    dateRangeIdx = i;
    break;
  }
}

if (dateRangeIdx >= 0) {
  const recentHook = [
    '  if (enabledDirs && enabledDirs.length > 0) {',
    '    try {',
    '      const rawRes = await performRawFilesystemScan(enabledDirs, searchQuery, type, sort, limit, cur, db);',
    '      const reqTime = Date.now() - reqStartTime;',
    '      console.log(\'[DIR FALLBACK] /api/media/recent-files - \' + rawRes.items.length + \' items in \' + reqTime + \'ms\');',
    '      return res.json({',
    '        success: true, items: rawRes.items, done: !rawRes.hitLimit,',
    '        next_cursor: rawRes.hitLimit ? encodeCursor({ rowOffset: rawRes.nextOffset, activeOffset: 0 }) : \'\'',
    '      });',
    '    } catch(err) {',
    '      console.error(\'[Recent-Files DIR FALLBACK error]\', err.message);',
    '    }',
    '  }',
    '',
  ];
  lines.splice(dateRangeIdx, 0, ...recentHook);
}

// ──────────────────────────────────────────────────────────
// PATCH 4: Add fallback hook in channel-files endpoint
// Find: "if (!platform || !channel) return res.status(400)"
// Insert after it.
// ──────────────────────────────────────────────────────────
let channelGuardIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("if (!platform || !channel) return res.status(400)")) {
    channelGuardIdx = i;
    break;
  }
}

if (channelGuardIdx >= 0) {
  const channelHook = [
    '',
    '  // ═══ RAW FILESYSTEM BROWSER FALLBACK ═══',
    '  try {',
    '    const hookDirs = [{ platform: platform, channels: [channel] }];',
    '    const rawRes = await performRawFilesystemScan(hookDirs, \'\', type, sort, limit, cur, db);',
    '    console.log(\'[DIR FALLBACK] /api/media/channel-files - \' + rawRes.items.length + \' items\');',
    '    return res.json({',
    '      success: true, items: rawRes.items, done: !rawRes.hitLimit,',
    '      next_cursor: rawRes.hitLimit ? encodeCursor({ rowOffset: rawRes.nextOffset, activeOffset: 0 }) : \'\'',
    '    });',
    '  } catch(err) {',
    '    console.error(\'[Channel-Files DIR FALLBACK error]\', err.message);',
    '  }',
    '',
  ];
  lines.splice(channelGuardIdx + 1, 0, ...channelHook);
}

// ──────────────────────────────────────────────────────────
// PATCH 5: Add fallback hook in search endpoint
// Find: "const orGroups = q.split(',')"
// ──────────────────────────────────────────────────────────
let orGroupsIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("const orGroups = q.split(',')")) {
    orGroupsIdx = i;
    break;
  }
}

if (orGroupsIdx >= 0) {
  // Find the "try {" immediately before orGroups line
  let tryIdx = orGroupsIdx - 1;
  while (tryIdx >= 0 && !lines[tryIdx].trim().startsWith('try {')) tryIdx--;
  if (tryIdx >= 0) {
    const searchHook = [
      '  if (enabledDirs && enabledDirs.length > 0) {',
      '    try {',
      '      const rawRes = await performRawFilesystemScan(enabledDirs, q, type, sort, limit, { rowOffset: offset }, db);',
      '      const reqTime = Date.now() - reqStart;',
      '      console.log(\'[DIR FALLBACK] /api/media/search - \' + rawRes.items.length + \' items in \' + reqTime + \'ms\');',
      '      return res.json({',
      '        success: true, items: rawRes.items, done: !rawRes.hitLimit,',
      '        next_cursor: rawRes.hitLimit ? encodeCursor({ rowOffset: rawRes.nextOffset, activeOffset: 0 }) : \'\'',
      '      });',
      '    } catch(err) {',
      '      console.error(\'[Search DIR FALLBACK error]\', err.message);',
      '    }',
      '  }',
      '',
    ];
    lines.splice(tryIdx, 0, ...searchHook);
  }
}

fs.writeFileSync(FILE, lines.join('\n'), 'utf-8');
console.log('✅ All 5 patches applied successfully!');
console.log('Total lines:', lines.length);
