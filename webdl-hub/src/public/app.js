// src/public/app.js — WebDL-Hub dashboard met gegroepeerde playlist-weergave.
'use strict';

const $ = (id) => document.getElementById(id);
const setText = (id, value) => {
  const el = $(id);
  if (el) el.textContent = value ?? '';
};

const state = {
  source: 'hub',
  jobs: new Map(),
  serverDownloads: new Map(),
  serverPlatforms: [],
  selectedId: null,
  selectedGroupId: null,
  selectedGroupJobs: [],
  filter: '',
  platformFilter: '',
  adapters: [],
  collapsedGroups: new Set(),
  jobStats: { queued: 0, running: 0, paused: 0, done: 0, failed: 0, cancelled: 0, total: 0 },
  laneStats: [],
  jobGroups: [],
  queueDiagnostics: null,
  sabnzbd: null,
  // Live progress data van WebSocket (speed/eta)
  liveProgress: new Map(),
};

// ─── API ──────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('nl-NL', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function humanSize(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
}

function humanBytes(n) {
  const value = Number(n);
  if (!Number.isFinite(value) || value <= 0) return '-';
  return humanSize(value);
}

function sumSizes(files) {
  return files.reduce((sum, f) => sum + (Number(f.size || f.filesize) || 0), 0);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function canonicalVipergirlsThreadUrl(rawUrl, wholeThread) {
  if (!wholeThread) return rawUrl;
  try {
    const u = new URL(String(rawUrl || '').trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'viper.to' || host.endsWith('.viper.to')) u.hostname = 'vipergirls.to';
    if (u.hostname.toLowerCase().replace(/^www\./, '') !== 'vipergirls.to') return rawUrl;
    const m = u.pathname.match(/^\/threads\/(\d+)(-[^/?#]+)?(?:\/page\d+)?\/?$/i);
    if (!m) return rawUrl;
    u.pathname = `/threads/${m[1]}${m[2] || ''}`;
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch (_) {
    return rawUrl;
  }
}

function normalizeTranslatedProxyUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || '').trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'translated.turbopages.org') return u.toString();
    const parts = u.pathname.split('/').filter(Boolean);
    const schemeIndex = parts.findIndex((p) => p === 'http' || p === 'https');
    if (schemeIndex < 0 || !parts[schemeIndex + 1]) return u.toString();
    const scheme = parts[schemeIndex];
    const targetHost = parts[schemeIndex + 1];
    const targetPath = '/' + parts.slice(schemeIndex + 2).join('/');
    return `${scheme}://${targetHost}${targetPath}${u.search}${u.hash}`;
  } catch (_) {
    return String(rawUrl || '').trim();
  }
}

function isXenForoThreadUrl(rawUrl) {
  try {
    const u = new URL(normalizeTranslatedProxyUrl(rawUrl));
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return host === 'foot-fetish.club' && /^\/threads\/[^/]+/i.test(u.pathname);
  } catch (_) {
    return false;
  }
}

function statusIcon(status) {
  switch (status) {
    case 'pending':   return '⏳';
    case 'queued':    return '⏳';
    case 'paused':    return '⏸';
    case 'downloading':
    case 'running':   return '⬇️';
    case 'postprocessing': return '⚙';
    case 'completed':
    case 'done':      return '✅';
    case 'error':
    case 'failed':    return '❌';
    case 'cancelled': return '⊘';
    default:          return '•';
  }
}

function displayStatus(status) {
  switch (status) {
    case 'pending': return 'pending';
    case 'queued': return 'wachtrij';
    case 'paused': return 'pauze';
    case 'running':
    case 'downloading': return 'actief';
    case 'postprocessing': return 'verwerkt';
    case 'done':
    case 'completed': return 'klaar';
    case 'failed':
    case 'error': return 'fout';
    case 'cancelled': return 'cancelled';
    default: return status || '—';
  }
}

function effectiveStatus(job) {
  if (job && job.status === 'queued' && job.lane === 'paused') return 'paused';
  return job?.status || '';
}

function workLane(lane) {
  switch (lane) {
    case 'image':
    case 'gallery':
      return { key: 'fast', label: 'Fast', detail: 'afbeeldingen en video zonder nabewerking', lanes: ['image', 'gallery'] };
    case 'video':
      return { key: 'middle', label: 'Middle', detail: 'mixed adapters', lanes: ['video'] };
    case 'process-video':
      return { key: 'heavy', label: 'Heavy', detail: 'video met postprocessing', lanes: ['process-video'] };
    case 'paused':
      return { key: 'paused', label: 'Pauze', detail: 'staat stil', lanes: ['paused'] };
    default:
      return { key: 'other', label: lane || 'Onbekend', detail: 'technisch', lanes: [lane] };
  }
}

function laneLabel(lane) {
  const work = workLane(lane);
  return work.key === 'paused' ? 'Pauze' : work.label;
}

function laneMetaLabel(lane) {
  const work = workLane(lane);
  return work.detail ? `${work.label} (${work.detail})` : work.label;
}

function aggregateWorkLanes(rows = []) {
  const base = [
    { key: 'fast', label: 'Fast', detail: 'afbeeldingen en video zonder nabewerking', queued: 0, running: 0, failed: 0, paused: 0 },
    { key: 'middle', label: 'Middle', detail: 'mixed adapters', queued: 0, running: 0, failed: 0, paused: 0 },
    { key: 'heavy', label: 'Heavy', detail: 'video met postprocessing', queued: 0, running: 0, failed: 0, paused: 0 },
  ];
  const byKey = new Map(base.map((row) => [row.key, row]));
  for (const row of rows || []) {
    const work = workLane(row.lane);
    if (work.key === 'paused') {
      continue;
    }
    const target = byKey.get(work.key);
    if (!target) continue;
    const count = Number(row.count || 0);
    if (row.status === 'queued') target.queued += count;
    else if (row.status === 'running') target.running += count;
    else if (row.status === 'failed') target.failed += count;
  }
  return base;
}

function videoTitle(job) {
  if (job.downloaded_title) return job.downloaded_title;
  // Probeer video-titel uit options
  const opts = job.options || {};
  if (opts.videoTitle) return opts.videoTitle;
  // Fallback: haal iets leesbars uit de URL
  try {
    const u = new URL(job.url);
    if (u.searchParams.get('v')) return `Video van ${u.hostname.replace(/^www\./, '')}`;
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    if (last && !isTechnicalText(last)) return last.replace(/[-_]+/g, ' ');
    return `Video van ${u.hostname.replace(/^www\./, '')}`;
  } catch { return job.url; }
}

function groupMeta(groupId) {
  return (state.jobGroups || []).find((g) => String(g.group_id) === String(groupId)) || null;
}

function isTechnicalText(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^[a-f0-9]{10,}$/i.test(text)) return true;
  if (/^playlist\s+(PL|UU|UC|OLAK5uy|RD)[A-Za-z0-9_-]+$/i.test(text)) return true;
  if (/^(PL|UU|UC|OLAK5uy|RD)[A-Za-z0-9_-]{8,}$/i.test(text)) return true;
  if (/^[A-Za-z0-9_-]{18,}$/.test(text) && !/\s/.test(text)) return true;
  return false;
}

function firstReadable(...values) {
  return values.map((v) => String(v || '').trim()).find((v) => v && !isTechnicalText(v)) || '';
}

function groupDisplayName(group) {
  const total = Number(group.total || group.jobs || 0);
  return firstReadable(group.displayName, group.display_name, group.name, group.latestTitle, group.latest_title) ||
    (total ? `Playlist met ${total} video's` : 'Playlist');
}

function groupContext(group) {
  const parts = [];
  const technicalName = group.technicalName || group.technical_name || group.name;
  if (technicalName && !isTechnicalText(technicalName) && technicalName !== groupDisplayName(group)) parts.push(technicalName);
  const latestTitle = firstReadable(group.latestTitle, group.latest_title);
  if (latestTitle && latestTitle !== groupDisplayName(group)) parts.push(latestTitle);
  return parts.join(' · ');
}

function jobGroupDisplay(job) {
  const opts = job?.options || {};
  const meta = opts.expandGroup ? groupMeta(opts.expandGroup) : null;
  return firstReadable(meta?.display_name, opts.playlistTitle, opts.expandName, job?.downloaded_channel, job?.downloaded_platform);
}

function downloadTitle(download) {
  return download.title || download.filename || download.url || `Download #${download.id}`;
}

function serverStatusToFilter(status) {
  switch (status) {
    case 'active': return ['downloading', 'postprocessing'];
    case 'failed': return ['error', 'failed'];
    case 'done': return ['completed'];
    case 'queued': return ['pending', 'queued'];
    default: return status ? [status] : [];
  }
}

// ─── Queue stats ──────────────────────────────────────────────────────────────
function updateStats() {
  const s = state.jobStats || {};
  setText('statQueued', s.queued || 0);
  setText('statRunning', s.running || 0);
  setText('statPaused', s.paused || 0);
  setText('statDone', s.done || 0);
  setText('statFailed', s.failed || 0);
  renderOverview();
}

function updateServerStats(stats = {}) {
  const legacy = stats.legacy || {};
  setText('srvPending', legacy.pending || 0);
  setText('srvQueued', legacy.queued || 0);
  setText('srvDownloading', (legacy.downloading || 0) + (legacy.postprocessing || 0));
  setText('srvCompleted', legacy.completed || 0);
  setText('srvError', (legacy.error || 0) + (legacy.failed || 0));
}

function renderOverview() {
  const s = state.jobStats || {};
  setText('overviewTotal', `${s.total || 0} jobs totaal`);
  setText('ovRunning', s.running || 0);
  setText('ovQueued', s.queued || 0);
  setText('ovPaused', s.paused || 0);
  setText('ovFailed', s.failed || 0);
  renderWorkLanes();
  renderQueueDiagnosis();
  renderSabnzbdStatus();

  const target = $('overviewGroups');
  if (!target) return;
  target.innerHTML = '';
  const groups = (state.jobGroups || []).filter((g) =>
    Number(g.running || 0) || Number(g.queued || 0) || Number(g.paused || 0) || Number(g.failed || 0)
  ).slice(0, 12);
  for (const g of groups) {
    const total = Number(g.total || g.jobs || 0);
    const done = Number(g.done || 0);
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const name = groupDisplayName(g);
    const context = groupContext(g);
    const div = document.createElement('div');
    div.className = 'overview-group';
    div.innerHTML = `
      <div class="overview-group-title" title="${esc([name, context].filter(Boolean).join(' · '))}">${esc(name)}</div>
      ${context ? `<div class="overview-group-sub">${esc(context)}</div>` : ''}
      <div class="overview-group-stats">
        ${g.running ? `<span>⬇ ${g.running} actief</span>` : ''}
        ${g.queued ? `<span>⏳ ${g.queued} wacht</span>` : ''}
        ${g.paused ? `<span>⏸ ${g.paused} pauze</span>` : ''}
        ${g.failed ? `<span>❌ ${g.failed} fout</span>` : ''}
        ${total ? `<span>${done}/${total}</span>` : ''}
      </div>
      <div class="overview-group-progress"><div class="bar"><div class="bar-fill ${pct === 100 ? 'done' : ''}" style="width:${pct}%"></div></div></div>
    `;
    div.addEventListener('click', () => selectGroup(g.group_id));
    target.appendChild(div);
  }
  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = 'Geen actieve of wachtende groepen';
    target.appendChild(empty);
  }
}

function renderWorkLanes() {
  const target = $('workLanes');
  if (!target) return;
  const lanes = aggregateWorkLanes(state.laneStats);
  target.innerHTML = lanes.map((lane) => `
    <div class="work-lane ${esc(lane.key)}">
      <div class="work-lane-head">
        <strong>${esc(lane.label)}</strong>
        <span>${esc(lane.detail)}</span>
      </div>
      <div class="work-lane-counts">
        ${lane.running ? `<span class="running">${lane.running} actief</span>` : ''}
        ${lane.queued ? `<span>${lane.queued} wacht</span>` : ''}
        ${lane.paused ? `<span class="paused">${lane.paused} pauze</span>` : ''}
        ${lane.failed ? `<span class="failed">${lane.failed} fout</span>` : ''}
        ${(!lane.running && !lane.queued && !lane.paused && !lane.failed) ? '<span>leeg</span>' : ''}
      </div>
    </div>
  `).join('');
}

function shortTitle(row) {
  return firstReadable(row.video_title, row.group_name, row.name) || row.url || `Job #${row.id}`;
}

function renderQueueDiagnosis() {
  const target = $('queueDiagnosis');
  if (!target) return;
  const d = state.queueDiagnostics;
  if (!d) {
    target.innerHTML = '';
    return;
  }

  const pausedGroups = (d.pausedGroups || []).slice(0, 5);
  const running = (d.running || []).slice(0, 4);
  const failures = (d.recentFailures || []).slice(0, 4);
  const pausedLanes = (d.pausedLanes || [])
    .map((lane) => `${lane.count} ${laneLabel(lane.resume_lane)}`)
    .join(' · ');

  const rows = [];
  if (running.length) {
    rows.push(...running.map((job) => `
      <button type="button" class="diagnosis-row diagnosis-job" data-job-id="${esc(job.id)}">
        <span>${esc(shortTitle(job))}</span>
        <strong>${Math.round(Number(job.progress_pct || 0))}%</strong>
      </button>
    `));
  } else if (pausedGroups.length) {
    rows.push(...pausedGroups.map((group) => `
      <button type="button" class="diagnosis-row diagnosis-group" data-group-id="${esc(group.group_id)}">
        <span>${esc(group.name || 'Losse downloads')}</span>
        <strong>${esc(group.paused)} pauze</strong>
      </button>
    `));
  } else if (failures.length) {
    rows.push(...failures.map((job) => `
      <button type="button" class="diagnosis-row diagnosis-job" data-job-id="${esc(job.id)}">
        <span>${esc(shortTitle(job))}</span>
        <strong>fout</strong>
      </button>
    `));
  }

  target.className = `queue-diagnosis ${esc(d.state || 'idle')}`;
  target.innerHTML = `
    <div class="diagnosis-main">
      <div>
        <div class="diagnosis-label">Hubstatus</div>
        <h3>${esc(d.reason || 'Status onbekend')}</h3>
        <p>${esc(d.action || '')}</p>
        ${pausedLanes ? `<p class="diagnosis-muted">Gepauzeerd: ${esc(pausedLanes)}</p>` : ''}
      </div>
      <div class="diagnosis-actions">
        ${(d.stats && Number(d.stats.paused || 0) > 0) ? '<button id="diagResumeAll" type="button" class="btn-download">▶ Hervat alles</button>' : ''}
        ${(d.stats && Number(d.stats.failed || 0) > 0) ? '<button id="diagRetryFailed" type="button" class="btn-expand">↻ Retry failed</button>' : ''}
      </div>
    </div>
    ${rows.length ? `<div class="diagnosis-list">${rows.join('')}</div>` : ''}
  `;

  const resumeAll = $('diagResumeAll');
  if (resumeAll) {
    resumeAll.addEventListener('click', async () => {
      try {
        const result = await api('POST', '/api/jobs/bulk', { action: 'resume-paused' });
        setMsg(`Hervat: ${result.affected} jobs bijgewerkt`, false, true);
        await refreshCurrentSource();
      } catch (e) { setMsg(e.message, true); }
    });
  }
  const retryFailed = $('diagRetryFailed');
  if (retryFailed) {
    retryFailed.addEventListener('click', async () => {
      try {
        const result = await api('POST', '/api/jobs/bulk', { action: 'retry-failed' });
        setMsg(`Retry failed: ${result.affected} jobs bijgewerkt`, false, true);
        await refreshCurrentSource();
      } catch (e) { setMsg(e.message, true); }
    });
  }
  target.querySelectorAll('.diagnosis-job').forEach((btn) => {
    btn.addEventListener('click', () => selectJob(btn.dataset.jobId));
  });
  target.querySelectorAll('.diagnosis-group').forEach((btn) => {
    btn.addEventListener('click', () => selectGroup(btn.dataset.groupId).catch((e) => setMsg(e.message, true)));
  });
}

function renderSabnzbdStatus() {
  const sab = state.sabnzbd;
  if (!sab) return;
  if (!sab.ok) {
    setText('sabState', sab.error || 'niet bereikbaar');
    setText('sabQueue', '-');
    setText('sabSpeed', '-');
    setText('sabLeft', '-');
    setText('sabFree', '-');
    const slots = $('sabSlots');
    if (slots) slots.innerHTML = '';
    return;
  }
  const queue = sab.queue || {};
  setText('sabState', queue.paused ? 'gepauzeerd' : (queue.status || 'actief'));
  setText('sabQueue', queue.noOfSlots || 0);
  setText('sabSpeed', queue.speed || '-');
  setText('sabLeft', queue.sizeLeft || queue.timeLeft || '-');
  setText('sabFree', humanBytes(sab.disks?.completed?.free));
  const slots = $('sabSlots');
  if (!slots) return;
  slots.innerHTML = '';
  for (const item of (queue.slots || []).slice(0, 6)) {
    const row = document.createElement('div');
    row.className = 'overview-sab-slot';
    row.innerHTML = `
      <strong title="${esc(item.name)}">${esc(item.name)}</strong>
      <span>${Math.round(Number(item.percentage || 0))}%</span>
      <span>${esc(item.timeLeft || item.sizeLeft || '')}</span>
    `;
    slots.appendChild(row);
  }
}

function setFilterOptions() {
  const filter = $('filter');
  const current = filter.value;
  if (state.source === 'server') {
    filter.innerHTML = `
      <option value="">alle</option>
      <option value="queued">wachtrij</option>
      <option value="active">actief</option>
      <option value="completed">klaar</option>
      <option value="error">fout</option>
      <option value="cancelled">cancelled</option>
    `;
  } else {
    filter.innerHTML = `
      <option value="">alle</option>
      <option value="queued">wachtrij</option>
      <option value="running">actief</option>
      <option value="paused">pauze</option>
      <option value="done">klaar</option>
      <option value="failed">mislukt</option>
    `;
  }
  filter.value = [...filter.options].some((o) => o.value === current) ? current : '';
  state.filter = filter.value;
}

function updateSourceControls() {
  $('source').value = state.source;
  $('platformFilter').hidden = state.source !== 'server';
  $('btnBulkClear').hidden = state.source === 'server';
  $('btnBulkPause').hidden = state.source === 'server';
  $('btnBulkResume').hidden = state.source === 'server';
  $('btnBulkCancel').textContent = state.source === 'server' ? '✕ pending' : '✕ wacht';
  $('btnBulkRetry').textContent = state.source === 'server' ? '↻ error' : '↻ failed';
  setFilterOptions();
}

// ─── Groepering ───────────────────────────────────────────────────────────────
// Jobs worden gegroepeerd op expandGroup (uit options).
// Jobs zonder expandGroup staan als "losse downloads" bovenaan.
function buildGroups() {
  const groups = new Map(); // groupId → { name, url, jobs[] }
  const standalone = [];

  const allJobs = [...state.jobs.values()]
    .filter((j) => !state.filter || effectiveStatus(j) === state.filter)
    .sort((a, b) => {
      // Sorteer op expandIndex als die er is, anders op id
      const aIdx = a.options?.expandIndex || Infinity;
      const bIdx = b.options?.expandIndex || Infinity;
      if (aIdx !== bIdx) return aIdx - bIdx;
      return Number(a.id) - Number(b.id);
    });

  for (const j of allJobs) {
    const gid = j.options?.expandGroup;
    if (gid) {
      if (!groups.has(gid)) {
        const meta = groupMeta(gid);
        groups.set(gid, {
          id: gid,
          name: meta?.display_name || j.options.expandName || 'Playlist',
          displayName: meta?.display_name || j.options.expandName || 'Playlist',
          technicalName: j.options.expandName || meta?.name || '',
          latestTitle: meta?.latest_title || '',
          url: meta?.url || j.options.expandUrl || '',
          total: meta?.total || j.options.expandTotal || 0,
          jobs: [],
        });
      }
      groups.get(gid).jobs.push(j);
    } else {
      standalone.push(j);
    }
  }

  return { standalone, groups: [...groups.values()].reverse() };
}

function groupStats(group) {
  let q = 0, r = 0, p = 0, d = 0, f = 0;
  for (const j of group.jobs) {
    const status = effectiveStatus(j);
    if (status === 'queued') q++;
    else if (status === 'running') r++;
    else if (status === 'paused') p++;
    else if (status === 'done') d++;
    else if (status === 'failed') f++;
  }
  return { queued: q, running: r, paused: p, done: d, failed: f, total: group.jobs.length };
}

// ─── Render job list ──────────────────────────────────────────────────────────
function renderList() {
  const container = $('jobList');
  container.innerHTML = '';
  if (state.source === 'server') {
    renderServerList(container);
    return;
  }

  const { standalone, groups } = buildGroups();

  // Losse downloads
  for (const j of standalone.sort((a, b) => b.id - a.id)) {
    container.appendChild(renderJobItem(j, true));
  }

  // Gegroepeerde playlists. Links staat alleen de map/groep; de losse video's
  // verschijnen rechts wanneer je een groep selecteert.
  for (const g of groups) {
    const s = groupStats(g);
    const donePct = g.jobs.length > 0 ? Math.round((s.done / g.jobs.length) * 100) : 0;

    // Groepskop
    const header = document.createElement('div');
    header.className = 'group-header' + (String(state.selectedGroupId) === String(g.id) ? ' selected' : '');
    const groupName = groupDisplayName(g);
    const groupSub = groupContext(g);
    header.innerHTML = `
      <div class="group-top-row">
        <div class="group-name">
          <span class="chevron">›</span>
          <span class="group-label">
            <span class="group-main">📋 ${esc(groupName)}</span>
            ${groupSub ? `<span class="group-sub">${esc(groupSub)}</span>` : ''}
          </span>
        </div>
        <div class="group-actions">
          ${s.queued ? `<button class="btn-sm btn-grp" data-action="pause-queued" data-gid="${esc(g.id)}" title="Pauzeer wachtende">⏸ ${s.queued}</button>` : ''}
          ${s.paused ? `<button class="btn-sm btn-grp" data-action="resume-paused" data-gid="${esc(g.id)}" title="Hervat gepauzeerde">▶ ${s.paused}</button>` : ''}
          ${s.queued ? `<button class="btn-sm btn-grp" data-action="cancel-queued" data-gid="${esc(g.id)}" title="Cancel alle wachtende">✕ ${s.queued}</button>` : ''}
          ${s.failed ? `<button class="btn-sm btn-grp" data-action="retry-failed" data-gid="${esc(g.id)}" title="Retry alle mislukte">↻ ${s.failed}</button>` : ''}
        </div>
      </div>
      <div class="group-stats">
        <span>${s.total} video's</span>
        <span style="color:var(--ok)">✅ ${s.done}</span>
        ${s.running ? `<span style="color:var(--running)">⬇ ${s.running}</span>` : ''}
        ${s.queued ? `<span style="color:var(--queued)">⏳ ${s.queued}</span>` : ''}
        ${s.paused ? `<span style="color:var(--warn)">⏸ ${s.paused}</span>` : ''}
        ${s.failed ? `<span style="color:var(--err)">❌ ${s.failed}</span>` : ''}
      </div>
      <div class="group-bar">
        <div class="bar"><div class="bar-fill ${donePct === 100 ? 'done' : ''}" style="width:${donePct}%"></div></div>
      </div>
    `;
    header.addEventListener('click', (e) => {
      if (e.target.closest('.btn-grp')) return;
      selectGroup(g.id).catch((err) => setMsg(err.message, true));
    });
    // Groep-actie knoppen
    header.querySelectorAll('.btn-grp').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const gid = btn.dataset.gid;
        try {
          const result = await api('POST', '/api/jobs/bulk', { action, groupId: gid });
          setMsg(`${action}: ${result.affected} jobs bijgewerkt`, false, true);
          await loadJobs();
        } catch (err) { setMsg(err.message, true); }
      });
    });
    container.appendChild(header);
  }

  updateStats();
}

function renderServerList(container) {
  const statuses = serverStatusToFilter(state.filter);
  const items = [...state.serverDownloads.values()]
    .filter((d) => statuses.length === 0 || statuses.includes(d.status))
    .filter((d) => !state.platformFilter || d.platform === state.platformFilter)
    .sort((a, b) => Number(b.id) - Number(a.id));

  for (const download of items) {
    container.appendChild(renderServerItem(download));
  }

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = 'Geen server-downloads voor dit filter';
    container.appendChild(empty);
  }
}

function renderJobItem(job, isStandalone) {
  const div = document.createElement('div');
  div.className = 'job-item' + (isStandalone ? ' standalone' : '') +
    (String(job.id) === String(state.selectedId) ? ' selected' : '');
  div.dataset.id = job.id;

  const pct = Math.round(job.progress_pct || 0);
  const status = effectiveStatus(job);
  const title = isStandalone ? videoTitle(job) : (job.options?.videoTitle || videoTitle(job));
  const live = state.liveProgress.get(String(job.id));
  const gallerySynced = job.options?.gallery_synced;
  const groupName = jobGroupDisplay(job);

  // Regel 2: meta-info afhankelijk van status
  let metaHtml = '';
  if (status === 'running') {
    const speed = live?.speed || '';
    const eta = live?.eta || '';
    metaHtml = `<div class="job-meta">${esc([groupName, laneMetaLabel(job.lane), pct + '%'].filter(Boolean).join(' · '))}${speed ? ' · ' + esc(speed) : ''}${eta && eta !== 'Unknown' ? ' · ETA ' + esc(eta) : ''}</div>`;
  } else if (status === 'failed' && job.error) {
    metaHtml = `<div class="job-meta job-error">${esc(job.error).slice(0, 80)}</div>`;
  } else if (status === 'done') {
    metaHtml = `<div class="job-meta">${esc([groupName, gallerySynced ? 'in gallery' : job.adapter].filter(Boolean).join(' · '))}</div>`;
  } else if (status === 'paused') {
    metaHtml = `<div class="job-meta">${esc([groupName, laneMetaLabel(job.options?.pauseLane || job.lane), 'gepauzeerd'].filter(Boolean).join(' · '))}</div>`;
  } else if (status === 'queued') {
    metaHtml = `<div class="job-meta">${esc([groupName, laneMetaLabel(job.lane), 'wachtrij'].filter(Boolean).join(' · '))}</div>`;
  }

  // Progress bar bij running
  const progressBar = status === 'running'
    ? `<div class="job-progress-bar"><div class="job-progress-fill" style="width:${pct}%"></div></div>`
    : '';

  div.innerHTML = `
    <span class="job-icon">${statusIcon(status)}${gallerySynced && status === 'done' ? '<span class="gallery-dot"></span>' : ''}</span>
    <div class="job-body">
      <div class="job-title-row">
        <span class="job-title" title="${esc(job.url)}">${esc(title)}</span>
        <span class="job-badge ${status}">${status === 'running' ? 'actief' : status === 'queued' ? 'wacht' : status === 'paused' ? 'pauze' : status === 'done' ? 'klaar' : status}</span>
      </div>
      ${metaHtml}
      ${progressBar}
    </div>
  `;
  div.onclick = () => selectJob(job.id);
  return div;
}

function renderServerItem(download) {
  const div = document.createElement('div');
  div.className = 'job-item standalone' +
    (String(download.id) === String(state.selectedId) ? ' selected' : '');
  div.dataset.id = download.id;

  const progress = Math.round(Number(download.progress) || 0);
  const title = downloadTitle(download);
  const status = download.status || '';
  let meta = `${download.platform || 'unknown'} · ${download.channel || 'unknown'}`;
  if (['downloading', 'postprocessing'].includes(status)) meta += ` · ${progress}%`;
  if (download.filesize) meta += ` · ${humanSize(Number(download.filesize))}`;

  const progressBar = ['downloading', 'postprocessing'].includes(status)
    ? `<div class="job-progress-bar"><div class="job-progress-fill" style="width:${progress}%"></div></div>`
    : '';

  div.innerHTML = `
    <span class="job-icon">${statusIcon(status)}</span>
    <div class="job-body">
      <div class="job-title-row">
        <span class="job-title" title="${esc(download.url || download.filepath)}">${esc(title)}</span>
        <span class="job-badge ${esc(status)}">${esc(displayStatus(status))}</span>
      </div>
      <div class="job-meta">${esc(meta)}</div>
      ${progressBar}
    </div>
  `;
  div.onclick = () => selectServerDownload(download.id);
  return div;
}

// ─── Detail ───────────────────────────────────────────────────────────────────
function showOverview() {
  state.selectedId = null;
  state.selectedGroupId = null;
  state.selectedGroupJobs = [];
  $('detail').hidden = true;
  const groupDetail = $('groupDetail');
  if (groupDetail) groupDetail.hidden = true;
  $('detailEmpty').hidden = false;
  closeInlineViewer();
  renderList();
}

async function selectGroup(groupId) {
  state.source = 'hub';
  state.selectedId = null;
  state.selectedGroupId = groupId;
  $('detailEmpty').hidden = true;
  $('detail').hidden = true;
  const groupDetail = $('groupDetail');
  if (groupDetail) groupDetail.hidden = false;
  closeInlineViewer();
  renderList();
  state.selectedGroupJobs = [...state.jobs.values()]
    .filter((job) => String(job.options?.expandGroup) === String(groupId))
    .sort((a, b) => Number(a.options?.expandIndex || a.id) - Number(b.options?.expandIndex || b.id));
  renderGroupDetail();
  try {
    const { jobs } = await api('GET', `/api/jobs/group/${encodeURIComponent(groupId)}?limit=1500`);
    state.selectedGroupJobs = jobs || state.selectedGroupJobs;
    renderGroupDetail();
  } catch (_) {
    // De bestaande hub-process serveert de nieuwe frontend direct vanaf disk.
    // Na de eerstvolgende hub-herstart levert de nieuwe endpoint de volledige lijst.
  }
}

function renderGroupDetail() {
  const groupId = state.selectedGroupId;
  if (!groupId) return;
  const jobs = state.selectedGroupJobs || [];
  const meta = groupMeta(groupId) || jobs.reduce((found, job) => {
    if (found) return found;
    if (job.options?.expandGroup === groupId) {
      return {
        group_id: groupId,
        display_name: jobGroupDisplay(job),
        name: job.options?.expandName,
        latest_title: job.options?.videoTitle || job.downloaded_title,
        total: job.options?.expandTotal || jobs.length,
      };
    }
    return null;
  }, null) || { group_id: groupId, total: jobs.length };

  const title = groupDisplayName(meta);
  const context = groupContext(meta);
  const stats = groupStats({ jobs });
  setText('gTitle', title);
  setText('gSub', context || `${jobs.length} video's`);

  const gStats = $('gStats');
  if (gStats) {
    gStats.innerHTML = `
      <span>${stats.total} video's</span>
      <span class="ok">${stats.done} klaar</span>
      ${stats.running ? `<span class="running">${stats.running} actief</span>` : ''}
      ${stats.queued ? `<span>${stats.queued} wachtend</span>` : ''}
      ${stats.paused ? `<span class="warn">${stats.paused} pauze</span>` : ''}
      ${stats.failed ? `<span class="err">${stats.failed} fout</span>` : ''}
    `;
  }

  const target = $('gVideos');
  if (!target) return;
  target.innerHTML = '';
  if (jobs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = 'Geen losse video\'s gevonden voor deze groep';
    target.appendChild(empty);
    return;
  }
  for (const job of jobs) {
    target.appendChild(renderJobItem(job, true));
  }
}

async function selectJob(id) {
  state.source = 'hub';
  state.selectedId = id;
  state.selectedGroupId = null;
  renderList();
  $('detailEmpty').hidden = true;
  const groupDetail = $('groupDetail');
  if (groupDetail) groupDetail.hidden = true;
  $('detail').hidden = false;
  try {
    const { job, files, logs } = await api('GET', '/api/jobs/' + id);
    renderDetail(job, files, logs);
  } catch (e) { setMsg(e.message, true); }
}

async function selectServerDownload(id) {
  state.source = 'server';
  state.selectedId = id;
  state.selectedGroupId = null;
  renderList();
  $('detailEmpty').hidden = true;
  const groupDetail = $('groupDetail');
  if (groupDetail) groupDetail.hidden = true;
  $('detail').hidden = false;
  try {
    const { download } = await api('GET', '/api/downloads/' + id);
    renderServerDetail(download);
  } catch (e) { setMsg(e.message, true); }
}

function renderDetail(job, files, logs) {
  const title = job.options?.videoTitle || videoTitle(job);
  const status = effectiveStatus(job);
  closeInlineViewer();
  setText('dTitle', title);
  setText('dUrl', job.url);
  $('dUrl').href = job.url || '#';
  setText('dAdapter', job.adapter);
  setText('dPlatformBadge', laneLabel(job.options?.pauseLane || job.lane));
  const groupName = jobGroupDisplay(job);
  setText('dChannelBadge', groupName || '');
  setText('dChannel', groupName || job.options?.expandName || '—');
  const totalSize = sumSizes(files);
  setText('dFilesize', totalSize ? humanSize(totalSize) : '—');
  $('dStatus').innerHTML = `<span class="badge ${status}">${displayStatus(status)}</span>`;
  const pct = Math.round(job.progress_pct || 0);
  $('dBar').style.width = pct + '%';
  $('dBar').className = 'bar-fill' + (status === 'done' ? ' done' : '');
  setText('dPct', pct + '%');
  setText('dAttempts', `${job.attempts} / ${job.max_attempts}`);
  setText('dStarted', fmtTime(job.started_at));
  setText('dFinished', fmtTime(job.finished_at));
  setText('dCreated', fmtTime(job.created_at));
  setText('dPriority', job.priority || 'normaal');
  setText('dWorker', job.locked_by || job.worker || '—');

  const hasError = job.error && job.error.length > 0;
  $('dErrorRow').hidden = !hasError;
  $('dError').textContent = job.error || '';

  $('btnPause').disabled = status !== 'queued';
  $('btnResume').disabled = status !== 'paused';
  $('btnBoost').disabled = !['queued', 'paused'].includes(status);
  $('btnRetry').disabled = !['failed', 'cancelled'].includes(status);
  $('btnCancel').disabled = !['queued', 'running', 'paused'].includes(status);

  // Media tab - show images/videos with thumbnails
  const mediaFiles = files.filter(f => isMediaFile(f.path));
  const mediaGrid = $('mediaGrid');
  mediaGrid.innerHTML = '';
  if (mediaFiles.length > 0) {
    for (const f of mediaFiles) {
      const div = document.createElement('div');
      div.className = 'media-item';
      const thumbUrl = `/api/files/${f.id}/serve`;
      const isVideo = isVideoFile(f.path);
      div.innerHTML = `
        <a href="${thumbUrl}" target="_blank" class="media-link">
          ${isVideo ? '<div class="media-badge video">▶</div>' : ''}
          <img src="${thumbUrl}" alt="${esc(f.path)}" loading="lazy" class="media-thumb">
        </a>
        <div class="media-meta">
          <div class="media-name" title="${esc(f.path)}">${esc(f.path.split('/').pop())}</div>
          <div class="media-size">${f.size ? humanSize(Number(f.size)) : ''}</div>
        </div>
      `;
      mediaGrid.appendChild(div);
    }
    $('noMedia').hidden = true;
  } else {
    $('noMedia').hidden = false;
  }

  // Hero thumbnail
  const heroThumb = $('heroThumb');
  if (mediaFiles.length > 0) {
    heroThumb.src = `/api/files/${mediaFiles[0].id}/serve`;
    $('mediaHero').hidden = false;
  } else {
    $('mediaHero').hidden = true;
  }

  // Hero status badge
  const heroStatus = $('heroStatus');
  heroStatus.textContent = displayStatus(status).toUpperCase();
  heroStatus.className = `hero-badge ${status}`;

  // Hero progress
  const heroPct = $('heroPct');
  const heroBar = $('heroBar');
  heroPct.textContent = pct + '%';
  heroBar.style.width = pct + '%';

  // Files tab - distinguish media vs non-media
  const filesList = $('filesList');
  filesList.innerHTML = '';
  const nonMediaFiles = files.filter(f => !isMediaFile(f.path));
  if (nonMediaFiles.length > 0) {
    for (const f of nonMediaFiles) {
      const div = document.createElement('div');
      div.className = 'file-row';
      const basename = f.path.split('/').pop();
      const ext = f.path.split('.').pop().toLowerCase();
      div.innerHTML = `
        <span class="file-name" title="${esc(f.path)}">${esc(basename)}</span>
        <span class="file-type">${ext.toUpperCase()}</span>
        <span class="file-size">${f.size ? humanSize(Number(f.size)) : ''}</span>
      `;
      filesList.appendChild(div);
    }
    $('noFiles').hidden = true;
  } else {
    $('noFiles').hidden = false;
  }

  // Logs
  const logsList = $('logsList');
  logsList.innerHTML = '';
  for (const l of logs) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = `<span class="log-ts">${fmtTime(l.ts)}</span><span class="log-lvl ${l.level}">${l.level}</span><span class="log-msg">${esc(l.msg)}</span>`;
    logsList.appendChild(div);
  }
  if (!logs.length) $('noLogs').hidden = false;
  else $('noLogs').hidden = true;
}

function renderServerDetail(download) {
  closeInlineViewer();
  const title = downloadTitle(download);
  const status = download.status || '';
  const progress = Math.round(Number(download.progress) || 0);
  const sourceUrl = download.source_url || download.url || '#';
  const mediaUrl = `/api/downloads/${download.id}/serve`;
  const thumbUrl = `/api/downloads/${download.id}/thumb`;
  const fileName = download.filename || (download.filepath ? download.filepath.split('/').pop() : '');
  const mediaFile = download.filepath ? [{ path: download.filepath, size: download.filesize, id: download.id }] : [];

  setText('dTitle', title);
  setText('dUrl', sourceUrl);
  $('dUrl').href = sourceUrl;
  setText('dAdapter', download.platform || 'server');
  setText('dPlatformBadge', download.platform || 'server');
  setText('dChannelBadge', download.channel || '');
  setText('dChannel', download.channel || '—');
  setText('dFilesize', download.filesize ? humanSize(Number(download.filesize)) : '—');
  $('dStatus').innerHTML = `<span class="badge ${esc(status)}">${esc(displayStatus(status))}</span>`;
  $('dBar').style.width = progress + '%';
  $('dBar').className = 'bar-fill' + (status === 'completed' ? ' done' : '');
  setText('dPct', progress + '%');
  setText('dAttempts', '—');
  setText('dStarted', fmtDateTime(download.created_at));
  setText('dFinished', fmtDateTime(download.finished_at));
  setText('dCreated', fmtDateTime(download.created_at));
  setText('dPriority', download.priority || 'normaal');
  setText('dWorker', 'simple-server');

  const hasError = download.error && String(download.error).length > 0;
  $('dErrorRow').hidden = !hasError;
  setText('dError', download.error || '');

  $('btnRetry').disabled = !['error', 'failed', 'cancelled'].includes(status);
  $('btnCancel').disabled = !['pending', 'queued', 'downloading', 'postprocessing'].includes(status);
  $('btnPause').disabled = true;
  $('btnResume').disabled = true;
  $('btnBoost').disabled = true;

  const heroThumb = $('heroThumb');
  if (download.filepath) {
    heroThumb.src = thumbUrl;
    $('mediaHero').hidden = false;
  } else {
    $('mediaHero').hidden = true;
  }
  $('heroStatus').textContent = displayStatus(status).toUpperCase();
  $('heroStatus').className = `hero-badge ${esc(status)}`;
  $('heroPct').textContent = progress + '%';
  $('heroBar').style.width = progress + '%';

  const mediaGrid = $('mediaGrid');
  mediaGrid.innerHTML = '';
  if (download.filepath && isMediaFile(download.filepath)) {
    const div = document.createElement('div');
    div.className = 'media-item';
    const isVideo = isVideoFile(download.filepath);
    div.innerHTML = `
      <button type="button" class="media-link media-button" data-media-url="${esc(mediaUrl)}" data-media-type="${isVideo ? 'video' : 'image'}">
        ${isVideo ? '<div class="media-badge video">▶</div>' : ''}
        <img src="${esc(thumbUrl)}" alt="${esc(download.filepath)}" loading="lazy" class="media-thumb">
      </button>
      <div class="media-meta">
        <div class="media-name" title="${esc(download.filepath)}">${esc(fileName)}</div>
        <div class="media-size">${download.filesize ? humanSize(Number(download.filesize)) : ''}</div>
      </div>
    `;
    div.querySelector('.media-button').addEventListener('click', () => openInlineViewer(mediaUrl, isVideo ? 'video' : 'image'));
    mediaGrid.appendChild(div);
    $('noMedia').hidden = true;
  } else {
    $('noMedia').hidden = false;
  }

  renderFiles(mediaFile, true);
  renderLogs([], true);
}

function renderFiles(files, includeMedia = false) {
  const filesList = $('filesList');
  filesList.innerHTML = '';
  const shown = includeMedia ? files : files.filter(f => !isMediaFile(f.path));
  if (shown.length > 0) {
    for (const f of shown) {
      const div = document.createElement('div');
      div.className = 'file-row';
      const basename = f.path.split('/').pop();
      const ext = f.path.split('.').pop().toLowerCase();
      div.innerHTML = `
        <span class="file-name" title="${esc(f.path)}">${esc(basename)}</span>
        <span class="file-type">${esc(ext.toUpperCase())}</span>
        <span class="file-size">${f.size ? humanSize(Number(f.size)) : ''}</span>
      `;
      filesList.appendChild(div);
    }
    $('noFiles').hidden = true;
  } else {
    $('noFiles').hidden = false;
  }
}

function renderLogs(logs, serverSource = false) {
  const logsList = $('logsList');
  logsList.innerHTML = '';
  for (const l of logs) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = `<span class="log-ts">${fmtTime(l.ts)}</span><span class="log-lvl ${esc(l.level)}">${esc(l.level)}</span><span class="log-msg">${esc(l.msg)}</span>`;
    logsList.appendChild(div);
  }
  if (!logs.length && serverSource) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = '<span class="log-ts">—</span><span class="log-lvl info">info</span><span class="log-msg">Logs staan in simple-server, niet in webdl.jobs.</span>';
    logsList.appendChild(div);
  }
  $('noLogs').hidden = logsList.children.length > 0;
}

function openInlineViewer(url, type) {
  const box = $('mediaViewer');
  const video = $('viewerVideo');
  const img = $('viewerImage');
  video.pause();
  video.hidden = true;
  img.hidden = true;
  if (type === 'video') {
    video.src = url;
    video.hidden = false;
  } else {
    img.src = url;
    img.hidden = false;
  }
  box.hidden = false;
}

function closeInlineViewer() {
  const box = $('mediaViewer');
  const video = $('viewerVideo');
  const img = $('viewerImage');
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.hidden = true;
  }
  if (img) {
    img.removeAttribute('src');
    img.hidden = true;
  }
  if (box) box.hidden = true;
}

function isMediaFile(path) {
  const ext = path.split('.').pop().toLowerCase();
  const mediaExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'mp4', 'mkv', 'webm', 'mov', 'm4v', 'avi', 'flv'];
  return mediaExts.includes(ext);
}

function isVideoFile(path) {
  const ext = path.split('.').pop().toLowerCase();
  const videoExts = ['mp4', 'mkv', 'webm', 'mov', 'm4v', 'avi', 'flv'];
  return videoExts.includes(ext);
}

// ─── Messages ─────────────────────────────────────────────────────────────────
function setMsg(text, isErr = false, isOk = false) {
  const m = $('msg');
  m.textContent = text || '';
  m.className = 'msg' + (isErr ? ' err' : '') + (isOk ? ' ok' : '');
}

function redditLimitOption() {
  const raw = String($('redditLimit')?.value || '').trim();
  const limit = Number(raw);
  if (!raw || !Number.isFinite(limit) || limit <= 0) return {};
  return { limit: Math.max(1, Math.min(5000, Math.floor(limit))) };
}

function redditUrlForMode(mode, rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) throw new Error('Vul een Reddit URL, subreddit of username in');
  if (/^https?:\/\//i.test(raw)) return raw;
  const clean = raw.replace(/^[@/]+/, '').replace(/^r\//i, '').replace(/^u(?:ser)?\//i, '').replace(/\/+$/, '');
  if (!clean) throw new Error('Reddit invoer is leeg');
  if (mode === 'subreddit') return `https://www.reddit.com/r/${encodeURIComponent(clean)}/`;
  if (mode === 'user') return `https://www.reddit.com/user/${encodeURIComponent(clean)}/`;
  return /^[a-z0-9]{5,10}$/i.test(clean)
    ? `https://redd.it/${encodeURIComponent(clean)}`
    : raw;
}

async function enqueueReddit(mode) {
  const btns = ['btnRedditPost', 'btnRedditSubreddit', 'btnRedditUser'].map($).filter(Boolean);
  const raw = $('url').value.trim();
  const force = $('force')?.checked;
  try {
    const url = redditUrlForMode(mode, raw);
    const options = redditLimitOption();
    btns.forEach((btn) => { btn.disabled = true; });
    setMsg('⏳ Reddit download inplannen…');
    const job = await api('POST', '/api/jobs', { url, adapter: 'reddit', options, force });
    state.source = 'hub';
    updateSourceControls();
    if (job && job.id != null && job.id !== '') {
      state.jobs.set(job.id, job);
      renderList();
      selectJob(job.id);
      if (job.duplicate) setMsg(`Reddit duplicaat — bestaande job #${job.id} (${job.status})`);
      else setMsg(`✅ Reddit #${job.id} ingepland met voorrang ${job.priority}`, false, true);
    } else {
      await loadJobs();
      setMsg('Reddit download is verwerkt', false, true);
    }
  } catch (e) {
    setMsg(e.message, true);
  } finally {
    btns.forEach((btn) => { btn.disabled = false; });
  }
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
let ws;
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws');
  ws.onopen = () => setStatus('up');
  ws.onclose = () => { setStatus('down'); setTimeout(connectWs, 2000); };
  ws.onerror = () => setStatus('down');
  ws.onmessage = (ev) => {
    const { type, payload } = JSON.parse(ev.data);
    handleEvent(type, payload);
  };
}

function setStatus(s) {
  const el = $('status');
  el.className = 'status ' + s;
  el.textContent = s === 'up' ? 'live' : (s === 'down' ? 'offline' : '•');
}

function handleEvent(type, payload) {
  if (!payload) return;
  if (type === 'job:progress') {
    const j = state.jobs.get(payload.id);
    if (j) { j.progress_pct = payload.pct; }
    const groupJob = state.selectedGroupJobs.find((item) => String(item.id) === String(payload.id));
    if (groupJob) groupJob.progress_pct = payload.pct;
    // Bewaar speed/eta voor weergave
    state.liveProgress.set(String(payload.id), {
      pct: payload.pct,
      speed: payload.speed || null,
      eta: payload.eta || null,
    });
    if (state.source === 'hub') renderList();
    if (state.source === 'hub' && state.selectedGroupId) renderGroupDetail();
    if (state.source === 'hub' && String(state.selectedId) === String(payload.id)) selectJob(payload.id);
    return;
  }
  if (typeof payload === 'object' && payload.id) {
    state.jobs.set(payload.id, { ...(state.jobs.get(payload.id) || {}), ...payload });
    const groupIndex = state.selectedGroupJobs.findIndex((item) => String(item.id) === String(payload.id));
    if (groupIndex !== -1) state.selectedGroupJobs[groupIndex] = { ...state.selectedGroupJobs[groupIndex], ...payload };
    // Wis live progress als job niet meer running is
    if (payload.status && payload.status !== 'running') {
      state.liveProgress.delete(String(payload.id));
    }
    if (state.source === 'hub') renderList();
    if (state.source === 'hub' && state.selectedGroupId) renderGroupDetail();
    if (state.source === 'hub' && String(state.selectedId) === String(payload.id)) selectJob(payload.id);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function loadAdapters() {
  try {
    const { adapters } = await api('GET', '/api/adapters');
    state.adapters = adapters;
  } catch {}
}

async function loadJobs() {
  const params = new URLSearchParams({ limit: '500' });
  if (state.filter) params.set('status', state.filter);
  const { jobs } = await api('GET', '/api/jobs?' + params.toString());
  state.jobs = new Map(jobs.map((j) => [j.id, j]));
  if (state.source === 'hub') renderList();
}

async function loadJobStats() {
  try {
    const { stats, lanes, groups, diagnostics } = await api('GET', '/api/jobs/meta/stats');
    state.jobStats = stats || state.jobStats;
    state.laneStats = lanes || [];
    state.jobGroups = groups || [];
    state.queueDiagnostics = diagnostics || null;
    updateStats();
    if (state.source === 'hub') renderList();
    if (state.source === 'hub' && state.selectedGroupId) renderGroupDetail();
  } catch {}
}

async function loadServerStats() {
  try {
    const stats = await api('GET', '/api/downloads/meta/stats');
    updateServerStats(stats);
  } catch {}
}

async function loadSabnzbdStatus() {
  try {
    state.sabnzbd = await api('GET', '/api/sabnzbd/status');
    renderSabnzbdStatus();
  } catch (e) {
    state.sabnzbd = { ok: false, error: e.message };
    renderSabnzbdStatus();
  }
}

async function loadServerPlatforms() {
  try {
    const { platforms } = await api('GET', '/api/downloads/meta/platforms');
    state.serverPlatforms = platforms || [];
    const counts = new Map();
    for (const row of state.serverPlatforms) {
      counts.set(row.platform || 'unknown', (counts.get(row.platform || 'unknown') || 0) + Number(row.count || 0));
    }
    const select = $('platformFilter');
    const current = select.value;
    select.innerHTML = '<option value="">alle platforms</option>' +
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([platform, count]) => `<option value="${esc(platform)}">${esc(platform)} (${count})</option>`)
        .join('');
    select.value = [...select.options].some((o) => o.value === current) ? current : '';
    state.platformFilter = select.value;
  } catch {}
}

async function loadServerDownloads() {
  const params = new URLSearchParams({ limit: '500' });
  const statuses = serverStatusToFilter(state.filter);
  if (statuses.length === 1) params.set('status', statuses[0]);
  if (state.platformFilter) params.set('platform', state.platformFilter);
  const { downloads } = await api('GET', '/api/downloads?' + params.toString());
  state.serverDownloads = new Map((downloads || []).map((d) => [d.id, d]));
  if (state.source === 'server') renderList();
}

async function refreshCurrentSource() {
  if (state.source === 'server') {
    await Promise.all([loadJobStats(), loadServerStats(), loadServerPlatforms(), loadServerDownloads()]);
  } else {
    await Promise.all([loadJobs(), loadJobStats(), loadServerStats()]);
  }
}

async function switchSource(source) {
  state.source = source;
  state.selectedId = null;
  state.selectedGroupId = null;
  state.selectedGroupJobs = [];
  $('detail').hidden = true;
  const groupDetail = $('groupDetail');
  if (groupDetail) groupDetail.hidden = true;
  $('detailEmpty').hidden = false;
  closeInlineViewer();
  updateSourceControls();
  await refreshCurrentSource();
  renderList();
}

function bind() {
  // Single download
  $('newJobForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const rawUrl = $('url').value.trim();
    const wholeThread = $('wholeThread')?.checked !== false;
    const url = isXenForoThreadUrl(rawUrl)
      ? normalizeTranslatedProxyUrl(rawUrl)
      : canonicalVipergirlsThreadUrl(rawUrl, wholeThread);
    if (!url) return;
    const force = $('force')?.checked;
    const options = { vipergirlsWholeThread: wholeThread };
    try {
      const payload = isXenForoThreadUrl(url)
        ? { url, adapter: 'xenforo', force, options: { ...options, platform: 'xenforo' } }
        : { url, force, options };
      const job = await api('POST', '/api/jobs', payload);
      state.source = 'hub';
      updateSourceControls();
      if (job && job.expanded) {
        $('url').value = '';
        setMsg(`✅ ${job.total || 0} video's → ${job.queued || 0} ingepland, ${job.duplicates || 0} overgeslagen${job.skipped ? `, ${job.skipped} verwijderd/privé geskipt` : ''}`, false, true);
        await loadJobs();
        renderList();
        const firstId = Array.isArray(job.jobs) && job.jobs[0] && job.jobs[0].id ? job.jobs[0].id : null;
        if (firstId) selectJob(firstId);
        return;
      }
      if (!job || job.id == null || job.id === '') {
        await loadJobs();
        renderList();
        setMsg('Download is verwerkt, maar Hub gaf geen job-ID terug', false, true);
        return;
      }
      state.jobs.set(job.id, job);
      renderList();
      selectJob(job.id);
      if (job.duplicate) {
        setMsg(`Duplicaat — bestaande job #${job.id} (${job.status})`);
      } else {
        $('url').value = '';
        setMsg(`✅ Download #${job.id} gestart`, false, true);
      }
    } catch (e) { setMsg(e.message, true); }
  });

  // Expand playlist
  $('btnExpand').addEventListener('click', async () => {
    const rawUrl = $('url').value.trim();
    const wholeThread = $('wholeThread')?.checked !== false;
    const url = isXenForoThreadUrl(rawUrl)
      ? normalizeTranslatedProxyUrl(rawUrl)
      : canonicalVipergirlsThreadUrl(rawUrl, wholeThread);
    if (!url) { setMsg('Vul een playlist/kanaal URL in', true); return; }
    const force = $('force')?.checked;
    const options = { vipergirlsWholeThread: wholeThread };
    setMsg('⏳ Playlist uitpakken…');
    $('btnExpand').disabled = true;
    try {
      const result = isXenForoThreadUrl(url)
        ? await api('POST', '/api/jobs', { url, adapter: 'xenforo', force, options: { ...options, platform: 'xenforo' } })
        : await api('POST', '/api/jobs/expand', { url, force, options });
      $('url').value = '';
      if (result && result.expanded) {
        setMsg(`✅ ${result.total} video's → ${result.queued} ingepland, ${result.duplicates} overgeslagen${result.skipped ? `, ${result.skipped} verwijderd/privé geskipt` : ''}`, false, true);
      } else {
        setMsg(`✅ Forum-thread ingepland als job #${result.id}`, false, true);
      }
      await loadJobs();
    } catch (e) {
      setMsg(e.message, true);
    } finally {
      $('btnExpand').disabled = false;
    }
  });

  $('btnRedditPost')?.addEventListener('click', () => enqueueReddit('post'));
  $('btnRedditSubreddit')?.addEventListener('click', () => enqueueReddit('subreddit'));
  $('btnRedditUser')?.addEventListener('click', () => enqueueReddit('user'));

  $('source').addEventListener('change', (ev) => switchSource(ev.target.value).catch((e) => setMsg(e.message, true)));
  $('filter').addEventListener('change', async (ev) => {
    state.filter = ev.target.value;
    if (state.source === 'server') await loadServerDownloads().catch((e) => setMsg(e.message, true));
    else await loadJobs().catch((e) => setMsg(e.message, true));
    renderList();
  });
  $('platformFilter').addEventListener('change', async (ev) => {
    state.platformFilter = ev.target.value;
    await loadServerDownloads().catch((e) => setMsg(e.message, true));
    renderList();
  });

  // Bulk-acties
  async function doBulk(action) {
    try {
      const serverAction = action === 'cancel-queued' ? 'cancel-pending'
        : action === 'retry-failed' ? 'retry-failed'
          : action;
      const path = state.source === 'server' ? '/api/downloads/bulk' : '/api/jobs/bulk';
      const body = state.source === 'server'
        ? { action: serverAction, platform: state.platformFilter || undefined }
        : { action };
      const result = await api('POST', path, body);
      setMsg(`${action}: ${result.affected} jobs bijgewerkt`, false, true);
      await refreshCurrentSource();
    } catch (e) { setMsg(e.message, true); }
  }
  $('btnBulkPause').addEventListener('click', () => doBulk('pause-queued'));
  $('btnBulkResume').addEventListener('click', () => doBulk('resume-paused'));
  $('btnBulkCancel').addEventListener('click', () => doBulk('cancel-queued'));
  $('btnBulkRetry').addEventListener('click', () => doBulk('retry-failed'));
  $('btnBulkClear').addEventListener('click', () => doBulk('clear-done'));

  $('btnRetry').addEventListener('click', () => {
    if (!state.selectedId) return;
    const path = state.source === 'server' ? `/api/downloads/${state.selectedId}/retry` : `/api/jobs/${state.selectedId}/retry`;
    api('POST', path).then(() => refreshCurrentSource()).catch((e) => setMsg(e.message, true));
  });
  $('btnPause').addEventListener('click', () => {
    if (!state.selectedId || state.source !== 'hub') return;
    api('POST', `/api/jobs/${state.selectedId}/pause`)
      .then(() => refreshCurrentSource())
      .catch((e) => setMsg(e.message, true));
  });
  $('btnResume').addEventListener('click', () => {
    if (!state.selectedId || state.source !== 'hub') return;
    api('POST', `/api/jobs/${state.selectedId}/resume`)
      .then(() => refreshCurrentSource())
      .catch((e) => setMsg(e.message, true));
  });
  $('btnBoost').addEventListener('click', () => {
    if (!state.selectedId || state.source !== 'hub') return;
    api('POST', `/api/jobs/${state.selectedId}/priority`, { priority: 100 })
      .then(() => refreshCurrentSource())
      .catch((e) => setMsg(e.message, true));
  });
  $('btnCancel').addEventListener('click', () => {
    if (!state.selectedId) return;
    const path = state.source === 'server' ? `/api/downloads/${state.selectedId}/cancel` : `/api/jobs/${state.selectedId}/cancel`;
    api('POST', path).then(() => refreshCurrentSource()).catch((e) => setMsg(e.message, true));
  });
  const groupClose = $('gClose');
  if (groupClose) groupClose.addEventListener('click', showOverview);
  $('btnCloseViewer').addEventListener('click', closeInlineViewer);

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.querySelector(`[data-panel="${tabName}"]`).classList.add('active');
    });
  });

  // Auto-refresh — 2026-05-30 Spoor 0.3: 5s→2s zodat post-actie UI sneller bijwerkt
  // (WebSocket geeft live state, deze poll is fallback voor sync van currentSource)
  setInterval(() => refreshCurrentSource().catch(() => {}), 2000);
}

(async function boot() {
  bind();
  updateSourceControls();
  await loadAdapters();
  await refreshCurrentSource();
  connectWs();
})();
