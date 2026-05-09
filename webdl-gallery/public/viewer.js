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
    nextCursor: null,
    done: false,
    loading: false,
    typeFilter: 'all',    // 'all' | 'video' | 'image'
    queryFilters: null,

    // Slideshow
    slideshow: false,
    slideshowTimer: null,
    slideshowSec: 4,
    wrap: false,
    random: false,
    videoWait: true,
    channelScope: 'query', // 'query' | 'all'

    // UI
    sidebarOpen: false,
    logOpen: false,
    hudTimer: null,

    // Tags
    availableTags: [],
    currentItemTags: [],
    tagRecipes: [],
    tagSuggestions: [],
    recipeDraftTagIds: [],
    editingRecipeId: null,
    tagTarget: 'media',
    lastTagOpenAt: 0,

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
    mediaReloadNonce: 0,
    mediaResetSeq: 0,
    mediaSeq: 0,
    hudMessageTimer: null,
    forceTranscodeIds: new Set(),

    // Zoom (exact als oude viewer)
    zoomed: false,
    scale: 1,
    panX: 0,
    panY: 0,
    rotation: 0,
    lastRotateAt: 0,
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
  let navChain = Promise.resolve();

  // Uniek per tabblad — voorkomt dat de browser requests van verschillende tabs samenvoegt
  const VIEWER_TAB_ID = Math.random().toString(36).slice(2, 8);
  const VIEWER_POS_KEY = 'webdl:viewer:last-position';
  const VIEWER_SPEED_KEY = 'webdl:viewer:playback-rate';

  async function api(url, opts) {
    const sep = url.includes('?') ? '&' : '?';
    const r = await fetch(url + sep + '_t=' + VIEWER_TAB_ID, opts);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  function mediaRotationKey(it) {
    return `webdl:media-rotation:${String((it && it.id) || '')}`;
  }

  function sourceSummaryParts(it) {
    const platform = String(it && it.platform || '').trim();
    const sourceSite = String(it && it.source_site || '').trim();
    const sameSource = window.__wdGallery && typeof window.__wdGallery.shouldShowSourceSite === 'function'
      ? !window.__wdGallery.shouldShowSourceSite(platform, sourceSite)
      : sourceSite === platform;
    const parts = [
      platform,
      sourceSite && !sameSource ? `via ${sourceSite}` : '',
      it && it.channel && it.channel !== 'unknown' ? it.channel : '',
    ].filter(Boolean);
    if (it && Array.isArray(it.content_sites) && it.content_sites.length) {
      parts.push(`inhoud: ${it.content_sites.slice(0, 3).join(', ')}`);
    }
    if (it && it.source_thread_title && it.source_thread_title !== it.channel) {
      parts.push(it.source_thread_title);
    }
    if (it && sourceModelTitle(it)) {
      parts.push(`set/model ${sourceModelTitle(it)}`);
    } else if (it && (it.source_post_num || it.source_post_id || it.source_post_title)) {
      const postLabel = it.source_post_num || it.source_post_id || '';
      const postTitle = it.source_post_title ? ` · ${it.source_post_title}` : '';
      parts.push(postLabel ? `post ${postLabel}${postTitle}` : it.source_post_title);
    }
    return parts;
  }

  function sourceLinkForItem(it) {
    return String((it && (it.source_post_url || it.source_url || it.url)) || '').trim();
  }

  function sourceThreadKey(it) {
    if (!it) return '';
    return String(it.source_thread_url || it.source_thread_id || it.source_thread_title || '').trim().toLowerCase();
  }

  function sourcePostKey(it) {
    if (!it) return '';
    return String(it.source_post_num || it.source_post_id || it.source_post_url || it.source_post_title || '').trim().toLowerCase();
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

  function sourceModelKey(it) {
    if (!it) return '';
    const explicit = String(it.source_model_key || '').trim().toLowerCase();
    if (explicit) return explicit;
    const title = sourceModelTitle(it);
    if (title) {
      return title
        .trim()
        .toLowerCase()
        .replace(/[\s._-]+/g, '-')
        .replace(/[^a-z0-9-]+/g, '')
        .replace(/^-+|-+$/g, '');
    }
    return sourcePostKey(it);
  }

  function loadMediaRotation(it) {
    try {
      const value = Number(localStorage.getItem(mediaRotationKey(it)) || 0);
      return Number.isFinite(value) ? ((Math.round(value / 90) * 90) % 360 + 360) % 360 : 0;
    } catch (_) {
      return 0;
    }
  }

  function saveMediaRotation(it, degrees) {
    try {
      const normalized = ((Math.round(Number(degrees || 0) / 90) * 90) % 360 + 360) % 360;
      const key = mediaRotationKey(it);
      if (normalized === 0) localStorage.removeItem(key);
      else localStorage.setItem(key, String(normalized));
    } catch (_) {}
  }

  function syncRotationUi() {
    for (const btn of [el.vBtnRotate, el.vBtnRotateStage]) {
      if (!btn) continue;
      const degrees = Number(vs.rotation || 0);
      btn.textContent = degrees ? `↻ ${degrees}°` : '↻ +90°';
      btn.title = degrees ? `Rotatie: ${degrees}° (klik voor +90°)` : 'Media 90° draaien';
      btn.dataset.rotation = String(degrees);
      btn.classList.toggle('active', Boolean(vs.rotation));
    }
    if (el.vBtnRotateBottom) {
      const degrees = Number(vs.rotation || 0);
      el.vBtnRotateBottom.textContent = '⟳';
      el.vBtnRotateBottom.title = degrees ? `Rotatie: ${degrees}° (klik voor +90°)` : 'Media 90° draaien';
      el.vBtnRotateBottom.dataset.rotation = String(degrees);
      el.vBtnRotateBottom.classList.toggle('active', Boolean(vs.rotation));
    }
  }

  function thumbUrl(it, retry = 0) {
    const params = new URLSearchParams();
    params.set('v', it && it.is_thumb_ready ? '1' : '0');
    if (retry) params.set('retry', String(retry));
    return `/thumb/${encodeURIComponent(String(it.id))}?${params.toString()}`;
  }

  function snapshotGalleryFilters() {
    const filters = { ...(gal().state.filters || {}) };
    return {
      platform: filters.platform || '',
      channel: filters.channel || '',
      q: filters.q || '',
      sort: filters.sort || 'recent',
      channel_sort: filters.channel_sort || 'count',
      min_rating: filters.min_rating || '',
      media_type: filters.media_type || '',
      tag_id: el.vTagFilter ? el.vTagFilter.value || '' : '',
    };
  }

  function viewerFilters() {
    return vs.queryFilters || snapshotGalleryFilters();
  }

  function appendContextParams(params, { includeChannel = true } = {}) {
    const filters = viewerFilters();
    if (filters.platform) params.set('platform', filters.platform);
    if (includeChannel && filters.channel) params.set('channel', filters.channel);
    if (filters.q) params.set('q', filters.q);
    if (filters.min_rating) params.set('min_rating', filters.min_rating);
    if (filters.tag_id) params.set('tag_id', filters.tag_id);
    const type = vs.typeFilter && vs.typeFilter !== 'all' ? vs.typeFilter : filters.media_type;
    if (type) params.set('media_type', type);
    return params;
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init() {
    const ids = [
      'viewer','vSidebar','vSidebarBackdrop','vList',
      'vMode','vFilter','vTagFilter','vReload',
      'vSlideshow','vSlideshowSec','vWrap','vRandom','vVideoWait','vChannelScope',
      'vNowTitle','vNowSub','vNowRating',
      'vRatingSelect',
      'vBtnSidebar','vBtnOpen','vBtnFinder','vBtnRotate',
      'vZoomRange','vZoomReset',
      'vVol','vBtnMute','vBtnReloadMedia','vSeek',
      'vBtnReverse','vSpeedSelect','vSpeedDown','vSpeedUp',
      'vBtnMuteBottom','vBottomVol','vBtnFullscreen',
      'vBtnTags','vBtnLog','vClose',
      'vSlideshow2','vRandom2',
      'vStage','vContent','vPrev','vNext','vUp','vDown','vHudLeft','vHudRight',
      'vProgressBar','vProgressFill','vProgressHandle',
      'vBottomControls','vBtnPlayPause','vTimeLabel','vBtnRotateBottom','vBtnRotateStage',
      'vTagDialog','vTagCurrent','vTagTargetMedia','vTagTargetRecipe','vTagQuick','vTagRecipes','vTagSuggestions','vRecipeName','vRecipeDescription',
      'vRecipeDraft','vBtnRecipeFromItem','vBtnSaveRecipe','vBtnClearRecipe',
      'vTagSearch','vTagList','vNewTagInput','vBtnAddTag','vBtnCloseTagDialog',
      'vLogPanel','vLogBody',
    ];
    for (const id of ids) {
      el[id] = $(id);
      if (!el[id]) console.warn(`viewer: element #${id} niet gevonden`);
    }
    window.__wdOpenTags = openTagsFromEvent;
    bindControls();
    bindKeyboard();
    bindMouse();
    restorePlaybackRate();
    syncViewerModeControls();
    loadTags();
  }

  function restorePlaybackRate() {
    try {
      const stored = Number(localStorage.getItem(VIEWER_SPEED_KEY) || '1');
      if (SPEED_STEPS.includes(stored)) vs.playbackRate = stored;
    } catch (_) {}
  }

  function rememberCurrentPosition() {
    const it = vs.items[vs.idx];
    if (!it) return;
    try {
      localStorage.setItem(VIEWER_POS_KEY, JSON.stringify({
        id: String(it.id),
        idx: vs.idx,
        filters: viewerFilters(),
        at: Date.now(),
      }));
    } catch (_) {}
  }

  function syncViewerModeControls() {
    if (el.vWrap) {
      el.vWrap.textContent = vs.wrap ? '🔁 Query loop' : '∞ Oneindig';
      el.vWrap.title = vs.wrap
        ? 'Aan het einde terug naar het begin van de huidige query'
        : 'Aan het einde verder laden uit de database';
      el.vWrap.classList.toggle('active', vs.wrap);
    }
    if (el.vRandom) {
      el.vRandom.textContent = `🔀 Rand: ${vs.random ? 'aan' : 'uit'}`;
      el.vRandom.classList.toggle('active', vs.random);
    }
    if (el.vVideoWait) {
      el.vVideoWait.textContent = `⏳ Wacht: ${vs.videoWait ? 'aan' : 'uit'}`;
      el.vVideoWait.classList.toggle('active', vs.videoWait);
    }
    if (el.vChannelScope) {
      const all = vs.channelScope === 'all';
      el.vChannelScope.textContent = all ? '↕ Kanaal: alles' : '↕ Kanaal: query';
      el.vChannelScope.title = all
        ? 'Als een item geen postgegevens heeft, zoekt omhoog/omlaag buiten de huidige query naar volgend kanaal/model'
        : 'Als een item geen postgegevens heeft, zoekt omhoog/omlaag binnen de huidige query naar volgend kanaal/model';
      el.vChannelScope.classList.toggle('active', all);
    }
  }

  // ─── Open / sluit ─────────────────────────────────────────────────────────
  function open(idx) {
    // Kopieer gallery items als startpunt
    const gState = gal().state;
    vs.queryFilters = snapshotGalleryFilters();
    vs.typeFilter = vs.queryFilters.media_type || (el.vFilter ? el.vFilter.value : 'all') || 'all';
    if (el.vFilter) el.vFilter.value = vs.typeFilter;
    vs.channels = [];
    vs.chIdx = 0;
    vs.items  = [...gState.items];
    vs.offset = gState.offset;
    vs.nextCursor = gState.nextCursor || null;
    vs.done   = Boolean(gState.done && !vs.nextCursor);
    vs.idx    = Math.max(0, Math.min(idx, vs.items.length - 1));
    vs.open   = true;

    el.viewer.classList.remove('hidden');
    el.viewer.classList.toggle('viewer--sidebar-open', vs.sidebarOpen);
    el.viewer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (gal().setViewerActive) gal().setViewerActive(true);

    // Push history state zodat browser-back (en muis-back-knop) de viewer sluit
    history.pushState({ page: 'viewer' }, '', location.href);

    renderSidebarList();
    showCurrent();
    showHUD();
  }

  function close(skipHistory) {
    if (!vs.open) return;
    const anchorId = vs.items[vs.idx] ? String(vs.items[vs.idx].id) : '';
    rememberCurrentPosition();
    vs.open = false;
    stopSlideshow();
    cleanupMedia();
    closeTagDialog({ force: true });
    if (vs.logOpen) toggleLog();

    el.viewer.classList.add('hidden');
    el.viewer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    vs.idx = -1;
    if (gal().setViewerActive) gal().setViewerActive(false);
    if (anchorId && gal().restoreViewerAnchor) {
      gal().restoreViewerAnchor(anchorId).catch(() => {});
    }

    // Pop de viewer history entry (tenzij we al via popstate kwamen)
    if (!skipHistory) {
      try { history.back(); } catch (_) {}
    }
  }

  // ─── Huidige item tonen ────────────────────────────────────────────────────
  function mediaUrl(it) {
    const params = new URLSearchParams();
    if (vs.mediaReloadNonce) params.set('reload', String(vs.mediaReloadNonce));
    if (it && it.type === 'video') {
      const ext = String(it.ext || it.format || '').toLowerCase();
      const nativeVideo = ext === 'mp4' || ext === 'webm' || ext === 'ogv';
      if (!nativeVideo) params.set('play', '1');
      if (vs.forceTranscodeIds.has(String(it.id))) params.set('transcode', '1');
    }
    return `/media/${encodeURIComponent(String(it.id))}${params.toString() ? '?' + params.toString() : ''}`;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function reloadCurrentMedia() {
    if (!vs.open || !vs.items[vs.idx]) return;
    const seq = ++vs.mediaResetSeq;
    const activeIdx = vs.idx;
    vs.mediaReloadNonce = Date.now();
    cleanupMedia();
    if (el.vProgressBar) el.vProgressBar.style.display = 'none';
    if (el.vBottomControls) el.vBottomControls.classList.add('hidden');
    if (el.vContent) {
      el.vContent.innerHTML = '<div class="media-reset-note">Speler wordt opnieuw opgebouwd...</div>';
    }
    await wait(350);
    if (!vs.open || seq !== vs.mediaResetSeq || activeIdx !== vs.idx) return;
    showCurrent();
    showHUD();
    log('Speler opnieuw opgebouwd');
  }

  async function rebuildCurrentMedia({ reason = '', quiet = false } = {}) {
    if (!vs.open || !vs.items[vs.idx]) return;
    const seq = ++vs.mediaResetSeq;
    const activeIdx = vs.idx;
    vs.mediaReloadNonce = Date.now();
    cleanupMedia();
    if (!quiet) {
      if (el.vProgressBar) el.vProgressBar.style.display = 'none';
      if (el.vBottomControls) el.vBottomControls.classList.add('hidden');
      if (el.vContent) {
        el.vContent.innerHTML = '<div class="media-reset-note">Speler wordt opnieuw opgebouwd...</div>';
      }
    }
    await wait(quiet ? 180 : 350);
    if (!vs.open || seq !== vs.mediaResetSeq || activeIdx !== vs.idx) return;
    showCurrent({ autoRecovered: true });
    showHUD();
    if (reason) log(reason);
  }

  function showVideoFallback(videoEl, it) {
    if (!videoEl || videoEl.dataset.fallbackShown === '1') return;
    videoEl.dataset.fallbackShown = '1';
    stopReverse();

    const img = document.createElement('img');
    img.src = thumbUrl(it, Date.now());
    img.alt = it.title || '';
    img.classList.add('zoom-media');
    img.style.transition = 'transform 120ms ease-out';
    img.onerror = () => { img.classList.add('media-fallback-empty'); };

    videoEl.replaceWith(img);
    vs.currentMediaEl = img;
    attachZoomHandlers(img);
    applyTransform();

    el.vVol.disabled = true;
    el.vSeek.disabled = true;
    el.vSeek.value = '0';
    if (el.vBottomControls) el.vBottomControls.classList.add('hidden');
    if (el.vProgressBar) el.vProgressBar.style.display = 'none';
    updatePlaybackControls(null);

    const note = document.createElement('div');
    note.className = 'media-error-note';
    note.innerHTML = `
      <span>Video niet afspeelbaar · preview getoond</span>
      <button type="button" class="media-error-action">Opnieuw laden</button>
    `;
    note.querySelector('.media-error-action').addEventListener('click', (e) => {
      e.stopPropagation();
      reloadCurrentMedia().catch((err) => log('Reload fout: ' + err.message));
    });
    el.vContent.appendChild(note);
  }

  function showCurrent(opts = {}) {
    const it = vs.items[vs.idx];
    if (!it) { close(); return; }

    cleanupMedia();
    const mediaSeq = ++vs.mediaSeq;
    resetZoom(); // Reset zoom bij elk nieuw item (exact als oude viewer)
    vs.rotation = loadMediaRotation(it);
    syncRotationUi();

    let mediaEl;
    if (it.type === 'video') {
      mediaEl = document.createElement('video');
      mediaEl.preload = 'auto';
      mediaEl.playsinline = true;
      mediaEl.muted = true;                  // altijd muted starten (browser autoplay policy)
      mediaEl.volume = vs.vol;
      mediaEl.poster = thumbUrl(it);        // thumbnail terwijl video laadt
      mediaEl.dataset.autoRecoveries = opts.autoRecovered ? '1' : '0';
      try { mediaEl.setAttribute('controlsList', 'noremoteplayback nodownload'); } catch (_) {}
      try { mediaEl.disablePictureInPicture = true; } catch (_) {}

      // Start altijd muted; zet de gewenste mute-status pas terug nadat play() gelukt is.
      mediaEl.addEventListener('loadedmetadata', () => {
        if (mediaSeq !== vs.mediaSeq || mediaEl !== vs.currentMediaEl) return;
        el.vBtnMute.textContent = vs.muted ? '🔇' : '🔊';
      });

      mediaEl.addEventListener('timeupdate', () => {
        if (mediaSeq !== vs.mediaSeq || mediaEl !== vs.currentMediaEl) return;
        syncVideoProgress(mediaEl);
      });
      mediaEl.addEventListener('loadedmetadata', () => syncVideoProgress(mediaEl));
      mediaEl.addEventListener('play', () => syncVideoProgress(mediaEl));
      mediaEl.addEventListener('pause', () => syncVideoProgress(mediaEl));
      mediaEl.addEventListener('ended', () => {
        if (mediaSeq !== vs.mediaSeq || mediaEl !== vs.currentMediaEl) return;
        stopReverse();
        updatePlaybackControls(mediaEl);
        if (vs.slideshow && vs.videoWait) slideshowTick();
      });

      // Pas opgeslagen snelheid toe
      mediaEl.addEventListener('loadedmetadata', () => {
        if (mediaSeq !== vs.mediaSeq || mediaEl !== vs.currentMediaEl) return;
        if (vs.playbackRate > 0) mediaEl.playbackRate = vs.playbackRate;
      });
      mediaEl.addEventListener('loadeddata', () => {
        if (mediaSeq !== vs.mediaSeq || mediaEl !== vs.currentMediaEl) return;
        const p = mediaEl.play();
        if (p && typeof p.catch === 'function') {
          p.then(() => {
            if (mediaSeq !== vs.mediaSeq || mediaEl !== vs.currentMediaEl) return;
            mediaEl.muted = vs.muted;
            el.vBtnMute.textContent = vs.muted ? '🔇' : '🔊';
          }).catch(() => updatePlaybackControls(mediaEl));
        }
      }, { once: true });
      mediaEl.addEventListener('error', () => {
        if (mediaSeq !== vs.mediaSeq || mediaEl !== vs.currentMediaEl) return;
        if (!vs.forceTranscodeIds.has(String(it.id))) {
          vs.forceTranscodeIds.add(String(it.id));
          rebuildCurrentMedia({ reason: 'Compatibele videostream geprobeerd', quiet: true })
            .catch((err) => log('Video-herstel fout: ' + err.message));
          return;
        }
        const recoveries = Number(mediaEl.dataset.autoRecoveries || 0);
        if (recoveries < 1) {
          mediaEl.dataset.autoRecoveries = String(recoveries + 1);
          rebuildCurrentMedia({ reason: 'Video-load automatisch hersteld', quiet: true })
            .catch((err) => log('Auto-herstel fout: ' + err.message));
          return;
        }
        showVideoFallback(mediaEl, it);
      });

      el.vVol.disabled  = false;
      el.vSeek.disabled = false;
      if (el.vBottomControls) el.vBottomControls.classList.remove('hidden');
    } else {
      mediaEl = document.createElement('img');
      mediaEl.src = mediaUrl(it);
      mediaEl.alt = it.title || '';
      mediaEl.onerror = () => { mediaEl.src = thumbUrl(it, Date.now()); };

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
    if (it.type === 'video') {
      mediaEl.src = mediaUrl(it);
      mediaEl.load();
    }
    applyTransform();
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
    el.vNowSub.textContent = sourceSummaryParts(it).join(' · ');

    // Rating, HUD, sidebar active
    updateRatingDisplay(it.rating);
    updateHUD(it);
    updateSidebarActive();
    scrollListToActive();
    rememberCurrentPosition();

    // Tags prefetch
    loadItemTags(it.rating_id || it.id).catch(() => {});
  }

  function cleanupMedia() {
    stopReverse();
    vs.mediaSeq += 1;
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
    if (vs.loading || vs.done) return false;
    vs.loading = true;
    try {
      const sort = viewerFilters().sort || 'recent';
      const params = new URLSearchParams({
        limit: '100',
        sort,
      });
      if (sort === 'recent' && vs.nextCursor) {
        params.set('cursor_ts', vs.nextCursor.sort_ts);
        params.set('cursor_order', vs.nextCursor.source_order);
      } else {
        params.set('offset', String(vs.offset));
      }
      appendContextParams(params);

      const data = await api('/api/items?' + params.toString());
      if (data.items && data.items.length > 0) {
        const seen = new Set(vs.items.map((it) => String(it.id)));
        const fresh = data.items.filter((it) => !seen.has(String(it.id)));
        vs.items.push(...fresh);
        vs.offset += data.items.length;
        vs.nextCursor = data.next_cursor || null;
        if (sort === 'recent') {
          vs.done = !vs.nextCursor;
        } else if (data.items.length < 100) {
          vs.done = true;
        }
        renderSidebarList();
        vs.loading = false;
        return fresh.length > 0 || (!vs.done && Boolean(vs.nextCursor));
      } else {
        vs.done = true;
      }
    } catch (e) {
      log('Laden mislukt: ' + e.message);
    }
    vs.loading = false;
    return false;
  }

  async function navTo(idx) {
    if (idx < 0) {
      if (vs.wrap && vs.done) idx = vs.items.length - 1;
      else return;
    }
    if (idx >= vs.items.length) {
      let loaded = false;
      for (let i = 0; idx >= vs.items.length && !vs.done && i < 10; i++) {
        // Cursor-pagina's kunnen door live prepend/dedup een lege verse set
        // opleveren. Blijf dan doorvragen totdat de gevraagde index bestaat.
        loaded = await loadMoreViewerItems() || loaded;
      }
      if (idx >= vs.items.length) {
        if (loaded && idx < vs.items.length) {
          // Nieuwe items zijn beschikbaar; ga door naar de gevraagde index.
        } else if (vs.wrap && vs.done) idx = 0;
        else { stopSlideshow(); return; }
      }
    }
    vs.idx = idx;
    showCurrent();
  }

  function enqueueNavigation(action) {
    navChain = navChain.catch(() => {}).then(action);
    return navChain;
  }

  async function navNext() {
    return enqueueNavigation(async () => {
      let next;
      if (vs.random) {
        if (!vs.done && vs.items.length < 300) {
          await loadMoreViewerItems();
        }
        next = Math.floor(Math.random() * vs.items.length);
      } else {
        next = vs.idx + 1;
      }
      await navTo(next);
    });
  }

  async function navPrev() {
    return enqueueNavigation(async () => {
      await navTo(vs.idx - 1);
    });
  }

  async function navPost(dir) {
    return enqueueNavigation(async () => {
      const currentItem = vs.items[vs.idx] || null;
      const currentThreadKey = sourceThreadKey(currentItem);
      const currentModelKey = sourceModelKey(currentItem);
      if (!currentThreadKey || !currentModelKey) {
        await navChannel(dir);
        return;
      }

      async function findLoadedModel(startIdx) {
        for (let i = startIdx; i >= 0 && i < vs.items.length; i += dir) {
          const it = vs.items[i];
          if (sourceThreadKey(it) !== currentThreadKey) continue;
          const modelKey = sourceModelKey(it);
          if (modelKey && modelKey !== currentModelKey) return i;
        }
        return -1;
      }

      let nextIdx = await findLoadedModel(vs.idx + dir);
      if (nextIdx >= 0) {
        await navTo(nextIdx);
        return;
      }

      if (dir > 0) {
        for (let tries = 0; tries < 10 && !vs.done; tries++) {
          const beforeLen = vs.items.length;
          const loaded = await loadMoreViewerItems();
          if (!loaded && vs.items.length === beforeLen) break;
          nextIdx = await findLoadedModel(Math.max(beforeLen, vs.idx + 1));
          if (nextIdx >= 0) {
            await navTo(nextIdx);
            return;
          }
        }
      }

      showHudMessage(dir > 0 ? 'Geen volgend model/set in thread' : 'Geen vorig model/set in thread');
    });
  }

  async function navChannel(dir) {
    const currentItem = vs.items[vs.idx] || null;
    const channelKey = (it) => [
      String((it && it.platform) || ''),
      String((it && it.channel) || ''),
    ].join('\u0001');
    const currentItemKey = channelKey(currentItem);
    if (currentItem && currentItemKey !== '\u0001') {
      for (let i = vs.idx + dir; i >= 0 && i < vs.items.length; i += dir) {
        if (channelKey(vs.items[i]) !== currentItemKey) {
          await navTo(i);
          return;
        }
      }
      if (dir > 0) {
        for (let tries = 0; tries < 5 && !vs.done; tries++) {
          const beforeLen = vs.items.length;
          const loaded = await loadMoreViewerItems();
          if (!loaded && vs.items.length === beforeLen) break;
          for (let i = Math.max(vs.idx + 1, beforeLen); i < vs.items.length; i++) {
            if (channelKey(vs.items[i]) !== currentItemKey) {
              await navTo(i);
              return;
            }
          }
        }
      }
    }
    const sameChannel = (c, channel, platform) =>
      c && c.channel === channel && (!platform || !c.platform || c.platform === platform);

    async function loadChannelList(scope) {
      const params = scope === 'all'
        ? new URLSearchParams()
        : appendContextParams(new URLSearchParams(), { includeChannel: false });
      params.set('sort', viewerFilters().sort || 'recent');
      params.set('channel_sort', viewerFilters().channel_sort || 'count');
      const data = await api('/api/channels' + (params.toString() ? '?' + params.toString() : ''));
      return (data.channels || []).filter(c => c.channel && c.channel !== 'unknown');
    }

    function pickNextChannel(channels) {
      if (!channels.length) return null;
      const currentChannel = (currentItem && currentItem.channel) || viewerFilters().channel || '';
      const currentPlatform = (currentItem && currentItem.platform) || viewerFilters().platform || '';
      const currentIdx = channels.findIndex(c => sameChannel(c, currentChannel, currentPlatform));
      const baseIdx = currentIdx >= 0 ? currentIdx : 0;
      for (let step = 1; step <= channels.length; step++) {
        const idx = ((baseIdx + (dir * step)) + channels.length) % channels.length;
        const ch = channels[idx];
        if (ch && !sameChannel(ch, currentChannel, currentPlatform)) {
          vs.chIdx = idx;
          return ch;
        }
      }
      return null;
    }

    try {
      if (!vs.channels.length) vs.channels = await loadChannelList(vs.channelScope);
    } catch (e) {
      showHudMessage('Kanalen laden mislukt');
      log('Kanalen laden mislukt: ' + e.message);
      return;
    }

    let ch = pickNextChannel(vs.channels);
    if (!ch && vs.channelScope === 'query') {
      try {
        vs.channelScope = 'all';
        vs.channels = await loadChannelList('all');
        syncViewerModeControls();
        showHudMessage('Geen volgende in query, nu alles');
        ch = pickNextChannel(vs.channels);
      } catch (e) {
        showHudMessage('Kanalen laden mislukt');
        log('Kanalen laden mislukt: ' + e.message);
        return;
      }
    }
    if (!ch) {
      showHudMessage(dir > 0 ? 'Geen volgend kanaal/model' : 'Geen vorig kanaal/model');
      return;
    }

    if (vs.channelScope === 'all') {
      vs.queryFilters = {
        platform: ch.platform || '',
        channel: ch.channel,
        q: '',
        sort: viewerFilters().sort || 'recent',
        min_rating: '',
        media_type: vs.typeFilter && vs.typeFilter !== 'all' ? vs.typeFilter : '',
        tag_id: '',
      };
    } else {
      if (!vs.queryFilters) vs.queryFilters = snapshotGalleryFilters();
      vs.queryFilters.channel = ch.channel;
      if (ch.platform) vs.queryFilters.platform = ch.platform;
    }
    await reloadViewerItems();
  }

  async function reloadViewerItems({ preserveSelection = false } = {}) {
    if (!vs.queryFilters) vs.queryFilters = snapshotGalleryFilters();
    const currentId = preserveSelection && vs.items[vs.idx] ? String(vs.items[vs.idx].id) : '';
    vs.items = [];
    vs.offset = 0;
    vs.nextCursor = null;
    vs.done = false;
    vs.idx = 0;
    await loadMoreViewerItems();
    if (currentId) {
      const nextIdx = vs.items.findIndex((it) => String(it.id) === currentId);
      if (nextIdx >= 0) vs.idx = nextIdx;
    }
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
    if (el.vSpeedSelect) el.vSpeedSelect.value = String(vs.playbackRate > 0 ? vs.playbackRate : 1);
    if (el.vBtnReverse) el.vBtnReverse.classList.toggle('active', vs.playbackRate < 0);
    if (el.vBtnMuteBottom) el.vBtnMuteBottom.textContent = vs.muted ? '🔇' : '🔊';
    if (el.vBottomVol && String(el.vBottomVol.value) !== String(vs.vol)) el.vBottomVol.value = String(vs.vol);
    if (el.vTimeLabel) {
      el.vTimeLabel.textContent = v
        ? `${formatTime(v.currentTime)} / ${formatTime(v.duration)}`
        : '0:00 / 0:00';
      el.vTimeLabel.title = v
        ? `${formatTime(v.currentTime)} (${formatSeconds(v.currentTime)}) / ${formatTime(v.duration)} (${formatSeconds(v.duration)})`
        : '';
    }
  }

  function syncVideoProgress(video, opts = {}) {
    const v = video || el.vContent.querySelector('video');
    const checkLoop = opts.checkLoop !== false;
    if (!v) {
      updatePlaybackControls(null);
      return;
    }
    if (
      checkLoop &&
      vs.loopStart != null &&
      vs.loopEnd != null &&
      v.currentTime >= vs.loopEnd
    ) {
      v.currentTime = vs.loopStart;
    }
    if (!vs.seekDragging && Number.isFinite(v.duration) && v.duration > 0) {
      const pct = Math.max(0, Math.min(100, (v.currentTime / v.duration) * 100));
      el.vSeek.value = String(Math.round(pct * 10));
      el.vSeek.style.setProperty('--vseek-progress', pct + '%');
      if (el.vProgressFill) el.vProgressFill.style.width = pct + '%';
      if (el.vProgressHandle) el.vProgressHandle.style.left = pct + '%';
    }
    updatePlaybackControls(v);
  }

  function seekVideoFromRange(rangeEl) {
    const v = el.vContent.querySelector('video');
    if (!v || !v.duration || !rangeEl) return;
    v.currentTime = (parseInt(rangeEl.value, 10) / 1000) * v.duration;
    syncVideoProgress(v);
  }

  function seekRelative(seconds) {
    const v = el.vContent.querySelector('video');
    if (!v || !Number.isFinite(v.duration)) return;
    const delta = Number(seconds) || 0;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
    syncVideoProgress(v);
    showHudMessage(`${delta > 0 ? '+' : ''}${delta}s`, 900);
  }

  function toggleVideoPlayback() {
    const v = el.vContent.querySelector('video');
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
    updatePlaybackControls(v);
  }

  function toggleFullscreen() {
    const target = el.vStage || el.viewer || document.documentElement;
    if (!document.fullscreenElement) {
      const p = target.requestFullscreen && target.requestFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else if (document.exitFullscreen) {
      const p = document.exitFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
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
    if (el.vSeek) el.vSeek.style.setProperty('--vseek-progress', '0%');
    // Show progress bar alleen bij video
    if (el.vProgressBar) el.vProgressBar.style.display = it.type === 'video' ? '' : 'none';
    if (el.vBottomControls) el.vBottomControls.classList.toggle('hidden', it.type !== 'video');
    if (el.vStage) el.vStage.classList.toggle('viewer-stage--video', it.type === 'video');
    if (el.vBtnReloadMedia) el.vBtnReloadMedia.disabled = !it || (it.type !== 'video' && it.type !== 'image');
    updatePlaybackControls(null);
  }

  function showHudMessage(message, timeout = 1800) {
    if (!message || !el.vHudRight) return;
    el.vHudRight.textContent = message;
    showHUD();
    clearTimeout(vs.hudMessageTimer);
    vs.hudMessageTimer = setTimeout(() => {
      if (vs.items[vs.idx]) updateHUD(vs.items[vs.idx]);
    }, timeout);
  }

  function showHUD() {
    el.vHudLeft.classList.remove('hud-hidden');
    el.vHudRight.classList.remove('hud-hidden');
    el.vStage.classList.remove('hud-hidden');
    if (el.viewer) el.viewer.classList.remove('viewer--hud-hidden');
    clearTimeout(vs.hudTimer);
    vs.hudTimer = setTimeout(hideHUD, 3000);
  }

  function hideHUD() {
    if (el.vTagDialog && !el.vTagDialog.classList.contains('hidden')) return;
    const topbar = document.querySelector('.viewer-topbar');
    if (topbar && (topbar.matches(':hover') || topbar.contains(document.activeElement))) {
      clearTimeout(vs.hudTimer);
      vs.hudTimer = setTimeout(hideHUD, 1200);
      return;
    }
    el.vHudLeft.classList.add('hud-hidden');
    el.vHudRight.classList.add('hud-hidden');
    el.vStage.classList.add('hud-hidden');
    if (el.viewer) el.viewer.classList.add('viewer--hud-hidden');
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
      const title = (it.title || it.filename || '(untitled)').replace(/</g, '&lt;').slice(0, 64);
      div.innerHTML = `<img class="vsidebar-thumb" src="${thumbUrl(it)}" loading="eager" decoding="async" alt=""><span class="vsidebar-label">${title}</span>`;
      const img = div.querySelector('img');
      img.addEventListener('error', () => {
        const tries = Number(img.dataset.retry || '0');
        if (tries >= 2) return;
        img.dataset.retry = String(tries + 1);
        setTimeout(() => { img.src = thumbUrl(it, Date.now()); }, 700 * (tries + 1));
      });
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

  function userTagUses(tag) {
    return Number(tag && (tag.user_use_count ?? tag.uses) || 0);
  }

  function sortUserTags(a, b) {
    const favDelta = Number(Boolean(b.is_favorite)) - Number(Boolean(a.is_favorite));
    if (favDelta) return favDelta;
    const useDelta = userTagUses(b) - userTagUses(a);
    if (useDelta) return useDelta;
    const bLast = Date.parse(b.last_used_at || '') || 0;
    const aLast = Date.parse(a.last_used_at || '') || 0;
    if (bLast !== aLast) return bLast - aLast;
    return safeText(a.name).localeCompare(safeText(b.name));
  }

  function sortTagsByName(a, b) {
    return safeText(a && a.name).localeCompare(safeText(b && b.name));
  }

  function syncTagTargetControls() {
    const target = vs.tagTarget === 'recipe' ? 'recipe' : 'media';
    if (el.vTagTargetMedia) el.vTagTargetMedia.classList.toggle('active', target === 'media');
    if (el.vTagTargetRecipe) el.vTagTargetRecipe.classList.toggle('active', target === 'recipe');
    if (el.vBtnAddTag) {
      el.vBtnAddTag.textContent = target === 'recipe' ? '+ Maak + naar recept' : '+ Maak + naar media';
    }
  }

  function setTagTarget(target) {
    vs.tagTarget = target === 'recipe' ? 'recipe' : 'media';
    syncTagTargetControls();
    renderTagDialog();
  }

  async function addTagToMedia(itemId, tag) {
    await api(`/api/items/${itemId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_id: tag.id }),
    });
    await loadItemTags(itemId);
    await loadTags();
  }

  async function applyPickedTag(itemId, tag) {
    if (vs.tagTarget === 'recipe') {
      addTagToRecipeDraft(tag);
      return;
    }
    if ((vs.currentItemTags || []).some((t) => Number(t.id) === Number(tag.id))) {
      renderTagDialog();
      return;
    }
    await addTagToMedia(itemId, tag);
    renderTagDialog();
  }

  async function toggleTagFavorite(tag) {
    await api(`/api/tags/${tag.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_favorite: !tag.is_favorite }),
    });
  }

  async function loadTags() {
    try {
      const data = await api('/api/tags');
      vs.availableTags = (data.tags || []).sort(sortUserTags);
      // Tag-filter select vullen
      const sel = el.vTagFilter;
      sel.innerHTML = '<option value="">Alle tags</option>';
      for (const t of vs.availableTags) {
        const o = document.createElement('option');
        o.value = String(t.id);
        const prefix = t.is_favorite ? '★ ' : '';
        const useCount = userTagUses(t);
        o.textContent = useCount ? `${prefix}${t.name} (${useCount})` : `${prefix}${t.name}`;
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

  async function loadTagRecipes() {
    try {
      const data = await api('/api/tag-recipes');
      vs.tagRecipes = data.recipes || [];
    } catch (e) {
      vs.tagRecipes = [];
      console.warn('tag recipes load failed', e);
    }
  }

  async function loadTagSuggestions(itemId) {
    try {
      const data = await api(`/api/items/${itemId}/tag-suggestions`);
      vs.tagSuggestions = data.suggestions || [];
    } catch (e) {
      vs.tagSuggestions = [];
      console.warn('tag suggestions load failed', e);
    }
  }

  function allKnownTagsById() {
    const tags = new Map();
    for (const t of vs.availableTags || []) tags.set(Number(t.id), t);
    for (const t of vs.currentItemTags || []) tags.set(Number(t.id), t);
    for (const r of vs.tagRecipes || []) {
      for (const t of r.tags || []) tags.set(Number(t.id), t);
    }
    for (const t of vs.tagSuggestions || []) tags.set(Number(t.id), t);
    return tags;
  }

  function addTagToRecipeDraft(tag) {
    const id = Number(tag && tag.id);
    if (!Number.isFinite(id) || vs.recipeDraftTagIds.includes(id)) return;
    vs.recipeDraftTagIds.push(id);
    renderRecipeDraft();
  }

  function setRecipeDraft(tags, recipe = null) {
    vs.recipeDraftTagIds = [];
    for (const t of tags || []) {
      const id = Number(t && t.id);
      if (Number.isFinite(id) && !vs.recipeDraftTagIds.includes(id)) vs.recipeDraftTagIds.push(id);
    }
    vs.editingRecipeId = recipe ? Number(recipe.id) : null;
    if (el.vRecipeName) el.vRecipeName.value = recipe ? safeText(recipe.name) : '';
    if (el.vRecipeDescription) el.vRecipeDescription.value = recipe ? safeText(recipe.description) : '';
    renderRecipeDraft();
  }

  function renderRecipeDraft() {
    if (!el.vRecipeDraft) return;
    const tags = allKnownTagsById();
    el.vRecipeDraft.innerHTML = '';
    if (!vs.recipeDraftTagIds.length) {
      const empty = document.createElement('span');
      empty.className = 'tag-empty';
      empty.textContent = 'Nog geen tags in recept';
      el.vRecipeDraft.appendChild(empty);
      return;
    }
    for (const id of vs.recipeDraftTagIds) {
      const tag = tags.get(Number(id));
      if (!tag) continue;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip tag-chip-quick';
      chip.title = 'Uit recept halen';
      chip.textContent = `#${safeText(tag.name)} ×`;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        vs.recipeDraftTagIds = vs.recipeDraftTagIds.filter((tagId) => tagId !== Number(id));
        renderRecipeDraft();
      });
      el.vRecipeDraft.appendChild(chip);
    }
  }

  async function saveRecipeDraft() {
    const name = (el.vRecipeName && el.vRecipeName.value || '').trim();
    if (!name) {
      log('Recept heeft een naam nodig');
      return;
    }
    if (!vs.recipeDraftTagIds.length) {
      log('Recept heeft minimaal 1 tag nodig');
      return;
    }
    const body = {
      name,
      description: (el.vRecipeDescription && el.vRecipeDescription.value || '').trim(),
      tag_ids: vs.recipeDraftTagIds,
    };
    const url = vs.editingRecipeId ? `/api/tag-recipes/${vs.editingRecipeId}` : '/api/tag-recipes';
    const method = vs.editingRecipeId ? 'PATCH' : 'POST';
    await api(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await loadTagRecipes();
    renderTagDialog();
    log(`Recept opgeslagen: ${name}`);
  }

  async function openTagDialog() {
    const it = vs.items[vs.idx];
    el.vTagDialog.classList.remove('hidden');
    if (el.vTagSearch) el.vTagSearch.value = '';
    if (el.vTagCurrent) el.vTagCurrent.textContent = 'Tags laden...';
    if (el.vTagQuick) el.vTagQuick.textContent = '';
    if (el.vTagList) el.vTagList.textContent = '';
    if (!it) {
      if (el.vTagCurrent) el.vTagCurrent.textContent = 'Geen item geselecteerd';
      return;
    }
    syncTagTargetControls();
    vs.tagSuggestions = [];
    await Promise.all([
      loadTags(),
      loadItemTags(it.rating_id || it.id),
      loadTagRecipes(),
    ]);
    renderTagDialog();
    loadTagSuggestions(it.rating_id || it.id)
      .then(() => renderTagDialog())
      .catch((err) => console.warn('tag suggestions load failed', err));
  }

  function openTagsFromEvent(e) {
    if (e) {
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      try { e.stopImmediatePropagation(); } catch (_) {}
    }
    const now = Date.now();
    if (now - vs.lastTagOpenAt < 250) return false;
    vs.lastTagOpenAt = now;
    showHUD();
    openTagDialog().catch((err) => log('Tags openen mislukt: ' + err.message));
    return false;
  }

  function closeTagDialog(opts = {}) {
    if (!opts.force && Date.now() - vs.lastTagOpenAt < 2000) return;
    if (el.vTagDialog) el.vTagDialog.classList.add('hidden');
  }

  function renderTagDialog() {
    const it = vs.items[vs.idx];
    if (!it) return;
    syncTagTargetControls();
    const itemId = it.rating_id || it.id;
    const currentIds = new Set(vs.currentItemTags.map(t => Number(t.id)));
    const recipeDraftIds = new Set((vs.recipeDraftTagIds || []).map((id) => Number(id)));
    const tagState = (tag) => {
      const tagId = Number(tag && tag.id);
      return {
        tagId,
        isOnMedia: currentIds.has(tagId),
        isInRecipe: recipeDraftIds.has(tagId),
      };
    };
    const appendStateBadges = (parent, state) => {
      if (!state.isOnMedia && !state.isInRecipe) return;
      const badges = document.createElement('span');
      badges.className = 'tag-state-badges';
      if (state.isOnMedia) {
        const badge = document.createElement('span');
        badge.className = 'tag-state-badge';
        badge.textContent = 'Media';
        badges.appendChild(badge);
      }
      if (state.isInRecipe) {
        const badge = document.createElement('span');
        badge.className = 'tag-state-badge';
        badge.textContent = 'Recept';
        badges.appendChild(badge);
      }
      parent.appendChild(badges);
    };

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

          chip.addEventListener('click', async (e) => {
            e.stopPropagation();
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
    const quickTags = vs.availableTags
      .filter(t => t.is_favorite)
      .sort(sortTagsByName)
      .slice(0, 24);

    if (el.vTagQuick) {
      el.vTagQuick.innerHTML = '';
      if (!quickTags.length) {
        const empty = document.createElement('span');
        empty.className = 'tag-empty';
        empty.textContent = 'Nog geen favoriete tags';
        el.vTagQuick.appendChild(empty);
      } else {
        for (const t of quickTags) {
          const state = tagState(t);
          const selectedForTarget = vs.tagTarget === 'recipe' ? state.isInRecipe : state.isOnMedia;
          const item = document.createElement('span');
          item.className = 'tag-quick-item';

          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'tag-chip tag-chip-quick';
          chip.disabled = selectedForTarget;
          chip.title = selectedForTarget
            ? (vs.tagTarget === 'recipe' ? 'Staat al in recept' : 'Staat al op media')
            : (vs.tagTarget === 'recipe' ? 'Tag aan recept toevoegen' : 'Tag aan huidig item toevoegen');
          chip.textContent = `#${safeText(t.name)}`;
          appendStateBadges(chip, state);
          chip.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (chip.disabled) return;
            try {
              await applyPickedTag(itemId, t);
            } catch (err) { log('Tag fout: ' + err.message); }
          });

          const unstar = document.createElement('button');
          unstar.type = 'button';
          unstar.className = 'tag-quick-unstar';
          unstar.title = 'Uit favorieten halen';
          unstar.textContent = '★';
          unstar.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              await toggleTagFavorite(t);
              await loadTags();
              renderTagDialog();
            } catch (err) { log('Favoriet fout: ' + err.message); }
          });

          item.append(unstar, chip);
          el.vTagQuick.appendChild(item);
        }
      }
    }

    if (el.vTagRecipes) {
      el.vTagRecipes.innerHTML = '';
      if (!vs.tagRecipes.length) {
        const empty = document.createElement('span');
        empty.className = 'tag-empty';
        empty.textContent = 'Geen opgeslagen recepten';
        el.vTagRecipes.appendChild(empty);
      } else {
        for (const recipe of vs.tagRecipes.slice(0, 8)) {
          const row = document.createElement('div');
          row.className = 'tag-recipe';

          const main = document.createElement('div');
          main.className = 'tag-recipe-main';
          const name = document.createElement('div');
          name.className = 'tag-recipe-name';
          name.textContent = safeText(recipe.name);
          const desc = document.createElement('div');
          desc.className = 'tag-recipe-desc';
          desc.textContent = safeText(recipe.description) || `${(recipe.tags || []).length} tags`;
          const tags = document.createElement('div');
          tags.className = 'tag-recipe-tags';
          for (const t of (recipe.tags || []).slice(0, 8)) {
            const chip = document.createElement('span');
            chip.className = 'tag-mini-chip';
            chip.textContent = `#${safeText(t.name)}`;
            tags.appendChild(chip);
          }
          main.append(name, desc, tags);

          const apply = document.createElement('button');
          apply.type = 'button';
          apply.textContent = 'Media +';
          apply.title = 'Recept op dit item toepassen';
          apply.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              await api(`/api/items/${itemId}/tag-recipes/${recipe.id}`, { method: 'POST' });
              await loadTags();
              await loadItemTags(itemId);
              await loadTagRecipes();
              renderTagDialog();
              log(`Recept toegepast: ${recipe.name}`);
            } catch (err) { log('Recept fout: ' + err.message); }
          });

          const edit = document.createElement('button');
          edit.type = 'button';
          edit.textContent = 'Wijzig';
          edit.title = 'Recept in editor laden';
          edit.addEventListener('click', (e) => {
            e.stopPropagation();
            setRecipeDraft(recipe.tags || [], recipe);
          });

          const del = document.createElement('button');
          del.type = 'button';
          del.textContent = 'Wis';
          del.title = 'Recept verwijderen';
          del.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm(`Recept "${recipe.name}" verwijderen?`)) return;
            try {
              await api(`/api/tag-recipes/${recipe.id}`, { method: 'DELETE' });
              if (vs.editingRecipeId === Number(recipe.id)) setRecipeDraft([]);
              await loadTagRecipes();
              renderTagDialog();
            } catch (err) { log('Recept del fout: ' + err.message); }
          });

          row.append(main, apply, edit, del);
          el.vTagRecipes.appendChild(row);
        }
      }
    }

    if (el.vTagSuggestions) {
      el.vTagSuggestions.innerHTML = '';
      const suggestions = vs.tagSuggestions
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || sortTagsByName(a, b))
        .slice(0, 10);
      if (suggestions.length) {
        const label = document.createElement('div');
        label.className = 'tag-suggestion-label';
        label.textContent = 'Voorgestelde tags';
        el.vTagSuggestions.appendChild(label);
      }
      for (const t of suggestions) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tag-chip tag-chip-quick';
        chip.title = `${Number(t.uses || 0)} matches via bron-graph`;
        chip.textContent = `#${safeText(t.name)}`;
        chip.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await applyPickedTag(itemId, t);
          } catch (err) { log('Tag fout: ' + err.message); }
        });
        el.vTagSuggestions.appendChild(chip);
      }
    }

    renderRecipeDraft();

    const candidates = vs.availableTags
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
      const { tagId, isOnMedia, isInRecipe } = tagState(t);
      const addDisabled = vs.tagTarget === 'recipe' ? isInRecipe : isOnMedia;
      const row = document.createElement('div');
      row.className = 'tag-row';
      const name = document.createElement('span');
      name.className = 'tag-name';
      name.textContent = `#${safeText(t.name)}`;
      appendStateBadges(name, { tagId, isOnMedia, isInRecipe });

      const fav = document.createElement('button');
      fav.className = 'tag-fav' + (t.is_favorite ? ' active' : '');
      fav.type = 'button';
      fav.title = t.is_favorite ? 'Uit favorieten halen' : 'Als favoriete tag markeren';
      fav.textContent = t.is_favorite ? '★' : '☆';

      const uses = document.createElement('span');
      uses.className = 'tag-uses';
      uses.title = `${Number(t.applied_count || 0)}× toegepast`;
      uses.textContent = userTagUses(t) ? `${userTagUses(t)}×` : '';

      const add = document.createElement('button');
      add.className = 'tag-toggle';
      add.type = 'button';
      add.disabled = addDisabled;
      add.title = addDisabled
        ? (vs.tagTarget === 'recipe' ? 'Tag staat al in dit recept' : 'Tag staat al op dit item')
        : (vs.tagTarget === 'recipe' ? 'Tag aan recept toevoegen' : 'Tag aan huidig item toevoegen');
      add.textContent = addDisabled
        ? (vs.tagTarget === 'recipe' ? 'In recept' : 'Op media')
        : (vs.tagTarget === 'recipe' ? 'Recept +' : 'Media +');

      const del = document.createElement('button');
      del.className = 'tag-del';
      del.type = 'button';
      del.title = 'Tag globaal verwijderen';
      del.textContent = '🗑';

      row.append(fav, name, uses, add, del);

      fav.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await toggleTagFavorite(t);
          await loadTags();
          renderTagDialog();
        } catch (err) { log('Favoriet fout: ' + err.message); }
      });

      add.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (add.disabled) return;
        try {
          await applyPickedTag(itemId, t);
        } catch (err) { log('Tag fout: ' + err.message); }
      });

      del.addEventListener('click', async (e) => {
        e.stopPropagation();
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
  const FORWARD_SPEED_STEPS = [0.1, 0.25, 0.5, 1, 1.5, 2, 3, 4];
  const SPEED_STEPS = FORWARD_SPEED_STEPS;

  function changeSpeed(dir) {
    const cur = vs.playbackRate > 0 ? vs.playbackRate : 1;
    let idx = FORWARD_SPEED_STEPS.indexOf(cur);
    if (idx === -1) {
      idx = FORWARD_SPEED_STEPS.findIndex(s => s >= cur);
      if (idx === -1) idx = FORWARD_SPEED_STEPS.length - 1;
    }
    if (dir < 0 && idx <= 0) {
      setSpeed(-1);
      return;
    }
    idx = Math.max(0, Math.min(FORWARD_SPEED_STEPS.length - 1, idx + dir));
    setSpeed(FORWARD_SPEED_STEPS[idx]);
  }

  function resetSpeed() { setSpeed(1); }

  function setSpeed(rate) {
    rate = Number(rate);
    if (!Number.isFinite(rate) || rate === 0) rate = 1;
    vs.playbackRate = rate;
    if (rate > 0) {
      try { localStorage.setItem(VIEWER_SPEED_KEY, String(rate)); } catch (_) {}
    }
    const v = el.vContent.querySelector('video');

    if (rate <= 0) {
      if (v) {
        if (v.currentTime <= 0.15 && Number.isFinite(v.duration) && v.duration > 0) {
          v.currentTime = Math.max(0, v.duration - 0.05);
        }
        v.pause();
        v.playbackRate = 1;
      }
      startReverse(Math.abs(rate) || 1);
    } else {
      stopReverse();
      if (v) {
        v.playbackRate = rate;
        if (v.paused) {
          const p = v.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      }
    }
    updateSpeedIndicator();
    syncVideoProgress(v);
    showHudMessage(rate > 0 ? `Snelheid ${rate}x` : `Achteruit ${Math.abs(rate)}x`, 1100);
    log(`Snelheid: ${rate > 0 ? rate + '×' : rate + '× (achteruit)'}`);
  }

  function startReverse(speed) {
    stopReverse();
    const activeVideo = el.vContent.querySelector('video');
    if (!activeVideo) return;
    if (activeVideo.currentTime <= 0.15 && Number.isFinite(activeVideo.duration) && activeVideo.duration > 0) {
      activeVideo.currentTime = Math.max(0, activeVideo.duration - 0.05);
    }
    activeVideo.pause();
    activeVideo.playbackRate = 1;
    syncVideoProgress(activeVideo, { checkLoop: false });
    vs.reverseLastT = performance.now();
    function tick(now) {
      const v = el.vContent.querySelector('video');
      if (!v || vs.playbackRate > 0) { stopReverse(); return; }
      const dt = (now - vs.reverseLastT) / 1000;
      vs.reverseLastT = now;
      const step = Math.max(dt * speed, 1 / 120);
      v.currentTime = Math.max(0, v.currentTime - step);
      syncVideoProgress(v, { checkLoop: false });
      if (v.currentTime <= 0) {
        vs.playbackRate = 1;
        stopReverse();
        updateSpeedIndicator();
        syncVideoProgress(v, { checkLoop: false });
        showHudMessage('Begin video', 900);
        return;
      }
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
    if (el.vSpeedSelect) el.vSpeedSelect.value = String(r > 0 ? r : 1);
    if (el.vBtnReverse) el.vBtnReverse.classList.toggle('active', r < 0);
    if (el.vSpeedDown) el.vSpeedDown.classList.toggle('active', r > 0 && r < 1);
    if (el.vSpeedUp) el.vSpeedUp.classList.toggle('active', r > 1);
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
  function ratingFromNumberKey(e) {
    if (!e || !/^[0-9]$/.test(String(e.key || ''))) return null;
    return (10 - parseInt(e.key, 10)) / 2; // 0→5.0, 9→0.5
  }

  function bindKeyboard() {
    window.addEventListener('keydown', async (e) => {
      if (!vs.open) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target.tagName || '').toUpperCase();
      if (['INPUT', 'TEXTAREA'].includes(tag)) return;
      const numericRating = ratingFromNumberKey(e);
      if (numericRating != null) {
        await setRating(numericRating);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (tag === 'SELECT') return;

      switch (e.key) {
        case 'Escape':
          if (!el.vTagDialog.classList.contains('hidden')) closeTagDialog({ force: true });
          else if (vs.logOpen) toggleLog();
          else close();
          e.preventDefault();
          break;
        case 'ArrowRight': await navNext(); e.preventDefault(); break;
        case 'ArrowLeft':  await navPrev(); e.preventDefault(); break;
        case 'ArrowUp':    await navPost(-1); e.preventDefault(); break;
        case 'ArrowDown':  await navPost(1);  e.preventDefault(); break;
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
          if (el.vBtnMuteBottom) el.vBtnMuteBottom.textContent = vs.muted ? '🔇' : '🔊';
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
        case 't': case 'T':
          openTagsFromEvent(e);
          break;
        case '[': changeSpeed(-1); e.preventDefault(); break;
        case ']': changeSpeed(1);  e.preventDefault(); break;
        case '\\': resetSpeed();   e.preventDefault(); break;
        case 'i': case 'I': setLoopPoint('start'); e.preventDefault(); break;
        case 'o': case 'O': setLoopPoint('end');   e.preventDefault(); break;
        case 'p': case 'P': clearLoop();            e.preventDefault(); break;
      }
    }, { capture: true });
  }

  // ─── Zoom (exact als oude viewer: attachZoomHandlers) ──────────────────────
  function applyTransform() {
    const mediaEl = vs.currentMediaEl || el.vContent.querySelector('video, img');
    if (mediaEl) {
      const transforms = [];
      if (vs.rotation) transforms.push('rotate(' + vs.rotation + 'deg)');
      if (vs.scale > 1) {
        transforms.push('scale(' + vs.scale + ')');
        transforms.push('translate(' + vs.panX + 'px, ' + vs.panY + 'px)');
      }
      mediaEl.style.transform = transforms.join(' ');
      mediaEl.dataset.rotation = String(Number(vs.rotation || 0));
      mediaEl.classList.toggle('rotated', Boolean(vs.rotation));
      mediaEl.classList.toggle('zoomed', vs.scale > 1);
      if (vs.scale <= 1) mediaEl.classList.remove('dragging');
    }
    syncZoomUi();
    syncRotationUi();
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
      mediaEl.style.transform = vs.rotation ? 'rotate(' + vs.rotation + 'deg)' : '';
      mediaEl.dataset.rotation = String(Number(vs.rotation || 0));
      mediaEl.classList.toggle('rotated', Boolean(vs.rotation));
      mediaEl.classList.remove('zoomed', 'dragging');
    }
    syncZoomUi();
    syncRotationUi();
  }

  function rotateCurrentMedia() {
    const it = vs.items[vs.idx];
    if (!it) return;
    vs.rotation = (Number(vs.rotation || 0) + 90) % 360;
    saveMediaRotation(it, vs.rotation);
    applyTransform();
    showHUD();
    log(`Rotatie: ${vs.rotation || 0}°`);
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
      const clickedTagsButton = el.vBtnTags && (e.target === el.vBtnTags || el.vBtnTags.contains(e.target));
      if (clickedTagsButton || Date.now() - vs.lastTagOpenAt < 2000) return;
      if (
        !el.vTagDialog.classList.contains('hidden') &&
        !el.vTagDialog.contains(e.target)
      ) {
        closeTagDialog();
      }
    });
  }

  // ─── Controls binding ─────────────────────────────────────────────────────
  function bindControls() {
    const topbar = document.querySelector('.viewer-topbar');
    if (topbar) {
      for (const eventName of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick']) {
        topbar.addEventListener(eventName, (e) => {
          e.stopPropagation();
        });
      }
    }

    el.vClose.addEventListener('click', close);
    el.vPrev.addEventListener('click', (e) => { e.stopPropagation(); navPrev(); });
    el.vNext.addEventListener('click', (e) => { e.stopPropagation(); navNext(); });
    if (el.vUp) el.vUp.addEventListener('click', (e) => { e.stopPropagation(); navPost(-1); });
    if (el.vDown) el.vDown.addEventListener('click', (e) => { e.stopPropagation(); navPost(1); });
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
      const sourceUrl = sourceLinkForItem(it);
      if (sourceUrl) window.open(sourceUrl, '_blank', 'noopener');
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

    if (el.vBtnRotate) {
      el.vBtnRotate.addEventListener('click', (e) => {
        window.__wdRotateMedia(e);
      });
    }
    if (el.vBtnRotateBottom) {
      el.vBtnRotateBottom.addEventListener('click', (e) => {
        window.__wdRotateMedia(e);
      });
    }
    if (el.vBtnRotateStage) {
      el.vBtnRotateStage.addEventListener('click', (e) => {
        window.__wdRotateMedia(e);
      });
    }

    function toggleMute() {
      const v = el.vContent.querySelector('video');
      vs.muted = !vs.muted;
      if (v) v.muted = vs.muted;
      if (el.vBtnMute) el.vBtnMute.textContent = vs.muted ? '🔇' : '🔊';
      if (el.vBtnMuteBottom) el.vBtnMuteBottom.textContent = vs.muted ? '🔇' : '🔊';
    }

    el.vBtnMute.addEventListener('click', toggleMute);
    if (el.vBtnMuteBottom) el.vBtnMuteBottom.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMute();
    });

    if (el.vBtnReloadMedia) {
      el.vBtnReloadMedia.addEventListener('click', (e) => {
        e.stopPropagation();
        reloadCurrentMedia().catch((err) => log('Reload fout: ' + err.message));
      });
    }

    if (el.vBtnPlayPause) {
      el.vBtnPlayPause.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleVideoPlayback();
      });
    }

    if (el.vBtnReverse) {
      el.vBtnReverse.addEventListener('click', (e) => {
        e.stopPropagation();
        setSpeed(vs.playbackRate < 0 ? 1 : -1);
      });
    }

    if (el.vSpeedSelect) {
      el.vSpeedSelect.addEventListener('change', (e) => {
        const rate = Number(e.target.value);
        if (Number.isFinite(rate)) setSpeed(rate);
      });
    }

    function setVolumeFrom(input) {
      vs.vol = parseFloat(input.value);
      const v = el.vContent.querySelector('video');
      if (v) v.volume = vs.vol;
      if (el.vVol && el.vVol !== input) el.vVol.value = String(vs.vol);
      if (el.vBottomVol && el.vBottomVol !== input) el.vBottomVol.value = String(vs.vol);
    }

    el.vVol.addEventListener('input', () => {
      setVolumeFrom(el.vVol);
    });
    if (el.vBottomVol) {
      el.vBottomVol.addEventListener('input', (e) => {
        e.stopPropagation();
        setVolumeFrom(el.vBottomVol);
      });
    }

    el.vSeek.addEventListener('mousedown', () => { vs.seekDragging = true; });
    el.vSeek.addEventListener('mouseup', () => {
      vs.seekDragging = false;
      seekVideoFromRange(el.vSeek);
    });
    el.vSeek.addEventListener('touchend', () => {
      vs.seekDragging = false;
      seekVideoFromRange(el.vSeek);
    });
    el.vSeek.addEventListener('input', () => {
      const v = el.vContent.querySelector('video');
      const pct = Math.max(0, Math.min(100, (parseInt(el.vSeek.value, 10) || 0) / 10));
      el.vSeek.style.setProperty('--vseek-progress', pct + '%');
      if (v && Number.isFinite(v.duration) && v.duration > 0 && vs.seekDragging && el.vTimeLabel) {
        const t = (pct / 100) * v.duration;
        el.vTimeLabel.textContent = `${formatTime(t)} / ${formatTime(v.duration)}`;
      }
    });

    for (const btn of el.vBottomControls.querySelectorAll('[data-seek]')) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        seekRelative(Number(btn.dataset.seek || 0));
      });
    }
    if (el.vSpeedDown) {
      el.vSpeedDown.addEventListener('click', (e) => {
        e.stopPropagation();
        changeSpeed(-1);
      });
    }
    if (el.vSpeedUp) {
      el.vSpeedUp.addEventListener('click', (e) => {
        e.stopPropagation();
        changeSpeed(1);
      });
    }
    if (el.vBtnFullscreen) {
      el.vBtnFullscreen.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFullscreen();
      });
    }
    el.vSlideshow.addEventListener('click', () => {
      if (vs.slideshow) stopSlideshow(); else startSlideshow();
    });

    el.vSlideshowSec.addEventListener('change', () => {
      vs.slideshowSec = Number(el.vSlideshowSec.value);
    });

    el.vWrap.addEventListener('click', () => {
      vs.wrap = !vs.wrap;
      syncViewerModeControls();
    });

    el.vRandom.addEventListener('click', () => {
      vs.random = !vs.random;
      syncViewerModeControls();
    });

    el.vVideoWait.addEventListener('click', () => {
      vs.videoWait = !vs.videoWait;
      syncViewerModeControls();
    });

    if (el.vChannelScope) {
      el.vChannelScope.addEventListener('click', () => {
        vs.channelScope = vs.channelScope === 'query' ? 'all' : 'query';
        vs.channels = [];
        syncViewerModeControls();
      });
    }

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

    el.vReload.addEventListener('click', () => reloadViewerItems({ preserveSelection: true }));

    el.vMode.addEventListener('change', async () => {
      if (el.vMode.value === 'channel' && !vs.channels.length) {
        try {
          if (!vs.queryFilters) vs.queryFilters = snapshotGalleryFilters();
          const params = appendContextParams(new URLSearchParams(), { includeChannel: false });
          params.set('sort', viewerFilters().sort || 'recent');
          params.set('channel_sort', viewerFilters().channel_sort || 'count');
          const data = await api('/api/channels' + (params.toString() ? '?' + params.toString() : ''));
          vs.channels = (data.channels || []).filter(c => c.channel && c.channel !== 'unknown');
          const currentChannel = (vs.items[vs.idx] && vs.items[vs.idx].channel) || viewerFilters().channel || '';
          const currentIdx = vs.channels.findIndex(c => c.channel === currentChannel);
          vs.chIdx = currentIdx >= 0 ? currentIdx : 0;
        } catch (e) { log('Kanalen laden mislukt: ' + e.message); }
      }
    });

    el.vFilter.addEventListener('change', async () => {
      vs.typeFilter = el.vFilter.value;
      if (!vs.queryFilters) vs.queryFilters = snapshotGalleryFilters();
      vs.queryFilters.media_type = vs.typeFilter === 'all' ? '' : vs.typeFilter;
      vs.channels = [];
      await reloadViewerItems({ preserveSelection: true });
    });

    el.vTagFilter.addEventListener('change', async () => {
      if (!vs.queryFilters) vs.queryFilters = snapshotGalleryFilters();
      vs.queryFilters.tag_id = el.vTagFilter.value || '';
      vs.channels = [];
      await reloadViewerItems({ preserveSelection: true });
    });

    // Tags dialog
    for (const eventName of ['pointerdown', 'mousedown', 'mouseup']) {
      el.vBtnTags.addEventListener(eventName, (e) => {
        e.stopPropagation();
      });
    }
    el.vBtnTags.addEventListener('click', openTagsFromEvent);
    el.vBtnCloseTagDialog.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTagDialog({ force: true });
    });
    el.vTagDialog.addEventListener('click', (e) => {
      if (e.target === el.vTagDialog) closeTagDialog();
      else e.stopPropagation();
    });
    for (const eventName of ['pointerdown', 'mousedown', 'mouseup', 'dblclick']) {
      el.vTagDialog.addEventListener(eventName, (e) => {
        if (e.target !== el.vTagDialog) e.stopPropagation();
      });
    }
    if (el.vTagSearch) el.vTagSearch.addEventListener('input', renderTagDialog);
    if (el.vTagTargetMedia) {
      el.vTagTargetMedia.addEventListener('click', (e) => {
        e.stopPropagation();
        setTagTarget('media');
      });
    }
    if (el.vTagTargetRecipe) {
      el.vTagTargetRecipe.addEventListener('click', (e) => {
        e.stopPropagation();
        setTagTarget('recipe');
      });
    }

    if (el.vBtnRecipeFromItem) {
      el.vBtnRecipeFromItem.addEventListener('click', () => {
        const tags = vs.currentItemTags || [];
        if (!tags.length) {
          log('Geen gekoppelde media-tags om een recept van te maken');
          return;
        }
        setRecipeDraft(tags);
        const it = vs.items[vs.idx] || {};
        if (el.vRecipeName && !el.vRecipeName.value.trim()) {
          el.vRecipeName.value = safeText(it.title || it.filename || it.channel || 'Nieuw recept').slice(0, 80);
        }
        setTagTarget('recipe');
        if (el.vRecipeName) el.vRecipeName.focus();
        log(`Recept gevuld met ${tags.length} gekoppelde tag${tags.length === 1 ? '' : 's'}`);
      });
    }
    if (el.vBtnSaveRecipe) {
      el.vBtnSaveRecipe.addEventListener('click', () => {
        saveRecipeDraft().catch((err) => log('Recept save fout: ' + err.message));
      });
    }
    if (el.vBtnClearRecipe) {
      el.vBtnClearRecipe.addEventListener('click', () => {
        setRecipeDraft([]);
      });
    }

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
        if (vs.tagTarget === 'recipe') {
          addTagToRecipeDraft(result.tag);
        } else {
          await addTagToMedia(itemId, result.tag);
        }
        el.vNewTagInput.value = '';
        await loadTags();
        await loadItemTags(itemId);
        renderTagDialog();
        log(vs.tagTarget === 'recipe' ? `Tag naar recept: ${name}` : `Tag toegevoegd: ${name}`);
      } catch (e) { log('Tag add fout: ' + e.message); }
    });

    el.vNewTagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.vBtnAddTag.click();
    });

    el.vBtnLog.addEventListener('click', toggleLog);
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  window.__wdRotateMedia = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const now = Date.now();
    if (now - vs.lastRotateAt < 250) return;
    vs.lastRotateAt = now;
    rotateCurrentMedia();
  };
  window.__wdOpenTags = openTagsFromEvent;
  window.__viewer = { init, open, close };

  // Auto-init zodra DOM klaar is (app.js laadt viewer.js na zichzelf)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
