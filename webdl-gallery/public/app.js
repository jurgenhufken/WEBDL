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
    filters: { platform: '', channel: '', q: '', sort: 'recent', min_rating: '', media_type: '', channel_sort: 'count' },
    // Auto-refresh
    autoRefresh: true,
    liveAllMedia: true,
    autoRefreshMs: 1000,
    autoInjectMax: 100,
    autoInjectPumpMs: 50,
    autoRefreshTimer: null,
    autoInjectTimer: null,
    autoRefreshInFlight: false,
    activeRefreshMs: 30000,
    activeRefreshTimer: null,
    activeRefreshInFlight: false,
    newestFinishedAt: null,
    knownIds: new Set(),
    queryVersion: 0,
    pendingNewItems: new Map(),
    nextCursor: null,
    totalHint: null,
    channelsLoadedFor: null,
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

  function formatDurationBadge(it) {
    if (mediaTypeOf(it) !== 'video') return '';
    const explicitSeconds = Number(it && it.duration_seconds);
    let seconds = Number.isFinite(explicitSeconds) && explicitSeconds > 0 ? Math.round(explicitSeconds) : 0;
    const raw = String(it && it.duration || '').trim();
    if (!seconds && /^\d+(?:\.\d+)?$/.test(raw)) seconds = Math.round(Number(raw));
    if (seconds > 0) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
    }
    if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(raw)) return raw;
    return '';
  }

  function looksLikeFilenameTitle(value) {
    const text = String(value || '').trim();
    if (!text) return false;
    if (/\.(jpe?g|png|webp|gif|avif|bmp|mp4|webm|mkv|mov|m4v|avi|flv|ts)$/i.test(text)) return true;
    if (/^[a-f0-9]{12,}$/i.test(text) && /\d/.test(text)) return true;
    if (/^[0-9]+[-_][a-f0-9-]{12,}$/i.test(text)) return true;
    if (/^[a-f0-9-]{24,}$/i.test(text) && /\d/.test(text)) return true;
    return false;
  }

  function displayTitle(it) {
    const title = String(it && it.title || '').trim();
    if (title && title.toLowerCase() !== 'untitled' && !looksLikeFilenameTitle(title)) return title;
    const pageTitle = String(it && (it.source_thread_title || it.channel) || '').trim();
    if (pageTitle && pageTitle.toLowerCase() !== 'unknown' && !looksLikeFilenameTitle(pageTitle)) return pageTitle;
    return '';
  }

  function canonicalSiteLabel(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/^www\./, '');
    if (!raw) return '';
    if (raw === 'youtube' || raw === 'youtube.com' || raw === 'youtu.be' || raw.endsWith('.youtube.com')) return 'youtube';
    if (raw === 'telegram' || raw === 't' || raw === 't.me' || raw === 'telegram.me' || raw.endsWith('.t.me') || raw.endsWith('.telegram.me')) return 'telegram';
    if (raw === 'twitter' || raw === 'x.com' || raw === 'twitter.com' || raw.endsWith('.x.com') || raw.endsWith('.twitter.com')) return 'twitter';
    if (raw === 'reddit' || raw === 'reddit.com' || raw === 'redd.it' || raw.endsWith('.reddit.com')) return 'reddit';
    if (raw === 'redgifs' || raw === 'redgifs.com' || raw === 'gifdeliverynetwork.com' || raw.endsWith('.redgifs.com') || raw.endsWith('.gifdeliverynetwork.com')) return 'redgifs';
    if (raw === 'footfetishforum' || raw === 'footfetishforum.com' || raw.endsWith('.footfetishforum.com')) return 'footfetishforum';
    if (raw === 'vipergirls' || raw === 'vipergirls.to' || raw === 'viper.to' || raw.endsWith('.vipergirls.to') || raw.endsWith('.viper.to')) return 'vipergirls';
    if (raw === 'keep2share' || raw === 'keep2share.cc' || raw === 'k2s.cc' || raw === 'k2s.io' || raw.endsWith('.keep2share.cc') || raw.endsWith('.k2s.cc') || raw.endsWith('.k2s.io')) return 'keep2share';
    return raw;
  }

  function comparableSiteKey(value) {
    let key = canonicalSiteLabel(value);
    if (!key) return '';
    key = key.replace(/^https?:\/\//, '').split(/[/?#]/, 1)[0].replace(/^www\./, '');
    if (key.includes('.')) {
      const parts = key.split('.').filter(Boolean);
      if (parts.length >= 2) key = parts[parts.length - 2];
    }
    return key.replace(/[^a-z0-9]+/g, '');
  }

  function shouldShowSourceSite(platform, sourceSite) {
    const platformKey = comparableSiteKey(platform);
    const sourceKey = comparableSiteKey(sourceSite);
    return !!sourceKey && sourceKey !== platformKey;
  }

  function displayPlatformBadge(it) {
    const platform = String(it && it.platform || '?').trim();
    const sourceSite = String(it && it.source_site || '').trim();
    if (!shouldShowSourceSite(platform, sourceSite)) return platform || '?';
    return `${platform} via ${sourceSite}`;
  }

  function sourceLinkForItem(it) {
    return String((it && (it.source_post_url || it.source_url || it.url)) || '').trim();
  }

  function sourceModelTitleFromText(value) {
    let title = String(value || '').trim();
    if (!title) return '';
    title = title
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const stripPatterns = [
      /(?:[._ -])p(?:[._ -])?\d{1,5}[a-z]?$/i,
      /(?:[._ -])(?:img|image|pic|photo)(?:[._ -])?\d{1,5}[a-z]?$/i,
      /(?:[._ -])\d{1,5}[a-z]?$/i,
    ];
    for (const re of stripPatterns) {
      const stripped = title.replace(re, '').trim();
      if (stripped && stripped !== title) return stripped;
    }
    return title;
  }

  function sourceModelTitle(it) {
    if (!it) return '';
    const explicit = String(it.source_model_title || '').trim();
    if (explicit) return explicit;
    return sourceModelTitleFromText(it.source_post_title || it.title || it.filename || '');
  }

  function postLabelForItem(it, titleText = '') {
    if (!it) return '';
    const modelTitle = sourceModelTitle(it);
    if (modelTitle && modelTitle !== titleText) return `set/model ${modelTitle}`;
    const postNum = String(it.source_post_num || '').trim();
    const postId = String(it.source_post_id || '').trim();
    const postTitle = String(it.source_post_title || '').trim();
    const suffix = postTitle && postTitle !== titleText ? ` · ${postTitle}` : '';
    if (postNum) return `post ${postNum}${suffix}`;
    if (postId) return `post ${postId}${suffix}`;
    return postTitle && postTitle !== titleText ? postTitle : '';
  }

  function itemMatchesCurrentFilters(it) {
    const f = state.filters || {};
    if (f.platform && String(it.platform || '') !== String(f.platform)) return false;
    if (f.channel) {
      if (String(f.channel).startsWith('site:')) {
        const siteNeedle = String(f.channel).slice(5).toLowerCase();
        const sites = [it.source_site, ...(Array.isArray(it.source_sites) ? it.source_sites : [])]
          .map(v => String(v || '').toLowerCase())
          .filter(Boolean);
        if (!sites.some(site => site === siteNeedle || site.includes(siteNeedle))) return false;
      } else if (String(it.channel || '') !== String(f.channel)) {
        return false;
      }
    }
    if (f.media_type && mediaTypeOf(it) !== String(f.media_type)) return false;
    if (f.min_rating && Number(it.rating || 0) < Number(f.min_rating)) return false;
    if (f.q) {
      const haystack = [
        it.title, it.filename, it.channel, it.platform, it.source_site,
        ...(Array.isArray(it.source_sites) ? it.source_sites : []),
        ...(Array.isArray(it.content_sites) ? it.content_sites : []),
        it.source_thread_title, it.source_post_title, it.source_post_num, it.source_post_id, it.source_host,
        it.source_url, it.url,
      ].map(v => String(v || '').toLowerCase()).join(' ');
      if (!haystack.includes(String(f.q).toLowerCase())) return false;
    }
    return true;
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
    const platformText = canonicalSiteLabel(it.platform) || String(it.platform || '?').trim() || '?';
    const sourceText = String(it.source_site || '').trim();
    const showSource = shouldShowSourceSite(platformText, sourceText);
    const badgeTitle = displayPlatformBadge(it);
    const badge = `<div class="card-badge-stack" title="${escHtml(badgeTitle)}">
        <span class="card-badge">${escHtml(platformText)}</span>
        ${showSource ? `<span class="card-badge card-badge-source">via ${escHtml(canonicalSiteLabel(sourceText) || sourceText)}</span>` : ''}
      </div>`;
    const mediaLabel = mediaTypeLabel(it);
    const mediaMark = mediaLabel ? `<span class="card-media-mark">${mediaLabel}</span>` : '';
    const durationBadge = formatDurationBadge(it);
    const durationMark = durationBadge ? `<span class="card-duration">${escHtml(durationBadge)}</span>` : '';
    const titleText = displayTitle(it);
    const title = escHtml(titleText);
    const sourceSite = String(it.source_site || '').trim();
    const channel = (it.channel && it.channel !== 'unknown') ? String(it.channel) : '';
    const pageTitle = String(it.source_thread_title || channel || '').trim();
    const subSource = shouldShowSourceSite(platformText, sourceSite) ? (canonicalSiteLabel(sourceSite) || sourceSite) : '';
    const sub = pageTitle && pageTitle !== titleText
      ? pageTitle
      : (subSource && subSource !== titleText ? subSource : '');
    const contentSites = Array.isArray(it.content_sites) ? it.content_sites.filter(Boolean).slice(0, 3) : [];
    const postLabel = postLabelForItem(it, titleText);
    const subParts = [postLabel, sub, contentSites.length ? `inhoud: ${contentSites.join(', ')}` : ''].filter(Boolean);
    c.innerHTML = `
      <div class="card-thumb">
        ${badge}${mediaMark}${durationMark}
      </div>
      <div class="card-info">
        ${title ? `<div class="card-title">${title}</div>` : ''}
        ${subParts.length ? `<div class="card-sub">${escHtml(subParts.join(' · '))}</div>` : ''}
        ${it.rating != null ? `<div class="card-stars">${starHtml(it.rating)}</div>` : ''}
      </div>`;
    attachThumbRetry(c.querySelector('.card-thumb'), it);
    const sourceUrl = sourceLinkForItem(it);
    if (sourceUrl) {
      const srcBtn = document.createElement('button');
      srcBtn.type = 'button';
      srcBtn.className = 'src-btn';
      srcBtn.textContent = '↗';
      srcBtn.title = 'Open bronpagina';
      srcBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(sourceUrl, '_blank', 'noopener');
      });
      c.appendChild(srcBtn);
    }
    c.addEventListener('click', () => {
      if (window.__viewer) {
        const itemId = String(c.dataset.id || it.id || '');
        const currentIdx = state.items.findIndex((item) => String(item.id) === itemId);
        window.__viewer.open(currentIdx >= 0 ? currentIdx : idx);
      }
    });
    return c;
  }

  async function restoreViewerAnchor(itemId) {
    const id = String(itemId || '');
    if (!id) return false;
    let card = grid.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    for (let i = 0; !card && !state.done && i < 12; i++) {
      await loadMore();
      card = grid.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    }
    if (!card) return false;
    card.scrollIntoView({ block: 'center', behavior: 'auto' });
    card.classList.add('card-return-anchor');
    setTimeout(() => card.classList.remove('card-return-anchor'), 1800);
    return true;
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
    const frag = document.createDocumentFragment();
    for (let i = 0; i < newItems.length; i++) {
      frag.appendChild(cardEl(newItems[i], i));
    }
    grid.insertBefore(frag, grid.firstChild);
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

  function pumpPendingNewItems() {
    if (state.viewerActive) return;
    if (!state.pendingNewItems || state.pendingNewItems.size === 0) return;
    const inject = Array.from(state.pendingNewItems.values()).slice(0, state.autoInjectMax);
    for (const it of inject) state.pendingNewItems.delete(String(it.id));
    if (inject.length) renderPrepend(inject);
    if (state.pendingNewItems.size > 0) scheduleInjectPump();
  }

  function scheduleInjectPump() {
    if (state.autoInjectTimer) return;
    state.autoInjectTimer = setTimeout(() => {
      state.autoInjectTimer = null;
      pumpPendingNewItems();
    }, state.autoInjectPumpMs);
  }

  function clearGrid() {
    grid.innerHTML = '';
    state.items = []; state.offset = 0; state.done = false;
    state.loading = false;
    state.newestFinishedAt = null;
    state.knownIds = new Set();
    state.pendingNewItems = new Map();
    state.nextCursor = null;
    state.totalHint = selectedTotalHint();
    state.queryVersion += 1;
  }

  function countFromOptionText(text) {
    const match = String(text || '').match(/\((\d+)\)\s*$/);
    return match ? Number(match[1]) : null;
  }

  function selectedOptionCount(selectEl) {
    const opt = selectEl && selectEl.options ? selectEl.options[selectEl.selectedIndex] : null;
    if (!opt) return null;
    const value = Number(opt.dataset.count);
    if (Number.isFinite(value)) return value;
    return countFromOptionText(opt.textContent);
  }

  function selectedTotalHint() {
    const channel = $('channel');
    if (channel && channel.value) return selectedOptionCount(channel);
    const platform = $('platform');
    if (platform && platform.value) return selectedOptionCount(platform);
    return null;
  }

  function activeFilterText() {
    const f = state.filters;
    const parts = [];
    if (f.platform) parts.push(f.platform);
    if (f.channel) parts.push(f.channel);
    if (f.media_type) parts.push(f.media_type === 'video' ? 'video' : 'afbeelding');
    if (f.min_rating) parts.push(`${f.min_rating}+ sterren`);
    if (f.sort === 'channel') parts.push('sort: kanaal/model');
    if (f.q) parts.push(`"${f.q}"`);
    return parts.join(' / ');
  }

  function updateStats() {
    const pending = state.pendingNewItems ? state.pendingNewItems.size : 0;
    const filterText = activeFilterText();
    const total = Number.isFinite(Number(state.totalHint)) ? Number(state.totalHint) : null;
    const loadedText = total !== null && total >= state.items.length
      ? `${state.items.length} / ${total} geladen`
      : `${state.items.length} items${state.done ? '' : '+'}`;
    const parts = [loadedText];
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
    if (state.activeRefreshInFlight) return;
    state.activeRefreshInFlight = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const data = await apiFetch('/api/active-items', { signal: ctrl.signal }).then(r => r.json());
      renderActiveItems(data.items || [], data.summary || null);
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('active-items failed', e);
    } finally {
      clearTimeout(timer);
      state.activeRefreshInFlight = false;
    }
  }

  // ─── API: laad meer ───────────────────────────────────────────────────────
  async function loadMore() {
    if (state.loading || state.done) return;
    const queryVersion = state.queryVersion;
    state.loading = true;
    sentinel.hidden = false;
    sentinel.textContent = 'Laden…';
    try {
      const params = new URLSearchParams();
      params.set('limit',  String(state.limit));
      params.set('thumb_ready', '1');
      if (state.filters.sort === 'recent' && state.nextCursor) {
        params.set('cursor_ts', state.nextCursor.sort_ts);
        params.set('cursor_order', state.nextCursor.source_order);
      } else {
        params.set('offset', String(state.offset));
      }
      for (const [k, v] of Object.entries(state.filters)) if (v) params.set(k, v);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      let resp;
      try {
        resp = await apiFetch('/api/items?' + params.toString(), { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (queryVersion !== state.queryVersion) return;
      if (!data.items) throw new Error(data.error || 'geen items');
      state.items.push(...data.items);
      state.offset += data.items.length;
      state.nextCursor = data.next_cursor || null;
      if (state.filters.sort === 'recent') {
        state.done = !state.nextCursor;
      } else if (data.items.length < state.limit) {
        state.done = true;
      }
      renderAppend(data.items);
      updateStats();
    } catch (e) {
      if (queryVersion !== state.queryVersion) return;
      sentinel.textContent = 'Fout: ' + e.message;
      state.loading = false;
      return;
    }
    if (queryVersion !== state.queryVersion) return;
    sentinel.textContent = state.done ? '' : 'Scroll voor meer…';
    sentinel.hidden = state.done;
    state.loading = false;
  }

  async function reloadGallery() {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    clearGrid();
    await loadMore();
  }

  // ─── Filters ──────────────────────────────────────────────────────────────
  function platformCountParams() {
    const params = new URLSearchParams();
    if (state.filters.q) params.set('q', state.filters.q);
    if (state.filters.min_rating) params.set('min_rating', state.filters.min_rating);
    return params;
  }

  function mediaSplitLabel(row) {
    const images = Number(row.image_count || 0);
    const videos = Number(row.video_count || 0);
    return `${images} afb · ${videos} vid`;
  }

  function countForCurrentMediaType(row) {
    if (state.filters.media_type === 'image') return Number(row.image_count || 0);
    if (state.filters.media_type === 'video') return Number(row.video_count || 0);
    return Number(row.count || 0);
  }

  async function loadFilterDropdowns() {
    try {
      const params = platformCountParams();
      const platformsUrl = '/api/platforms' + (params.toString() ? '?' + params.toString() : '');
      const platformsResp = await apiFetch(platformsUrl).then(r => r.json());
      const platforms = Array.isArray(platformsResp.platforms) ? platformsResp.platforms : [];
      const pSel = $('platform');
      const prev = pSel.value;
      const total = platforms.reduce((s, p) => s + Number(p.count), 0);
      pSel.innerHTML = `<option value="">Alle platforms (${total})</option>`;
      for (const p of platforms) {
        const o = document.createElement('option');
        o.value = p.platform;
        o.dataset.count = String(countForCurrentMediaType(p));
        o.textContent = `${p.platform} (${p.count} · ${mediaSplitLabel(p)})`;
        pSel.appendChild(o);
      }
      if (prev && [...pSel.options].some(o => o.value === prev)) {
        pSel.value = prev;
        state.filters.platform = prev;
        await reloadChannels();
      } else {
        pSel.value = '';
        state.filters.platform = '';
        await reloadChannels();
      }
      state.totalHint = selectedTotalHint();
      updateStats();
    } catch (e) { console.warn('filters load failed', e); }
  }

  function resetChannels() {
    const cSel = $('channel');
    cSel.innerHTML = '<option value="">Alle kanalen</option>';
    cSel.value = '';
    state.filters.channel = '';
    state.channelsLoadedFor = null;
  }

  async function reloadChannels() {
    try {
      const plat = state.filters.platform;
      const params = new URLSearchParams();
      if (plat) params.set('platform', plat);
      if (state.filters.q) params.set('q', state.filters.q);
      if (state.filters.min_rating) params.set('min_rating', state.filters.min_rating);
      params.set('channel_sort', state.filters.channel_sort || 'count');
      const url = '/api/channels' + (params.toString() ? '?' + params.toString() : '');
      const channelsResp = await apiFetch(url).then(r => r.json());
      const channels = Array.isArray(channelsResp.channels) ? channelsResp.channels : [];
      const cSel = $('channel');
      const prev = cSel.value;
      const total = channels.reduce((sum, c) => sum + Number(c.count || 0), 0);
      cSel.innerHTML = `<option value="">Alle kanalen (${total})</option>`;
      for (const c of channels.slice(0, 300)) {
        if (!c.channel || c.channel === 'unknown') continue;
        const o = document.createElement('option');
        o.value = c.channel;
        const label = String(c.channel || '').startsWith('site:') ? String(c.channel).slice(5) : c.channel;
        o.dataset.count = String(countForCurrentMediaType(c));
        o.textContent = `${label} (${c.count} · ${mediaSplitLabel(c)})`;
        cSel.appendChild(o);
      }
      // Herstel vorige selectie als die nog bestaat
      if (prev && [...cSel.options].some(o => o.value === prev)) {
        cSel.value = prev;
      } else {
        cSel.value = '';
        state.filters.channel = '';
      }
      state.channelsLoadedFor = [
        plat || '__all__',
        state.filters.q || '',
        state.filters.media_type || '',
        state.filters.min_rating || '',
        state.filters.channel_sort || 'count',
      ].join('|');
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
    state.filters.channel_sort = $('channelSort') ? $('channelSort').value : 'count';
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

  for (const id of ['platform', 'channel', 'channelSort', 'sort', 'minRating', 'mediaType']) {
    $(id).addEventListener('change', async () => {
      readFiltersFromControls();
      if (id === 'minRating' || id === 'mediaType') await loadFilterDropdowns();
      // Bij platform-wissel: kanalen herladen (filtert op geselecteerd platform)
      if (id === 'platform' || id === 'channelSort' || id === 'minRating' || id === 'mediaType') await reloadChannels();
      reloadGallery();
    });
  }
  $('q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      state.filters.q = $('q').value.trim();
      loadFilterDropdowns().catch((err) => console.warn('platforms load failed', err));
      reloadChannels().catch((err) => console.warn('channels load failed', err));
      reloadGallery();
    }
  });
  $('q').addEventListener('change', () => {
    state.filters.q = $('q').value.trim();
    loadFilterDropdowns().catch((err) => console.warn('platforms load failed', err));
    reloadChannels().catch((err) => console.warn('channels load failed', err));
    reloadGallery();
  });
  $('channel').addEventListener('focus', () => {
    const key = [
      state.filters.platform || '__all__',
      state.filters.q || '',
      state.filters.media_type || '',
      state.filters.min_rating || '',
      state.filters.channel_sort || 'count',
    ].join('|');
    if (state.channelsLoadedFor !== key) {
      reloadChannels().catch((e) => console.warn('channels load failed', e));
    }
  });

  // ─── Infinite scroll ──────────────────────────────────────────────────────
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) loadMore();
  }, { rootMargin: '400px' });

  // ─── Auto-refresh: poll voor nieuwe items ─────────────────────────────────
  async function pollNewItems() {
    if (!state.autoRefresh) return;
    if (!state.liveAllMedia && state.filters.sort !== 'recent') return;
    if (state.autoRefreshInFlight) return;
    state.autoRefreshInFlight = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const params = new URLSearchParams({
        limit: String(Math.min(state.limit, 100)),
        offset: '0',
        sort: 'recent',
        thumb_ready: '1',
      });
      if (!state.liveAllMedia) {
        for (const [k, v] of Object.entries(state.filters)) {
          if (v) params.set(k, v);
        }
      }
      const data = await apiFetch('/api/items?' + params.toString(), { signal: ctrl.signal }).then(r => r.json());
      if (!data.items || data.items.length === 0) return;
      const fresh = data.items.filter(it => !state.knownIds.has(String(it.id)) && itemMatchesCurrentFilters(it));
      if (fresh.length > 0) {
        for (const it of fresh) state.pendingNewItems.set(String(it.id), it);
        pumpPendingNewItems();
        updateStats();
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('auto-refresh failed', e);
    } finally {
      clearTimeout(timer);
      state.autoRefreshInFlight = false;
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    pollNewItems();
    state.autoRefreshTimer = setInterval(pollNewItems, state.autoRefreshMs);
  }
  function stopAutoRefresh() {
    if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
    if (state.autoInjectTimer) clearTimeout(state.autoInjectTimer);
    state.autoRefreshTimer = null;
    state.autoInjectTimer = null;
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

  function setViewerActive(active) {
    state.viewerActive = Boolean(active);
    if (state.viewerActive) {
      stopActiveRefresh();
      if (!document.hidden && state.autoRefresh) startAutoRefresh();
    } else if (!document.hidden) {
      startActiveRefresh();
      if (state.autoRefresh) startAutoRefresh();
      pumpPendingNewItems();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAutoRefresh();
      stopActiveRefresh();
    } else {
      if (!state.viewerActive) {
        startActiveRefresh();
        if (state.autoRefresh) startAutoRefresh();
      }
    }
  });

  // Live-toggle knop
  const autoBtn = document.createElement('button');
  function syncAutoButton() {
    autoBtn.textContent = state.autoRefresh ? (state.liveAllMedia ? '🔴 Live alles' : '🔴 Live') : '⚪ Live';
    autoBtn.title = state.autoRefresh
      ? (state.liveAllMedia ? 'Auto-refresh aan voor alle media (klik om uit te zetten)' : 'Auto-refresh aan voor huidige filter (klik om uit te zetten)')
      : 'Auto-refresh uit (klik om aan te zetten)';
    autoBtn.style.cssText = state.autoRefresh ? 'background:#1f6feb;border-color:#1f6feb;color:#fff' : '';
  }
  autoBtn.className = 'auto-toggle';
  syncAutoButton();
  autoBtn.addEventListener('click', () => {
    state.autoRefresh = !state.autoRefresh;
    if (state.autoRefresh) {
      state.liveAllMedia = true;
      syncAutoButton();
      startAutoRefresh();
      pollNewItems();
    } else {
      syncAutoButton();
      stopAutoRefresh();
    }
  });
  $('refresh').parentNode.insertBefore(autoBtn, $('refresh').nextSibling);

  // ─── Exporteer gallery API voor viewer.js ─────────────────────────────────
  window.__wdGallery = {
    state,
    starHtml,
    updateCardRating,
    shouldShowSourceSite,
    setFilter,
    setViewerActive,
    restoreViewerAnchor,
    loadMore,
    reload: reloadGallery,
  };

  // ─── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    readFiltersFromControls();
    loadFilterDropdowns().catch((e) => console.warn('filters load failed', e));
    await loadMore();
    io.observe(sentinel);
    startActiveRefresh();
    if (state.autoRefresh) startAutoRefresh();
  }

  init().catch((e) => {
    sentinel.textContent = 'Fout: ' + (e && e.message ? e.message : String(e));
  });
})();
