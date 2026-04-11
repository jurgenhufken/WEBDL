const http = require('http');
http.get('http://localhost:35729/api/media/active', res => {
  let body=''; res.on('data', d=>body+=d); res.on('end', ()=>console.log(body.substring(0, 500)));
});
