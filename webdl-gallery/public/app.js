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

  const SOURCE_TREE_EXPANDED_KEY = 'webdl.gallery.sourceTree.expanded.v1';
  function loadSourceTreeExpanded() {
    try {
      const raw = localStorage.getItem(SOURCE_TREE_EXPANDED_KEY);
      if (!raw) return null;
      const values = JSON.parse(raw);
      return Array.isArray(values) ? new Set(values.map((v) => String(v || '').trim()).filter(Boolean)) : null;
    } catch (_) {
      return null;
    }
  }
  const initialSourceTreeExpanded = loadSourceTreeExpanded();
  function saveSourceTreeExpanded(values) {
    try {
      localStorage.setItem(SOURCE_TREE_EXPANDED_KEY, JSON.stringify(Array.from(values || [])));
    } catch (_) {}
  }

  const state = {
    items: [],
    offset: 0,
    limit: 100,
    loading: false,
    done: false,
    filters: {
      platform: '',
      channel: '',
      q: '',
      sort: 'recent',
      min_rating: '',
      media_type: '',
      channel_sort: 'count',
      tag_id: '',
      source_thread_url: '',
      source_thread_title: '',
      source_post_url: '',
      source_model_key: '',
      source_model_title: '',
      source_scope_label: '',
    },
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
    tagFilterOptions: [],
    platformOptions: [],
    channelOptions: [],
    sourceTreeExpanded: initialSourceTreeExpanded || new Set(),
    sourceTreeHadSavedExpanded: Boolean(initialSourceTreeExpanded),
    sourceTreeQuery: '',
    sourceFilterBusy: false,
    sourceTreeSuppress: false,
    newestFinishedAt: null,
    knownIds: new Set(),
    queryVersion: 0,
    queryHistory: [],
    queryHistoryIndex: -1,
    applyingQueryHistory: false,
    lastMouseHistoryAt: 0,
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
    if (explicit === 'video' || explicit === 'image' || explicit === 'archive' || explicit === 'download') return explicit;
    const value = String((it && (it.filepath || it.filename || it.format)) || '').toLowerCase();
    if (/\.(mp4|webm|mkv|mov|m4v|avi|flv|ts)(?:$|[?#])/.test(value) || ['mp4', 'webm', 'mkv', 'mov', 'm4v', 'avi', 'flv', 'ts'].includes(value)) return 'video';
    if (/\.(jpe?g|png|webp|gif|avif|bmp)(?:$|[?#])/.test(value) || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'].includes(value)) return 'image';
    if (/\.(rar|zip|7z|tar|tgz|gz|bz2|xz|cbz|cbr)(?:$|[?#])/.test(value) || ['rar', 'zip', '7z', 'tar', 'tgz', 'gz', 'bz2', 'xz', 'cbz', 'cbr'].includes(value)) return 'archive';
    return '';
  }

  function mediaTypeLabel(it) {
    const type = mediaTypeOf(it);
    if (type === 'video') return 'video';
    if (type === 'image') return 'afbeelding';
    if (type === 'archive' || type === 'download') return 'download';
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
    if (/\.(jpe?g|png|webp|gif|avif|bmp|mp4|webm|mkv|mov|m4v|avi|flv|ts|rar|zip|7z|tar|tgz|gz|bz2|xz|cbz|cbr)$/i.test(text)) return true;
    if (/^[a-f0-9]{12,}$/i.test(text) && /\d/.test(text)) return true;
    if (/^[0-9]+[-_][a-f0-9-]{12,}$/i.test(text)) return true;
    if (/^[a-f0-9-]{24,}$/i.test(text) && /\d/.test(text)) return true;
    return false;
  }

  function displayTitle(it) {
    const type = mediaTypeOf(it);
    if (type === 'archive' || type === 'download') {
      const filename = String(it && (it.filename || '') || '').trim();
      if (filename) return filename;
      const filepath = String(it && (it.filepath || '') || '').trim();
      const base = filepath.split(/[\\/]/).filter(Boolean).pop() || '';
      if (base) return base;
    }
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
    if (raw === 'phun' || raw === 'phun.org' || raw === 'forum.phun.org' || raw.endsWith('.phun.org')) return 'phun';
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
    const site = String(it.source_site || it.platform || '').toLowerCase();
    if (site === 'twitter' || site === 'x' || site.includes('twitter')) {
      return sourceModelTitleFromText(it.source_post_title || '');
    }
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
    const type = mediaTypeOf(it);
    if (type === 'archive' || type === 'download') {
      el.style.backgroundImage = 'none';
      el.dataset.kind = 'download';
      el.classList.add('thumb-missing');
      return;
    }
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
    const itemType = mediaTypeOf(it);
    if (itemType === 'archive' || itemType === 'download') c.classList.add('card-download');
    c.dataset.idx = String(idx);
    c.dataset.id  = String(it.id);
    const platformText = canonicalSiteLabel(it.platform) || String(it.platform || '?').trim() || '?';
    const sourceText = String(it.source_site || '').trim();
    const showSource = shouldShowSourceSite(platformText, sourceText);
    const badgeTitle = displayPlatformBadge(it);
    // Build extra source badges from source_sites array (excluding platform and source_site to avoid duplication)
    const platformKey = comparableSiteKey(platformText);
    const sourceKey = comparableSiteKey(sourceText);
    const extraSites = (Array.isArray(it.source_sites) ? it.source_sites : [])
      .map(s => String(s || '').trim())
      .filter(s => {
        const k = comparableSiteKey(s);
        return k && k !== platformKey && k !== sourceKey;
      });
    const badge = `<div class="card-badge-stack" title="${escHtml(badgeTitle)}">
        <span class="card-badge">${escHtml(platformText)}</span>
        ${showSource ? `<span class="card-badge card-badge-source">via ${escHtml(canonicalSiteLabel(sourceText) || sourceText)}</span>` : ''}
        ${extraSites.map(s => `<span class="card-badge card-badge-source">${escHtml(canonicalSiteLabel(s) || s)}</span>`).join('')}
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
    const sizeLabel = itemType === 'archive' || itemType === 'download' ? compactBytes(it.filesize) : '';
    const subParts = [sizeLabel, postLabel, sub, contentSites.length ? `inhoud: ${contentSites.join(', ')}` : ''].filter(Boolean);
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
      if (itemType === 'archive' || itemType === 'download') {
        window.open(`/media/${encodeURIComponent(String(it.id))}`, '_blank', 'noopener');
        return;
      }
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

  function prependItems(newItems) {
    const incoming = Array.isArray(newItems) ? newItems : [newItems];
    const fresh = incoming.filter((it) => it && it.id != null && !state.knownIds.has(String(it.id)));
    if (!fresh.length) return;
    renderPrepend(fresh);
    updateStats();
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
    if (state.filters.sort !== 'recent') {
      state.pendingNewItems = new Map();
      return;
    }
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

  function reconcileLiveRefreshForSort() {
    if (state.filters.sort !== 'recent') {
      state.autoRefresh = false;
      state.liveAllMedia = false;
      state.pendingNewItems = new Map();
      if (state.autoInjectTimer) clearTimeout(state.autoInjectTimer);
      state.autoInjectTimer = null;
      stopAutoRefresh();
      syncAutoButton();
      return;
    }
    syncAutoButton();
    if (state.autoRefresh && !state.viewerActive && !document.hidden) startAutoRefresh();
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
    const selectedChannels = splitFilterList(state.filters.channel);
    if (selectedChannels.length) {
      const selectedSet = new Set(selectedChannels);
      const value = (state.channelOptions || [])
        .filter((row) => selectedSet.has(String(row.channel || '')))
        .reduce((sum, row) => sum + countForCurrentMediaType(row), 0);
      if (value) return value;
    }
    const selectedPlatforms = splitFilterList(state.filters.platform);
    if (selectedPlatforms.length) {
      const selectedSet = new Set(selectedPlatforms);
      const value = (state.platformOptions || [])
        .filter((row) => selectedSet.has(String(row.platform || '')))
        .reduce((sum, row) => sum + countForCurrentMediaType(row), 0);
      if (value) return value;
    }
    const tag = $('tagFilter');
    if (tag && tag.value) {
      const value = Number(tag.dataset.count);
      return Number.isFinite(value) ? value : null;
    }
    return null;
  }

  function activeFilterText() {
    const f = state.filters;
    const parts = [];
    if (f.platform) parts.push(f.platform);
    if (f.channel) parts.push(f.channel);
    if (f.media_type) parts.push(f.media_type === 'video' ? 'video' : 'afbeelding');
    if (f.min_rating) parts.push(`${f.min_rating}+ sterren`);
    if (f.tag_id) {
      const tagSel = $('tagFilter');
      const label = tagSel && tagSel.dataset.label ? tagSel.dataset.label : `tag ${f.tag_id}`;
      parts.push(label);
    }
    const sortLabels = {
      oldest: 'sort: oudste',
      channel: 'sort: kanaal/model A-Z',
      channel_desc: 'sort: kanaal/model Z-A',
      rating: 'sort: rating hoog',
      rating_asc: 'sort: rating laag',
      random: 'sort: random',
    };
    if (sortLabels[f.sort]) parts.push(sortLabels[f.sort]);
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
            .map((r) => `${r.work_lane || r.platform} ${r.count}`)
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
      const sub = [it.work_lane, mediaTypeLabel(it), it.channel, compactBytes(it.filesize)].filter(Boolean).join(' / ');
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
      const timer = setTimeout(() => ctrl.abort(), 30000);
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
      sentinel.textContent = e && e.name === 'AbortError'
        ? 'Fout: zoekopdracht duurde te lang.'
        : 'Fout: ' + e.message;
      state.loading = false;
      return;
    }
    if (queryVersion !== state.queryVersion) return;
    sentinel.textContent = state.done ? '' : 'Scroll voor meer…';
    sentinel.hidden = state.done;
    state.loading = false;
  }

  async function reloadGallery({ pushHistory = true } = {}) {
    if (pushHistory) pushQueryHistory(state.filters);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    clearGrid();
    await loadMore();
    updateQueryHistoryControls();
  }

  // ─── Filters ──────────────────────────────────────────────────────────────
  function platformCountParams() {
    const params = new URLSearchParams();
    if (state.filters.q) params.set('q', state.filters.q);
    if (state.filters.min_rating) params.set('min_rating', state.filters.min_rating);
    if (state.filters.tag_id) params.set('tag_id', state.filters.tag_id);
    for (const key of ['source_thread_url', 'source_thread_title', 'source_post_url', 'source_model_key', 'source_model_title']) {
      if (state.filters[key]) params.set(key, state.filters[key]);
    }
    return params;
  }

  function mediaSplitLabel(row) {
    const images = Number(row.image_count || 0);
    const videos = Number(row.video_count || 0);
    return `${images} afb · ${videos} vid`;
  }

  function splitFilterList(value) {
    return String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
  }

  function joinFilterList(values) {
    const list = values instanceof Set
      ? Array.from(values)
      : Array.isArray(values)
        ? values
        : splitFilterList(values);
    return Array.from(new Set(list.map((v) => String(v || '').trim()).filter(Boolean))).join(',');
  }

  const QUERY_FILTER_KEYS = [
    'platform', 'channel', 'q', 'sort', 'channel_sort', 'min_rating', 'media_type', 'tag_id',
    'source_thread_url', 'source_thread_title', 'source_post_url',
    'source_model_key', 'source_model_title', 'source_scope_label',
  ];

  function snapshotQueryFilters(filters = state.filters) {
    const out = {};
    for (const key of QUERY_FILTER_KEYS) out[key] = String(filters[key] || '');
    if (!out.sort) out.sort = 'recent';
    if (!out.channel_sort) out.channel_sort = 'count';
    return out;
  }

  function queryFiltersEqual(a, b) {
    const left = snapshotQueryFilters(a || {});
    const right = snapshotQueryFilters(b || {});
    return QUERY_FILTER_KEYS.every((key) => left[key] === right[key]);
  }

  function queryHistoryLabel(filters = state.filters) {
    const snap = snapshotQueryFilters(filters);
    if (snap.source_scope_label) return snap.source_scope_label;
    if (snap.source_model_title) return `Model: ${snap.source_model_title}`;
    if (snap.source_thread_title) return `Serie: ${snap.source_thread_title}`;
    if (snap.channel) {
      const channels = splitFilterList(snap.channel);
      if (channels.length === 1) return `Map: ${channels[0]}`;
      if (channels.length > 1) return `${channels.length} mappen`;
    }
    if (snap.platform) {
      const platforms = splitFilterList(snap.platform);
      if (platforms.length === 1) return `Bron: ${platforms[0]}`;
      if (platforms.length > 1) return `${platforms.length} bronnen`;
    }
    if (snap.tag_id) return `Tag #${snap.tag_id}`;
    if (snap.q) return `Zoek: ${snap.q}`;
    return 'Alle media';
  }

  function syncFilterControlsFromState() {
    const map = { min_rating: 'minRating', tag_id: 'tagFilter', media_type: 'mediaType', channel_sort: 'channelSort' };
    for (const key of ['platform', 'channel', 'q', 'sort', 'min_rating', 'media_type', 'channel_sort', 'tag_id']) {
      const control = $(map[key] || key);
      if (control) control.value = state.filters[key] || '';
    }
    syncTagFilterControl();
    renderSourceTree();
  }

  function updateQueryHistoryControls() {
    const back = $('queryBack');
    const forward = $('queryForward');
    const label = $('queryHistoryLabel');
    if (back) back.disabled = state.queryHistoryIndex <= 0;
    if (forward) forward.disabled = state.queryHistoryIndex < 0 || state.queryHistoryIndex >= state.queryHistory.length - 1;
    if (label) {
      const text = queryHistoryLabel();
      label.textContent = text;
      label.title = text;
    }
  }

  function pushQueryHistory(filters = state.filters) {
    if (state.applyingQueryHistory) return;
    const snap = snapshotQueryFilters(filters);
    const current = state.queryHistory[state.queryHistoryIndex];
    if (current && queryFiltersEqual(current, snap)) {
      updateQueryHistoryControls();
      return;
    }
    state.queryHistory = state.queryHistory.slice(0, state.queryHistoryIndex + 1);
    state.queryHistory.push(snap);
    if (state.queryHistory.length > 80) state.queryHistory.shift();
    state.queryHistoryIndex = state.queryHistory.length - 1;
    updateQueryHistoryControls();
  }

  async function applyGalleryQuery(filters, { pushHistory = true } = {}) {
    state.filters = {
      ...state.filters,
      ...snapshotQueryFilters({ ...state.filters, ...(filters || {}) }),
    };
    state.totalHint = selectedTotalHint();
    syncFilterControlsFromState();
    if (pushHistory) pushQueryHistory(state.filters);
    await loadFilterDropdowns();
    await reloadChannels();
    await reloadGallery({ pushHistory: false });
  }

  async function moveQueryHistory(dir) {
    const next = state.queryHistoryIndex + dir;
    if (next < 0 || next >= state.queryHistory.length) return;
    state.queryHistoryIndex = next;
    state.applyingQueryHistory = true;
    try {
      await applyGalleryQuery(state.queryHistory[next], { pushHistory: false });
    } finally {
      state.applyingQueryHistory = false;
      updateQueryHistoryControls();
    }
  }

  function shouldHandleMouseHistory(event) {
    if (!event || state.viewerActive) return false;
    const button = Number(event.button);
    if (button !== 3 && button !== 4) return false;
    const target = event.target;
    if (target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]')) return false;
    return true;
  }

  function handleMouseHistory(event) {
    if (!shouldHandleMouseHistory(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'mousedown') return;
    const now = Date.now();
    if (event.type === 'auxclick' && now - state.lastMouseHistoryAt < 300) return;
    state.lastMouseHistoryAt = now;
    moveQueryHistory(event.button === 3 ? -1 : 1);
  }

  function selectedSourceLabel(total) {
    const platforms = splitFilterList(state.filters.platform);
    const channels = splitFilterList(state.filters.channel);
    if (!platforms.length && !channels.length) return `Alle bronnen (${total})`;
    if (platforms.length === 1 && !channels.length) return platforms[0];
    if (channels.length === 1) return channels[0];
    const parts = [];
    if (platforms.length) parts.push(`${platforms.length} bronnen`);
    if (channels.length) parts.push(`${channels.length} mappen`);
    return parts.join(' + ');
  }

  function channelsForPlatform(platform) {
    return (state.channelOptions || [])
      .filter((row) => String(row.platform || '') === String(platform || ''))
      .filter((row) => row.channel && row.channel !== 'unknown' && !String(row.channel).startsWith('site:'))
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
  }

  function sourceTreeNodeId(kind, platform = '', channel = '') {
    const enc = (value) => encodeURIComponent(String(value || ''));
    if (kind === 'all') return 'all';
    if (kind === 'platform') return `platform:${enc(platform)}`;
    return `channel:${enc(platform)}:${enc(channel)}`;
  }

  function buildSourceTreeData(total) {
    const platforms = (state.platformOptions || []).filter((row) => row.platform && row.platform !== 'unknown');
    const selectedPlatforms = new Set(splitFilterList(state.filters.platform));
    const selectedChannels = new Set(splitFilterList(state.filters.channel));
    const query = String(state.sourceTreeQuery || '').trim().toLowerCase();
    const platformRows = query ? platforms : platforms.slice(0, 80);
    const children = [];

    for (const platformRow of platformRows) {
      const platform = String(platformRow.platform);
      const platformMatches = platform.toLowerCase().includes(query);
      const childRows = channelsForPlatform(platform).slice(0, query ? 500 : 80);
      const visibleChildren = query
        ? childRows.filter((row) => platformMatches || String(row.channel || '').toLowerCase().includes(query))
        : childRows;
      if (query && !platformMatches && visibleChildren.length === 0) continue;

      const childSelected = childRows.some((row) => selectedChannels.has(String(row.channel)));
      const platformChecked = selectedPlatforms.has(platform) && !childSelected;
      const opened = Boolean(query || state.sourceTreeExpanded.has(platform) || childSelected);
      children.push({
        id: sourceTreeNodeId('platform', platform),
        text: `${platform} (${countForCurrentMediaType(platformRow)})`,
        data: { kind: 'platform', platform },
        state: { opened, checked: platformChecked, disabled: state.sourceFilterBusy },
        children: visibleChildren.map((channelRow) => {
          const channel = String(channelRow.channel);
          return {
            id: sourceTreeNodeId('channel', platform, channel),
            text: `${channel} (${countForCurrentMediaType(channelRow)})`,
            data: { kind: 'channel', platform, channel },
            state: { checked: selectedChannels.has(channel), disabled: state.sourceFilterBusy },
          };
        }),
      });
    }

    return [{
      id: sourceTreeNodeId('all'),
      text: `Alle bronnen (${total})`,
      data: { kind: 'all' },
      state: {
        opened: true,
        checked: selectedPlatforms.size === 0 && selectedChannels.size === 0,
        disabled: state.sourceFilterBusy,
      },
      children,
    }];
  }

  function checkedSourceTreeIds(nodes, out = []) {
    for (const node of nodes || []) {
      if (node && node.state && node.state.checked) out.push(node.id);
      if (node && node.children) checkedSourceTreeIds(node.children, out);
    }
    return out;
  }

  async function applySourceFilters(nextPlatformValues, nextChannelValues) {
    if (state.sourceFilterBusy) return;
    const nextPlatformFilter = joinFilterList(nextPlatformValues);
    const nextChannelFilter = joinFilterList(nextChannelValues);
    const tree = $('platformPicker');
    const keepOpen = Boolean(tree && tree.classList.contains('open'));
    if (state.filters.platform === nextPlatformFilter && state.filters.channel === nextChannelFilter) {
      renderSourceTree();
      if (keepOpen) $('platformPicker')?.classList.add('open');
      return;
    }
    state.sourceFilterBusy = true;
    state.filters.platform = nextPlatformFilter;
    state.filters.channel = nextChannelFilter;
    const pSel = $('platform');
    const cSel = $('channel');
    if (pSel) pSel.value = state.filters.platform;
    if (cSel) cSel.value = state.filters.channel;
    state.totalHint = selectedTotalHint();
    updateStats();
    renderSourceTree();
    if (keepOpen) $('platformPicker')?.classList.add('open');
    try {
      await reloadGallery();
    } finally {
      state.sourceFilterBusy = false;
      renderSourceTree();
      if (keepOpen) $('platformPicker')?.classList.add('open');
    }
  }

  function commitSourceTreeSelection(kind, nextChecked, platform = '', channel = '') {
    const nextPlatforms = new Set(splitFilterList(state.filters.platform));
    const nextChannels = new Set(splitFilterList(state.filters.channel));
    if (kind === 'all') {
      nextPlatforms.clear();
      nextChannels.clear();
    } else if (kind === 'platform') {
      // Platform- en mapselecties zijn bewust exclusief: de API kan geen
      // "hele bron OF specifieke map" mix betrouwbaar uitdrukken.
      nextChannels.clear();
      if (nextChecked) {
        nextPlatforms.add(platform);
      } else {
        nextPlatforms.delete(platform);
      }
    } else if (kind === 'channel') {
      if (nextChecked) {
        nextChannels.add(channel);
      } else {
        nextChannels.delete(channel);
      }
      nextPlatforms.clear();
      for (const row of state.channelOptions || []) {
        const rowChannel = String(row.channel || '');
        const rowPlatform = String(row.platform || '');
        if (rowChannel && rowPlatform && nextChannels.has(rowChannel)) nextPlatforms.add(rowPlatform);
      }
      if (nextChannels.size && nextPlatforms.size === 0 && platform) nextPlatforms.add(platform);
    }
    return applySourceFilters(nextPlatforms, nextChannels);
  }

  function ensureSourceTreeShell(tree) {
    if (tree.dataset.ready === '1') return;
    tree.innerHTML = '';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'source-tree-button';
    button.dataset.testid = 'source-tree-button';
    button.innerHTML = '<span></span><span>⌄</span>';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      tree.classList.toggle('open');
    });

    const menu = document.createElement('div');
    menu.className = 'source-tree-menu';
    menu.addEventListener('click', (event) => event.stopPropagation());

    const controls = document.createElement('div');
    controls.className = 'source-tree-controls';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'source-tree-search';
    search.placeholder = 'Zoek bron of map...';
    search.addEventListener('input', () => {
      state.sourceTreeQuery = search.value;
      renderSourceTree();
      tree.classList.add('open');
    });
    controls.appendChild(search);

    const actions = document.createElement('div');
    actions.className = 'source-tree-actions';
    const addAction = (name, label, title, handler) => {
      const action = document.createElement('button');
      action.type = 'button';
      action.dataset.action = name;
      action.textContent = label;
      action.title = title;
      action.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!state.sourceFilterBusy) await handler();
      });
      actions.appendChild(action);
    };
    addAction('all', 'Alles', 'Alle bronfilters wissen', () => commitSourceTreeSelection('all', true));
    addAction('open', 'Open', 'Alle zichtbare bronnen openklappen', () => {
      const query = String(state.sourceTreeQuery || '').trim().toLowerCase();
      for (const platformRow of state.platformOptions || []) {
        const platform = String(platformRow.platform || '');
        if (!platform || platform === 'unknown') continue;
        if (!query || platform.toLowerCase().includes(query) || channelsForPlatform(platform).some((row) => String(row.channel || '').toLowerCase().includes(query))) {
          state.sourceTreeExpanded.add(platform);
        }
      }
      state.sourceTreeHadSavedExpanded = true;
      saveSourceTreeExpanded(state.sourceTreeExpanded);
      renderSourceTree();
      tree.classList.add('open');
    });
    addAction('close', 'Dicht', 'Alle bronnen dichtklappen', () => {
      state.sourceTreeExpanded.clear();
      state.sourceTreeHadSavedExpanded = true;
      saveSourceTreeExpanded(state.sourceTreeExpanded);
      renderSourceTree();
      tree.classList.add('open');
    });
    controls.appendChild(actions);
    menu.appendChild(controls);

    const widget = document.createElement('div');
    widget.id = 'sourceTreeWidget';
    widget.className = 'source-tree-widget';
    menu.appendChild(widget);

    tree.appendChild(button);
    tree.appendChild(menu);
    tree.dataset.ready = '1';
  }

  function syncSourceTreePlugin(data) {
    const jq = window.jQuery;
    const widgetEl = $('sourceTreeWidget');
    if (!jq || !jq.fn || !jq.fn.jstree || !widgetEl) {
      if (widgetEl) widgetEl.textContent = 'Treeview plugin niet geladen';
      return;
    }
    const widget = jq(widgetEl);
    const existing = widget.jstree(true);
    const checkedIds = checkedSourceTreeIds(data);
    const finishSync = () => {
      const inst = widget.jstree(true);
      if (inst) {
        inst.uncheck_all();
        for (const id of checkedIds) {
          if (inst.get_node(id)) inst.check_node(id);
        }
      }
      state.sourceTreeSuppress = false;
    };

    state.sourceTreeSuppress = true;
    if (existing) {
      widget.jstree('destroy');
      widget.empty();
    }

    widget
      .off('.sourceTree')
      .on('ready.jstree.sourceTree', finishSync)
      .on('check_node.jstree.sourceTree uncheck_node.jstree.sourceTree', async (event, payload) => {
        if (state.sourceTreeSuppress || state.sourceFilterBusy) return;
        const meta = payload && payload.node && payload.node.data ? payload.node.data : {};
        const checked = event.type === 'check_node';
        window.setTimeout(() => {
          commitSourceTreeSelection(meta.kind, checked, meta.platform || '', meta.channel || '')
            .catch((err) => console.warn('source tree filter failed', err));
        }, 0);
      })
      .on('open_node.jstree.sourceTree close_node.jstree.sourceTree', (event, payload) => {
        if (state.sourceTreeSuppress) return;
        const meta = payload && payload.node && payload.node.data ? payload.node.data : {};
        if (meta.kind !== 'platform' || !meta.platform) return;
        if (event.type === 'open_node') state.sourceTreeExpanded.add(meta.platform);
        else state.sourceTreeExpanded.delete(meta.platform);
        state.sourceTreeHadSavedExpanded = true;
        saveSourceTreeExpanded(state.sourceTreeExpanded);
      })
      .on('select_node.jstree.sourceTree', (event, payload) => {
        const inst = widget.jstree(true);
        const meta = payload && payload.node && payload.node.data ? payload.node.data : {};
        if (inst && meta.kind === 'platform') inst.toggle_node(payload.node);
        if (inst) inst.deselect_all();
      })
      .jstree({
        core: {
          data,
          check_callback: false,
          themes: { name: 'default', dots: true, icons: false, stripes: false },
        },
        checkbox: {
          tie_selection: false,
          three_state: false,
          cascade: '',
          keep_selected_style: false,
        },
        plugins: ['checkbox'],
      });
  }

  function renderSourceTree() {
    const tree = $('platformPicker');
    if (!tree) return;
    ensureSourceTreeShell(tree);

    const platforms = (state.platformOptions || []).filter((row) => row.platform && row.platform !== 'unknown');
    const selectedPlatforms = new Set(splitFilterList(state.filters.platform));
    const selectedChannels = new Set(splitFilterList(state.filters.channel));
    const total = platforms.reduce((sum, row) => sum + countForCurrentMediaType(row), 0);
    if (!state.sourceTreeHadSavedExpanded && platforms.length && state.sourceTreeExpanded.size === 0) {
      state.sourceTreeExpanded.add(String(platforms[0].platform));
    }

    tree.classList.toggle('busy', state.sourceFilterBusy);
    const button = tree.querySelector('.source-tree-button');
    if (button) {
      button.className = 'source-tree-button' + ((selectedPlatforms.size || selectedChannels.size) ? ' active' : '');
      const label = button.querySelector('span:first-child');
      if (label) label.textContent = selectedSourceLabel(total);
    }
    const search = tree.querySelector('.source-tree-search');
    if (search && search !== document.activeElement) search.value = state.sourceTreeQuery || '';
    for (const action of tree.querySelectorAll('.source-tree-actions button')) action.disabled = state.sourceFilterBusy;

    syncSourceTreePlugin(buildSourceTreeData(total));
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
      state.platformOptions = platforms;
      const pSel = $('platform');
      const prev = state.filters.platform || pSel.value;
      const total = platforms.reduce((s, p) => s + Number(p.count), 0);
      pSel.innerHTML = `<option value="">Alle platforms (${total})</option>`;
      for (const p of platforms) {
        const o = document.createElement('option');
        o.value = p.platform;
        o.dataset.count = String(countForCurrentMediaType(p));
        o.textContent = `${p.platform} (${p.count} · ${mediaSplitLabel(p)})`;
        pSel.appendChild(o);
      }
      const availablePlatforms = new Set(platforms.map((p) => String(p.platform || '')).filter(Boolean));
      const keptPlatforms = splitFilterList(prev).filter((value) => availablePlatforms.has(value));
      if (keptPlatforms.length) {
        state.filters.platform = joinFilterList(keptPlatforms);
        pSel.value = '';
        await reloadChannels();
      } else {
        pSel.value = '';
        state.filters.platform = '';
        resetChannels();
        await reloadChannels();
      }
      state.totalHint = selectedTotalHint();
      renderSourceTree();
      updateStats();
    } catch (e) { console.warn('filters load failed', e); }
  }

  async function loadTagFilterDropdown() {
    const sel = $('tagFilter');
    const matrix = $('tagFilterMatrix');
    if (!sel && !matrix) return;
    try {
      const prev = sel ? sel.value : state.filters.tag_id;
      const data = await apiFetch('/api/tags').then(r => r.json());
      const tags = Array.isArray(data.tags) ? data.tags : [];
      const sorted = tags
        .slice()
        .sort((a, b) => {
          const favDelta = Number(Boolean(b.is_favorite)) - Number(Boolean(a.is_favorite));
          if (favDelta) return favDelta;
          const useDelta = Number(b.user_use_count || b.applied_count || b.uses || 0) - Number(a.user_use_count || a.applied_count || a.uses || 0);
          if (useDelta) return useDelta;
          return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
        });
      const total = sorted.reduce((sum, t) => sum + Number(t.applied_count || 0), 0);
      state.tagFilterOptions = sorted.map((tag) => ({
        id: String(tag.id),
        name: String(tag.name || ''),
        count: Number(tag.applied_count || tag.uses || 0),
        favorite: Boolean(tag.is_favorite),
      }));
      if (prev && state.tagFilterOptions.some((tag) => tag.id === String(prev))) {
        state.filters.tag_id = prev;
      } else {
        state.filters.tag_id = '';
      }
      syncTagFilterControl(total);
    } catch (e) { console.warn('tags filter load failed', e); }
  }

  function syncTagFilterControl(totalCount = null) {
    const sel = $('tagFilter');
    const selectedId = String(state.filters.tag_id || '');
    const selectedTag = (state.tagFilterOptions || []).find((tag) => tag.id === selectedId);
    if (sel) {
      sel.value = selectedId;
      sel.dataset.label = selectedTag ? `#${selectedTag.name}` : '';
      sel.dataset.count = selectedTag ? String(selectedTag.count) : '';
    }
    const matrix = $('tagFilterMatrix');
    if (!matrix) return;
    const total = totalCount != null
      ? Number(totalCount)
      : (state.tagFilterOptions || []).reduce((sum, tag) => sum + Number(tag.count || 0), 0);
    matrix.innerHTML = '';
    const mkChip = (tag) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-filter-chip' + (String(tag.id || '') === selectedId ? ' active' : '');
      chip.dataset.tagId = String(tag.id || '');
      chip.title = tag.id ? `Filter op #${tag.name}` : 'Tagfilter wissen';
      chip.textContent = tag.id ? `#${tag.name} ${tag.count ? `(${tag.count})` : ''}` : `Alle tags (${total})`;
      chip.addEventListener('click', () => applyTagFilter(tag.id || ''));
      return chip;
    };
    matrix.appendChild(mkChip({ id: '', name: 'Alle tags', count: total }));
    for (const tag of state.tagFilterOptions || []) matrix.appendChild(mkChip(tag));
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
      const params = new URLSearchParams();
      if (state.filters.q) params.set('q', state.filters.q);
      if (state.filters.min_rating) params.set('min_rating', state.filters.min_rating);
      if (state.filters.tag_id) params.set('tag_id', state.filters.tag_id);
      for (const key of ['source_thread_url', 'source_thread_title', 'source_post_url', 'source_model_key', 'source_model_title']) {
        if (state.filters[key]) params.set(key, state.filters[key]);
      }
      params.set('channel_sort', state.filters.channel_sort || 'count');
      const url = '/api/channels' + (params.toString() ? '?' + params.toString() : '');
      const channelsResp = await apiFetch(url).then(r => r.json());
      const channels = Array.isArray(channelsResp.channels) ? channelsResp.channels : [];
      state.channelOptions = channels;
      const cSel = $('channel');
      const prev = state.filters.channel || cSel.value;
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
      const availableChannels = new Set(channels.map((row) => String(row.channel || '')).filter(Boolean));
      const keptChannels = splitFilterList(prev).filter((value) => availableChannels.has(value));
      if (keptChannels.length) {
        state.filters.channel = joinFilterList(keptChannels);
        cSel.value = '';
      } else {
        cSel.value = '';
        state.filters.channel = '';
      }
      renderSourceTree();
      state.channelsLoadedFor = [
        '__all__',
        state.filters.q || '',
        state.filters.media_type || '',
        state.filters.min_rating || '',
        state.filters.tag_id || '',
        state.filters.source_thread_url || '',
        state.filters.source_thread_title || '',
        state.filters.source_post_url || '',
        state.filters.source_model_key || '',
        state.filters.source_model_title || '',
        state.filters.channel_sort || 'count',
      ].join('|');
    } catch (e) { console.warn('channels load failed', e); }
  }

  function setFilter(key, value) {
    state.filters[key] = value;
    // Sync filter control als aanwezig
    const el = $(key === 'min_rating' ? 'minRating' : key === 'tag_id' ? 'tagFilter' : key);
    if (el) el.value = value;
    if (key === 'tag_id') syncTagFilterControl();
  }

  async function applyTagFilter(tagId = '') {
    setFilter('tag_id', String(tagId || ''));
    await loadFilterDropdowns();
    await reloadChannels();
    await reloadGallery();
  }

  function readFiltersFromControls() {
    state.filters.platform   = state.filters.platform || $('platform').value;
    state.filters.channel    = state.filters.channel || $('channel').value;
    state.filters.channel_sort = $('channelSort') ? $('channelSort').value : 'count';
    state.filters.sort       = $('sort').value;
    state.filters.min_rating = $('minRating').value;
    state.filters.media_type = $('mediaType').value;
    state.filters.tag_id     = $('tagFilter') ? $('tagFilter').value : '';
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
  if ($('queryBack')) $('queryBack').addEventListener('click', () => moveQueryHistory(-1));
  if ($('queryForward')) $('queryForward').addEventListener('click', () => moveQueryHistory(1));
  window.addEventListener('mousedown', handleMouseHistory, { capture: true });
  window.addEventListener('mouseup', handleMouseHistory, { capture: true });
  window.addEventListener('auxclick', handleMouseHistory, { capture: true });

  for (const id of ['channelSort', 'sort', 'minRating', 'mediaType', 'tagFilter']) {
    const control = $(id);
    if (!control) continue;
    control.addEventListener('change', async () => {
      readFiltersFromControls();
      if (id === 'sort') reconcileLiveRefreshForSort();
      else syncAutoButton();
      if (id === 'minRating' || id === 'mediaType' || id === 'tagFilter') await loadFilterDropdowns();
      // Bij platform-wissel: kanalen herladen (filtert op geselecteerd platform)
      if (id === 'platform' || id === 'channelSort' || id === 'minRating' || id === 'mediaType' || id === 'tagFilter') await reloadChannels();
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
  document.addEventListener('click', (e) => {
    for (const id of ['platformPicker']) {
      const picker = $(id);
      if (picker && !picker.contains(e.target)) picker.classList.remove('open');
    }
  });

  // ─── Infinite scroll ──────────────────────────────────────────────────────
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) loadMore();
  }, { rootMargin: '400px' });

  // ─── Auto-refresh: poll voor nieuwe items ─────────────────────────────────
  async function pollNewItems() {
    if (!state.autoRefresh) return;
    if (state.filters.sort !== 'recent') {
      state.pendingNewItems = new Map();
      return;
    }
    if (state.autoRefreshInFlight) return;
    state.autoRefreshInFlight = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const params = new URLSearchParams({
        limit: String(Math.min(state.limit, 100)),
        offset: '0',
        sort: 'recent',
        thumb_ready: '1',
      });
      const hasActiveFilter = ['platform', 'channel', 'q', 'media_type', 'min_rating', 'tag_id']
        .some((key) => Boolean(state.filters[key]));
      if (!state.liveAllMedia || hasActiveFilter) {
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
    if (state.filters.sort !== 'recent') {
      state.pendingNewItems = new Map();
      syncAutoButton();
      return;
    }
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
    const livePausedBySort = state.autoRefresh && state.filters.sort !== 'recent';
    autoBtn.textContent = livePausedBySort ? '⏸ Live' : (state.autoRefresh ? (state.liveAllMedia ? '🔴 Live alles' : '🔴 Live') : '⚪ Live');
    autoBtn.title = livePausedBySort
      ? 'Live-refresh pauzeert bij deze sortering'
      : state.autoRefresh
      ? (state.liveAllMedia ? 'Auto-refresh aan voor alle media (klik om uit te zetten)' : 'Auto-refresh aan voor huidige filter (klik om uit te zetten)')
      : 'Auto-refresh uit (klik om aan te zetten)';
    autoBtn.style.cssText = livePausedBySort
      ? 'background:#334155;border-color:#475569;color:#cbd5e1'
      : (state.autoRefresh ? 'background:#1f6feb;border-color:#1f6feb;color:#fff' : '');
  }
  autoBtn.className = 'auto-toggle';
  syncAutoButton();
  autoBtn.addEventListener('click', () => {
    if (state.filters.sort !== 'recent') {
      state.autoRefresh = false;
      state.liveAllMedia = false;
      state.pendingNewItems = new Map();
      stopAutoRefresh();
      syncAutoButton();
      return;
    }
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
    applyTagFilter,
    setViewerActive,
    restoreViewerAnchor,
    prependItems,
    loadMore,
    reload: reloadGallery,
    applyQuery: applyGalleryQuery,
    loadTagFilterDropdown,
  };

  // ─── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    readFiltersFromControls();
    pushQueryHistory(state.filters);

    // Ensure browser history has a gallery entry so viewer's history.back()
    // returns here instead of the browser start page.
    try {
      if (!history.state || history.state.page !== 'gallery') {
        history.replaceState({ page: 'gallery' }, '', location.href);
      }
    } catch (_) {}

    loadTagFilterDropdown().catch((e) => console.warn('tags filter load failed', e));
    loadFilterDropdowns().catch((e) => console.warn('filters load failed', e));
    await loadMore();
    if (window.__viewer && typeof window.__viewer.restoreLastPosition === 'function') {
      await window.__viewer.restoreLastPosition();
    }
    document.dispatchEvent(new CustomEvent('webdl:gallery-ready'));
    io.observe(sentinel);
    if (!state.viewerActive) {
      startActiveRefresh();
      if (state.autoRefresh) startAutoRefresh();
    }
  }

  init().catch((e) => {
    sentinel.textContent = 'Fout: ' + (e && e.message ? e.message : String(e));
  });
})();
