// viewer.js — webdl-gallery volledige viewer module
// Afhankelijk van app.js: window.__wdGallery (state, starHtml, updateCardRating, loadMore, reload, setFilter, setTypeFilter)
(() => {
  'use strict';

  // ─── Viewer state ──────────────────────────────────────────────────────────
  const vs = {
    open: false,
    idx: -1,

    // Eigen items + paginering (onafhankelijk van gallery grid)
    items: [],
    offset: 0,
    done: false,
    loading: false,
    typeFilter: 'all',    // 'all' | 'video' | 'image'

    // Slideshow
    slideshow: false,
    slideshowTimer: null,
    slideshowSec: 4,
    wrap: true,
    random: false,
    videoWait: true,

    // UI
    sidebarOpen: false,
    logOpen: false,
    hudTimer: null,

    // Tags
    availableTags: [],
    currentItemTags: [],

    // Video
    vol: 0.8,
    muted: false,
    seekDragging: false,

    // Afspeelsnelheid
    playbackRate: 1.0,
    reverseRAF: null,      // requestAnimationFrame ID voor achteruit
    reverseLastT: 0,

    // Loop sectie
    loopStart: null,       // in seconden
    loopEnd: null,

    // Zoom (exact als oude viewer)
    zoomed: false,
    scale: 1,
    panX: 0,
    panY: 0,
    currentMediaEl: null,
    dragging: false,
    dragMoved: false,
    dragStart: null,

    // Channel-mode
    channels: [],
    chIdx: 0,
  };

  // Shorthand voor gallery API (gezet door app.js)
  function gal()    { return window.__wdGallery; }

  const $ = (id) => document.getElementById(id);

  // Gecachede DOM refs
  const el = {};

  // Uniek per tabblad — voorkomt dat de browser requests van verschillende tabs samenvoegt
  const VIEWER_TAB_ID = Math.random().toString(36).slice(2, 8);

  async function api(url, opts) {
    const sep = url.includes('?') ? '&' : '?';
    const r = await fetch(url + sep + '_t=' + VIEWER_TAB_ID, opts);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init() {
    const ids = [
      'viewer','vSidebar','vSidebarBackdrop','vList',
      'vMode','vFilter','vTagFilter','vReload',
      'vSlideshow','vSlideshowSec','vWrap','vRandom','vVideoWait',
      'vNowTitle','vNowSub','vNowRating',
      'vRatingSelect',
      'vBtnSidebar','vBtnOpen','vBtnFinder',
      'vZoomRange','vZoomReset',
      'vVol','vBtnMute','vSeek',
      'vBtnTags','vBtnLog','vClose',
      'vSlideshow2','vRandom2',
      'vStage','vContent','vPrev','vNext','vHudLeft','vHudRight',
      'vProgressBar','vProgressFill','vProgressHandle',
      'vBottomControls','vBtnPlayPause','vTimeLabel',
      'vTagDialog','vTagCurrent','vTagSearch','vTagList','vNewTagInput','vBtnAddTag','vBtnCloseTagDialog',
      'vLogPanel','vLogBody',
    ];
    for (const id of ids) {
      el[id] = $(id);
      if (!el[id]) console.warn(`viewer: element #${id} niet gevonden`);
    }
    bindControls();
    bindKeyboard();
    bindMouse();
    loadTags();
  }

  // ─── Open / sluit ─────────────────────────────────────────────────────────
  function open(idx) {
    // Kopieer gallery items als startpunt
    const gState = gal().state;
    vs.items  = [...gState.items];
    vs.offset = gState.offset;
    vs.done   = gState.done;
    vs.idx    = Math.max(0, Math.min(idx, vs.items.length - 1));
    vs.open   = true;

    el.viewer.classList.remove('hidden');
    el.viewer.classList.toggle('viewer--sidebar-open', vs.sidebarOpen);
    el.viewer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Push history state zodat browser-back (en muis-back-knop) de viewer sluit
    history.pushState({ page: 'viewer' }, '', location.href);

    renderSidebarList();
    showCurrent();
    showHUD();
  }

  function close(skipHistory) {
    if (!vs.open) return;
    vs.open = false;
    stopSlideshow();
    cleanupMedia();
    closeTagDialog();
    if (vs.logOpen) toggleLog();

    el.viewer.classList.add('hidden');
    el.viewer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    vs.idx = -1;

    // Pop de viewer history entry (tenzij we al via popstate kwamen)
    if (!skipHistory) {
      try { history.back(); } catch (_) {}
    }
  }

  // ─── Huidige item tonen ────────────────────────────────────────────────────
  function showCurrent() {
    const it = vs.items[vs.idx];
    if (!it) { close(); return; }

    cleanupMedia();
    resetZoom(); // Reset zoom bij elk nieuw item (exact als oude viewer)

    let mediaEl;
    if (it.type === 'video') {
      mediaEl = document.createElement('video');
      mediaEl.src = `/media/${it.id}`;
      mediaEl.poster = `/thumb/${it.id}`;   // thumbnail terwijl video laadt
      mediaEl.autoplay = true;
      mediaEl.controls = true;
      mediaEl.playsinline = true;
      mediaEl.muted = true;                  // altijd muted starten (browser autoplay policy)
      mediaEl.volume = vs.vol;
      try { mediaEl.setAttribute('controlsList', 'noremoteplayback nodownload'); } catch (_) {}
      try { mediaEl.disablePictureInPicture = true; } catch (_) {}

      // Zodra metadata geladen is: unmute als gebruiker dat wil
      mediaEl.addEventListener('loadedmetadata', () => {
        mediaEl.muted = vs.muted;
        el.vBtnMute.textContent = vs.muted ? '🔇' : '🔊';
      });

      mediaEl.addEventListener('timeupdate', () => {
        if (!vs.seekDragging && mediaEl.duration) {
          const pct = (mediaEl.currentTime / mediaEl.duration) * 100;
          el.vSeek.value = String(Math.round(pct * 10));
          if (el.vProgressFill) el.vProgressFill.style.width = pct + '%';
          if (el.vProgressHandle) el.vProgressHandle.style.left = pct + '%';

          // Loop sectie: spring terug naar begin als we voorbij het einde zijn
          if (vs.loopStart != null && vs.loopEnd != null && mediaEl.currentTime >= vs.loopEnd) {
            mediaEl.currentTime = vs.loopStart;
          }
        }
        updatePlaybackControls(mediaEl);
      });
      mediaEl.addEventListener('loadedmetadata', () => updatePlaybackControls(mediaEl));
      mediaEl.addEventListener('play', () => updatePlaybackControls(mediaEl));
      mediaEl.addEventListener('pause', () => updatePlaybackControls(mediaEl));
      mediaEl.addEventListener('ended', () => {
        stopReverse();
        updatePlaybackControls(mediaEl);
        if (vs.slideshow && vs.videoWait) slideshowTick();
      });

      // Pas opgeslagen snelheid toe
      mediaEl.addEventListener('loadedmetadata', () => {
        if (vs.playbackRate > 0) mediaEl.playbackRate = vs.playbackRate;
      });

      el.vVol.disabled  = false;
      el.vSeek.disabled = false;
      if (el.vBottomControls) el.vBottomControls.classList.remove('hidden');
    } else {
      mediaEl = document.createElement('img');
      mediaEl.src = `/media/${it.id}`;
      mediaEl.alt = it.title || '';
      mediaEl.onerror = () => { mediaEl.src = `/thumb/${it.id}`; };

      el.vVol.disabled  = true;
      el.vSeek.disabled = true;
      el.vSeek.value = '0';
      if (el.vBottomControls) el.vBottomControls.classList.add('hidden');
      updatePlaybackControls(null);
    }

    mediaEl.classList.add('zoom-media');
    mediaEl.style.transition = 'transform 120ms ease-out';
    vs.currentMediaEl = mediaEl;
    el.vContent.appendChild(mediaEl);
    attachZoomHandlers(mediaEl);

    // Align progress bar exact op onderkant van de afgespeelde pixels
    function alignProgressBar() {
      const media = el.vContent.querySelector('video, img');
      if (!media || !el.vProgressBar) return;
      
      const isVid = media.tagName === 'VIDEO';
      const w = isVid ? media.videoWidth : media.naturalWidth;
      const h = isVid ? media.videoHeight : media.naturalHeight;
      if (!w || !h) return;
      
      const stageRect = el.vStage.getBoundingClientRect();
      const stageRatio = stageRect.width / stageRect.height;
      const mediaRatio = w / h;
      
      let actualHeight, actualWidth;
      if (mediaRatio > stageRatio) {
        // Breder dan stage: letterbox boven en onder
        actualWidth = stageRect.width;
        actualHeight = stageRect.width / mediaRatio;
      } else {
        // Hoger dan stage: letterbox links en rechts (portrait)
        actualHeight = stageRect.height;
        actualWidth = stageRect.height * mediaRatio;
      }
      
      const bottomOffset = (stageRect.height - actualHeight) / 2;
      const sideOffset = (stageRect.width - actualWidth) / 2;
      
      el.vProgressBar.style.bottom = bottomOffset + 'px';
      el.vProgressBar.style.left = sideOffset + 'px';
      el.vProgressBar.style.right = sideOffset + 'px';
    }
    mediaEl.addEventListener(mediaEl.tagName === 'VIDEO' ? 'loadedmetadata' : 'load', alignProgressBar);
    // Ook bij resize
    if (!vs._resizeAlignBound) {
      vs._resizeAlignBound = true;
      window.addEventListener('resize', () => {
        requestAnimationFrame(alignProgressBar);
      });
    }
    // Na een kort moment voor layout
    requestAnimationFrame(() => setTimeout(alignProgressBar, 50));

    // Mute-knop initieel syncen
    el.vBtnMute.textContent = vs.muted ? '🔇' : '🔊';

    // Titel — alleen titel, geen bestandsnaam
    el.vNowTitle.textContent = it.title || '(zonder titel)';
    el.vNowSub.textContent = [
      it.platform,
      (it.channel && it.channel !== 'unknown') ? it.channel : '',
    ].filter(Boolean).join(' · ');

    // Rating, HUD, sidebar active
    updateRatingDisplay(it.rating);
    updateHUD(it);
    updateSidebarActive();
    scrollListToActive();

    // Tags prefetch
    loadItemTags(it.rating_id || it.id).catch(() => {});
  }

  function cleanupMedia() {
    stopReverse();
    vs.loopStart = null;
    vs.loopEnd = null;
    const v = el.vContent.querySelector('video');
    if (v) { v.pause(); v.src = ''; v.load(); }
    el.vContent.innerHTML = '';
    vs.currentMediaEl = null;
    el.vSeek.value = '0';
    updatePlaybackControls(null);
  }

  // ─── Navigatie ────────────────────────────────────────────────────────────
  async function loadMoreViewerItems() {
    if (vs.loading || vs.done) return;
    vs.loading = true;
    try {
      const gFilters = gal().state.filters;
      const params = new URLSearchParams({
        limit: '100',
        offset: String(vs.offset),
        sort: gFilters.sort || 'recent',
      });
      if (gFilters.platform) params.set('platform', gFilters.platform);
      if (gFilters.channel)  params.set('channel',  gFilters.channel);
      if (gFilters.q)        params.set('q',         gFilters.q);
      if (gFilters.min_rating) params.set('min_rating', gFilters.min_rating);
      if (vs.typeFilter !== 'all') params.set('media_type', vs.typeFilter);

      const data = await api('/api/items?' + params.toString());
      if (data.items && data.items.length > 0) {
        vs.items.push(...data.items);
        vs.offset += data.items.length;
        if (data.items.length < 100) vs.done = true;
        renderSidebarList();
      } else {
        vs.done = true;
      }
    } catch (e) {
      log('Laden mislukt: ' + e.message);
    }
    vs.loading = false;
  }

  async function navTo(idx) {
    if (idx < 0) {
      if (vs.wrap) idx = vs.items.length - 1;
      else return;
    }
    if (idx >= vs.items.length) {
      await loadMoreViewerItems();
      if (idx >= vs.items.length) {
        if (vs.wrap) idx = 0;
        else { stopSlideshow(); return; }
      }
    }
    vs.idx = idx;
    showCurrent();
  }

  async function navNext() {
    let next;
    if (vs.random) {
      next = Math.floor(Math.random() * vs.items.length);
    } else {
      next = vs.idx + 1;
    }
    await navTo(next);
  }

  async function navPrev() {
    await navTo(vs.idx - 1);
  }

  async function navChannel(dir) {
    if (!vs.channels.length) {
      // Laad kanalen als nog niet aanwezig
      try {
        const gf = gal().state.filters;
        const data = await api(`/api/channels${gf.platform ? '?platform=' + encodeURIComponent(gf.platform) : ''}`);
        vs.channels = (data.channels || []).filter(c => c.channel && c.channel !== 'unknown');
      } catch (e) { return; }
    }
    if (!vs.channels.length) return;
    vs.chIdx = ((vs.chIdx + dir) + vs.channels.length) % vs.channels.length;
    const ch = vs.channels[vs.chIdx];
    gal().setFilter('channel', ch.channel);
    await reloadViewerItems();
  }

  async function reloadViewerItems() {
    vs.items = [];
    vs.offset = 0;
    vs.done = false;
    vs.idx = 0;
    await loadMoreViewerItems();
    if (vs.items.length > 0) showCurrent();
    renderSidebarList();
  }

  // ─── Rating ───────────────────────────────────────────────────────────────
  function updateRatingDisplay(rating) {
    el.vNowRating.innerHTML = '';
    const r = Number(rating) || 0;

    for (let i = 1; i <= 5; i++) {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'rating-star-btn';
      s.dataset.index = String(i);

      if (r >= i) {
        s.textContent = '★';
        s.classList.add('on');
      } else if (r >= i - 0.5) {
        s.textContent = '⯪';
        s.classList.add('on');
      } else {
        s.textContent = '★';
      }

      el.vNowRating.appendChild(s);
    }

    // Cijfer-label
    const lbl = document.createElement('span');
    lbl.className = 'rating-value';
    lbl.textContent = rating != null ? String(rating) : '—';
    el.vNowRating.appendChild(lbl);
    if (el.vRatingSelect) el.vRatingSelect.value = rating != null ? String(rating) : '';
  }

  async function setRating(r) {
    const it = vs.items[vs.idx];
    if (!it) return;
    const activeId = String(it.id);
    try {
      await api('/api/rating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: it.id, rating: r }),
      });
      it.rating = r;
      for (const item of vs.items) {
        if (String(item.id) === activeId) item.rating = r;
      }
      if (vs.items[vs.idx] && String(vs.items[vs.idx].id) === activeId) {
        updateRatingDisplay(r);
      }
      gal().updateCardRating(activeId, r);
      log(`Rating: ${r != null ? r : 'gewist'}`);
    } catch (e) {
      log('Rating fout: ' + e.message);
    }
  }

  // ─── Video controls ───────────────────────────────────────────────────────
  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    const m = Math.floor((sec / 60) % 60);
    const h = Math.floor(sec / 3600);
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function formatSeconds(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '--s';
    return `${Math.round(sec)}s`;
  }

  function updatePlaybackControls(video) {
    const v = video || el.vContent.querySelector('video');
    if (el.vBtnPlayPause) el.vBtnPlayPause.textContent = v && !v.paused && !v.ended ? '⏸' : '▶';
    if (el.vTimeLabel) {
      el.vTimeLabel.textContent = v
        ? `${formatTime(v.currentTime)} (${formatSeconds(v.currentTime)}) / ${formatTime(v.duration)} (${formatSeconds(v.duration)})`
        : '0:00 (0s) / 0:00 (--s)';
    }
  }

  function seekVideoFromRange(rangeEl) {
    const v = el.vContent.querySelector('video');
    if (!v || !v.duration || !rangeEl) return;
    v.currentTime = (parseInt(rangeEl.value, 10) / 1000) * v.duration;
    updatePlaybackControls(v);
  }

  function toggleVideoPlayback() {
    const v = el.vContent.querySelector('video');
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
    updatePlaybackControls(v);
  }

  // ─── HUD ──────────────────────────────────────────────────────────────────
  function updateHUD(it) {
    const total = vs.items.length;
    const plus = vs.done ? '' : '+';
    el.vHudLeft.textContent =
      `${vs.idx + 1} / ${total}${plus}  ·  ${it.platform || '?'}  ·  ` +
      `${(it.channel && it.channel !== 'unknown') ? it.channel : '—'}`;
    el.vHudRight.textContent = it.duration ? String(it.duration) : '';
    // Reset progress bar
    if (el.vProgressFill) el.vProgressFill.style.width = '0%';
    if (el.vProgressHandle) el.vProgressHandle.style.left = '0%';
    // Show progress bar alleen bij video
    if (el.vProgressBar) el.vProgressBar.style.display = it.type === 'video' ? '' : 'none';
    if (el.vBottomControls) el.vBottomControls.classList.toggle('hidden', it.type !== 'video');
    updatePlaybackControls(null);
  }

  function showHUD() {
    el.vHudLeft.classList.remove('hud-hidden');
    el.vHudRight.classList.remove('hud-hidden');
    el.vStage.classList.remove('hud-hidden');
    // Topbar mee tonen
    const topbar = document.querySelector('.viewer-topbar');
    if (topbar) {
      topbar.style.opacity = '';
      topbar.style.pointerEvents = '';
    }
    clearTimeout(vs.hudTimer);
    vs.hudTimer = setTimeout(hideHUD, 3000);
  }

  function hideHUD() {
    el.vHudLeft.classList.add('hud-hidden');
    el.vHudRight.classList.add('hud-hidden');
    el.vStage.classList.add('hud-hidden');
    // Topbar mee verbergen
    const topbar = document.querySelector('.viewer-topbar');
    if (topbar) {
      topbar.style.opacity = '0';
      topbar.style.pointerEvents = 'none';
    }
  }

  // ─── Slideshow ────────────────────────────────────────────────────────────
  function startSlideshow() {
    vs.slideshow = true;
    updateSlideshowBtn();
    scheduleSlideshowTick();
  }

  function stopSlideshow() {
    vs.slideshow = false;
    if (vs.slideshowTimer) { clearTimeout(vs.slideshowTimer); vs.slideshowTimer = null; }
    updateSlideshowBtn();
  }

  function scheduleSlideshowTick() {
    if (!vs.slideshow) return;
    const v = el.vContent.querySelector('video');
    // Als video-wait aan EN video nog bezig → wacht op 'ended' event (gebonden in showCurrent)
    if (v && vs.videoWait && !v.ended && !v.paused) return;
    vs.slideshowTimer = setTimeout(slideshowTick, vs.slideshowSec * 1000);
  }

  async function slideshowTick() {
    if (!vs.slideshow) return;
    await navNext();
    scheduleSlideshowTick();
  }

  function updateSlideshowBtn() {
    el.vSlideshow.textContent = vs.slideshow ? '⏸ Dia' : '▶︎ Dia';
    el.vSlideshow.classList.toggle('active', vs.slideshow);
  }

  // ─── Sidebar ──────────────────────────────────────────────────────────────
  function renderSidebarList() {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < vs.items.length; i++) {
      const it = vs.items[i];
      const div = document.createElement('div');
      div.className = 'vsidebar-item' + (i === vs.idx ? ' active' : '');
      div.dataset.i = String(i);
      const thumb = `/thumb/${it.id}?v=${it.is_thumb_ready ? 1 : 0}`;
      const title = (it.title || it.filename || '(untitled)').replace(/</g, '&lt;').slice(0, 64);
      div.innerHTML = `<img class="vsidebar-thumb" src="${thumb}" loading="lazy" alt=""><span class="vsidebar-label">${title}</span>`;
      div.addEventListener('click', () => navTo(i));
      frag.appendChild(div);
    }
    el.vList.innerHTML = '';
    el.vList.appendChild(frag);
  }

  function updateSidebarActive() {
    el.vList.querySelectorAll('.vsidebar-item').forEach((row, i) => {
      row.classList.toggle('active', i === vs.idx);
    });
  }

  function scrollListToActive() {
    const active = el.vList.querySelector('.vsidebar-item.active');
    if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function toggleSidebar(force) {
    vs.sidebarOpen = force !== undefined ? force : !vs.sidebarOpen;
    // Oude: viewer--no-sidebar (grid), Nieuwe: viewer--sidebar-open (overlay)
    el.viewer.classList.toggle('viewer--sidebar-open', vs.sidebarOpen);
    el.viewer.classList.remove('viewer--no-sidebar'); // cleanup oude klasse
    // Backdrop wordt nu via CSS getoggeld door viewer--sidebar-open
  }

  function syncTopbarButtons() {
    if (el.vSlideshow2) {
      el.vSlideshow2.textContent = vs.slideshow ? '⏸ Dia' : '▶ Dia';
      el.vSlideshow2.classList.toggle('active', vs.slideshow);
    }
    if (el.vRandom2) {
      el.vRandom2.textContent = vs.random ? '🔀 Aan' : '🔀 Rand';
      el.vRandom2.classList.toggle('active', vs.random);
    }
  }

  // ─── Tags ─────────────────────────────────────────────────────────────────
  function safeText(value) {
    return String(value || '');
  }

  async function loadTags() {
    try {
      const data = await api('/api/tags');
      vs.availableTags = data.tags || [];
      // Tag-filter select vullen
      const sel = el.vTagFilter;
      sel.innerHTML = '<option value="">Alle tags</option>';
      for (const t of vs.availableTags) {
        const o = document.createElement('option');
        o.value = String(t.id);
        o.textContent = t.uses ? `${t.name} (${t.uses})` : t.name;
        sel.appendChild(o);
      }
    } catch (e) {
      console.warn('tags load failed', e);
    }
  }

  async function loadItemTags(itemId) {
    try {
      const data = await api(`/api/items/${itemId}/tags`);
      vs.currentItemTags = data.tags || [];
    } catch (_) {
      vs.currentItemTags = [];
    }
  }

  async function openTagDialog() {
    const it = vs.items[vs.idx];
    if (!it) return;
    await loadTags();
    await loadItemTags(it.rating_id || it.id);
    if (el.vTagSearch) el.vTagSearch.value = '';
    renderTagDialog();
    el.vTagDialog.classList.remove('hidden');
  }

  function closeTagDialog() {
    if (el.vTagDialog) el.vTagDialog.classList.add('hidden');
  }

  function renderTagDialog() {
    const it = vs.items[vs.idx];
    if (!it) return;
    const itemId = it.rating_id || it.id;
    const currentIds = new Set(vs.currentItemTags.map(t => Number(t.id)));

    if (el.vTagCurrent) {
      el.vTagCurrent.innerHTML = '';
      if (!vs.currentItemTags.length) {
        const empty = document.createElement('span');
        empty.className = 'tag-empty';
        empty.textContent = 'Geen tags op dit item';
        el.vTagCurrent.appendChild(empty);
      } else {
        for (const t of vs.currentItemTags) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'tag-chip tag-chip-current';

          const name = document.createElement('span');
          name.textContent = `#${safeText(t.name)}`;
          const remove = document.createElement('span');
          remove.className = 'tag-chip-remove';
          remove.textContent = '×';
          chip.append(name, remove);

          chip.addEventListener('click', async () => {
            try {
              await api(`/api/items/${itemId}/tags/${t.id}`, { method: 'DELETE' });
              await loadItemTags(itemId);
              renderTagDialog();
            } catch (err) { log('Tag fout: ' + err.message); }
          });

          el.vTagCurrent.appendChild(chip);
        }
      }
    }

    const q = (el.vTagSearch?.value || '').trim().toLowerCase();
    const candidates = vs.availableTags
      .filter(t => !currentIds.has(Number(t.id)))
      .filter(t => !q || safeText(t.name).toLowerCase().includes(q))
      .slice(0, 120);

    el.vTagList.innerHTML = '';
    if (!candidates.length) {
      const empty = document.createElement('div');
      empty.className = 'tag-empty tag-empty-row';
      empty.textContent = q ? 'Geen bestaande tags gevonden' : 'Geen andere tags beschikbaar';
      el.vTagList.appendChild(empty);
      return;
    }

    for (const t of candidates) {
      const row = document.createElement('div');
      row.className = 'tag-row';
      const name = document.createElement('span');
      name.className = 'tag-name';
      name.textContent = `#${safeText(t.name)}`;

      const uses = document.createElement('span');
      uses.className = 'tag-uses';
      uses.textContent = t.uses ? `${t.uses}×` : '';

      const add = document.createElement('button');
      add.className = 'tag-toggle';
      add.type = 'button';
      add.title = 'Tag aan huidig item toevoegen';
      add.textContent = '+';

      const del = document.createElement('button');
      del.className = 'tag-del';
      del.type = 'button';
      del.title = 'Tag globaal verwijderen';
      del.textContent = '🗑';

      row.append(name, uses, add, del);

      add.addEventListener('click', async () => {
        try {
          await api(`/api/items/${itemId}/tags`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag_id: t.id }),
          });
          await loadItemTags(itemId);
          renderTagDialog();
        } catch (err) { log('Tag fout: ' + err.message); }
      });

      del.addEventListener('click', async () => {
        if (!confirm(`Tag "${t.name}" globaal verwijderen?`)) return;
        try {
          await api(`/api/tags/${t.id}`, { method: 'DELETE' });
          await loadTags();
          await loadItemTags(itemId);
          renderTagDialog();
        } catch (err) { log('Tag del fout: ' + err.message); }
      });

      el.vTagList.appendChild(row);
    }
  }

  // ─── Log ──────────────────────────────────────────────────────────────────
  function log(msg) {
    const ts = new Date().toLocaleTimeString();
    el.vLogBody.textContent = `[${ts}] ${msg}\n` + el.vLogBody.textContent;
  }

  // ─── Afspeelsnelheid ─────────────────────────────────────────────────────
  const SPEED_STEPS = [-2, -1, -0.5, 0.25, 0.5, 1, 1.5, 2, 3, 4];

  function changeSpeed(dir) {
    const cur = vs.playbackRate;
    let idx = SPEED_STEPS.indexOf(cur);
    if (idx === -1) {
      // Zoek dichtstbijzijnde
      idx = SPEED_STEPS.findIndex(s => s >= cur);
      if (idx === -1) idx = SPEED_STEPS.length - 1;
    }
    idx = Math.max(0, Math.min(SPEED_STEPS.length - 1, idx + dir));
    setSpeed(SPEED_STEPS[idx]);
  }

  function resetSpeed() { setSpeed(1); }

  function setSpeed(rate) {
    vs.playbackRate = rate;
    const v = el.vContent.querySelector('video');

    if (rate <= 0) {
      // Achteruit: zet video op pause, start RAF-loop
      if (v) { v.pause(); v.playbackRate = 1; }
      startReverse(Math.abs(rate) || 1);
    } else {
      // Vooruit: stop eventuele reverse loop
      stopReverse();
      if (v) { v.playbackRate = rate; if (v.paused) v.play(); }
    }
    updateSpeedIndicator();
    log(`Snelheid: ${rate > 0 ? rate + '×' : rate + '× (achteruit)'}`);
  }

  function startReverse(speed) {
    stopReverse();
    vs.reverseLastT = performance.now();
    function tick(now) {
      const v = el.vContent.querySelector('video');
      if (!v || vs.playbackRate > 0) { stopReverse(); return; }
      const dt = (now - vs.reverseLastT) / 1000;
      vs.reverseLastT = now;
      v.currentTime = Math.max(0, v.currentTime - dt * speed);
      if (v.currentTime <= 0) { stopReverse(); return; }
      vs.reverseRAF = requestAnimationFrame(tick);
    }
    vs.reverseRAF = requestAnimationFrame(tick);
  }

  function stopReverse() {
    if (vs.reverseRAF) { cancelAnimationFrame(vs.reverseRAF); vs.reverseRAF = null; }
  }

  function updateSpeedIndicator() {
    let ind = document.getElementById('vSpeedIndicator');
    if (!ind) {
      ind = document.createElement('span');
      ind.id = 'vSpeedIndicator';
      ind.style.cssText = 'font-size:11px; font-weight:700; padding:3px 8px; border-radius:4px; margin-left:4px; cursor:pointer; user-select:none; transition:all .2s;';
      ind.title = 'Klik om te resetten. [ = langzamer, ] = sneller';
      ind.addEventListener('click', () => resetSpeed());
      // Voeg toe naast de slideshow-knop in topbar center
      const center = document.querySelector('.vtop-center');
      if (center) center.appendChild(ind);
    }
    const r = vs.playbackRate;
    if (r === 1) {
      ind.textContent = '1×';
      ind.style.background = 'rgba(255,255,255,.08)';
      ind.style.color = 'rgba(255,255,255,.4)';
    } else {
      ind.textContent = (r > 0 ? '' : '') + r + '×';
      ind.style.background = r < 0 ? 'rgba(255,80,80,.25)' : 'rgba(80,200,255,.2)';
      ind.style.color = r < 0 ? '#ff8080' : '#80d0ff';
    }
  }

  // ─── Loop sectie ─────────────────────────────────────────────────────────
  function setLoopPoint(which) {
    const v = el.vContent.querySelector('video');
    if (!v || !v.duration) return;

    if (which === 'start') {
      vs.loopStart = v.currentTime;
      log(`Loop start: ${fmtTime(vs.loopStart)}`);
    } else {
      vs.loopEnd = v.currentTime;
      log(`Loop einde: ${fmtTime(vs.loopEnd)}`);
    }

    // Zorg dat start < end
    if (vs.loopStart != null && vs.loopEnd != null && vs.loopStart > vs.loopEnd) {
      [vs.loopStart, vs.loopEnd] = [vs.loopEnd, vs.loopStart];
    }

    updateLoopOverlay();
  }

  function clearLoop() {
    vs.loopStart = null;
    vs.loopEnd = null;
    updateLoopOverlay();
    log('Loop gewist');
  }

  function updateLoopOverlay() {
    let ov = document.getElementById('vLoopOverlay');
    if (!ov && el.vProgressBar) {
      ov = document.createElement('div');
      ov.id = 'vLoopOverlay';
      ov.style.cssText = 'position:absolute; bottom:8px; height:4px; background:rgba(80,200,255,.35); pointer-events:none; z-index:5; border-radius:2px; transition:all .2s;';
      el.vProgressBar.appendChild(ov);
    }
    if (!ov) return;

    const v = el.vContent.querySelector('video');
    if (!v || !v.duration || vs.loopStart == null || vs.loopEnd == null) {
      ov.style.display = 'none';
      return;
    }
    const left = (vs.loopStart / v.duration) * 100;
    const width = ((vs.loopEnd - vs.loopStart) / v.duration) * 100;
    ov.style.display = '';
    ov.style.left = left + '%';
    ov.style.width = width + '%';
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function toggleLog() {
    vs.logOpen = !vs.logOpen;
    el.vLogPanel.classList.toggle('hidden', !vs.logOpen);
    el.vBtnLog.classList.toggle('active', vs.logOpen);
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────────
  function bindKeyboard() {
    window.addEventListener('keydown', async (e) => {
      if (!vs.open) return;
      const tag = (e.target.tagName || '').toUpperCase();
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;

      switch (e.key) {
        case 'Escape':
          if (!el.vTagDialog.classList.contains('hidden')) closeTagDialog();
          else if (vs.logOpen) toggleLog();
          else close();
          e.preventDefault();
          break;
        case 'ArrowRight': await navNext(); e.preventDefault(); break;
        case 'ArrowLeft':  await navPrev(); e.preventDefault(); break;
        case 'ArrowUp':    await navChannel(-1); e.preventDefault(); break;
        case 'ArrowDown':  await navChannel(1);  e.preventDefault(); break;
        case ' ': {
          const v = el.vContent.querySelector('video');
          if (v) { v.paused ? v.play() : v.pause(); e.preventDefault(); }
          break;
        }
        case 'm': case 'M': {
          const v = el.vContent.querySelector('video');
          vs.muted = !vs.muted;
          if (v) v.muted = vs.muted;
          el.vBtnMute.textContent = vs.muted ? '🔇' : '🔊';
          e.preventDefault();
          break;
        }
        case 's': case 'S':
          toggleSidebar();
          e.preventDefault();
          break;
        case 'l': case 'L':
          toggleLog();
          e.preventDefault();
          break;
        case '[': changeSpeed(-1); e.preventDefault(); break;
        case ']': changeSpeed(1);  e.preventDefault(); break;
        case '\\': resetSpeed();   e.preventDefault(); break;
        case 'i': case 'I': setLoopPoint('start'); e.preventDefault(); break;
        case 'o': case 'O': setLoopPoint('end');   e.preventDefault(); break;
        case 'p': case 'P': clearLoop();            e.preventDefault(); break;
        default:
          if (/^[0-9]$/.test(e.key)) {
            const r = (10 - parseInt(e.key, 10)) / 2; // 0→5.0, 9→0.5
            await setRating(r);
            e.preventDefault();
          }
      }
    }, { capture: true });
  }

  // ─── Zoom (exact als oude viewer: attachZoomHandlers) ──────────────────────
  function applyTransform() {
    const mediaEl = vs.currentMediaEl || el.vContent.querySelector('video, img');
    if (mediaEl) {
      const transforms = [];
      if (vs.scale > 1) {
        transforms.push('scale(' + vs.scale + ')');
        transforms.push('translate(' + vs.panX + 'px, ' + vs.panY + 'px)');
      }
      mediaEl.style.transform = transforms.join(' ');
      mediaEl.classList.toggle('zoomed', vs.scale > 1);
      if (vs.scale <= 1) mediaEl.classList.remove('dragging');
    }
    syncZoomUi();
  }

  function syncZoomUi() {
    if (el.vZoomRange) el.vZoomRange.value = String(Math.round(vs.scale * 100));
    if (el.vZoomReset) el.vZoomReset.disabled = vs.scale <= 1;
  }

  function setZoom(z) {
    vs.scale = Math.max(1, Math.min(6, z));
    vs.zoomed = vs.scale > 1;
    if (!vs.zoomed) { vs.panX = 0; vs.panY = 0; }
    el.vStage.classList.toggle('zoomed', vs.zoomed);
    applyTransform();
  }

  function resetZoom() {
    vs.zoomed = false;
    vs.scale = 1;
    vs.panX = 0;
    vs.panY = 0;
    vs.dragging = false;
    vs.dragStart = null;
    el.vStage.classList.remove('zoomed');
    const mediaEl = vs.currentMediaEl || el.vContent.querySelector('video, img');
    if (mediaEl) {
      mediaEl.style.transform = '';
      mediaEl.classList.remove('zoomed', 'dragging');
    }
    syncZoomUi();
  }

  // ─── Muis (exact als oude viewer: attachZoomHandlers) ──────────────────────
  function attachZoomHandlers(mediaEl) {
    if (!mediaEl) return;
    mediaEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(vs.scale + delta);
    }, { passive: false });

    mediaEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || vs.scale <= 1) return;
      e.stopPropagation();
      vs.dragging = true;
      vs.dragMoved = false;
      vs.dragStart = { x: e.clientX, y: e.clientY, panX: vs.panX, panY: vs.panY };
      mediaEl.classList.add('dragging');
      e.preventDefault();
    });

    mediaEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (vs.dragMoved) { vs.dragMoved = false; return; }
      if (mediaEl.tagName === 'VIDEO') {
        mediaEl.paused ? mediaEl.play() : mediaEl.pause();
        return;
      }
      if (vs.scale > 1) resetZoom();
      else setZoom(2);
    });
  }

  function bindMouse() {
    // Klik op viewer overlay (buiten stage) → sluit
    el.viewer.addEventListener('click', (e) => {
      if (e.target === el.viewer) close();
    });

    // Scroll wheel op content → ALTIJD zoom in/uit (exact als oude viewer!)
    el.vContent.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(vs.scale + delta);
    }, { passive: false });

    // Klik op content:
    // - Video: play/pause
    // - Afbeelding: toggle zoom (2x of reset)
    // Scroll wheel zoomt altijd (voor beide)
    el.vContent.addEventListener('click', (e) => {
      if (el.vPrev.contains(e.target) || el.vNext.contains(e.target)) return;
      if (el.vHudLeft.contains(e.target) || el.vHudRight.contains(e.target)) return;
      if (el.vProgressBar && el.vProgressBar.contains(e.target)) return;
      if (vs.dragMoved) { vs.dragMoved = false; return; }

      const v = el.vContent.querySelector('video');
      if (v) {
        // Video: play/pause
        v.paused ? v.play() : v.pause();
      } else {
        // Afbeelding: toggle zoom
        if (vs.scale > 1) resetZoom();
        else setZoom(2);
      }
    });

    // Dubbelklik blokkeren (exact als oude viewer)
    el.vContent.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });

    // Mousedown op content: start drag als ingezoomd (exact als oude viewer)
    el.vContent.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (vs.scale <= 1) return;
      vs.dragging = true;
      vs.dragMoved = false;
      vs.dragStart = { x: e.clientX, y: e.clientY, panX: vs.panX, panY: vs.panY };
      const mediaEl = vs.currentMediaEl || el.vContent.querySelector('video, img');
      if (mediaEl) mediaEl.classList.add('dragging');
      e.preventDefault();
    });

    // Mousemove: als dragging → pan (exact als oude viewer)
    window.addEventListener('mousemove', (e) => {
      if (!vs.dragging || !vs.dragStart) return;
      const dx = e.clientX - vs.dragStart.x;
      const dy = e.clientY - vs.dragStart.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) vs.dragMoved = true;
      vs.panX = vs.dragStart.panX + dx;
      vs.panY = vs.dragStart.panY + dy;
      applyTransform();
    });

    // Mouseup: stop drag + muis-back-knop
    window.addEventListener('mouseup', (e) => {
      if (!vs.open) return;
      vs.dragging = false;
      vs.dragStart = null;
      const mediaEl = vs.currentMediaEl || el.vContent.querySelector('video, img');
      if (mediaEl) mediaEl.classList.remove('dragging');

      // Muis-back-knop (button 3) → sluit viewer
      if (e.button === 3) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });

    // Browser back (popstate) → sluit viewer
    window.addEventListener('popstate', (e) => {
      if (vs.open) {
        close(true); // skipHistory=true want we zijn al terug
      }
    });

    // Muisbeweging → HUD tonen
    el.vStage.addEventListener('mousemove', () => showHUD());

    // Progress bar klik → seek
    if (el.vProgressBar) {
      el.vProgressBar.addEventListener('click', (e) => {
        e.stopPropagation(); // niet triggeren play/pause
        const v = el.vContent.querySelector('video');
        if (!v || !v.duration) return;
        const rect = el.vProgressBar.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        v.currentTime = pct * v.duration;
      });
    }

    // Rating rechterklik → wissen
    el.vNowRating.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      setRating(null);
    });

    // Sidebar backdrop → sluit sidebar (mobiel)
    el.vSidebarBackdrop.addEventListener('click', () => toggleSidebar(false));

    // Tag dialog: klik buiten → sluit
    document.addEventListener('click', (e) => {
      if (
        !el.vTagDialog.classList.contains('hidden') &&
        !el.vTagDialog.contains(e.target) &&
        e.target !== el.vBtnTags
      ) {
        closeTagDialog();
      }
    });
  }

  // ─── Controls binding ─────────────────────────────────────────────────────
  function bindControls() {
    el.vClose.addEventListener('click', close);
    el.vPrev.addEventListener('click', (e) => { e.stopPropagation(); navPrev(); });
    el.vNext.addEventListener('click', (e) => { e.stopPropagation(); navNext(); });
    el.vBtnSidebar.addEventListener('click', () => toggleSidebar());
    el.vNowRating.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.rating-star-btn') : null;
      if (!btn || !el.vNowRating.contains(btn)) return;
      e.stopPropagation();
      const idx = Number(btn.dataset.index);
      if (!Number.isFinite(idx)) return;
      const rect = btn.getBoundingClientRect();
      const half = (e.clientX - rect.left) < rect.width / 2;
      const current = vs.items[vs.idx] ? vs.items[vs.idx].rating : null;
      let val = half ? idx - 0.5 : idx;
      if (Number(current) === val) val = null;
      setRating(val);
    });
    el.vRatingSelect.addEventListener('change', () => {
      const raw = el.vRatingSelect.value;
      const val = raw === '' ? null : Number(raw);
      setRating(Number.isFinite(val) ? val : null);
    });

    el.vBtnOpen.addEventListener('click', () => {
      const it = vs.items[vs.idx];
      if (it && it.source_url) window.open(it.source_url, '_blank', 'noopener');
      else if (it && it.url)   window.open(it.url, '_blank', 'noopener');
    });

    el.vBtnFinder.addEventListener('click', async () => {
      const it = vs.items[vs.idx];
      if (!it) return;
      try {
        await api('/api/finder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: it.id }),
        });
        log('Finder geopend');
      } catch (e) { log('Finder fout: ' + e.message); }
    });

    el.vBtnMute.addEventListener('click', () => {
      const v = el.vContent.querySelector('video');
      vs.muted = !vs.muted;
      if (v) v.muted = vs.muted;
      el.vBtnMute.textContent = vs.muted ? '🔇' : '🔊';
    });

    if (el.vBtnPlayPause) {
      el.vBtnPlayPause.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleVideoPlayback();
      });
    }

    el.vVol.addEventListener('input', () => {
      vs.vol = parseFloat(el.vVol.value);
      const v = el.vContent.querySelector('video');
      if (v) v.volume = vs.vol;
    });

    el.vSeek.addEventListener('mousedown', () => { vs.seekDragging = true; });
    el.vSeek.addEventListener('mouseup', () => {
      vs.seekDragging = false;
      seekVideoFromRange(el.vSeek);
    });
    el.vSeek.addEventListener('touchend', () => {
      vs.seekDragging = false;
      seekVideoFromRange(el.vSeek);
    });
    el.vSlideshow.addEventListener('click', () => {
      if (vs.slideshow) stopSlideshow(); else startSlideshow();
    });

    el.vSlideshowSec.addEventListener('change', () => {
      vs.slideshowSec = Number(el.vSlideshowSec.value);
    });

    el.vWrap.addEventListener('click', () => {
      vs.wrap = !vs.wrap;
      el.vWrap.textContent = `🔁 Wrap: ${vs.wrap ? 'aan' : 'uit'}`;
      el.vWrap.classList.toggle('active', vs.wrap);
    });

    el.vRandom.addEventListener('click', () => {
      vs.random = !vs.random;
      el.vRandom.textContent = `🔀 Rand: ${vs.random ? 'aan' : 'uit'}`;
      el.vRandom.classList.toggle('active', vs.random);
    });

    el.vVideoWait.addEventListener('click', () => {
      vs.videoWait = !vs.videoWait;
      el.vVideoWait.textContent = `⏳ Wacht: ${vs.videoWait ? 'aan' : 'uit'}`;
      el.vVideoWait.classList.toggle('active', vs.videoWait);
    });

    if (el.vZoomRange) {
      el.vZoomRange.addEventListener('input', () => {
        setZoom(Number(el.vZoomRange.value || '100') / 100);
      });
    }
    if (el.vZoomReset) {
      el.vZoomReset.addEventListener('click', () => resetZoom());
      el.vZoomReset.disabled = true;
    }

    // Topbar slideshow/random knoppen (spiegelen sidebar)
    if (el.vSlideshow2) {
      el.vSlideshow2.addEventListener('click', () => {
        if (vs.slideshow) stopSlideshow(); else startSlideshow();
        syncTopbarButtons();
      });
    }
    if (el.vRandom2) {
      el.vRandom2.addEventListener('click', () => {
        vs.random = !vs.random;
        el.vRandom.textContent = `🔀 Rand: ${vs.random ? 'aan' : 'uit'}`;
        el.vRandom.classList.toggle('active', vs.random);
        syncTopbarButtons();
      });
    }

    el.vReload.addEventListener('click', reloadViewerItems);

    el.vMode.addEventListener('change', async () => {
      if (el.vMode.value === 'channel' && !vs.channels.length) {
        try {
          const gf = gal().state.filters;
          const data = await api(`/api/channels${gf.platform ? '?platform=' + encodeURIComponent(gf.platform) : ''}`);
          vs.channels = (data.channels || []).filter(c => c.channel && c.channel !== 'unknown');
          vs.chIdx = 0;
        } catch (e) { log('Kanalen laden mislukt: ' + e.message); }
      }
    });

    el.vFilter.addEventListener('change', async () => {
      vs.typeFilter = el.vFilter.value;
      await reloadViewerItems();
    });

    el.vTagFilter.addEventListener('change', async () => {
      await reloadViewerItems();
    });

    // Tags dialog
    el.vBtnTags.addEventListener('click', (e) => { e.stopPropagation(); openTagDialog(); });
    el.vBtnCloseTagDialog.addEventListener('click', closeTagDialog);
    if (el.vTagSearch) el.vTagSearch.addEventListener('input', renderTagDialog);

    el.vBtnAddTag.addEventListener('click', async () => {
      const name = el.vNewTagInput.value.trim();
      if (!name) return;
      const it = vs.items[vs.idx];
      if (!it) return;
      try {
        const result = await api('/api/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const itemId = it.rating_id || it.id;
        await api(`/api/items/${itemId}/tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag_id: result.tag.id }),
        });
        el.vNewTagInput.value = '';
        await loadTags();
        await loadItemTags(itemId);
        renderTagDialog();
        log(`Tag toegevoegd: ${name}`);
      } catch (e) { log('Tag add fout: ' + e.message); }
    });

    el.vNewTagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.vBtnAddTag.click();
    });

    el.vBtnLog.addEventListener('click', toggleLog);
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  window.__viewer = { init, open, close };

  // Auto-init zodra DOM klaar is (app.js laadt viewer.js na zichzelf)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
