'use strict';
/**
 * State — Gecentraliseerde mutable state
 * 
 * Alle globals die in simple-server.js als losse `let` variabelen stonden,
 * zitten nu op één plek. Modules lezen/schrijven via ctx.state.
 * 
 * Voordelen:
 * - Overzicht: alle state op één plek
 * - Testbaar: inject een verse state per test
 * - Debugbaar: log state.activeProcesses.size enz.
 */

module.exports = function createState() {
  return {
    // === Ingest: Download queue ===
    activeProcesses: new Map(),     // downloadId → child_process
    queuedJobs: [],                 // [{ id, url, platform, ... }]
    startingJobs: new Set(),        // downloadId's die bezig zijn met starten
    cancelledJobs: new Set(),       // downloadId's die gecancelled zijn
    onHoldJobs: new Set(),          // downloadId's die on hold staan
    jobPlatform: new Map(),         // downloadId → platform
    jobLane: new Map(),             // downloadId → 'heavy' | 'light'
    schedulerTimer: null,
    postprocessSchedulerTimer: null,

    // === Ingest: Recording ===
    activeRecordings: new Map(),    // tabId → { process, filepath, ... }

    // === Bibliotheek: Thumb generation ===
    thumbGenQueue: [],
    thumbGenActive: 0,
    thumbGenTimer: null,

    // === Bibliotheek: File indexing ===
    downloadFilesAutoIndexInProgress: false,

    // === Beheer: Caches ===
    statsCache: null,
    statsCacheAt: 0,
    recentFilesCache: null,
    recentFilesCacheAt: 0,

    // === Runtime ===
    isShuttingDown: false,
    lastYoutubeStartMs: 0,
    metadataProbeActive: 0,
  };
};
