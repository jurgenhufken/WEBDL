// src/api/ws.js — WebSocket mount op /ws; broadcast van queue-events.
'use strict';

const { WebSocketServer } = require('ws');

function attachWs({ server, queue, logger }) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'hello', t: Date.now() }));
  });

  function broadcast(type, payload) {
    const msg = JSON.stringify({ type, payload, t: Date.now() });
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(msg);
    }
  }

  const events = ['job:created','job:claimed','job:progress','job:done','job:failed','job:retry','job:cancelled'];
  for (const ev of events) {
    queue.events.on(ev, (payload) => {
      try { broadcast(ev, payload); } catch (e) { logger.warn('ws.broadcast.error', { err: String(e.message || e) }); }
    });
  }

  return { wss };
}

module.exports = { attachWs };
