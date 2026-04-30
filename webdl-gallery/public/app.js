// app.js — webdl-gallery client (gallery grid + auto-refresh)
// Viewer logica zit in viewer.js; communicatie via window.__wdGallery + window.__viewer
(() => {
  'use strict';

  // Uniek ID per tabblad zodat de browser requests niet samenvoegt
  const TAB_ID = Math.random().toString(36).slice(2, 8);

  function apiFetch(url) {
    const sep = url.includes('?') ? '&' : '?';
    return fetch(url + sep + '_t=' + TAB_ID);
  }

  const state = {
    items: [],
    offset: 0,
    limit: 100,
    loading: false,
    done: false,
    filters: { platform: '', channel: '', q: '', sort: 'recent', min_rating: '', media_type: '' },
    // Auto-refresh
    autoRefresh: true,
    autoRefreshMs: 10000,
    autoRefreshTimer: null,
    newestFinishedAt: null,
    knownIds: new Set(),
  };

  const $ = (id) => document.getElementById(id);
  const grid      = $('grid');
  const sentinel  = $('sentinel');

  // ─── Star HTML helper ─────────────────────────────────────────────────────
  function starHtml(rating) {
    const r = Math.max(0, Math.min(5, Number(rating) || 0));
    let html = '';
    for (let i = 1; i <= 5; i++) {
      if (r >= i)        html += '★';
      else if (r >= i - 0.5) html += '⯨';
      else                html += '<span class="off">★</span>';
    }
    return html;
  }


  function thumbUrl(it) { return `/thumb/${it.id}?v=${it.is_thumb_ready ? 1 : 0}`; }

  // ─── Card rendering ───────────────────────────────────────────────────────
  function cardEl(it, idx) {
    const c = document.createElement('div');
    c.className = 'card';
    c.dataset.idx = String(idx);
    c.dataset.id  = String(it.id);
    const badge = `<span class="card-badge">${it.platform || '?'}</span>`;
    const vmark = it.type === 'video' ? '<span class="card-video-mark">▶ video</span>' : '';
    const title = (it.title || it.filename || '').replace(/</g, '&lt;');
    const sub   = (it.channel && it.channel !== 'unknown') ? it.channel : '';
    c.innerHTML = `
      <div class="card-thumb" style="background-image:url('${thumbUrl(it)}')">
        ${badge}${vmark}
      </div>
      <div class="card-info">
        <div class="card-title">${title}</div>
        ${sub ? `<div class="card-sub">${sub}</div>` : ''}
        ${it.rating != null ? `<div class="card-stars">${starHtml(it.rating)}</div>` : ''}
      </div>`;
    c.addEventListener('click', () => {
      if (window.__viewer) window.__viewer.open(idx);
    });
    return c;
  }

  function renderAppend(newItems) {
    const start = state.items.length - newItems.length;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < newItems.length; i++) {
      frag.appendChild(cardEl(newItems[i], start + i));
    }
    grid.appendChild(frag);
    trackNewest();
  }

  function renderPrepend(newItems) {
    state.items = newItems.concat(state.items);
    // Viewer idx opschuiven als open
    if (window.__viewer && window.__wdGallery._viewerOpen && window.__wdGallery._viewerIdx >= 0) {
      window.__wdGallery._viewerIdx += newItems.length;
    }
    redrawGrid();
    trackNewest();
    flashNewBanner(newItems.length);
  }

  function redrawGrid() {
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (let i = 0; i < state.items.length; i++) {
      frag.appendChild(cardEl(state.items[i], i));
    }
    grid.appendChild(frag);
  }

  function trackNewest() {
    for (const it of state.items) {
      if (it.id != null) state.knownIds.add(String(it.id));
      const t = it.sort_ts || it.finished_at || it.created_at;
      if (t && (!state.newestFinishedAt || t > state.newestFinishedAt)) {
        state.newestFinishedAt = t;
      }
    }
  }

  function flashNewBanner(count) {
    const s = $('stats');
    if (!s) return;
    s.textContent = `+${count} nieuw · ${state.items.length} items`;
    s.style.color = '#4ade80';
    setTimeout(() => { s.style.color = ''; updateStats(); }, 3000);
  }

  function clearGrid() {
    grid.innerHTML = '';
    state.items = []; state.offset = 0; state.done = false;
    state.newestFinishedAt = null;
    state.knownIds = new Set();
  }

  function updateStats() {
    $('stats').textContent = `${state.items.length} items${state.done ? '' : '+'}`;
  }

  // ─── API: laad meer ───────────────────────────────────────────────────────
  async function loadMore() {
    if (state.loading || state.done) return;
    state.loading = true;
    sentinel.textContent = 'Laden…';
    try {
      const params = new URLSearchParams();
      params.set('limit',  String(state.limit));
      params.set('offset', String(state.offset));
      for (const [k, v] of Object.entries(state.filters)) if (v) params.set(k, v);
      const resp = await apiFetch('/api/items?' + params.toString());
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (!data.items) throw new Error(data.error || 'geen items');
      state.items.push(...data.items);
      state.offset += data.items.length;
      if (data.items.length < state.limit) state.done = true;
      renderAppend(data.items);
      updateStats();
    } catch (e) {
      sentinel.textContent = 'Fout: ' + e.message;
      state.loading = false;
      return;
    }
    sentinel.textContent = state.done ? `Einde — ${state.items.length} items` : 'Scroll voor meer…';
    state.loading = false;
  }

  async function reloadGallery() {
    clearGrid();
    await loadMore();
  }

  // ─── Filters ──────────────────────────────────────────────────────────────
  async function loadFilterDropdowns() {
    try {
      const platformsResp = await apiFetch('/api/platforms').then(r => r.json());
      const platforms = Array.isArray(platformsResp.platforms) ? platformsResp.platforms : [];
      const pSel = $('platform');
      const total = platforms.reduce((s, p) => s + Number(p.count), 0);
      pSel.innerHTML = `<option value="">Alle platforms (${total})</option>`;
      for (const p of platforms) {
        const o = document.createElement('option');
        o.value = p.platform;
        o.textContent = `${p.platform} (${p.count})`;
        pSel.appendChild(o);
      }
      await reloadChannels();
    } catch (e) { console.warn('filters load failed', e); }
  }

  async function reloadChannels() {
    try {
      const plat = state.filters.platform;
      const url = plat
        ? '/api/channels?platform=' + encodeURIComponent(plat)
        : '/api/channels';
      const channelsResp = await apiFetch(url).then(r => r.json());
      const channels = Array.isArray(channelsResp.channels) ? channelsResp.channels : [];
      const cSel = $('channel');
      const prev = cSel.value;
      cSel.innerHTML = '<option value="">Alle kanalen</option>';
      for (const c of channels.slice(0, 300)) {
        if (!c.channel || c.channel === 'unknown') continue;
        const o = document.createElement('option');
        o.value = c.channel;
        o.textContent = `${c.channel} (${c.count})`;
        cSel.appendChild(o);
      }
      // Herstel vorige selectie als die nog bestaat
      if (prev && [...cSel.options].some(o => o.value === prev)) {
        cSel.value = prev;
      } else {
        cSel.value = '';
        state.filters.channel = '';
      }
    } catch (e) { console.warn('channels load failed', e); }
  }

  function setFilter(key, value) {
    state.filters[key] = value;
    // Sync dropdown als aanwezig
    const el = $(key === 'min_rating' ? 'minRating' : key);
    if (el) el.value = value;
  }

  // updateCardRating — bijwerken van ster-weergave in de grid
  function updateCardRating(itemId, rating) {
    const card = grid.querySelector(`.card[data-id="${itemId}"]`);
    // Bijwerken in state.items ook
    const changed = state.items.filter(x => String(x.id) === String(itemId) || String(x.rating_id || '') === String(itemId));
    for (const it of changed) it.rating = rating;
    const cards = changed.length
      ? changed.map(it => grid.querySelector(`.card[data-id="${it.id}"]`)).filter(Boolean)
      : (card ? [card] : []);
    for (const c of cards) {
      const starsEl = c.querySelector('.card-stars');
      if (starsEl) {
        starsEl.innerHTML = rating != null ? starHtml(rating) : '';
      } else if (rating != null) {
        const info = c.querySelector('.card-info');
        if (info) {
          const s = document.createElement('div');
          s.className = 'card-stars';
          s.innerHTML = starHtml(rating);
          info.appendChild(s);
        }
      }
    }
  }

  // ─── Event listeners (gallery filters) ───────────────────────────────────
  $('refresh').addEventListener('click', reloadGallery);

  for (const id of ['platform', 'channel', 'sort', 'minRating', 'mediaType']) {
    $(id).addEventListener('change', async () => {
      state.filters.platform   = $('platform').value;
      state.filters.channel    = $('channel').value;
      state.filters.sort       = $('sort').value;
      state.filters.min_rating = $('minRating').value;
      state.filters.media_type = $('mediaType').value;
      // Bij platform-wissel: kanalen herladen (filtert op geselecteerd platform)
      if (id === 'platform') await reloadChannels();
      reloadGallery();
    });
  }
  $('q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      state.filters.q = $('q').value.trim();
      reloadGallery();
    }
  });
  $('q').addEventListener('change', () => {
    state.filters.q = $('q').value.trim();
    reloadGallery();
  });

  // ─── Infinite scroll ──────────────────────────────────────────────────────
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) loadMore();
  }, { rootMargin: '400px' });
  io.observe(sentinel);

  // ─── Auto-refresh: poll voor nieuwe items ─────────────────────────────────
  async function pollNewItems() {
    if (!state.autoRefresh) return;
    if (state.filters.sort !== 'recent') return;
    if (!state.newestFinishedAt) return;
    try {
      const params = new URLSearchParams({ since: state.newestFinishedAt });
      for (const [k, v] of Object.entries(state.filters)) {
        if (v && k !== 'sort') params.set(k, v);
      }
      const data = await apiFetch('/api/items-since?' + params.toString()).then(r => r.json());
      if (!data.items || data.items.length === 0) return;
      const fresh = data.items.filter(it => !state.knownIds.has(String(it.id)));
      if (fresh.length > 0) renderPrepend(fresh);
    } catch (e) { console.warn('auto-refresh failed', e); }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    state.autoRefreshTimer = setInterval(pollNewItems, state.autoRefreshMs);
  }
  function stopAutoRefresh() {
    if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAutoRefresh();
    else if (state.autoRefresh) startAutoRefresh();
  });

  // Live-toggle knop
  const autoBtn = document.createElement('button');
  autoBtn.textContent = '🔴 Live';
  autoBtn.title = 'Auto-refresh aan (klik om uit te zetten)';
  autoBtn.className = 'auto-toggle';
  autoBtn.style.cssText = '';
  autoBtn.addEventListener('click', () => {
    state.autoRefresh = !state.autoRefresh;
    if (state.autoRefresh) {
      autoBtn.textContent = '🔴 Live';
      autoBtn.style.cssText = 'background:#1f6feb;border-color:#1f6feb;color:#fff';
      startAutoRefresh();
      pollNewItems();
    } else {
      autoBtn.textContent = '⚪ Live';
      autoBtn.style.cssText = '';
      stopAutoRefresh();
    }
  });
  $('refresh').parentNode.insertBefore(autoBtn, $('refresh').nextSibling);

  // ─── Exporteer gallery API voor viewer.js ─────────────────────────────────
  window.__wdGallery = {
    state,
    starHtml,
    updateCardRating,
    setFilter,
    loadMore,
    reload: reloadGallery,
  };

  // ─── Init ─────────────────────────────────────────────────────────────────
  loadFilterDropdowns().then(() => loadMore().then(() => startAutoRefresh()));
})();
