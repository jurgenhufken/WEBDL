const fs = require('fs');
const path = '/Users/jurgen/WEBDL/screen-recorder-native/src/simple-server.js.pg.refactored';
let content = fs.readFileSync(path, 'utf8');

// The replacement we did for /media/file was missing the image sending part! It got cut off inside the `if (t === 'video')` block! Let's check exactly what's there now.
const start = content.indexOf(`expressApp.get('/media/file'`);
const end = content.indexOf('});', start) + 3;
console.log(content.slice(start, end + 300));
