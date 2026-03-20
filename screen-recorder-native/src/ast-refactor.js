const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;

const DEFAULT_INPUT = '/Users/jurgen/WEBDL/screen-recorder-native/src/simple-server.js';
const DEFAULT_OUTPUT = '/Users/jurgen/WEBDL/screen-recorder-native/src/simple-server.js.pg.refactored';

const inputFile = process.argv[2] ? String(process.argv[2]) : DEFAULT_INPUT;
const outputFile = process.argv[3] ? String(process.argv[3]) : DEFAULT_OUTPUT;

let code = fs.readFileSync(inputFile, 'utf-8');

code = code.replace(
  /const\s+Database\s*=\s*require\(['"]better-sqlite3['"]\);/,
  "const { createDb } = require('./db-adapter');"
);

code = code.replace(
  /const\s+db\s*=\s*new\s+Database\(DB_PATH\);/,
  "const WEBDL_DB_ENGINE = String(process.env.WEBDL_DB_ENGINE || 'sqlite').trim();\nconst DATABASE_URL = String(process.env.DATABASE_URL || '').trim();\nconst db = createDb({ engine: WEBDL_DB_ENGINE, sqlitePath: DB_PATH, databaseUrl: DATABASE_URL });"
);

code = code.replace(
  /\bdb\.pragma\(\s*'journal_mode\s*=\s*WAL'\s*\);/g,
  "if (db.isSqlite) db.pragma('journal_mode = WAL');"
);

code = code.replace(/\bdb\.exec\(/g, 'if (db.isSqlite) db.exec(');

// 1. Identify all variables that are DB statements
// const getAllDownloads = db.prepare(...)
// We also have db.prepare(...).all()
const ast = parser.parse(code, {
  sourceType: 'script',
  allowReturnOutsideFunction: true,
  plugins: [
    'optionalChaining',
    'nullishCoalescingOperator',
    'dynamicImport',
    'objectRestSpread',
    'asyncGenerators',
    'bigInt',
    'classProperties',
    'topLevelAwait'
  ]
});

const dbStatements = new Set();
let changed = false;

function markEnclosingFunctionAsync(path) {
  const funcPath = path.findParent((p) => p.isFunction());
  if (funcPath && funcPath.node && !funcPath.node.async) {
    funcPath.node.async = true;
    changed = true;
  }
}

function isDbPrepareCall(node) {
  return (
    node &&
    node.type === 'CallExpression' &&
    node.callee &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'db' &&
    node.callee.property &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'prepare'
  );
}

traverse(ast, {
  VariableDeclarator(path) {
    const init = path.node.init;
    if (!isDbPrepareCall(init)) return;
    if (path.node.id.type !== 'Identifier') return;
    dbStatements.add(path.node.id.name);
  }
});

const DB_METHODS = new Set(['get', 'all', 'run', 'iterate']);

traverse(ast, {
  CallExpression(path) {
    const callee = path.node.callee;
    if (!callee || callee.type !== 'MemberExpression') return;

    const prop = callee.property;
    const propName = prop && prop.type === 'Identifier' ? prop.name : null;
    if (!propName || !DB_METHODS.has(propName)) return;

    const obj = callee.object;
    const isStmtVar = obj && obj.type === 'Identifier' && dbStatements.has(obj.name);
    const isPrepareInline = isDbPrepareCall(obj);
    if (!isStmtVar && !isPrepareInline) return;

    if (path.parent && path.parent.type === 'AwaitExpression') return;
    if (!path.findParent((p) => p.isFunction())) return;

    path.replaceWith({ type: 'AwaitExpression', argument: path.node });
    markEnclosingFunctionAsync(path);
    changed = true;
  }
});

const out = generator(
  ast,
  {
    retainLines: true,
    compact: false,
    comments: true
  },
  code
).code;

fs.writeFileSync(outputFile, out, 'utf-8');
console.log('Wrote:', outputFile);
