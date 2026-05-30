// @ts-check
// webdl-core/sources/index.js
//
// Central registry. require() registreert elke Source bij module-load
// via registerSource() in source.js.

require('./vipergirls');
// require('./footfetishforum');  // TODO stap 4

const sources = require('./source');

module.exports = sources;
