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
const FFF_BACKGROUND_WATCHDOG_INTERVAL_MS = 30000;
const FFF_BACKGROUND_STALE_MS = 180000;
const FFF_BACKGROUND_MAX_RESTARTS = 2;
const PROBE_FAILURES_BEFORE_DISCONNECT = 2; // Reduced so it detects faster
const PROBE_DISCONNECT_GRACE_MS = 12000; // Drop after 12s of no heartbeat
const SOCKET_ENABLED = false;
const BACKGROUND_BUILD = 'simple-background-v24-fff-watchdog-active-worker';
const HUB_URL = 'http://localhost:35730';
const HUB_URL_FALLBACK = 'http://127.0.0.1:35730';


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
const activeFffBackgroundScans = new Map();
const activeXvideosBrowserBatches = new Map();
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

function getHubCandidates() {
  const seen = new Set();
  const out = [];
  for (const base of [HUB_URL, HUB_URL_FALLBACK]) {
    const b = String(base || '').trim();
    if (!b || seen.has(b)) continue;
    seen.add(b);
    out.push(b.replace(/\/+$/, ''));
  }
  return out;
}

async function getHubJson(endpoint) {
  const cleanEndpoint = String(endpoint || '').replace(/^\/+/, '');
  let lastError = null;
  for (const base of getHubCandidates()) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
      const response = await fetch(`${base}/${cleanEndpoint}`, {
        method: 'GET',
        mode: 'cors',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
        cache: 'no-store'
      });
      clearTimeout(timeout);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = data.error || `Hub fout: ${response.status}`;
        continue;
      }
      return data;
    } catch (e) {
      lastError = e && e.message ? e.message : String(e);
    }
  }
  return { success: false, error: lastError || 'Hub niet bereikbaar' };
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
  let lastError = null;
  for (const base of getHubCandidates()) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    const response = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        ...(metadata && metadata.adapter ? { adapter: metadata.adapter } : {}),
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
      lastError = data.error || `Hub fout: HTTP ${response.status}`;
      continue;
    }
    return {
      success: true,
      downloadId: data.simple_server_download_id || data.id || data.groupId || null,
      hubJobId: data.id || null,
      simpleServerDownloadId: data.simple_server_download_id || null,
      hub: true,
      expanded: !!data.expanded,
      total: Number.isFinite(Number(data.total)) ? Number(data.total) : undefined,
      queued: Number.isFinite(Number(data.queued)) ? Number(data.queued) : undefined,
      duplicates: Number.isFinite(Number(data.duplicates)) ? Number(data.duplicates) : undefined,
      errors: Number.isFinite(Number(data.errors)) ? Number(data.errors) : undefined,
      skipped: Number.isFinite(Number(data.skipped)) ? Number(data.skipped) : undefined,
      paused: Number.isFinite(Number(data.paused)) ? Number(data.paused) : undefined,
      duplicate: !!data.duplicate,
      delegated: !!data.delegated,
      message: data.expanded ? 'Expanded in WebDL-Hub' : 'Added to WebDL-Hub',
      raw: data,
    };
  } catch (e) {
    lastError = e && e.message ? e.message : String(e);
  }
  }
  return { success: false, error: lastError || 'Hub niet bereikbaar' };
}

async function postHubBatch(urls, metadata = {}, force = false) {
  const cleanUrls = Array.isArray(urls)
    ? urls.map((url) => String(url || '').trim()).filter(Boolean)
    : [];
  if (!cleanUrls.length) return { success: false, error: 'Geen URLs om naar WebDL-Hub te sturen' };
  let lastError = null;
  for (const base of getHubCandidates()) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(HTTP_TIMEOUT_MS, 60000));
    const response = await fetch(`${base}/api/jobs/batch`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: cleanUrls,
        force: force === true,
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
      lastError = data.error || `Hub batch fout: HTTP ${response.status}`;
      continue;
    }
    return {
      success: true,
      total: Number(data.total) || cleanUrls.length,
      queued: Number(data.queued) || 0,
      duplicates: Number(data.duplicates) || 0,
      errors: Number(data.errors) || 0,
      jobs: Array.isArray(data.jobs) ? data.jobs : [],
      downloads: (Array.isArray(data.jobs) ? data.jobs : []).map((job) => ({
        downloadId: job && (job.simple_server_download_id || job.id) || null,
        hubJobId: job && job.id || null,
        url: job && job.url || '',
        duplicate: !!(job && job.duplicate),
        status: job && job.status || null,
        title: job && job.title || job && job.video_title || '',
      })),
      failed: Array.isArray(data.failed) ? data.failed : [],
      raw: data,
    };
  } catch (e) {
    lastError = e && e.message ? e.message : String(e);
  }
  }
  return { success: false, error: lastError || 'Hub niet bereikbaar' };
}

function waitForTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { clearTimeout(timer); } catch (e) {}
      try { browser.tabs.onUpdated.removeListener(listener); } catch (e) {}
      resolve(!!ok);
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo && changeInfo.status === 'complete') finish(true);
    };
    const timer = setTimeout(() => finish(false), Math.max(3000, Number(timeoutMs) || 45000));
    try { browser.tabs.onUpdated.addListener(listener); } catch (e) { finish(false); }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function traceFffBackgroundStart(scanId, phase, data = {}) {
  try {
    fetch(`${SERVER_URL_FALLBACK}/debug/fff-background-scan`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scanId: scanId || '',
        phase,
        url: data.url || '',
        stats: data.stats || null,
        extra: {
          ...(data.extra && typeof data.extra === 'object' ? data.extra : {}),
          backgroundBuild: BACKGROUND_BUILD,
        },
        error: data.error || '',
        build: BACKGROUND_BUILD,
      }),
    }).catch(() => {});
  } catch (e) {}
}

async function sendTabMessageWithRetry(tabId, message, attempts = 30, delayMs = 500) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await browser.tabs.sendMessage(tabId, message);
      if (response && response.success === false) {
        throw new Error(response.error || 'Worker-tab weigerde de achtergrondscan');
      }
      return response || { success: true };
    } catch (e) {
      lastError = e;
      await sleep(delayMs);
    }
  }
  throw new Error(lastError && lastError.message ? lastError.message : 'Content-script niet bereikbaar in worker-tab');
}

async function startFffBackgroundScan(payload = {}) {
  const url = String(payload.url || '').trim();
  if (!url) return { success: false, error: 'Geen FootFetishForum URL voor achtergrondscan' };
  const scanId = `fff-bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const activeWorker = payload.activeWorker !== false;
  const restartCount = Math.max(0, parseInt(String(payload.__restartCount || '0'), 10) || 0);
  let tab = null;
  try {
    traceFffBackgroundStart(scanId, 'background-start', {
      url,
      extra: {
        payloadKeys: Object.keys(payload && typeof payload === 'object' ? payload : {}),
        initialUrls: Array.isArray(payload.initialUrls) ? payload.initialUrls.length : 0,
        initialThreadLinks: Array.isArray(payload.initialThreadLinks) ? payload.initialThreadLinks.length : 0,
        activeWorker,
      },
    });
    tab = await browser.tabs.create({ url, active: activeWorker });
    activeFffBackgroundScans.set(scanId, {
      scanId,
      tabId: tab && tab.id,
      url,
      payload: { ...(payload && typeof payload === 'object' ? payload : {}), url },
      restartCount,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      status: 'loading',
    });
    traceFffBackgroundStart(scanId, 'background-tab-created', { url, extra: { tabId: tab && tab.id, activeWorker } });
    await waitForTabComplete(tab.id, 45000);
    activeFffBackgroundScans.set(scanId, {
      ...(activeFffBackgroundScans.get(scanId) || { scanId, tabId: tab.id, url }),
      status: 'dispatching',
      updatedAt: Date.now(),
    });
    traceFffBackgroundStart(scanId, 'background-dispatch', { url, extra: { tabId: tab.id } });
    const ack = await sendTabMessageWithRetry(tab.id, {
      action: 'runFffBackgroundScan',
      payload: {
        ...(payload && typeof payload === 'object' ? payload : {}),
        scanId,
        workerTabId: tab.id,
      }
    }, 40, 500);
    activeFffBackgroundScans.set(scanId, {
      ...(activeFffBackgroundScans.get(scanId) || { scanId, tabId: tab.id, url }),
      status: 'running',
      acceptedAt: Date.now(),
      updatedAt: Date.now(),
    });
    traceFffBackgroundStart(scanId, 'background-accepted', { url, extra: { tabId: tab.id, ack } });
    return { success: true, accepted: true, scanId, tabId: tab.id, worker: ack };
  } catch (e) {
    if (tab && tab.id) {
      try { await browser.tabs.remove(tab.id); } catch (_) {}
    }
    activeFffBackgroundScans.set(scanId, {
      scanId,
      tabId: tab && tab.id,
      url,
      status: 'error',
      error: e && e.message ? e.message : String(e),
      finishedAt: Date.now(),
      updatedAt: Date.now(),
    });
    traceFffBackgroundStart(scanId, 'background-error', { url, error: e && e.message ? e.message : String(e), extra: { tabId: tab && tab.id } });
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}

function startFffBackgroundScanWatchdog() {
  setInterval(() => {
    const now = Date.now();
    for (const [scanId, row] of activeFffBackgroundScans.entries()) {
      if (!row || !['loading', 'dispatching', 'running'].includes(String(row.status || ''))) continue;
      const lastSeen = Number(row.updatedAt || row.acceptedAt || row.startedAt || 0);
      if (!lastSeen || (now - lastSeen) < FFF_BACKGROUND_STALE_MS) continue;

      const restartCount = Math.max(0, Number(row.restartCount) || 0);
      if (restartCount >= FFF_BACKGROUND_MAX_RESTARTS) {
        activeFffBackgroundScans.set(scanId, {
          ...row,
          status: 'stale',
          error: `Geen FFF-progress sinds ${Math.round((now - lastSeen) / 1000)}s`,
          updatedAt: now,
        });
        traceFffBackgroundStart(scanId, 'watchdog-stale-final', {
          url: row.lastUrl || row.url || '',
          stats: row.stats || null,
          error: `Geen progress sinds ${Math.round((now - lastSeen) / 1000)}s`,
          extra: { restartCount },
        });
        continue;
      }

      const payload = row.payload && typeof row.payload === 'object' ? { ...row.payload } : {};
      payload.url = payload.url || row.url || row.lastUrl || '';
      payload.activeWorker = true;
      payload.__restartCount = restartCount + 1;
      activeFffBackgroundScans.set(scanId, {
        ...row,
        status: 'stale-restarting',
        error: `Geen FFF-progress sinds ${Math.round((now - lastSeen) / 1000)}s; restart ${payload.__restartCount}/${FFF_BACKGROUND_MAX_RESTARTS}`,
        updatedAt: now,
      });
      traceFffBackgroundStart(scanId, 'watchdog-restart', {
        url: row.lastUrl || row.url || payload.url || '',
        stats: row.stats || null,
        extra: {
          restartCount: payload.__restartCount,
          oldTabId: row.tabId || null,
          restartUrl: payload.url || '',
        },
      });
      if (row.tabId) {
        try { browser.tabs.remove(row.tabId).catch(() => {}); } catch (e) {}
      }
      startFffBackgroundScan(payload).catch((e) => {
        traceFffBackgroundStart(scanId, 'watchdog-restart-error', {
          url: payload.url || '',
          error: e && e.message ? e.message : String(e),
          extra: { restartCount: payload.__restartCount },
        });
      });
    }
  }, FFF_BACKGROUND_WATCHDOG_INTERVAL_MS);
}

startFffBackgroundScanWatchdog();

async function runXvideosBrowserBatch(batchId, payload = {}) {
  const urls = Array.isArray(payload.urls)
    ? payload.urls.map((url) => String(url || '').trim()).filter(Boolean)
    : [];
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  const stats = { total: urls.length, done: 0, imported: 0, duplicates: 0, errors: 0 };
  activeXvideosBrowserBatches.set(batchId, {
    batchId,
    status: 'running',
    startedAt: Date.now(),
    stats,
    currentUrl: '',
  });
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    let tab = null;
    try {
      activeXvideosBrowserBatches.set(batchId, {
        ...(activeXvideosBrowserBatches.get(batchId) || { batchId }),
        status: 'loading',
        currentUrl: url,
        index: i + 1,
        stats,
        updatedAt: Date.now(),
      });
      tab = await browser.tabs.create({ url, active: false });
      await waitForTabComplete(tab.id, 60000);
      activeXvideosBrowserBatches.set(batchId, {
        ...(activeXvideosBrowserBatches.get(batchId) || { batchId }),
        status: 'downloading',
        tabId: tab.id,
        currentUrl: url,
        index: i + 1,
        stats,
        updatedAt: Date.now(),
      });
      const result = await sendTabMessageWithRetry(tab.id, {
        action: 'runXvideosBrowserDownload',
        payload: {
          batchId,
          url,
          index: i + 1,
          total: urls.length,
          metadata: {
            ...metadata,
            webdl_batch_kind: metadata.webdl_batch_kind || 'xvideos_browser_batch',
          },
        },
      }, 60, 1000);
      stats.done++;
      if (result && result.duplicate) stats.duplicates++;
      else stats.imported++;
    } catch (e) {
      stats.done++;
      stats.errors++;
      activeXvideosBrowserBatches.set(batchId, {
        ...(activeXvideosBrowserBatches.get(batchId) || { batchId }),
        status: 'running',
        currentUrl: url,
        lastError: e && e.message ? e.message : String(e),
        stats,
        updatedAt: Date.now(),
      });
    } finally {
      if (tab && tab.id) {
        try { await browser.tabs.remove(tab.id); } catch (_) {}
      }
    }
    await sleep(500);
  }
  activeXvideosBrowserBatches.set(batchId, {
    ...(activeXvideosBrowserBatches.get(batchId) || { batchId }),
    status: stats.errors ? 'done-with-errors' : 'done',
    stats,
    finishedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

async function startXvideosBrowserBatch(payload = {}) {
  const urls = Array.isArray(payload.urls)
    ? payload.urls.map((url) => String(url || '').trim()).filter(Boolean)
    : [];
  if (!urls.length) return { success: false, error: 'Geen XVideos URLs voor browser-batch' };
  const batchId = `xv-bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  activeXvideosBrowserBatches.set(batchId, {
    batchId,
    status: 'queued',
    startedAt: Date.now(),
    stats: { total: urls.length, done: 0, imported: 0, duplicates: 0, errors: 0 },
  });
  runXvideosBrowserBatch(batchId, payload).catch((e) => {
    activeXvideosBrowserBatches.set(batchId, {
      ...(activeXvideosBrowserBatches.get(batchId) || { batchId }),
      status: 'error',
      error: e && e.message ? e.message : String(e),
      finishedAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  return { success: true, accepted: true, batchId, total: urls.length };
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
      if (typeof status.isRecording !== 'undefined') updateRecordingState(status.isRecording, status.activeRecordingUrls, status.activeRecordingKeys);
      if (Number.isFinite(Number(status.activeDownloads))) activeDownloads = Number(status.activeDownloads);
    }
    return { success: true, source, isConnected: true, isRecording, activeRecordingUrls, activeRecordingKeys, activeDownloads };
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
  return { success: false, source, isConnected: isConnected && !shouldDisconnect, isRecording, activeRecordingUrls, activeRecordingKeys, activeDownloads, error };
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
let activeRecordingKeys = [];

function updateRecordingState(next, urls, keys) {
  const normalized = !!next;
  activeRecordingUrls = Array.isArray(urls) ? urls : [];
  activeRecordingKeys = Array.isArray(keys) ? keys : [];
  isRecording = normalized;
  notifyRecordingStateChange(normalized, activeRecordingUrls, activeRecordingKeys);
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

async function notifyRecordingStateChange(state, urls, keys) {
  for (const tabId of activeTabs) {
    try {
      await browser.tabs.sendMessage(tabId, {
        action: 'recordingStateChanged',
        isRecording: state,
        activeRecordingUrls: Array.isArray(urls) ? urls : activeRecordingUrls,
        activeRecordingKeys: Array.isArray(keys) ? keys : activeRecordingKeys
      }).catch(() => {
        activeTabs.delete(tabId);
      });
    } catch (error) {
      activeTabs.delete(tabId);
    }
  }
}

async function ensureContextMenu() {
  const menusApi = browser.contextMenus || browser.menus;
  if (!menusApi || !menusApi.create) {
    console.error('context menu API ontbreekt');
    return;
  }
  try {
    if (menusApi.removeAll) await menusApi.removeAll();
  } catch (e) {
    console.warn('context menu removeAll failed', e && e.message ? e.message : e);
  }
  try {
    menusApi.create({
      id: CONTEXT_MENU_ID,
      title: 'Download with WEBDL',
      contexts: ['page', 'selection', 'link', 'image', 'video', 'audio']
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
      if (typeof status.isRecording !== 'undefined') updateRecordingState(status.isRecording, status.activeRecordingUrls, status.activeRecordingKeys);
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
      if (typeof status.isRecording !== 'undefined') updateRecordingState(status.isRecording, status.activeRecordingUrls, status.activeRecordingKeys);
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
      updateRecordingState(data.isRecording, data.activeRecordingUrls, data.activeRecordingKeys);
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
    sendResponse({ success: true, isConnected, isRecording, activeRecordingUrls, activeRecordingKeys, activeDownloads });
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
              activeRecordingKeys: probe.activeRecordingKeys || activeRecordingKeys,
              activeDownloads: Number.isFinite(Number(probe.activeDownloads)) ? Number(probe.activeDownloads) : activeDownloads
            });
            return;
          }
          sendResponse({ isConnected, isRecording, activeRecordingUrls, activeRecordingKeys, activeDownloads });
        })
        .catch(() => {
          sendResponse({ isConnected, isRecording, activeRecordingUrls, activeRecordingKeys, activeDownloads });
        });
      return true;
    }
    sendResponse({ isConnected, isRecording, activeRecordingUrls, activeRecordingKeys, activeDownloads });
    return false;
  }

  if (action === 'getHubStatus') {
    getHubJson('api/adapters')
      .then((health) => {
        if (health && Array.isArray(health.adapters)) {
          sendResponse({ success: true, ok: true, db: null, lightweight: true });
          return;
        }
        sendResponse({
          success: false,
          ok: false,
          error: health && health.error ? health.error : 'Hub adapters endpoint niet bereikbaar'
        });
      })
      .catch((error) => sendResponse({ success: false, ok: false, error: error && error.message ? error.message : String(error) }));
    return true;
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
    postJson('download/batch', payload)
      .then(sendResponse)
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (action === 'startFffBackgroundScan') {
    startFffBackgroundScan((message && message.payload) || {})
      .then(sendResponse)
      .catch(e => sendResponse({ success: false, error: e && e.message ? e.message : String(e) }));
    return true;
  }

  if (action === 'startXvideosBrowserBatch') {
    startXvideosBrowserBatch((message && message.payload) || {})
      .then(sendResponse)
      .catch(e => sendResponse({ success: false, error: e && e.message ? e.message : String(e) }));
    return true;
  }

  if (action === 'xvideosBrowserBatchStatus') {
    sendResponse({ success: true, batches: Array.from(activeXvideosBrowserBatches.values()) });
    return false;
  }

  if (action === 'fffBackgroundScanStatus') {
    sendResponse({ success: true, scans: Array.from(activeFffBackgroundScans.values()) });
    return false;
  }

  if (action === 'fffBackgroundScanProgress') {
    const payload = (message && message.payload) || {};
    const scanId = String(payload.scanId || '').trim();
    const tabId = sender && sender.tab && sender.tab.id ? sender.tab.id : Number(payload.tabId) || null;
    if (scanId) {
      activeFffBackgroundScans.set(scanId, {
        ...(activeFffBackgroundScans.get(scanId) || { scanId, tabId }),
        status: 'running',
        phase: payload.phase || '',
        stats: payload.stats || null,
        lastUrl: payload.url || '',
        updatedAt: Date.now(),
      });
    }
    sendResponse({ success: true });
    return false;
  }

  if (action === 'fffBackgroundScanFinished') {
    const payload = (message && message.payload) || {};
    const scanId = String(payload.scanId || '').trim();
    const tabId = sender && sender.tab && sender.tab.id ? sender.tab.id : Number(payload.tabId) || null;
    if (scanId) {
      activeFffBackgroundScans.set(scanId, {
        ...(activeFffBackgroundScans.get(scanId) || { scanId, tabId }),
        status: payload.success === false ? 'error' : 'done',
        stats: payload.stats || null,
        error: payload.error || '',
        finishedAt: Date.now(),
      });
    }
    sendResponse({ success: true });
    if (tabId && payload.closeTab !== false) {
      setTimeout(() => {
        browser.tabs.remove(tabId).catch(() => {});
      }, 1200);
    }
    return false;
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

ensureContextMenu().catch((e) => console.error('context menu init failed', e));
if (browser.runtime && browser.runtime.onInstalled) {
  browser.runtime.onInstalled.addListener(() => {
    ensureContextMenu().catch((e) => console.error('context menu install refresh failed', e));
  });
}
if (browser.runtime && browser.runtime.onStartup) {
  browser.runtime.onStartup.addListener(() => {
    ensureContextMenu().catch((e) => console.error('context menu startup refresh failed', e));
  });
}
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
