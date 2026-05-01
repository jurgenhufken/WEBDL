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
  filter: '',
  platformFilter: '',
  adapters: [],
  collapsedGroups: new Set(),
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

function sumSizes(files) {
  return files.reduce((sum, f) => sum + (Number(f.size || f.filesize) || 0), 0);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function statusIcon(status) {
  switch (status) {
    case 'pending':   return '⏳';
    case 'queued':    return '⏳';
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

function videoTitle(job) {
  // Probeer video-titel uit options
  const opts = job.options || {};
  if (opts.videoTitle) return opts.videoTitle;
  // Fallback: haal iets leesbars uit de URL
  try {
    const u = new URL(job.url);
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || u.hostname;
  } catch { return job.url; }
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
  let q = 0, r = 0, d = 0, f = 0;
  for (const j of state.jobs.values()) {
    if (j.status === 'queued') q++;
    else if (j.status === 'running') r++;
    else if (j.status === 'done') d++;
    else if (j.status === 'failed') f++;
  }
  $('statQueued').textContent = q;
  $('statRunning').textContent = r;
  $('statDone').textContent = d;
  $('statFailed').textContent = f;
}

function updateServerStats(stats = {}) {
  const legacy = stats.legacy || {};
  setText('srvPending', legacy.pending || 0);
  setText('srvQueued', legacy.queued || 0);
  setText('srvDownloading', (legacy.downloading || 0) + (legacy.postprocessing || 0));
  setText('srvCompleted', legacy.completed || 0);
  setText('srvError', (legacy.error || 0) + (legacy.failed || 0));
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
    .filter((j) => !state.filter || j.status === state.filter)
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
        groups.set(gid, {
          id: gid,
          name: j.options.expandName || 'Playlist',
          url: j.options.expandUrl || '',
          total: j.options.expandTotal || 0,
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
  let q = 0, r = 0, d = 0, f = 0;
  for (const j of group.jobs) {
    if (j.status === 'queued') q++;
    else if (j.status === 'running') r++;
    else if (j.status === 'done') d++;
    else if (j.status === 'failed') f++;
  }
  return { queued: q, running: r, done: d, failed: f, total: group.jobs.length };
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

  // Gegroepeerde playlists
  for (const g of groups) {
    const s = groupStats(g);
    const collapsed = state.collapsedGroups.has(g.id);
    const donePct = g.jobs.length > 0 ? Math.round((s.done / g.jobs.length) * 100) : 0;

    // Groepskop
    const header = document.createElement('div');
    header.className = 'group-header' + (collapsed ? ' collapsed' : '');
    header.innerHTML = `
      <div class="group-top-row">
        <div class="group-name">
          <span class="chevron">▼</span>
          📋 ${esc(g.name)}
        </div>
        <div class="group-actions">
          ${s.queued ? `<button class="btn-sm btn-grp" data-action="cancel-queued" data-gid="${esc(g.id)}" title="Cancel alle wachtende">✕ ${s.queued}</button>` : ''}
          ${s.failed ? `<button class="btn-sm btn-grp" data-action="retry-failed" data-gid="${esc(g.id)}" title="Retry alle mislukte">↻ ${s.failed}</button>` : ''}
        </div>
      </div>
      <div class="group-stats">
        <span>${s.total} video's</span>
        <span style="color:var(--ok)">✅ ${s.done}</span>
        ${s.running ? `<span style="color:var(--running)">⬇ ${s.running}</span>` : ''}
        ${s.queued ? `<span style="color:var(--queued)">⏳ ${s.queued}</span>` : ''}
        ${s.failed ? `<span style="color:var(--err)">❌ ${s.failed}</span>` : ''}
      </div>
      <div class="group-bar">
        <div class="bar"><div class="bar-fill ${donePct === 100 ? 'done' : ''}" style="width:${donePct}%"></div></div>
      </div>
    `;
    // Collapse toggle (op header, niet op knoppen)
    header.addEventListener('click', (e) => {
      if (e.target.closest('.btn-grp')) return; // niet collapen als knop geklikt
      if (state.collapsedGroups.has(g.id)) state.collapsedGroups.delete(g.id);
      else state.collapsedGroups.add(g.id);
      renderList();
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

    // Individuele video-items (verborgen als collapsed)
    if (!collapsed) {
      for (const j of g.jobs) {
        container.appendChild(renderJobItem(j, false));
      }
    }
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
  const title = isStandalone ? videoTitle(job) : (job.options?.videoTitle || videoTitle(job));
  const live = state.liveProgress.get(String(job.id));
  const gallerySynced = job.options?.gallery_synced;

  // Regel 2: meta-info afhankelijk van status
  let metaHtml = '';
  if (job.status === 'running') {
    const speed = live?.speed || '';
    const eta = live?.eta || '';
    metaHtml = `<div class="job-meta">${job.adapter || ''} · ${job.lane || ''} · ${pct}%${speed ? ' · ' + speed : ''}${eta && eta !== 'Unknown' ? ' · ETA ' + eta : ''}</div>`;
  } else if (job.status === 'failed' && job.error) {
    metaHtml = `<div class="job-meta job-error">${esc(job.error).slice(0, 80)}</div>`;
  } else if (job.status === 'done') {
    metaHtml = `<div class="job-meta">${gallerySynced ? '🖼️ in gallery' : job.adapter || ''}</div>`;
  } else if (job.status === 'queued') {
    metaHtml = `<div class="job-meta">${job.lane || ''} · wachtrij</div>`;
  }

  // Progress bar bij running
  const progressBar = job.status === 'running'
    ? `<div class="job-progress-bar"><div class="job-progress-fill" style="width:${pct}%"></div></div>`
    : '';

  div.innerHTML = `
    <span class="job-icon">${statusIcon(job.status)}${gallerySynced && job.status === 'done' ? '<span class="gallery-dot"></span>' : ''}</span>
    <div class="job-body">
      <div class="job-title-row">
        <span class="job-title" title="${esc(job.url)}">${esc(title)}</span>
        <span class="job-badge ${job.status}">${job.status === 'running' ? 'actief' : job.status === 'queued' ? 'wacht' : job.status === 'done' ? 'klaar' : job.status}</span>
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
async function selectJob(id) {
  state.source = 'hub';
  state.selectedId = id;
  renderList();
  $('detailEmpty').hidden = true;
  $('detail').hidden = false;
  try {
    const { job, files, logs } = await api('GET', '/api/jobs/' + id);
    renderDetail(job, files, logs);
  } catch (e) { setMsg(e.message, true); }
}

async function selectServerDownload(id) {
  state.source = 'server';
  state.selectedId = id;
  renderList();
  $('detailEmpty').hidden = true;
  $('detail').hidden = false;
  try {
    const { download } = await api('GET', '/api/downloads/' + id);
    renderServerDetail(download);
  } catch (e) { setMsg(e.message, true); }
}

function renderDetail(job, files, logs) {
  const title = job.options?.videoTitle || videoTitle(job);
  closeInlineViewer();
  setText('dTitle', title);
  setText('dUrl', job.url);
  $('dUrl').href = job.url || '#';
  setText('dAdapter', job.adapter);
  setText('dPlatformBadge', job.adapter || '');
  setText('dChannelBadge', job.options?.expandName || '');
  setText('dChannel', job.options?.expandName || job.options?.playlistTitle || '—');
  const totalSize = sumSizes(files);
  setText('dFilesize', totalSize ? humanSize(totalSize) : '—');
  $('dStatus').innerHTML = `<span class="badge ${job.status}">${job.status}</span>`;
  const pct = Math.round(job.progress_pct || 0);
  $('dBar').style.width = pct + '%';
  $('dBar').className = 'bar-fill' + (job.status === 'done' ? ' done' : '');
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

  $('btnRetry').disabled = !['failed', 'cancelled'].includes(job.status);
  $('btnCancel').disabled = !['queued', 'running'].includes(job.status);

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
  heroStatus.textContent = job.status.toUpperCase();
  heroStatus.className = `hero-badge ${job.status}`;

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
    // Bewaar speed/eta voor weergave
    state.liveProgress.set(String(payload.id), {
      pct: payload.pct,
      speed: payload.speed || null,
      eta: payload.eta || null,
    });
    if (state.source === 'hub') renderList();
    if (state.source === 'hub' && String(state.selectedId) === String(payload.id)) selectJob(payload.id);
    return;
  }
  if (typeof payload === 'object' && payload.id) {
    state.jobs.set(payload.id, { ...(state.jobs.get(payload.id) || {}), ...payload });
    // Wis live progress als job niet meer running is
    if (payload.status && payload.status !== 'running') {
      state.liveProgress.delete(String(payload.id));
    }
    if (state.source === 'hub') renderList();
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
  const { jobs } = await api('GET', '/api/jobs?limit=500');
  state.jobs = new Map(jobs.map((j) => [j.id, j]));
  if (state.source === 'hub') renderList();
  updateStats();
}

async function loadServerStats() {
  try {
    const stats = await api('GET', '/api/downloads/meta/stats');
    updateServerStats(stats);
  } catch {}
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
    await Promise.all([loadServerStats(), loadServerPlatforms(), loadServerDownloads()]);
  } else {
    await Promise.all([loadJobs(), loadServerStats()]);
  }
}

async function switchSource(source) {
  state.source = source;
  state.selectedId = null;
  $('detail').hidden = true;
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
    const url = $('url').value.trim();
    if (!url) return;
    const force = $('force')?.checked;
    try {
      const job = await api('POST', '/api/jobs', { url, force });
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
    const url = $('url').value.trim();
    if (!url) { setMsg('Vul een playlist/kanaal URL in', true); return; }
    const force = $('force')?.checked;
    setMsg('⏳ Playlist uitpakken…');
    $('btnExpand').disabled = true;
    try {
      const result = await api('POST', '/api/jobs/expand', { url, force });
      $('url').value = '';
      setMsg(`✅ ${result.total} video's → ${result.queued} ingepland, ${result.duplicates} overgeslagen${result.skipped ? `, ${result.skipped} verwijderd/privé geskipt` : ''}`, false, true);
      await loadJobs();
    } catch (e) {
      setMsg(e.message, true);
    } finally {
      $('btnExpand').disabled = false;
    }
  });

  $('source').addEventListener('change', (ev) => switchSource(ev.target.value).catch((e) => setMsg(e.message, true)));
  $('filter').addEventListener('change', async (ev) => {
    state.filter = ev.target.value;
    if (state.source === 'server') await loadServerDownloads().catch((e) => setMsg(e.message, true));
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
  $('btnBulkCancel').addEventListener('click', () => doBulk('cancel-queued'));
  $('btnBulkRetry').addEventListener('click', () => doBulk('retry-failed'));
  $('btnBulkClear').addEventListener('click', () => doBulk('clear-done'));

  $('btnRetry').addEventListener('click', () => {
    if (!state.selectedId) return;
    const path = state.source === 'server' ? `/api/downloads/${state.selectedId}/retry` : `/api/jobs/${state.selectedId}/retry`;
    api('POST', path).then(() => refreshCurrentSource()).catch((e) => setMsg(e.message, true));
  });
  $('btnCancel').addEventListener('click', () => {
    if (!state.selectedId) return;
    const path = state.source === 'server' ? `/api/downloads/${state.selectedId}/cancel` : `/api/jobs/${state.selectedId}/cancel`;
    api('POST', path).then(() => refreshCurrentSource()).catch((e) => setMsg(e.message, true));
  });
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

  // Auto-refresh
  setInterval(() => refreshCurrentSource().catch(() => {}), 5000);
}

(async function boot() {
  bind();
  updateSourceControls();
  await loadAdapters();
  await refreshCurrentSource();
  connectWs();
})();
