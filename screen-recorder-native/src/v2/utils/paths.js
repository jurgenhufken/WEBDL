'use strict';
/**
 * Utils: Paths — Pijler: Bibliotheek
 * 
 * Bestands- en mappaden. Houdt zich aan de blauwdruk:
 *   BASE_DIR / {platform} / {channel} / bestand
 */
const path = require('path');
const fs = require('fs');

/**
 * Maak een veilige naam voor filesystem gebruik
 */
function sanitizeName(name) {
  return String(name || 'unknown')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/^\.+/, '_')
    .trim()
    .slice(0, 200) || 'unknown';
}

/**
 * Download directory: BASE_DIR/platform/channel/
 */
function getDownloadDir(baseDir, platform, channel) {
  const dir = path.join(baseDir, sanitizeName(platform), sanitizeName(channel));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Zoek mediabestanden in een directory (niet-recursief)
 */
function findMediaFiles(dir, maxFiles = 500) {
  const MEDIA_EXTS = new Set([
    '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.ts',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  ]);
  const files = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      if (files.length >= maxFiles) break;
      const ext = path.extname(name).toLowerCase();
      if (!MEDIA_EXTS.has(ext)) continue;
      const fp = path.join(dir, name);
      try {
        const st = fs.statSync(fp);
        if (st.isFile() && st.size > 0) files.push(fp);
      } catch (e) {}
    }
  } catch (e) {}
  return files;
}

/**
 * Vind het primaire mediabestand in een directory (grootste bestand)
 */
function findPrimaryFile(dir) {
  const files = findMediaFiles(dir);
  if (files.length === 0) return null;
  let best = files[0];
  let bestSize = 0;
  for (const fp of files) {
    try {
      const sz = fs.statSync(fp).size;
      if (sz > bestSize) { bestSize = sz; best = fp; }
    } catch (e) {}
  }
  return best;
}

module.exports = { sanitizeName, getDownloadDir, findMediaFiles, findPrimaryFile };
