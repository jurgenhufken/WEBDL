const { execSync } = require('child_process');
try {
  execSync('node src/simple-server.pg.refactored.js', { timeout: 3000, stdio: 'inherit' });
} catch (e) {
  if (e.code !== 'ETIMEDOUT') {
    console.error("Syntax Error found!");
    process.exit(1);
  }
}
console.log("Server parses successfully.");
