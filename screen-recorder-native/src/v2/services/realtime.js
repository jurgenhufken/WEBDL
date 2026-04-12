'use strict';
/**
 * Service: Realtime — Socket.IO events
 * 
 * Stuurt realtime updates naar de gallery/viewer bij:
 * - Download voortgang
 * - Download voltooid/error
 * - Nieuwe media beschikbaar
 * - Queue status wijzigingen
 */
const { Server } = require('socket.io');

function initRealtime(ctx, httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
  });

  let clientCount = 0;

  io.on('connection', (socket) => {
    clientCount++;
    console.log(`[ws] Client connected (${clientCount} total)`);

    socket.on('disconnect', () => {
      clientCount--;
    });
  });

  // --- Emit helpers ---

  function emitDownloadProgress(downloadId, progress, status) {
    io.emit('download:progress', { downloadId, progress, status });
  }

  function emitDownloadComplete(downloadId, data) {
    io.emit('download:complete', { downloadId, ...data });
  }

  function emitDownloadError(downloadId, error) {
    io.emit('download:error', { downloadId, error });
  }

  function emitNewMedia(item) {
    io.emit('media:new', item);
  }

  function emitQueueStatus() {
    const { state } = ctx;
    io.emit('queue:status', {
      active: state.activeProcesses.size,
      queued: state.queuedJobs.length,
      thumbQueue: state.thumbGenQueue.length,
    });
  }

  return {
    io,
    emitDownloadProgress,
    emitDownloadComplete,
    emitDownloadError,
    emitNewMedia,
    emitQueueStatus,
    get clientCount() { return clientCount; },
  };
}

module.exports = { initRealtime };
