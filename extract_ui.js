// Line-based extraction: much safer than character-offset manipulation
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'screen-recorder-native/src/simple-server.js.pg.refactored');
const lines = fs.readFileSync(filePath, 'utf8').split('\n');

const publicDir = path.join(__dirname, 'screen-recorder-native/src/public');
const uiDir = path.join(__dirname, 'screen-recorder-native/src/ui');
fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(uiDir, { recursive: true });

// Find function boundaries by line scanning
function findFunctionRange(lines, fnSignature) {
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith(fnSignature)) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) return null;

  // Count braces to find the matching closing brace
  let depth = 0;
  let endLine = -1;
  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) { endLine = i; break; } }
    }
    if (endLine !== -1) break;
  }
  return { startLine, endLine };
}

// Extract getGalleryHTML (pure template, no dynamic server-side vars)
const gallery = findFunctionRange(lines, 'function getGalleryHTML()');
if (gallery) {
  // The HTML content is between `return \`` and the last `\`;`
  const block = lines.slice(gallery.startLine, gallery.endLine + 1);
  // Find return ` line
  let htmlStart = -1, htmlEnd = -1;
  for (let i = 0; i < block.length; i++) {
    if (block[i].includes('return `')) { htmlStart = i; break; }
  }
  for (let i = block.length - 1; i >= 0; i--) {
    if (block[i].includes('`;')) { htmlEnd = i; break; }
  }
  if (htmlStart !== -1 && htmlEnd !== -1) {
    const htmlLines = block.slice(htmlStart, htmlEnd + 1);
    // Strip the return ` prefix and `; suffix
    htmlLines[0] = htmlLines[0].replace(/.*return `/, '');
    htmlLines[htmlLines.length - 1] = htmlLines[htmlLines.length - 1].replace(/`;\s*$/, '');
    
    fs.writeFileSync(path.join(publicDir, 'gallery.html'), htmlLines.join('\n'), 'utf8');
    
    // Replace in source
    const replacement = `function getGalleryHTML() {\n  return require('fs').readFileSync(require('path').join(__dirname, 'public', 'gallery.html'), 'utf8');\n}`;
    lines.splice(gallery.startLine, gallery.endLine - gallery.startLine + 1, replacement);
    console.log(`✅ getGalleryHTML extracted (${gallery.endLine - gallery.startLine + 1} lines -> public/gallery.html)`);
  }
} else {
  console.log('❌ getGalleryHTML not found');
}

// Re-find getViewerHTML (line numbers shifted after splice)
const viewer = findFunctionRange(lines, 'function getViewerHTML()');
if (viewer) {
  const block = lines.slice(viewer.startLine, viewer.endLine + 1);
  let htmlStart = -1, htmlEnd = -1;
  for (let i = 0; i < block.length; i++) {
    if (block[i].includes('return `')) { htmlStart = i; break; }
  }
  for (let i = block.length - 1; i >= 0; i--) {
    if (block[i].includes('`;')) { htmlEnd = i; break; }
  }
  if (htmlStart !== -1 && htmlEnd !== -1) {
    const htmlLines = block.slice(htmlStart, htmlEnd + 1);
    htmlLines[0] = htmlLines[0].replace(/.*return `/, '');
    htmlLines[htmlLines.length - 1] = htmlLines[htmlLines.length - 1].replace(/`;\s*$/, '');
    
    fs.writeFileSync(path.join(publicDir, 'viewer.html'), htmlLines.join('\n'), 'utf8');
    
    const replacement = `function getViewerHTML() {\n  return require('fs').readFileSync(require('path').join(__dirname, 'public', 'viewer.html'), 'utf8');\n}`;
    lines.splice(viewer.startLine, viewer.endLine - viewer.startLine + 1, replacement);
    console.log(`✅ getViewerHTML extracted (${viewer.endLine - viewer.startLine + 1} lines -> public/viewer.html)`);
  }
} else {
  console.log('❌ getViewerHTML not found');
}

// getOldDashboardHTML uses ${} template expressions with server-side data, so we extract
// the entire function as a JS module rather than a static HTML file
const dashboard = findFunctionRange(lines, 'function getOldDashboardHTML(');
if (dashboard) {
  const block = lines.slice(dashboard.startLine, dashboard.endLine + 1);
  
  fs.writeFileSync(path.join(uiDir, 'dashboard.js'), 'module.exports = ' + block.join('\n') + ';\n', 'utf8');
  
  const replacement = `const getOldDashboardHTML = require('./ui/dashboard.js');`;
  lines.splice(dashboard.startLine, dashboard.endLine - dashboard.startLine + 1, replacement);
  console.log(`✅ getOldDashboardHTML extracted (${dashboard.endLine - dashboard.startLine + 1} lines -> ui/dashboard.js)`);
} else {
  console.log('❌ getOldDashboardHTML not found');
}

fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
const finalSize = fs.statSync(filePath).size;
console.log(`\n📊 Server file: ${(finalSize / 1024).toFixed(0)} KB (was 616 KB)`);
console.log('Done!');
