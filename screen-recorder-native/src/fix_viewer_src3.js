const fs = require('fs');
const path = '/Users/jurgen/WEBDL/screen-recorder-native/src/simple-server.js.pg.refactored';
let content = fs.readFileSync(path, 'utf8');

// Wait, the previous replace failed because the regex `const img = pickThumbnailFile\\(fp\\);\\s+if \\(img && safeIsAllowedExistingPath\\(img\\)\\) \\{` didn't match. 
// Ah, the regex failed because of the backslashes `\\s+`. I used `replace(/.../g)` in JS string.
// Let's just use simple indexOf and slice.

const target = `const img = pickThumbnailFile(fp);
        if (img && safeIsAllowedExistingPath(img)) {`;
const replaceWith = `const imgData = pickPrimaryMediaFile(fp);
        const img = imgData ? imgData.path : null;
        if (img && safeIsAllowedExistingPath(img)) {`;

if (content.includes(target)) {
  content = content.replace(target, replaceWith);
  fs.writeFileSync(path, content, 'utf8');
  console.log("Successfully replaced pickThumbnailFile with pickPrimaryMediaFile in /media/file");
} else {
  console.log("Target not found!");
}

