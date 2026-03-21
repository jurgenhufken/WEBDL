const fs = require('fs');
const path = '/Users/jurgen/WEBDL/screen-recorder-native/src/simple-server.js.pg.refactored';
let content = fs.readFileSync(path, 'utf8');

// Fix 1: lastPeriodicAt initialization
content = content.replace('let lastPeriodicAt = 0;', 'let lastPeriodicAt = Date.now();');

// Fix 2: softRefreshTop include_active
content = content.replace(/include_active=1/g, 'include_active=0');

// Fix 3: /media/file picking high-res image
const start = content.indexOf(`expressApp.get('/media/file', async (req, res) => {`);
if (start !== -1) {
  const end = content.indexOf('});', start) + 3;
  let block = content.slice(start, end);
  
  block = block.replace(
    /const img = pickThumbnailFile\(fp\);\s+if \(img && safeIsAllowedExistingPath\(img\)\) \{/g,
    `const imgData = pickPrimaryMediaFile(fp);\n        const img = imgData ? imgData.path : null;\n        if (img && safeIsAllowedExistingPath(img)) {`
  );
  
  content = content.slice(0, start) + block + content.slice(end);
} else {
  console.error('Could not find /media/file route');
}

// Fix 4: Inject [Bron] link in gallery modal
const viewerHeaderStart = content.indexOf('<button id="btnFinder" class="btn">Finder</button>');
if (viewerHeaderStart !== -1 && !content.includes('<button id="btnSource" class="btn">Bron</button>')) {
  content = content.replace(
    '<button id="btnFinder" class="btn">Finder</button>',
    '<button id="btnFinder" class="btn">Finder</button>\n        <button id="btnSource" class="btn">Bron</button>'
  );
}

const btnFinderVarStart = content.indexOf("const elBtnFinder = document.getElementById('btnFinder');");
if (btnFinderVarStart !== -1 && !content.includes("const elBtnSource = document.getElementById('btnSource');")) {
  content = content.replace(
    "const elBtnFinder = document.getElementById('btnFinder');",
    "const elBtnFinder = document.getElementById('btnFinder');\n    const elBtnSource = document.getElementById('btnSource');"
  );
}

const openModalIdx = content.indexOf('elBtnFinder.disabled = !isReady;');
if (openModalIdx !== -1 && !content.includes('elBtnSource.style.display = it.source_url ?')) {
  content = content.replace(
    'elBtnFinder.disabled = !isReady;',
    'elBtnFinder.disabled = !isReady;\n      if (elBtnSource) { elBtnSource.style.display = it.source_url ? \'\' : \'none\'; elBtnSource.onclick = () => window.open(it.source_url, \'_blank\'); }'
  );
}

fs.writeFileSync(path, content, 'utf8');
console.log('Fixes applied.');
