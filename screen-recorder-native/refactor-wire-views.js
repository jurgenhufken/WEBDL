#!/usr/bin/env node
/**
 * Refactor script: Replace inline view functions in simple-server.js
 * with require() calls to the extracted view modules.
 * 
 * This script:
 * 1. Reads simple-server.js
 * 2. Removes the inline function bodies of getViewerHTML, getGalleryHTML, getDashboardHTML
 * 3. Adds require() imports at the top
 * 4. Updates the getDashboardHTML call site to pass extra params
 * 5. Writes the result back
 * 
 * SAFETY: Creates a .pre-wire backup and validates syntax before overwriting.
 */
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const SERVER_PATH = path.join(__dirname, 'src', 'simple-server.js');
const BACKUP_PATH = SERVER_PATH + '.pre-wire-backup';

// Read
const original = fs.readFileSync(SERVER_PATH, 'utf8');
const lines = original.split('\n');
console.log(`Read ${lines.length} lines from simple-server.js`);

// Find function boundaries using brace counting
function findFunctionBounds(lines, funcName) {
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`function ${funcName}(`)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) throw new Error(`Function ${funcName} not found`);
  
  let braceDepth = 0;
  let started = false;
  let endIdx = startIdx;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { braceDepth++; started = true; }
      if (ch === '}') { braceDepth--; }
    }
    if (started && braceDepth === 0) {
      endIdx = i;
      break;
    }
  }
  return { start: startIdx, end: endIdx };
}

// Find all three functions
const viewer = findFunctionBounds(lines, 'getViewerHTML');
const gallery = findFunctionBounds(lines, 'getGalleryHTML');
const dashboard = findFunctionBounds(lines, 'getDashboardHTML');

console.log(`getViewerHTML:    lines ${viewer.start + 1}-${viewer.end + 1}  (${viewer.end - viewer.start + 1} lines)`);
console.log(`getGalleryHTML:   lines ${gallery.start + 1}-${gallery.end + 1}  (${gallery.end - gallery.start + 1} lines)`);
console.log(`getDashboardHTML: lines ${dashboard.start + 1}-${dashboard.end + 1}  (${dashboard.end - dashboard.start + 1} lines)`);

// Build replacement - remove from bottom to top to preserve line numbers
const toRemove = [
  { ...dashboard, replacement: '// getDashboardHTML → extracted to ./views/dashboard.js' },
  { ...gallery, replacement: '// getGalleryHTML → extracted to ./views/gallery.js' },
  { ...viewer, replacement: '// getViewerHTML → extracted to ./views/viewer.js' },
].sort((a, b) => b.start - a.start); // Sort descending to remove from bottom first

let newLines = [...lines];
for (const { start, end, replacement } of toRemove) {
  newLines.splice(start, end - start + 1, replacement);
}

// Add require() imports after the existing require block (after line ~16: logger require)
const loggerIdx = newLines.findIndex(l => l.includes("require('./utils/logger')"));
if (loggerIdx === -1) throw new Error('Could not find logger require line');

const requireLines = [
  '',
  '// ========================',
  '// VIEW MODULES (GEEXTRAHEERD)',
  '// ========================',
  "const getViewerHTML = require('./views/viewer');",
  "const getGalleryHTML = require('./views/gallery');",
  "const getDashboardHTML = require('./views/dashboard');",
];
newLines.splice(loggerIdx + 1, 0, ...requireLines);

// Update getDashboardHTML call site to pass BASE_DIR and makeIndexedMediaItem
const callIdx = newLines.findIndex(l => l.includes('getDashboardHTML(uniqueDownloads, screenshots, recentBatchFiles)'));
if (callIdx === -1) throw new Error('Could not find getDashboardHTML call site');
newLines[callIdx] = newLines[callIdx].replace(
  'getDashboardHTML(uniqueDownloads, screenshots, recentBatchFiles)',
  'getDashboardHTML(uniqueDownloads, screenshots, recentBatchFiles, BASE_DIR, makeIndexedMediaItem)'
);

const result = newLines.join('\n');
console.log(`\nResult: ${newLines.length} lines (was ${lines.length}, removed ${lines.length - newLines.length})`);

// Backup
fs.writeFileSync(BACKUP_PATH, original);
console.log(`Backup saved to: ${BACKUP_PATH}`);

// Write result to temp file first
const tmpPath = SERVER_PATH.replace('.js', '.refactor-tmp.js');
fs.writeFileSync(tmpPath, result);

// Syntax check
try {
  execSync(`/opt/homebrew/bin/node -c "${tmpPath}"`, { stdio: 'pipe' });
  console.log('✅ Syntax check passed!');
} catch (e) {
  console.error('❌ SYNTAX ERROR! Not overwriting original.');
  console.error(e.stderr ? e.stderr.toString() : e.message);
  fs.unlinkSync(tmpPath);
  process.exit(1);
}

// Overwrite
fs.renameSync(tmpPath, SERVER_PATH);
console.log(`\n✅ simple-server.js updated successfully!`);
console.log(`   Removed: ${lines.length - newLines.length} lines`);
console.log(`   Can restore from: ${BACKUP_PATH}`);
console.log(`   Or from git: git checkout -- src/simple-server.js`);
