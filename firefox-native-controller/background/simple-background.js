// Constanten
const SERVER_URL = 'http://localhost:35729';
const SERVER_URL_FALLBACK = 'http://127.0.0.1:35729';
const CONTEXT_MENU_ID = 'webdl-download';
const SOCKET_ACK_TIMEOUT_MS = 8000;
const HEARTBEAT_INTERVAL_MS = 15000;
const HEARTBEAT_STALE_MS = 45000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HTTP_STATUS_PROBE_INTERVAL_MS = 4000;
const HTTP_TIMEOUT_MS = 6000;
const PROBE_FAILURES_BEFORE_DISCONNECT = 2; // Reduced so it detects faster
const PROBE_DISCONNECT_GRACE_MS = 12000; // Drop after 12s of no heartbeat
const SOCKET_ENABLED = false;
const BACKGROUND_BUILD = 'simple-background-v3-hub-downloads';
const HUB_URL = 'http://localhost:35730';


console.log(`[WEBDL] background loaded ${BACKGROUND_BUILD} socket=${SOCKET_ENABLED ? 'on' : 'off-http-only'}`);

// Status variabelen
let isConnected = false;
let isRecording = false;
let activeDownloads = 0;
let socket = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let lastHeartbeatAt = 0;
const activeTabs = new Set();
let probeInFlight = null;
let consecutiveProbeFailures = 0;

function getServerCandidates() {
  const seen = new Set();
  const out = [];
  for (const base of [SERVER_URL, SERVER_URL_FALLBACK]) {
    const b = String(base || '').trim();
    if (!b || seen.has(b)) continue;
    seen.add(b);
    out.push(b.replace(/\/+$/, ''));
  }
  return out;
}

async function postJson(endpoint, body) {
  const candidates = getServerCandidates();
  let lastError = null;
  for (const base of candidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
      const response = await fetch(`${base}/${endpoint}`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: controller.signal
      });
      clearTimeout(timeout);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = data.error || `Server fout: ${response.status}`;
        continue;
      }
      return data;
    } catch (e) {
      lastError = e && e.message ? e.message : String(e);
    }
  }
  return { success: false, error: lastError || 'Server niet bereikbaar' };
}

async function postHubJob(url, metadata = {}) {
  if (!url || typeof url !== 'string') {
    return { success: false, error: 'Geen URL om naar WebDL-Hub te sturen' };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    const response = await fetch(`${HUB_URL}/api/jobs`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        priority: 10,
        options: {
          ...(metadata || {}),
          queued_from: 'firefox-extension',
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { success: false, error: data.error || `Hub fout: HTTP ${response.status}` };
    }
    return {
      success: true,
      downloadId: data.id || null,
      expanded: !!data.expanded,
      queued: Number.isFinite(Number(data.queued)) ? Number(data.queued) : undefined,
      duplicate: !!data.duplicate,
      delegated: !!data.delegated,
      message: data.expanded ? 'Expanded in WebDL-Hub' : 'Added to WebDL-Hub',
      raw: data,
    };
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}

async function getJson(endpoint) {
  const candidates = getServerCandidates();
  let lastError = null;
  for (const base of candidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
      const response = await fetch(`${base}/${endpoint}`, {
        method: 'GET',
        mode: 'cors',
        signal: controller.signal,
        cache: 'no-store'
      });
      clearTimeout(timeout);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = data.error || `Server fout: ${response.status}`;
        continue;
      }
      return data;
    } catch (e) {
      lastError = e && e.message ? e.message : String(e);
    }
  }
  return { success: false, error: lastError || 'Server niet bereikbaar' };
}

async function probeServerStatus(source = 'probe') {
  if (probeInFlight) return probeInFlight;
  probeInFlight = (async () => {
  const health = await getJson('health');
  if (health && health.success !== false && health.status === 'running') {
    consecutiveProbeFailures = 0;
    setConnectedState(true);
    lastHeartbeatAt = Date.now();
    const status = await getJson('status');
    if (status && status.success !== false && status.status === 'running') {
      if (typeof status.isRecording !== 'undefined') updateRecordingState(status.isRecording, status.activeRecordingUrls);
      if (Number.isFinite(Number(status.activeDownloads))) activeDownloads = Number(status.activeDownloads);
    }
    return { success: true, source, isConnected: true, isRecording, activeRecordingUrls, activeDownloads };
  }
  consecutiveProbeFailures += 1;
  const error = health && health.error ? health.error : 'Health probe mislukt';
  const lastOkAgo = lastHeartbeatAt ? (Date.now() - lastHeartbeatAt) : Number.POSITIVE_INFINITY;
  const shouldDisconnect = consecutiveProbeFailures >= PROBE_FAILURES_BEFORE_DISCONNECT && lastOkAgo > PROBE_DISCONNECT_GRACE_MS;
  if (shouldDisconnect) {
    setConnectedState(false);
  }
  const errText = String(error || '').toLowerCase();
  const isAbort = errText.includes('aborted') || errText.includes('abort');
  const isNetworkTransient = errText.includes('networkerror') || errText.includes('failed to fetch') || errText.includes('load failed');
  const src = String(source || '');
  const mutedAbort = isAbort && (src.startsWith('startup-http') || src.startsWith('getStatus') || src.startsWith('periodic'));
  const mutedNetwork = isNetworkTransient && (src.startsWith('getStatus') || src.startsWith('periodic'));
  if (!mutedAbort && !mutedNetwork) {
    console.warn(`[WEBDL] status probe failed (${source}): ${error}`);
  }
  return { success: false, source, isConnected: isConnected && !shouldDisconnect, isRecording, activeRecordingUrls, activeDownloads, error };
  })();
  try {
    return await probeInFlight;
  } finally {
    probeInFlight = null;
  }
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function probeServerStatusWithRetry(source = 'probe', attempts = 2, delayMs = 250) {
  const maxAttempts = Math.max(1, Number(attempts) || 1);
  let last = null;
  for (let i = 0; i < maxAttempts; i += 1) {
    const suffix = maxAttempts > 1 ? `-try${i + 1}` : '';
    const res = await probeServerStatus(`${source}${suffix}`);
    last = res;
    if (res && res.success) return res;
    const errText = String((res && res.error) || '').toLowerCase();
    const transientAbort = errText.includes('abort') || errText.includes('aborted');
    if (!transientAbort) break;
    if (i < maxAttempts - 1) await waitMs(delayMs);
  }
  return last || { success: false, source, isConnected, isRecording, activeDownloads, error: 'Status probe mislukt' };
}

function registerTab(tabId) {
  activeTabs.add(tabId);
}

function unregisterTab(tabId) {
  activeTabs.delete(tabId);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearHeartbeatTimer() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function setConnectedState(next) {
  if (isConnected === next) return;
  isConnected = next;
  notifyConnectionStateChange(next);
}

let activeRecordingUrls = [];

function updateRecordingState(next, urls) {
  const normalized = !!next;
  activeRecordingUrls = Array.isArray(urls) ? urls : [];
  isRecording = normalized;
  notifyRecordingStateChange(normalized, activeRecordingUrls);
}

async function notifyConnectionStateChange(state) {
  const label = SOCKET_ENABLED ? 'socket' : 'server';
  console.log(state ? `✅ Verbonden met WEBDL ${label}` : `❌ Verbinding met WEBDL ${label} verbroken`);
  for (const tabId of activeTabs) {
    try {
      await browser.tabs.sendMessage(tabId, {
        action: 'connectionStateChanged',
        isConnected: state
      }).catch(() => {
        activeTabs.delete(tabId);
      });
    } catch (error) {
      activeTabs.delete(tabId);
    }
  }
}

async function notifyRecordingStateChange(state, urls) {
  for (const tabId of activeTabs) {
    try {
      await browser.tabs.sendMessage(tabId, {
        action: 'recordingStateChanged',
        isRecording: state,
        activeRecordingUrls: Array.isArray(urls) ? urls : activeRecordingUrls
      }).catch(() => {
        activeTabs.delete(tabId);
      });
    } catch (error) {
      activeTabs.delete(tabId);
    }
  }
}

function ensureContextMenu() {
  try {
    browser.contextMenus.removeAll();
  } catch (e) {}
  try {
    browser.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'WEBDL Download',
      contexts: ['link', 'image', 'video', 'audio']
    });
  } catch (e) {
    console.error('context menu create failed', e);
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const expDelay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt));
  const jitter = Math.floor(Math.random() * 350);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectAttempt += 1;
    connectPersistentSocket();
  }, expDelay + jitter);
}

function startHeartbeat() {
  clearHeartbeatTimer();
  lastHeartbeatAt = Date.now();
  heartbeatTimer = setInterval(async () => {
    if (!socket || !socket.connected) return;
    const status = await sendSocketRequest('status', {}, 5000);
    if (status && status.success) {
      lastHeartbeatAt = Date.now();
      if (typeof status.isRecording !== 'undefined') updateRecordingState(status.isRecording);
      if (Number.isFinite(Number(status.activeDownloads))) activeDownloads = Number(status.activeDownloads);
      return;
    }
    const httpProbe = await probeServerStatus('heartbeat-fallback');
    if (httpProbe && httpProbe.success) return;
    if ((Date.now() - lastHeartbeatAt) > HEARTBEAT_STALE_MS) {
      try { socket.disconnect(); } catch (e) {}
    }
  }, HEARTBEAT_INTERVAL_MS);
}

async function sendSocketRequest(action, payload, timeoutMs = SOCKET_ACK_TIMEOUT_MS) {
  if (!socket || !socket.connected) {
    return { success: false, error: 'Niet verbonden met socket' };
  }

  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ success: false, error: `Timeout bij actie ${action}` });
    }, Math.max(500, timeoutMs));

    try {
      socket.emit('webdl:request', { action, payload: payload || {} }, (reply) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (reply && typeof reply === 'object') {
          resolve(reply);
        } else {
          resolve({ success: false, error: `Leeg antwoord op actie ${action}` });
        }
      });
    } catch (e) {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        resolve({ success: false, error: e.message || `Socket fout bij ${action}` });
      }
    }
  });
}

async function sendCommand(action, payload, fallbackEndpoint = null) {
  if (!SOCKET_ENABLED && fallbackEndpoint) {
    return postJson(fallbackEndpoint, payload);
  }
  const viaSocket = await sendSocketRequest(action, payload);
  if (viaSocket && viaSocket.success) return viaSocket;
  if (fallbackEndpoint) return postJson(fallbackEndpoint, payload);
  return viaSocket;
}

async function resolveTargetTabId(sender) {
  if (sender && sender.tab && Number.isFinite(sender.tab.id)) return sender.tab.id;
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length && Number.isFinite(tabs[0].id)) return tabs[0].id;
  } catch (e) {}
  return null;
}

async function triggerTabScreenshot(sender, videoOnly) {
  const tabId = await resolveTargetTabId(sender);
  if (!Number.isFinite(tabId)) return { success: false, error: 'Geen actieve tab voor screenshot' };
  try {
    const result = await browser.tabs.sendMessage(tabId, {
      action: 'takeScreenshotNow',
      videoOnly: !!videoOnly
    });
    if (result && typeof result === 'object') return result;
    return { success: false, error: 'Screenshot antwoord ongeldig' };
  } catch (e) {
    return { success: false, error: e.message || 'Screenshot in tab mislukt' };
  }
}

function connectPersistentSocket() {
  clearReconnectTimer();

  if (typeof io !== 'function') {
    console.error('Socket.IO client ontbreekt in background context');
    setConnectedState(false);
    scheduleReconnect();
    return;
  }

  if (socket) {
    try {
      socket.removeAllListeners();
      socket.disconnect();
    } catch (e) {}
    socket = null;
  }

  socket = io(SERVER_URL, {
    withCredentials: true,
    autoConnect: false,
    forceNew: false,
    reconnection: false,
    timeout: 15000,
    transports: ['polling'],
    upgrade: false
  });

  socket.on('connect', async () => {
    reconnectAttempt = 0;
    clearReconnectTimer();
    setConnectedState(true);
    startHeartbeat();
    const status = await sendSocketRequest('status', {}, 4000);
    if (status && status.success) {
      if (typeof status.isRecording !== 'undefined') updateRecordingState(status.isRecording);
      if (Number.isFinite(Number(status.activeDownloads))) activeDownloads = Number(status.activeDownloads);
      lastHeartbeatAt = Date.now();
    }
  });

  socket.on('disconnect', () => {
    clearHeartbeatTimer();
    setConnectedState(false);
    scheduleReconnect();
  });

  socket.on('connect_error', async (err) => {
    console.error('Socket connect_error:', err && err.message ? err.message : err);
    clearHeartbeatTimer();
    const httpProbe = await probeServerStatus('socket-connect-error');
    if (!(httpProbe && httpProbe.success)) {
      setConnectedState(false);
    }
    scheduleReconnect();
  });

  socket.on('recording-status-changed', (data) => {
    if (data && typeof data.isRecording !== 'undefined') {
      updateRecordingState(data.isRecording, data.activeRecordingUrls);
    }
  });

  socket.on('connection-state', () => {
    setConnectedState(true);
    lastHeartbeatAt = Date.now();
  });

  try {
    socket.connect();
  } catch (e) {
    console.error('Socket connect() failed:', e.message);
    setConnectedState(false);
    scheduleReconnect();
  }
}

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info || info.menuItemId !== CONTEXT_MENU_ID) return;

  const url = info.linkUrl || info.srcUrl || info.pageUrl;
  if (!url) return;

  let metadata = null;
  try {
    if (tab && tab.id != null) {
      metadata = await browser.tabs.sendMessage(tab.id, { action: 'getPageMetadata' }).catch(() => null);
    }
  } catch (e) {
    metadata = null;
  }

  if (!metadata || typeof metadata !== 'object') {
    metadata = {
      url: tab && tab.url ? tab.url : info.pageUrl,
      title: tab && tab.title ? tab.title : '',
      platform: 'unknown',
      channel: 'unknown'
    };
  }

  metadata.sourceUrl = url;
  
  const resp = await postHubJob(url, metadata);

  try {
    if (tab && tab.id != null) {
      await browser.tabs.sendMessage(tab.id, {
        action: 'webdlDownloadQueued',
        success: !!resp.success,
        downloadId: resp.downloadId,
        duplicate: !!resp.duplicate,
        serverMessage: resp.message,
        error: resp.error,
        url
      }).catch(() => {});
    }
  } catch (e) {}
});

browser.tabs.onRemoved.addListener((tabId) => {
  unregisterTab(tabId);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    unregisterTab(tabId);
  }
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.tab && sender.tab.id) registerTab(sender.tab.id);

  const action = message && message.action ? message.action : '';
  if (action === 'contentScriptLoaded') {
    sendResponse({ success: true, isConnected, isRecording, activeRecordingUrls, activeDownloads });
    return false;
  }

  if (action === 'getStatus') {
    const stale = !lastHeartbeatAt || ((Date.now() - lastHeartbeatAt) > HEARTBEAT_STALE_MS);
    if (!isConnected || stale) {
      probeServerStatusWithRetry('getStatus', 3, 300)
        .then((probe) => {
          if (probe && typeof probe === 'object') {
            sendResponse({
              isConnected: !!probe.isConnected,
              isRecording: !!probe.isRecording,
              activeRecordingUrls: probe.activeRecordingUrls || activeRecordingUrls,
              activeDownloads: Number.isFinite(Number(probe.activeDownloads)) ? Number(probe.activeDownloads) : activeDownloads
            });
            return;
          }
          sendResponse({ isConnected, isRecording, activeRecordingUrls, activeDownloads });
        })
        .catch(() => {
          sendResponse({ isConnected, isRecording, activeRecordingUrls, activeDownloads });
        });
      return true;
    }
    sendResponse({ isConnected, isRecording, activeRecordingUrls, activeDownloads });
    return false;
  }

  if (action === 'queueDownload') {
    const payload = (message && message.payload) || {};
    const url = payload.url;
    const metadata = payload.metadata || payload;
    postHubJob(url, metadata).then(sendResponse);
    return true;
  }

  if (action === 'queueBatchDownload') {
    const payload = (message && message.payload) || {};
    const urls = payload.urls || [];
    const metadata = payload.metadata || {};
    
    Promise.all(urls.map(url => postHubJob(url, metadata))).then((results) => {
      const queued = results.filter(r => r.success && !r.duplicate).reduce((sum, r) => sum + (Number(r.queued) || 1), 0);
      const duplicates = results.filter(r => r.duplicate).length;
      const errors = results.filter(r => !r.success).length;
      sendResponse({ success: true, queued, duplicates, errors });
    }).catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (action === 'redditIndex') {
    postJson('reddit/index', (message && message.payload) || {})
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (action === 'startRecording') {
    sendCommand('start-recording', (message && message.payload) || {}, 'start-recording')
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (action === 'stopRecording') {
    sendCommand('stop-recording', (message && message.payload) || {}, 'stop-recording')
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (action === 'takeScreenshot') {
    triggerTabScreenshot(sender, message && message.videoOnly)
      .then((tabResult) => {
        if (tabResult && tabResult.success) return tabResult;
        return sendCommand('screenshot', { videoOnly: !!(message && message.videoOnly) }, 'screenshot');
      })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  return false;
});

ensureContextMenu();
if (SOCKET_ENABLED) {
  connectPersistentSocket();
} else {
  setConnectedState(false);
  const startupProbeDelays = [250, 1200, 3500];
  startupProbeDelays.forEach((delayMs, idx) => {
    setTimeout(() => {
      probeServerStatus(`startup-http-${idx + 1}`).catch(() => {});
    }, delayMs);
  });
}
setInterval(() => {
  probeServerStatusWithRetry('periodic', 2, 300).catch(() => {});
}, HTTP_STATUS_PROBE_INTERVAL_MS);
