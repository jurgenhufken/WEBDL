// src/public/app.js — vanilla dashboard. Geen dependencies, geen bundler.
'use strict';

const $ = (id) => document.getElementById(id);

const state = {
  jobs: new Map(),        // id -> job
  selectedId: null,
  filter: '',
  adapters: [],
};

// --- fetch-helpers ---
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

// --- rendering ---
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString('nl-NL') : d.toLocaleString('nl-NL');
}

function jobTitle(job) {
  try { return new URL(job.url).hostname.replace(/^www\./, '') + ' — ' + (job.url.slice(-40)); }
  catch { return job.url; }
}

function renderList() {
  const ul = $('jobList');
  const items = [...state.jobs.values()]
    .filter((j) => !state.filter || j.status === state.filter)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  ul.innerHTML = '';
  for (const j of items) {
    const li = document.createElement('li');
    li.dataset.id = j.id;
    if (String(j.id) === String(state.selectedId)) li.classList.add('selected');
    li.innerHTML = `
      <div class="title" title="${escapeHtml(j.url)}">${escapeHtml(jobTitle(j))}</div>
      <span class="badge ${j.status}">${j.status}</span>
      <div class="meta">#${j.id} · ${escapeHtml(j.adapter)} · ${fmtTime(j.created_at)}</div>
      <div class="bar"><div class="bar-fill" style="width:${Math.round(j.progress_pct || 0)}%"></div></div>
    `;
    li.onclick = () => selectJob(j.id);
    ul.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

async function selectJob(id) {
  state.selectedId = id;
  renderList();
  $('detailEmpty').hidden = true;
  $('detail').hidden = false;
  try {
    const { job, files, logs } = await api('GET', '/api/jobs/' + id);
    renderDetail(job, files, logs);
  } catch (e) {
    setMsg(e.message, true);
  }
}

function renderDetail(job, files, logs) {
  $('dTitle').textContent = jobTitle(job);
  $('dUrl').textContent = job.url;
  $('dAdapter').textContent = job.adapter;
  $('dStatus').innerHTML = `<span class="badge ${job.status}">${job.status}</span>`;
  $('dBar').style.width = Math.round(job.progress_pct || 0) + '%';
  $('dPct').textContent = ' ' + (Math.round((job.progress_pct || 0) * 10) / 10) + '%';
  $('dAttempts').textContent = `${job.attempts} / ${job.max_attempts}`;
  $('dCreated').textContent = fmtTime(job.created_at);
  $('dError').textContent = job.error || '';
  $('btnRetry').disabled  = !['failed','cancelled'].includes(job.status);
  $('btnCancel').disabled = !['queued','running'].includes(job.status);

  const fUl = $('dFiles'); fUl.innerHTML = '';
  for (const f of files) {
    const li = document.createElement('li');
    li.textContent = `${f.path}${f.size ? ' · ' + humanSize(Number(f.size)) : ''}`;
    fUl.appendChild(li);
  }
  if (files.length === 0) fUl.innerHTML = '<li class="empty" style="padding:4px 8px">geen</li>';

  const lOl = $('dLogs'); lOl.innerHTML = '';
  for (const l of logs) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="ts">${fmtTime(l.ts)}</span><span class="lvl ${l.level}">${l.level}</span><span>${escapeHtml(l.msg)}</span>`;
    lOl.appendChild(li);
  }
}

function humanSize(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  const u = ['B','KB','MB','GB','TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
}

function setMsg(text, isErr = false) {
  const m = $('msg');
  m.textContent = text || '';
  m.classList.toggle('err', !!isErr);
}

// --- WebSocket ---
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
    if (j) { j.progress_pct = payload.pct; upsertJob(j); }
    return;
  }
  if (typeof payload === 'object' && payload.id) {
    upsertJob(payload);
  }
}

function upsertJob(job) {
  state.jobs.set(job.id, { ...(state.jobs.get(job.id) || {}), ...job });
  renderList();
  if (String(state.selectedId) === String(job.id)) selectJob(job.id);
}

// --- init ---
async function loadAdapters() {
  try {
    const { adapters } = await api('GET', '/api/adapters');
    state.adapters = adapters;
    const sel = $('adapter');
    for (const a of adapters) {
      const opt = document.createElement('option');
      opt.value = a.name; opt.textContent = a.name;
      sel.appendChild(opt);
    }
  } catch (_e) { /* niet fataal */ }
}

async function loadJobs() {
  const { jobs } = await api('GET', '/api/jobs?limit=200');
  state.jobs = new Map(jobs.map((j) => [j.id, j]));
  renderList();
}

function bind() {
  $('newJobForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const url = $('url').value.trim();
    const adapter = $('adapter').value || undefined;
    if (!url) return;
    const force = $('force') && $('force').checked;
    try {
      const job = await api('POST', '/api/jobs', { url, adapter, force });
      upsertJob(job);
      selectJob(job.id);
      if (job.duplicate) {
        setMsg(`Duplicaat — bestaande job #${job.id} (${job.status}) hergebruikt. Vink "forceer" aan om opnieuw te downloaden.`);
      } else {
        $('url').value = '';
        setMsg(`Job #${job.id} aangemaakt (${job.adapter})`);
      }
    } catch (e) { setMsg(e.message, true); }
  });

  $('filter').addEventListener('change', (ev) => { state.filter = ev.target.value; renderList(); });
  $('btnRetry').addEventListener('click',  () => state.selectedId && api('POST', `/api/jobs/${state.selectedId}/retry`).then((j)=>upsertJob(j)).catch((e)=>setMsg(e.message,true)));
  $('btnCancel').addEventListener('click', () => state.selectedId && api('POST', `/api/jobs/${state.selectedId}/cancel`).then((j)=>upsertJob(j)).catch((e)=>setMsg(e.message,true)));
}

(async function boot() {
  bind();
  await loadAdapters();
  await loadJobs();
  connectWs();
})();
