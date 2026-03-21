const fs = require('fs');
const path = '/Users/jurgen/WEBDL/screen-recorder-native/src/simple-server.js.pg.refactored';

try {
  let content = fs.readFileSync(path, 'utf8');
  const lines = content.split('\n');
  
  // Find runDownloadScheduler start
  const startIdx = lines.findIndex(l => l.includes('async function runDownloadScheduler() {'));
  if (startIdx === -1) {
    console.error('Could not find runDownloadScheduler');
    process.exit(1);
  }

  // Find the end of runDownloadScheduler. 
  // We know from read_file it ends around 7650.
  // And the duplicate starts at 7651 with "      return n;"
  
  const duplicateStartLine = lines.findIndex((l, i) => i > startIdx && l.startsWith('      return n;'));
  if (duplicateStartLine === -1) {
     console.error('Could not find start of duplicate block "      return n;"');
     // Maybe it was already fixed?
     process.exit(1);
  }

  // The line BEFORE duplicateStartLine should be "}"
  if (lines[duplicateStartLine - 1].trim() !== '}') {
    console.error('Expected "}" before duplicate start, found:', lines[duplicateStartLine - 1]);
    process.exit(1);
  }

  // Find "let metadataProbeTimer = null;" which follows the duplicate block
  const nextValidCodeLine = lines.findIndex((l, i) => i > duplicateStartLine && l.includes('let metadataProbeTimer = null;'));
  
  if (nextValidCodeLine === -1) {
    console.error('Could not find "let metadataProbeTimer = null;"');
    process.exit(1);
  }

  console.log(`Removing lines ${duplicateStartLine + 1} to ${nextValidCodeLine} (exclusive)`);
  
  // Remove lines from duplicateStartLine up to nextValidCodeLine
  lines.splice(duplicateStartLine, nextValidCodeLine - duplicateStartLine);
  
  // Write back
  fs.writeFileSync(path, lines.join('\n'), 'utf8');
  console.log('Successfully removed duplicate block.');

} catch (e) {
  console.error(e);
  process.exit(1);
}
