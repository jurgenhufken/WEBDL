'use strict';
/**
 * DB Queries — Pijler: Bibliotheek
 * 
 * Factory: ontvangt db, retourneert alle prepared statements.
 * Elke query is een object met get(), all(), run().
 * 
 * Gegroepeerd per domein, niet per tabel.
 */

module.exports = function initQueries(db) {
  return {
    // === Downloads (Ingest) ===
    getDownload: db.prepare(
      `SELECT * FROM downloads WHERE id = ?`
    ),
    getRecentDownloads: db.prepare(
      `SELECT * FROM downloads ORDER BY COALESCE(finished_at, updated_at, created_at) DESC LIMIT ?`
    ),
    getActiveDownloads: db.prepare(
      `SELECT * FROM downloads WHERE status IN ('downloading', 'postprocessing', 'queued', 'pending') ORDER BY created_at DESC`
    ),
    insertDownload: db.prepare(
      `INSERT INTO downloads (url, platform, channel, title, status) VALUES (?, ?, ?, ?, 'pending') RETURNING id`
    ),
    updateDownloadStatus: db.prepare(
      `UPDATE downloads SET status=?, progress=?, error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ),

    // === Download Files (Bibliotheek) ===
    getDownloadFiles: db.prepare(
      `SELECT * FROM download_files WHERE download_id = ? ORDER BY file_rel`
    ),
    getRecentFiles: db.prepare(
      `SELECT d.id, d.platform, d.channel, d.title, d.status, d.thumbnail,
              d.filepath, d.created_at, d.finished_at, d.source_url, d.url,
              d.description, d.duration
       FROM downloads d
       WHERE d.status = 'completed' AND d.filepath IS NOT NULL AND d.filepath != ''
       ORDER BY COALESCE(d.finished_at, d.created_at) DESC
       LIMIT ?`
    ),

    // === Screenshots (Bibliotheek) ===
    getRecentScreenshots: db.prepare(
      `SELECT * FROM screenshots ORDER BY created_at DESC LIMIT ?`
    ),

    // === Stats (Beheer) ===
    getStats: db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM downloads) AS downloads,
        (SELECT COUNT(*) FROM screenshots) AS screenshots,
        (SELECT COUNT(*) FROM download_files) AS download_files`
    ),

    // === Tags (Beheer) ===
    getAllTags: db.prepare(
      `SELECT * FROM tags ORDER BY name`
    ),
    getMediaTags: db.prepare(
      `SELECT t.* FROM tags t JOIN media_tags mt ON mt.tag_id = t.id WHERE mt.kind = ? AND mt.media_id = ?`
    ),

    // === Ratings (Beheer) ===
    getRating: db.prepare(
      `SELECT * FROM ratings WHERE kind = ? AND media_id = ?`
    ),

    // === Channels (Viewer) ===
    getMediaChannels: db.prepare(
      `SELECT platform, channel, COUNT(*) AS count,
              MAX(COALESCE(finished_at, created_at)) AS last_item
       FROM downloads
       WHERE status = 'completed' AND filepath IS NOT NULL AND filepath != ''
       GROUP BY platform, channel
       ORDER BY last_item DESC
       LIMIT ? OFFSET ?`
    ),
    getChannelFiles: db.prepare(
      `SELECT d.id, d.platform, d.channel, d.title, d.status, d.thumbnail,
              d.filepath, d.created_at, d.finished_at, d.source_url, d.url,
              d.description, d.duration
       FROM downloads d
       WHERE d.status = 'completed' AND d.filepath IS NOT NULL AND d.filepath != ''
         AND d.platform = ? AND d.channel = ?
       ORDER BY COALESCE(d.finished_at, d.created_at) DESC
       LIMIT ? OFFSET ?`
    ),
  };
};
