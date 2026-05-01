// app.js — webdl-gallery client (gallery grid + auto-refresh)
// Viewer logica zit in viewer.js; communicatie via window.__wdGallery + window.__viewer
(() => {
  'use strict';

  // Uniek ID per tabblad zodat de browser requests niet samenvoegt
  const TAB_ID = Math.random().toString(36).slice(2, 8);

  function apiFetch(url, options) {
    const sep = url.includes('?') ? '&' : '?';
    return fetch(url + sep + '_t=' + TAB_ID, options);
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
    activeRefreshMs: 30000,
    activeRefreshTimer: null,
    newestFinishedAt: null,
    knownIds: new Set(),
    queryVersion: 0,
    pendingNewItems: new Map(),
  };

  const $ = (id) => document.getElementById(id);
  const grid      = $('grid');
  const sentinel  = $('sentinel');
  const activeStrip = $('activeStrip');

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


  function thumbUrl(it, retry = 0) {
    const params = new URLSearchParams();
    params.set('v', it && it.is_thumb_ready ? '1' : '0');
    if (retry) params.set('retry', String(retry));
    return `/thumb/${encodeURIComponent(String(it.id))}?${params.toString()}`;
  }
  function escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function mediaTypeOf(it) {
    const explicit = String(it && (it.type || it.media_type || '') || '').toLowerCase();
    if (explicit === 'video' || explicit === 'image') return explicit;
    const value = String((it && (it.filepath || it.filename || it.format)) || '').toLowerCase();
    if (/\.(mp4|webm|mkv|mov|m4v|avi|flv|ts)(?:$|[?#])/.test(value) || ['mp4', 'webm', 'mkv', 'mov', 'm4v', 'avi', 'flv', 'ts'].includes(value)) return 'video';
    if (/\.(jpe?g|png|webp|gif|avif|bmp)(?:$|[?#])/.test(value) || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'].includes(value)) return 'image';
    return '';
  }

  function mediaTypeLabel(it) {
    const type = mediaTypeOf(it);
    if (type === 'video') return 'video';
    if (type === 'image') return 'afbeelding';
    return '';
  }

  function attachThumbRetry(el, it) {
    if (!el || !it || !it.id) return;
    let tries = 0;
    const load = (retry = 0) => {
      el.classList.remove('thumb-missing');
      const url = thumbUrl(it, retry);
      el.style.backgroundImage = `url('${url}')`;
      const img = new Image();
      img.onload = () => { el.style.backgroundImage = `url('${url}')`; };
      img.onerror = () => {
        if (tries >= 2) {
          el.style.backgroundImage = 'none';
          el.dataset.kind = mediaTypeLabel(it) || 'media';
          el.classList.add('thumb-missing');
          return;
        }
        tries += 1;
        setTimeout(() => load(Date.now()), 700 * tries);
      };
      img.src = url;
    };
    load();
  }

  // ─── Card rendering ───────────────────────────────────────────────────────
  function cardEl(it, idx) {
    const c = document.createElement('div');
    c.className = 'card';
    c.dataset.idx = String(idx);
    c.dataset.id  = String(it.id);
    const badge = `<span class="card-badge">${it.platform || '?'}</span>`;
    const mediaLabel = mediaTypeLabel(it);
    const mediaMark = mediaLabel ? `<span class="card-media-mark">${mediaLabel}</span>` : '';
    const title = escHtml(it.title || it.filename || '');
    const sub   = (it.channel && it.channel !== 'unknown') ? it.channel : '';
    c.innerHTML = `
      <div class="card-thumb">
        ${badge}${mediaMark}
      </div>
      <div class="card-info">
        <div class="card-title">${title}</div>
        ${sub ? `<div class="card-sub">${escHtml(sub)}</div>` : ''}
        ${it.rating != null ? `<div class="card-stars">${starHtml(it.rating)}</div>` : ''}
      </div>`;
    attachThumbRetry(c.querySelector('.card-thumb'), it);
    const sourceUrl = it.source_url || it.url || '';
    if (sourceUrl) {
      const srcBtn = document.createElement('button');
      srcBtn.type = 'button';
      srcBtn.className = 'src-btn';
      srcBtn.textContent = 'Source';
      srcBtn.title = 'Open bron';
      srcBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(sourceUrl, '_blank', 'noopener');
      });
      c.appendChild(srcBtn);
    }
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
    state.loading = false;
    state.newestFinishedAt = null;
    state.knownIds = new Set();
    state.pendingNewItems = new Map();
    state.queryVersion += 1;
  }

  function activeFilterText() {
    const f = state.filters;
    const parts = [];
    if (f.platform) parts.push(f.platform);
    if (f.channel) parts.push(f.channel);
    if (f.media_type) parts.push(f.media_type === 'video' ? 'video' : 'afbeelding');
    if (f.min_rating) parts.push(`${f.min_rating}+ sterren`);
    if (f.q) parts.push(`"${f.q}"`);
    return parts.join(' / ');
  }

  function updateStats() {
    const pending = state.pendingNewItems ? state.pendingNewItems.size : 0;
    const filterText = activeFilterText();
    const parts = [`${state.items.length} items${state.done ? '' : '+'}`];
    if (pending) parts.push(`${pending} nieuw`);
    if (filterText) parts.push(`filter: ${filterText}`);
    $('stats').textContent = parts.join(' · ');
  }

  function compactBytes(n) {
    const v = Number(n) || 0;
    if (v >= 1024 * 1024 * 1024) return (v / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    if (v >= 1024 * 1024) return (v / (1024 * 1024)).toFixed(1) + ' MB';
    if (v >= 1024) return Math.round(v / 1024) + ' KB';
    return v ? v + ' B' : '';
  }

  function renderActiveItems(items, summary = null) {
    if (!activeStrip) return;
    const previews = (Array.isArray(items) ? items : [])
      .filter((it) => it && it.thumb_url)
      .slice(0, 12);
    const backlog = summary && Number(summary.hub_total || 0);
    activeStrip.classList.toggle('has-items', previews.length > 0 || backlog > 0);
    if (!previews.length && !backlog) {
      activeStrip.innerHTML = '';
      return;
    }
    activeStrip.innerHTML = '';
    const frag = document.createDocumentFragment();
    if (backlog > 0) {
      const queued = Number(summary.hub_queued || 0);
      const running = Number(summary.hub_running || 0);
      const topPlatforms = Array.isArray(summary.hub)
        ? summary.hub
            .filter((r) => r.status === 'queued')
            .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
            .slice(0, 3)
            .map((r) => `${r.platform} ${r.count}`)
            .join(' · ')
        : '';
      const card = document.createElement('div');
      card.className = 'active-card active-summary';
      card.innerHTML = `
        <div class="active-top"><span>QUEUE</span><span>${running ? `${running} actief` : ''}</span></div>
        <div class="active-title">${queued} wachtend · ${backlog} opdrachten totaal</div>
        <div class="active-sub">${escHtml(topPlatforms)}</div>`;
      frag.appendChild(card);
    }
    for (const it of previews) {
      const card = document.createElement('div');
      card.className = 'active-card active-thumb-card';
      const rawPlatform = (it.platform || it.source || 'active').toString();
      const source = rawPlatform.toLowerCase() === 'jdownloader' ? 'JDownloader' : rawPlatform.toUpperCase();
      const status = (it.status || '').toString().toUpperCase();
      const statusLabel = status && status !== source.toUpperCase() ? status : '';
      const sub = [mediaTypeLabel(it), it.platform, it.channel, compactBytes(it.filesize)].filter(Boolean).join(' / ');
      card.innerHTML = `
        <div class="active-thumb" style="background-image:url('${escHtml(it.thumb_url)}')"></div>
        <div class="active-top"><span>${escHtml(source)}</span><span>${escHtml(statusLabel)}</span></div>
        <div class="active-title">${escHtml(it.title || it.filename || it.filepath || '')}</div>
        <div class="active-sub">${escHtml(sub)}</div>`;
      frag.appendChild(card);
    }
    activeStrip.appendChild(frag);
  }

  async function pollActiveItems() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const data = await apiFetch('/api/active-items', { signal: ctrl.signal }).then(r => r.json());
      renderActiveItems(data.items || [], data.summary || null);
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('active-items failed', e);
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── API: laad meer ───────────────────────────────────────────────────────
  async function loadMore() {
    if (state.loading || state.done) return;
    const queryVersion = state.queryVersion;
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
      if (queryVersion !== state.queryVersion) return;
      if (!data.items) throw new Error(data.error || 'geen items');
      state.items.push(...data.items);
      state.offset += data.items.length;
      if (data.items.length < state.limit) state.done = true;
      renderAppend(data.items);
      updateStats();
    } catch (e) {
      if (queryVersion !== state.queryVersion) return;
      sentinel.textContent = 'Fout: ' + e.message;
      state.loading = false;
      return;
    }
    if (queryVersion !== state.queryVersion) return;
    sentinel.textContent = state.done ? `Einde — ${state.items.length} items` : 'Scroll voor meer…';
    state.loading = false;
  }

  async function reloadGallery() {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
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

  function readFiltersFromControls() {
    state.filters.platform   = $('platform').value;
    state.filters.channel    = $('channel').value;
    state.filters.sort       = $('sort').value;
    state.filters.min_rating = $('minRating').value;
    state.filters.media_type = $('mediaType').value;
    state.filters.q          = $('q').value.trim();
  }

  // updateCardRating — bijwerken van ster-weergave in de grid
  function updateCardRating(itemId, rating) {
    const card = grid.querySelector(`.card[data-id="${itemId}"]`);
    // Bijwerken in state.items ook. File-items hebben een eigen rating;
    // parent rating_id mag dus niet alle siblings meekleuren.
    const changed = state.items.filter(x => String(x.id) === String(itemId));
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
      readFiltersFromControls();
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
      if (fresh.length > 0) {
        for (const it of fresh) state.pendingNewItems.set(String(it.id), it);
        updateStats();
      }
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
  function startActiveRefresh() {
    stopActiveRefresh();
    pollActiveItems();
    state.activeRefreshTimer = setInterval(pollActiveItems, state.activeRefreshMs);
  }
  function stopActiveRefresh() {
    if (state.activeRefreshTimer) clearInterval(state.activeRefreshTimer);
    state.activeRefreshTimer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAutoRefresh();
      stopActiveRefresh();
    } else {
      startActiveRefresh();
      if (state.autoRefresh) startAutoRefresh();
    }
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
  loadFilterDropdowns().then(async () => {
    readFiltersFromControls();
    if (state.filters.platform) await reloadChannels();
    await loadMore();
    io.observe(sentinel);
    startActiveRefresh();
    startAutoRefresh();
  });
})();
