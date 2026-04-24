const http = require('http');

http.get('http://localhost:35729/gallery', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Gallery loaded, length:', data.length));
}).on('error', err => console.log('Error:', err.message));
