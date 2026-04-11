const fs = require('fs');
let code = fs.readFileSync('/Users/jurgen/WEBDL/screen-recorder-native/src/simple-server.js', 'utf8');

code = code.replace(
`    const cp = await db.query("SELECT COUNT(*) as c FROM downloads WHERE status = 'completed' AND url NOT LIKE 'recording:%'");
    dbCompletedCount = (cp && cp.rows && cp.rows[0]) ? parseInt(cp.rows[0].c, 10) : 0;`,
`    const cp = await db.prepare("SELECT COUNT(*) as c FROM downloads WHERE status = 'completed' AND url NOT LIKE 'recording:%'").get();
    dbCompletedCount = cp && Number.isFinite(Number(cp.c)) ? Number(cp.c) : 0;`
);

fs.writeFileSync('/Users/jurgen/WEBDL/screen-recorder-native/src/simple-server.js', code);
