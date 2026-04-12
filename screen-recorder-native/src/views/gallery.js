function getGalleryHTML() {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>WEBDL Gallery</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0b1020; color: #eee; min-height: 100vh; }
    .top { position: sticky; top: 0; z-index: 50; background: rgba(11,16,32,0.96); backdrop-filter: blur(8px); border-bottom: 1px solid #1f2a52; }
    .bar { padding: 12px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .title { font-size: 14px; color: #00d4ff; font-weight: 700; margin-right: 10px; }
    select, button { background: #0f3460; color: #fff; border: 1px solid #1f2a52; border-radius: 8px; padding: 8px 10px; font-size: 12px; }
    button:hover { background: #00d4ff; color: #0b1020; }
    .btn { width: auto; }
    .spacer { flex: 1 1 auto; }
    .mini { padding: 6px 8px; font-size: 11px; }
    .yt-controls { display: flex; flex-direction: column; gap: 4px; padding: 6px 10px; border: 1px solid #1f2a52; border-radius: 10px; background: #07112a; }
    .yt-controls.loading { opacity: 0.7; }
    .yt-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .yt-tag { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #9dd7ff; }
    .yt-input { width: 52px; border-radius: 8px; border: 1px solid #1f2a52; background: #020614; color: #fff; padding: 6px; text-align: center; font-size: 12px; }
    .yt-status { font-size: 11px; color: #9aa7d1; min-height: 14px; }
    .hint { font-size: 11px; color: #9aa7d1; }

    .content { padding: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
    .card { border: 1px solid #1f2a52; background: #050816; border-radius: 12px; overflow: hidden; cursor: pointer; position: relative; }
    .card:hover { border-color: #00d4ff; }
    .thumb { width: 100%; height: 140px; background: #000; object-fit: cover; display: block; }
    .meta { padding: 8px 10px 10px; }
    .line1 { font-size: 11px; color: #9aa7d1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .line2 { font-size: 12px; color: #eee; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badge { position: absolute; top: 8px; left: 8px; font-size: 10px; background: rgba(15,52,96,0.9); border: 1px solid rgba(31,42,82,0.9); padding: 3px 8px; border-radius: 999px; color: #d7e6ff; }
    .badge.r { left: auto; right: 8px; }
    .src-btn { position: absolute; bottom: 8px; right: 8px; font-size: 10px; font-weight: 600; background: rgba(0,212,255,0.15); border: 1px solid rgba(0,212,255,0.4); padding: 4px 8px; border-radius: 4px; color: #00d4ff; cursor: pointer; transition: all 0.2s; z-index: 5; text-transform: uppercase; letter-spacing: 0.5px; }
    .src-btn:hover { background: rgba(0,212,255,0.25); border-color: #00d4ff; transform: translateY(-1px); }
    .webdl-rating { margin-top: 8px; display: inline-flex !important; gap: 2px !important; align-items: center !important; user-select: none !important; }
    .webdl-rating .webdl-star { position: relative !important; display: inline-block !important; width: 1em !important; font-size: 14px !important; line-height: 1 !important; color: rgba(215,230,255,0.55) !important; cursor: pointer !important; }
    .webdl-rating .webdl-star.full { color: #ffd166 !important; }
    .webdl-rating .webdl-star.half { color: rgba(215,230,255,0.30) !important; }
    .webdl-rating .webdl-star.half::before { content: '★' !important; position: absolute !important; left: 0 !important; top: 0 !important; width: 50% !important; overflow: hidden !important; color: #ffd166 !important; }

    .modal { position: fixed; inset: 0; padding: 0; background: rgba(0,0,0,0.82); display: none; align-items: stretch; justify-content: center; z-index: 100; touch-action: manipulation; }
    .modal.open { display: flex; }
    .panel { width: 100vw; height: 100vh; background: #000; border: 0; border-radius: 0; overflow: hidden; display: flex; flex-direction: column; position: relative; }
    .panel header { position: absolute; top: 0; left: 0; right: 0; z-index: 10; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: none; background: linear-gradient(to bottom, rgba(5,8,22,0.9) 0%, rgba(5,8,22,0.7) 70%, transparent 100%); backdrop-filter: blur(6px); }
    .panel header .h { flex: 1 1 auto; min-width: 0; }
    .panel header .h .t { font-size: 13px; font-weight: 500; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .panel header .h .s { font-size: 11px; color: #9aa7d1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
    .panel .body { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: #000; overflow: hidden; }
    .panel .body img, .panel .body video { width: 100%; height: 100%; object-fit: contain; }
    .panel header { transition: opacity 0.3s ease, transform 0.3s ease; }
    .panel header.hide { opacity: 0; transform: translateY(-100%); pointer-events: none; }

    .dir-panel { width: 600px; max-width: 90vw; max-height: 80vh; background: #0b1020; border: 1px solid #2a4a82; border-radius: 8px; display: flex; flex-direction: column; }
    .dir-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #1f2a52; background: #050816; }
    .dir-header h3 { flex: 1; margin: 0; font-size: 16px; color: #00d4ff; }
    .dir-body { flex: 1; overflow: auto; padding: 16px; min-height: 400px; max-height: 60vh; }
    .dir-controls { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
    .dir-count { margin-left: auto; color: #9aa7d1; font-size: 12px; }
    .dir-list { display: flex; flex-direction: column; gap: 4px; }
    .dir-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #1f2a52; border-radius: 4px; cursor: pointer; user-select: none; }
    .dir-item:hover { background: #2a4a82; }
    .dir-item input[type=checkbox] { width: 18px; height: 18px; cursor: pointer; }
    .dir-item label { flex: 1; cursor: pointer; color: #d7e6ff; font-size: 13px; }
    .dir-footer { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #1f2a52; justify-content: flex-end; }
    .btn-primary { background: #2a4a82 !important; font-weight: bold; }
    .queue-bar { padding: 10px 14px; background: rgba(5,8,22,0.95); border-top: 1px solid #1f2a52; }
    .queue-title { font-size: 11px; font-weight: bold; color: #ffbc00; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px; }
    .queue-grid { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; scrollbar-color: #1f2a52 transparent; }
    .queue-grid::-webkit-scrollbar { height: 6px; }
    .queue-grid::-webkit-scrollbar-track { background: transparent; }
    .queue-grid::-webkit-scrollbar-thumb { background: #1f2a52; border-radius: 3px; }
    .queue-card { flex: 0 0 140px; background: #070b1a; border: 1px solid #1f2a52; border-radius: 6px; overflow: hidden; display: flex; flex-direction: column; position: relative; }
    .queue-card:hover { border-color: #00d4ff; }
    .queue-thumb-box { width:100%; padding-top:56.25%; position:relative; overflow:hidden; background:#000; border-radius:6px 6px 0 0; }
    .queue-thumb { position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; opacity:0.8; }
    .queue-overlay-bottom { position:absolute; bottom:0; left:0; width:100%; z-index:10; }
    .queue-progress-bar { width:100%; height:4px; background:rgba(255,255,255,0.2); }
    .queue-progress-fil { height:100%; background:#00d4ff; width:0%; transition:width 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 0 8px rgba(0,212,255,0.6); }
    .queue-progress-fil.postprocessing { background: #ff00ff; box-shadow: 0 0 12px rgba(255,0,255,0.8); }
    .queue-progress-fil.queued { background: #ffaa00; box-shadow: 0 0 8px rgba(255,170,0,0.6); }
    .queue-pct-badge { position:absolute; top:6px; right:6px; z-index:15; background:rgba(0,0,0,0.8); color:#00d4ff; font-weight:bold; font-size:10px; padding:2px 5px; border-radius:4px; text-shadow:0 0 4px #00d4ff; }
    .queue-pct-badge.postprocessing { color: #ff00ff; text-shadow: 0 0 4px #ff00ff; box-shadow: 0 0 8px rgba(255,0,255,0.3); }
    .queue-pct-badge.queued { color: #ffaa00; background:rgba(40,20,0,0.9); }
    .queue-info { padding: 6px 8px; flex: 1; display: flex; flex-direction: column; justify-content: flex-start; }
    .queue-platform { font-size: 9px; font-weight: bold; color: #8892b0; margin-bottom: 3px; }
    .queue-title { font-size: 11px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; font-weight: normal; text-transform: none; letter-spacing: normal; }
  </style>
</head>
<body>
  <div class="top">
    <div class="bar">
      <div class="title">WEBDL Gallery</div>
      <select id="mode" title="Weergave">
        <option value="recent">Chronologisch (alles)</option>
        <option value="channel">Per kanaal/model</option>
      </select>
      <select id="filter" title="Filter">
        <option value="media" selected>Media (foto+video)</option>
        <option value="video">Alleen video</option>
        <option value="image">Alleen foto</option>
        <option value="all">Alles</option>
      </select>
      <select id="sort" title="Sorteren">
        <option value="recent" selected>Nieuwste</option>
        <option value="rating_desc">Rating hoog→laag</option>
        <option value="rating_asc">Rating laag→hoog</option>
      </select>
      <select id="channelSel" style="min-width: 280px; display:none;"></select>
      <button id="btnReload" class="btn">↻ Herladen</button>
      <button id="btnDirSelect" class="btn">📁 Mappen</button>
      <div class="yt-controls" id="ytControls" style="display:none;">
        <div class="yt-row">
          <span class="yt-tag">YT</span>
          <button id="btnYtMinus" class="mini">-</button>
          <input id="inpYtConcurrency" class="yt-input" type="number" min="0" max="20" step="1" value="1" />
          <button id="btnYtPlus" class="mini">+</button>
          <button id="btnYtPause" class="mini">Pauze</button>
          <button id="btnYtResume" class="mini">Resume</button>
          <button id="btnYtReset" class="mini">Reset</button>
        </div>
        <div class="yt-status" id="ytStatus">-</div>
      </div>
      <div class="spacer"></div>
      <div class="hint" id="hint">-</div>
    </div>
    <div id="queue-bar" class="queue-bar" style="display: none;">
      <div class="queue-title">🔴 Momenteel bezig / Wachtrij</div>
      <div class="queue-grid" id="queue-grid"></div>
    </div>
  </div>

  <div class="content">
    <div class="grid" id="grid"></div>
    <div class="sentinel" id="sentinel">Laden…</div>
  </div>

  <div class="modal" id="modal">
    <div class="panel" id="mPanel">
      <header>
        <button id="btnClose" class="btn">✕</button>
        <div class="h">
          <div class="t" id="mTitle">-</div>
          <div class="s" id="mSub">-</div>
        </div>
        <div id="mRating" style="margin-right:6px"></div>
        <button id="mBtnSlideshow" class="btn">▶︎ Dia</button>
        <select id="mSlideshowSec" style="font-size:11px;padding:6px 8px;">
          <option value="2">2s</option>
          <option value="4" selected>4s</option>
          <option value="7">7s</option>
          <option value="10">10s</option>
          <option value="15">15s</option>
          <option value="30">30s</option>
          <option value="60">1m</option>
          <option value="300">5m</option>
        </select>
        <button id="mBtnRandom" class="btn" title="Random volgorde">🔀 Uit</button>
        <button id="mBtnVideoWait" class="btn" title="Video afwachten">⏳ Aan</button>
        <select id="mFilter" title="Filter" style="font-size:11px;padding:6px 8px;">
          <option value="media">Media</option>
          <option value="video">Video</option>
          <option value="image">Foto</option>
          <option value="all">Alles</option>
        </select>
        <select id="mSort" title="Sorteren" style="font-size:11px;padding:6px 8px;">
          <option value="recent">Nieuwste</option>
          <option value="rating_desc">Rating ↓</option>
          <option value="rating_asc">Rating ↑</option>
        </select>
        <label class="zoomctl">Zoom
          <input id="zoomRange" type="range" min="100" max="600" step="10" value="100">
        </label>
        <button id="btnZoomReset" class="btn">Reset zoom</button>
        <button id="btnRotate" class="btn">↻ 90°</button>
        <button id="btnOpen" class="btn">Open</button>
        <button id="btnFinder" class="btn">Finder</button>
        <button id="btnSource" class="btn">Bron</button>
      </header>
      <div class="body" id="mBody"></div>
    </div>
  </div>

  <div id="dirModal" class="modal" style="display:none;">
    <div class="dir-panel">
      <header class="dir-header">
        <h3>📁 Selecteer Mappen</h3>
        <button id="btnDirClose" class="btn">✕</button>
      </header>
      <div class="dir-body">
        <div class="dir-controls">
          <button id="btnDirSelectAll" class="btn">✓ Alles</button>
          <button id="btnDirDeselectAll" class="btn">✗ Geen</button>
          <span class="dir-count"></span>
        </div>
        <div id="dirList" class="dir-list"></div>
      </div>
      <footer class="dir-footer">
        <button id="btnDirCancel" class="btn">Annuleer</button>
        <button id="btnDirApply" class="btn btn-primary">✓ Toepassen</button>
      </footer>
    </div>
  </div>

  <script>
    const FALLBACK_THUMB = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="100%" height="100%" fill="#000"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#00d4ff" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="18">thumb…</text></svg>');
    const elMode = document.getElementById('mode');
    const elFilter = document.getElementById('filter');
    const elSort = document.getElementById('sort');
    const elChannelSel = document.getElementById('channelSel');
    const elGrid = document.getElementById('grid');
    const elSentinel = document.getElementById('sentinel');
    const elHint = document.getElementById('hint');
    const elYtControls = document.getElementById('ytControls');
    const elYtStatus = document.getElementById('ytStatus');
    const elYtMinus = document.getElementById('btnYtMinus');
    const elYtPlus = document.getElementById('btnYtPlus');
    const elYtPause = document.getElementById('btnYtPause');
    const elYtResume = document.getElementById('btnYtResume');
    const elYtReset = document.getElementById('btnYtReset');
    const elYtValue = document.getElementById('inpYtConcurrency');

    const elModal = document.getElementById('modal');
    const elPanel = document.getElementById('mPanel');
    const elBtnClose = document.getElementById('btnClose');
    const elBtnOpen = document.getElementById('btnOpen');
    const elBtnFinder = document.getElementById('btnFinder');
    const elBtnSource = document.getElementById('btnSource');
    const elBtnRotate = document.getElementById('btnRotate');
    const elZoomRange = document.getElementById('zoomRange');
    const elBtnZoomReset = document.getElementById('btnZoomReset');
    const elMTitle = document.getElementById('mTitle');
    const elMSub = document.getElementById('mSub');
    const elMRating = document.getElementById('mRating');
    const elMBody = document.getElementById('mBody');
    const elMFilter = document.getElementById('mFilter');
    const elMSort = document.getElementById('mSort');
    const elMBtnSlideshow = document.getElementById('mBtnSlideshow');
    const elMSlideshowSec = document.getElementById('mSlideshowSec');
    const elMBtnRandom = document.getElementById('mBtnRandom');
    const elMBtnVideoWait = document.getElementById('mBtnVideoWait');

    const state = {
      mode: 'recent',
      filter: 'media',
      sort: 'recent',
      enabledDirs: null,
      dirConfig: null,
      loading: false,
      done: false,
      cursor: '',
      limit: 120,
      items: [],
      status: null,
      channels: [],
      channel: null,
      current: null,
      currentIndex: -1,
      currentMediaEl: null,
      reloading: false,
      lastAutoLoadAt: 0,
      autoFillLoads: 0,
      hasUserScrolled: false,
      
      slideshow: false,
      slideshowTimer: null,
      random: false,
      videoWait: true,

      volume: 0.8,
      playbackSpeed: 1,

      youtube: null,
      youtubeDefaults: null,
      youtubeLastManual: null,
      youtubeLoading: false,
      reversePlayback: false,
      reverseInterval: null
    };

    function api(path) {
      return fetch(path, { cache: 'no-store' }).then(r => r.json());
    }

    function postApi(path, body) {
      return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json());
    }

    function getSessionEnabledDirs() {
      try {
        const instanceId = window.location.pathname === '/viewer' ? 'viewer' : 'gallery';
        const raw = sessionStorage.getItem('gallery.enabledDirs.' + instanceId);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(v => String(v || '').trim()).filter(Boolean) : [];
      } catch (e) {
        return null;
      }
    }

    function setSessionEnabledDirs(enabledDirs) {
      try {
        const instanceId = window.location.pathname === '/viewer' ? 'viewer' : 'gallery';
        if (enabledDirs == null) {
          sessionStorage.removeItem('gallery.enabledDirs.' + instanceId);
          return;
        }
        sessionStorage.setItem('gallery.enabledDirs.' + instanceId, JSON.stringify(Array.isArray(enabledDirs) ? enabledDirs : []));
      } catch (e) {}
    }

    function log(msg) {
      try {
        console.log('[Gallery]', msg);
      } catch (e) {}
    }

    function itemKey(it) {
      if (!it) return '';
      // Prefer dedupe_key (normalized WEBDL-relative path from server)
      if (it.dedupe_key) {
        var dk = String(it.dedupe_key);
        var m = dk.match(/[\/\\]WEBDL[\/\\](.+)$/i);
        return 'dp:' + (m ? m[1] : dk);
      }
      return (it.kind ? String(it.kind) : '') + ':' + String(it.id != null ? it.id : '');
    }

    function setHint() {
      if (state.mode === 'recent') {
        const s = state.status;
        const dl = s && Number.isFinite(s.activeDownloads) ? s.activeDownloads : null;
        const qh = s && s.queues && s.queues.heavy ? s.queues.heavy : null;
        const ql = s && s.queues && s.queues.light ? s.queues.light : null;
        const extra = (dl !== null)
          ? (' | actief: ' + dl + ((qh && ql)
            ? (' | queue H ' + qh.active + '/' + qh.limit + ' (+' + qh.queued + ') | L ' + ql.active + '/' + ql.limit + ' (+' + ql.queued + ')')
            : ''))
          : '';
        elHint.textContent = 'Items: ' + state.items.length + extra;
      } else {
        const ch = state.channel;
        const s = state.status;
        const dl = s && Number.isFinite(s.activeDownloads) ? s.activeDownloads : null;
        const qh = s && s.queues && s.queues.heavy ? s.queues.heavy : null;
        const ql = s && s.queues && s.queues.light ? s.queues.light : null;
        const extra = (dl !== null)
          ? (' | actief: ' + dl + ((qh && ql)
            ? (' | queue H ' + qh.active + '/' + qh.limit + ' (+' + qh.queued + ') | L ' + ql.active + '/' + ql.limit + ' (+' + ql.queued + ')')
            : ''))
          : '';
        elHint.textContent = ch ? (ch.platform + '/' + ch.channel + ' • items: ' + state.items.length + extra) : 'Geen kanaal';
      }
    }

    function clearGrid() {
      elGrid.innerHTML = '';
    }

    function syncZoomUi() {
      if (elZoomRange) elZoomRange.value = String(Math.round(state.zoom * 100));
      if (elBtnZoomReset) elBtnZoomReset.disabled = state.zoom <= 1;
    }

    function applyZoomTransform() {
      const el = state.currentMediaEl;
      if (!el) return;
      el.style.transform = 'translate(' + state.panX + 'px, ' + state.panY + 'px) scale(' + state.zoom + ')';
      if (state.zoom > 1) {
        el.classList.add('zoomed');
      } else {
        el.classList.remove('zoomed');
        el.classList.remove('dragging');
      }
      syncZoomUi();
    }

    function resetZoom() {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      state.dragging = false;
      state.dragMoved = false;
      state.dragStart = null;
      applyZoomTransform();
    }

    function setZoom(nextZoom) {
      state.zoom = Math.max(1, Math.min(6, Number(nextZoom) || 1));
      if (state.zoom <= 1) {
        state.panX = 0;
        state.panY = 0;
      }
      applyZoomTransform();
    }

    function attachZoomHandlers(el) {
      if (!el) return;
      state.currentMediaEl = el;
      el.classList.add('zoom-media');
      el.style.transition = 'transform 120ms ease-out';
      resetZoom();

      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (state.zoom <= 1) return;
        state.dragging = true;
        state.dragMoved = false;
        state.dragStart = {
          x: e.clientX,
          y: e.clientY,
          panX: state.panX,
          panY: state.panY
        };
        el.classList.add('dragging');
        e.preventDefault();
      });

      el.addEventListener('click', () => {
        if (state.dragMoved) {
          state.dragMoved = false;
          return;
        }
        if (state.zoom > 1) resetZoom();
        else setZoom(2);
      });
    }

    function clampRating(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(5, Math.round(n * 2) / 2));
    }

    function getRatingRef(it) {
      const kind = it && it.rating_kind ? String(it.rating_kind) : (it && it.kind ? String(it.kind) : '');
      const id = it && it.rating_id != null ? Number(it.rating_id) : (it && it.id != null ? Number(it.id) : NaN);
      if (!kind || !Number.isFinite(id)) return null;
      if (kind !== 'd' && kind !== 's') return null;
      return { kind, id };
    }

    function setStars(container, rating) {
      if (!container) return;
      const r = clampRating(rating);
      const stars = Array.from(container.querySelectorAll('.webdl-star'));
      for (let i = 0; i < stars.length; i++) {
        const star = stars[i];
        const idx = i + 1;
        star.classList.remove('full');
        star.classList.remove('half');
        if (r >= idx) star.classList.add('full');
        else if (r >= (idx - 0.5)) star.classList.add('half');
      }
    }

    function makeRatingEl(it) {
      const ref = getRatingRef(it);
      const box = document.createElement('div');
      box.className = 'webdl-rating';
      box.dataset.kind = ref ? ref.kind : '';
      box.dataset.id = ref ? String(ref.id) : '';
      const current = clampRating(it && it.rating != null ? it.rating : 0);
      for (let i = 1; i <= 5; i++) {
        const s = document.createElement('span');
        s.className = 'webdl-star';
        s.textContent = '★';
        s.dataset.i = String(i);
        box.appendChild(s);
      }
      setStars(box, current);
      if (!ref) {
        box.style.opacity = '0.35';
        return box;
      }

      const applyToState = (kind, id, rating) => {
        try {
          for (const item of state.items) {
            const r2 = getRatingRef(item);
            if (!r2) continue;
            if (r2.kind === kind && Number(r2.id) === Number(id)) item.rating = rating;
          }
        } catch (e) {}
      };

      const patchAllCards = (kind, id, rating) => {
        try {
          const cards = Array.from(elGrid.querySelectorAll('.card'));
          for (const c of cards) {
            const k = c.dataset && c.dataset.key ? String(c.dataset.key) : '';
            if (!k) continue;
            const idx = state.items.findIndex((x) => itemKey(x) === k);
            if (idx < 0) continue;
            const r2 = getRatingRef(state.items[idx]);
            if (!r2) continue;
            if (r2.kind === kind && Number(r2.id) === Number(id)) {
              const el = c.querySelector('.webdl-rating');
              if (el) setStars(el, rating);
            }
          }
        } catch (e) {}
      };

      box.addEventListener('click', async (e) => {
        try {
          e.preventDefault();
          e.stopPropagation();
          const t = e.target;
          if (!t || !t.classList || !t.classList.contains('webdl-star')) return;
          const idx = parseInt(String(t.dataset.i || '0'), 10) || 0;
          if (idx <= 0) return;
          const rect = t.getBoundingClientRect();
          const isHalf = (e.clientX - rect.left) < (rect.width / 2);
          const next = clampRating(isHalf ? (idx - 0.5) : idx);
          setStars(box, next);
          if (elMRating && elMRating.dataset && elMRating.dataset.kind === ref.kind && elMRating.dataset.id === String(ref.id)) {
            setStars(elMRating, next);
          }
          const resp = await postApi('/api/rating', { kind: ref.kind, id: ref.id, rating: next });
          if (!resp || !resp.success) throw new Error((resp && resp.error) ? resp.error : 'rating opslaan mislukt');
          applyToState(ref.kind, ref.id, next);
          patchAllCards(ref.kind, ref.id, next);
        } catch (err) {}
      });

      box.addEventListener('contextmenu', async (e) => {
        try {
          e.preventDefault();
          e.stopPropagation();
          const next = null;
          setStars(box, next);
          if (elMRating && elMRating.dataset && elMRating.dataset.kind === ref.kind && elMRating.dataset.id === String(ref.id)) {
            setStars(elMRating, next);
          }
          const resp = await postApi('/api/rating', { kind: ref.kind, id: ref.id, rating: next });
          if (!resp || !resp.success) return;
          applyToState(ref.kind, ref.id, next);
          patchAllCards(ref.kind, ref.id, next);
        } catch (e2) {}
      });

      return box;
    }

    function getActiveThumbUrl(a) {
      if (a.thumbnail && !String(a.thumbnail).includes('/download/') && !String(a.thumbnail).includes('/thumb')) return a.thumbnail;
      if (a.url && /\.(jpg|jpeg|png|webp|gif|avif|bmp)(?:\?|$)/i.test(String(a.url))) return a.url;
      if (a.platform === 'youtube' && a.url) {
        try {
          const u = new URL(a.url);
          let vid = '';
          if (u.hostname.includes('youtube.com') && u.searchParams.has('v')) {
            vid = u.searchParams.get('v');
          } else if (u.hostname.includes('youtu.be')) {
            vid = u.pathname.substring(1);
          } else if (u.hostname.includes('youtube.com') && u.pathname.startsWith('/shorts/')) {
            vid = u.pathname.split('/')[2];
          }
          if (vid) return 'https://i.ytimg.com/vi/' + vid + '/mqdefault.jpg';
        } catch(e) {}
      }
      return '/media/pending-thumb.svg?v=' + Date.now() + '&text=' + encodeURIComponent(a.title || 'Downloading...');
    }

    function setHint() {
      const s = state.status;
      const dl = s && Number.isFinite(s.activeDownloads) ? s.activeDownloads : null;
      const qh = s && s.queues && s.queues.heavy ? s.queues.heavy : null;
      const ql = s && s.queues && s.queues.light ? s.queues.light : null;
      const extra = (dl !== null)
        ? (' | actief: ' + dl + ((qh && ql)
          ? (' | queue H ' + qh.active + '/' + qh.limit + ' (+' + qh.queued + ') | L ' + ql.active + '/' + ql.limit + ' (+' + ql.queued + ')')
          : ''))
        : '';
        
      if (state.mode === 'recent') {
        elHint.textContent = 'Items: ' + state.items.length + extra;
      } else {
        const ch = state.channel;
        elHint.textContent = ch ? (ch.platform + '/' + ch.channel + ' • items: ' + state.items.length + extra) : 'Geen kanaal';
      }

      const elQueueBar = document.getElementById('queue-bar');
      const elQueueGrid = document.getElementById('queue-grid');
      if (elQueueBar && elQueueGrid) {
        if (s && s.active_items && s.active_items.length > 0) {
          elQueueGrid.innerHTML = '';
          const maxShows = 8;
          for (let i=0; i < Math.min(s.active_items.length, maxShows); i++) {
            const a = s.active_items[i];
            const card = document.createElement('div');
            card.className = 'queue-card';
            
            const thumbUrl = getActiveThumbUrl(a);
            const rawPct = typeof a.progress === 'number' ? a.progress : 0;
            const pct = Math.max(0, Math.min(100, Math.round(rawPct)));
            const isPost = a.status === 'postprocessing';
            const isQueued = a.status === 'queued';
            const pctText = isPost ? 'NABELICHTEN' : (isQueued ? 'WACHTRIJ' : (pct + '%'));
            const ppClass = isPost ? ' postprocessing' : (isQueued ? ' queued' : '');
            
            const safetitle = String(a.title || 'Downloading...').replace(/'/g, "\\\\\\'");
            const fallbackCall = thumbUrl.includes('ytimg') 
              ? "this.onerror=null;this.src='/media/pending-thumb.svg?v=" + Date.now() + "&text=' + encodeURIComponent('" + safetitle + "');"
              : "this.onerror=null;this.src=FALLBACK_THUMB;";
            
            card.innerHTML = \`
              <div class="queue-thumb-box">
                <img class="queue-thumb" src="\${thumbUrl}" onerror="\${fallbackCall}">
                <div class="queue-pct-badge\${ppClass}">\${pctText}</div>
                <div class="queue-overlay-bottom">
                  <div class="queue-progress-bar"><div class="queue-progress-fil\${ppClass}" style="width:\${pct}%"></div></div>
                </div>
              </div>
              <div class="queue-info">
                <div class="queue-platform">\${String(a.platform || 'ONBEKEND').toUpperCase()}</div>
                <div class="queue-title">\${String(a.title || 'Laden...')}</div>
              </div>
            \`;
            elQueueGrid.appendChild(card);
          }
          elQueueBar.style.display = 'block';
        } else {
          elQueueBar.style.display = 'none';
          elQueueGrid.innerHTML = '';
        }
      }
    }

    function clearGrid() {
      elGrid.innerHTML = '';
    }

    const THUMB_MAX_INFLIGHT = Math.max(1, Math.min(32, parseInt((new URLSearchParams(location.search)).get('thumb_inflight') || '20', 10) || 20));
    const thumbQueue = [];
    const thumbInflight = new Set();
    let thumbDrainTimer = null;

    function drainThumbQueueSoon() {
      if (thumbDrainTimer) return;
      thumbDrainTimer = setTimeout(() => {
        thumbDrainTimer = null;
        drainThumbQueue();
      }, 5);
    }

    function markThumbDone(img) {
      try { thumbInflight.delete(img); } catch (e) {}
      drainThumbQueueSoon();
    }

    function setThumbSource(img, real) {
      try {
        if (!img) return;
        const base = String(real || '');
        const prevBase = (img.dataset && typeof img.dataset.src === 'string') ? String(img.dataset.src || '') : '';
        const prevReal = (img.dataset && typeof img.dataset.real === 'string') ? String(img.dataset.real || '') : '';
        try {
          if (base && prevReal && base === prevReal && img.dataset && img.dataset._thumbLoaded === '1') {
            const cur = String(img.currentSrc || img.src || '');
            if (cur && cur !== FALLBACK_THUMB && !cur.includes('/media/pending-thumb.svg')) {
              return;
            }
          }
        } catch (e) {}
        if (base && base.startsWith('data:')) {
          img.src = base;
          try { if (img.dataset) img.dataset.src = ''; } catch (e) {}
          try { if (img.dataset) img.dataset.real = base; } catch (e) {}
          try { if (img.dataset) img.dataset._thumbLoaded = '1'; } catch (e) {}
          try { if (img.dataset) img.dataset._thumbQueued = ''; } catch (e) {}
          try { if (img.dataset) img.dataset._thumbFallback = ''; } catch (e) {}
          try { if (img.dataset) img.dataset.retries = '0'; } catch (e) {}
          try { if (img.dataset) img.dataset.next_retry_at = ''; } catch (e) {}
          try { thumbIo.unobserve(img); } catch (e) {}
          return;
        }
        if (base && (base.startsWith('/') || base.startsWith('https://') || base.startsWith('http://'))) {
          const preloader = new Image();
          preloader.onload = () => {
            try {
              img.src = base;
              try { if (img.dataset) img.dataset.src = ''; } catch (e) {}
              try { if (img.dataset) img.dataset.real = base; } catch (e) {}
              try { if (img.dataset) img.dataset._thumbLoaded = '1'; } catch (e) {}
              try { if (img.dataset) img.dataset._thumbQueued = ''; } catch (e) {}
              try { if (img.dataset) img.dataset._thumbFallback = ''; } catch (e) {}
            } catch (e) {}
          };
          preloader.onerror = () => {
            try {
              img.src = FALLBACK_THUMB;
              try { if (img.dataset) img.dataset._thumbFallback = '1'; } catch (e) {}
            } catch (e) {}
          };
          preloader.src = base;
          return;
        }
        img.src = FALLBACK_THUMB;
        try { if (img.dataset) img.dataset.src = base; } catch (e) {}
        try { if (img.dataset) img.dataset.real = base; } catch (e) {}
        try { if (img.dataset) img.dataset._thumbLoaded = ''; } catch (e) {}
        try { if (img.dataset) img.dataset._thumbQueued = ''; } catch (e) {}
        try { if (img.dataset) img.dataset._thumbFallback = base ? '1' : ''; } catch (e) {}
        try {
          if (img.dataset) {
            const baseUnchanged = prevBase && base && prevBase === base;
            const hasRetryState = !!(img.dataset.retries && String(img.dataset.retries) !== '0') || !!(img.dataset.next_retry_at && String(img.dataset.next_retry_at) !== '');
            if (!(baseUnchanged && hasRetryState)) {
              img.dataset.retries = '0';
              img.dataset.next_retry_at = '';
            }
          }
        } catch (e) {}
        if (base) {
          try { attachThumbRetry(img); } catch (e) {}
          try { thumbIo.observe(img); } catch (e) {}
        } else {
          try { if (img.dataset) img.dataset.real = ''; } catch (e) {}
          try { thumbIo.unobserve(img); } catch (e) {}
        }
      } catch (e) {}
    }

    function enqueueThumb(img) {
      try {
        if (!img || !img.dataset) return;
        const base = String(img.dataset.src || '');
        if (!base) return;
        if (img.dataset._thumbQueued === '1') return;
        if (img.dataset._thumbLoaded === '1') return;
        img.dataset._thumbQueued = '1';
        thumbQueue.push(img);
        drainThumbQueueSoon();
      } catch (e) {}
    }

    function drainThumbQueue() {
      try {
        while (thumbInflight.size < THUMB_MAX_INFLIGHT && thumbQueue.length) {
          const img = thumbQueue.shift();
          if (!img || !img.dataset) continue;
          if (!img.isConnected) continue;
          img.dataset._thumbQueued = '';
          const base = String(img.dataset.src || '');
          if (!base) continue;
          if (thumbInflight.has(img)) continue;
          const tries = parseInt(String(img.dataset.retries || '0'), 10) || 0;
          const bust = tries > 0 ? ((base.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now() + '-' + tries) : '';
          thumbInflight.add(img);
          img.src = base + bust;
        }
      } catch (e) {}
    }

    if (!window.thumbIo) {
      window.thumbIo = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const img = e.target;
          enqueueThumb(img);
          try { window.thumbIo.unobserve(img); } catch (e2) {}
        }
      }, { rootMargin: '1500px' });
    }
    var thumbIo = window.thumbIo;

    function pageIsScrollable() {
      try {
        const h = document.documentElement ? (document.documentElement.scrollHeight || 0) : 0;
        return h > (window.innerHeight + 40);
      } catch (e) {
        return true;
      }
    }

    function isNearBottom(margin = 700) {
      try {
        const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
        const viewport = window.innerHeight || 0;
        const full = document.documentElement ? (document.documentElement.scrollHeight || 0) : 0;
        return (scrollTop + viewport + margin) >= full;
      } catch (e) {
        return false;
      }
    }

    function primeThumbs(max = 8) {
      try {
        const imgs = elGrid.querySelectorAll('img.thumb');
        let n = 0;
        for (const img of imgs) {
          if (!img) continue;
          const src = img.dataset ? String(img.dataset.src || '') : (img.getAttribute ? String(img.getAttribute('data-src') || '') : '');
          if (!src) continue;
          try {
            const r = img.getBoundingClientRect();
            if (r && r.top > (window.innerHeight + 360)) continue;
          } catch (e) {}
          enqueueThumb(img);
          try { if (img.dataset) img.dataset.retries = img.dataset.retries || '0'; } catch (e) {}
          n++;
          if (n >= max) break;
        }
      } catch (e) {}
    }

    function refreshPendingThumbs(max = 4) {
      try {
        const imgs = elGrid.querySelectorAll('img.thumb');
        let n = 0;
        const now = Date.now();
        for (const img of imgs) {
          if (!img || !img.isConnected || !img.dataset) continue;
          const base = String(img.dataset.src || '');
          if (!base) continue;
          if (img.dataset._thumbLoaded === '1') continue;
          const cur = String(img.currentSrc || img.src || '');
          const isPending = cur.includes('/media/pending-thumb.svg');
          const isFallback = (img.dataset && img.dataset._thumbFallback === '1') || cur === FALLBACK_THUMB;
          if (!isPending && !isFallback) continue;

          try {
            const r = img.getBoundingClientRect();
            if (r && (r.bottom < -180 || r.top > (window.innerHeight + 320))) continue;
          } catch (e) {}

          const tries = parseInt(String(img.dataset.retries || '0'), 10) || 0;
          if (tries >= 30) continue;
          const nextAt = parseInt(String(img.dataset.next_retry_at || '0'), 10) || 0;
          if (nextAt && now < nextAt) continue;

          const delay = Math.min(120000, Math.floor(1200 * Math.pow(1.6, tries) + (Math.random() * 400)));
          try { img.dataset.next_retry_at = String(now + delay); } catch (e) {}
          try { img.dataset.retries = String(tries + 1); } catch (e) {}

          try { img.dataset._thumbLoaded = ''; } catch (e) {}
          try { img.dataset._thumbQueued = ''; } catch (e) {}
          enqueueThumb(img);
          n++;
          if (n >= max) break;
        }
      } catch (e) {}
    }

    function saveStateToUrl() {
      const params = new URLSearchParams();
      params.set('mode', state.mode);
      params.set('filter', state.filter);
      params.set('sort', state.sort);
      if (state.channel) {
        params.set('platform', state.channel.platform);
        params.set('channel', state.channel.channel);
      }
      const url = '/gallery?' + params.toString();
      history.replaceState({ page: 'gallery' }, '', url);
    }

    function restoreStateFromUrl() {
      const params = new URLSearchParams(window.location.search);
      if (params.has('mode')) state.mode = params.get('mode');
      if (params.has('filter')) state.filter = params.get('filter');
      if (params.has('sort')) state.sort = params.get('sort');
      if (params.has('platform') && params.has('channel')) {
        state.channel = { platform: params.get('platform'), channel: params.get('channel') };
      }
      
      if (elMode) elMode.value = state.mode;
      if (elFilter) elFilter.value = state.filter;
      if (elSort) elSort.value = state.sort;
    }

    function fmtItemSub(it) {
      if (!it) return '';
      const src = it.src ? ' - ' + it.src.split('/').pop() : '';
      const origin = it.origin_url ? ' (' + new URL(it.origin_url).hostname + ')' : '';
      const channelText = it.channel_display || it.channel || '-';
      return (it.platform || '-') + ' | ' + channelText + ' | ' + (it.type || '-') + ' | ' + (it.created_at || '-') + origin + src;
    }

    function syncZoomUi() {
      if (elZoomRange) elZoomRange.value = String(Math.round(state.zoom * 100));
      if (elBtnZoomReset) elBtnZoomReset.disabled = state.zoom <= 1;
    }

    function applyZoomTransform() {
      const el = state.currentMediaEl;
      if (!el) return;
      const transforms = [];
      if (state.rotation) transforms.push('rotate(' + state.rotation + 'deg)');
      if (state.zoom > 1) {
        transforms.push('scale(' + state.zoom + ')');
        transforms.push('translate(' + state.panX + 'px, ' + state.panY + 'px)');
      }
      el.style.transform = transforms.join(' ');
      if (elBtnZoomReset) elBtnZoomReset.disabled = state.zoom <= 1;
    }

    function resetZoom() {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      state.dragging = false;
      state.dragMoved = false;
      state.dragStart = null;
      applyZoomTransform();
      if (elZoomRange) elZoomRange.value = '100';
    }

    function rotateMedia() {
      state.rotation = (state.rotation + 90) % 360;
      applyZoomTransform();
    }

    function resetRotation() {
      state.rotation = 0;
      if (state.zoom <= 1) {
        state.panX = 0;
        state.panY = 0;
      }
      applyZoomTransform();
    }

    function attachZoomHandlers(el) {
      if (!el) return;
      state.currentMediaEl = el;
      el.classList.add('zoom-media');
      el.style.transition = 'transform 120ms ease-out';
      resetZoom();

      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(state.zoom + delta);
      }, { passive: false });

      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (state.zoom <= 1) return;
        state.dragging = true;
        state.dragMoved = false;
        state.dragStart = {
          x: e.clientX,
          y: e.clientY,
          panX: state.panX,
          panY: state.panY
        };
        el.classList.add('dragging');
        e.preventDefault();
      });

      el.addEventListener('click', () => {
        if (state.dragMoved) {
          state.dragMoved = false;
          return;
        }
        if (state.zoom > 1) resetZoom();
        else setZoom(2);
      });
    }

    async function cycleMode(direction) {
      const modes = ['recent', 'channel'];
      const curr = Math.max(0, modes.indexOf(state.mode));
      const next = (curr + direction + modes.length) % modes.length;
      const nextMode = modes[next];
      if (nextMode === state.mode) return;
      state.mode = nextMode;
      elMode.value = nextMode;
      closeModal();
      await reloadAll();
    }

    function openModalByKey(key) {
      try {
        const idx = state.items.findIndex((x) => itemKey(x) === key);
        if (idx >= 0) openModalIndex(idx);
      } catch (e) {}
    }

    function addCards(items) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const key = itemKey(it);
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.key = key;
        if (it && it.ready === false) {
          card.style.opacity = '0.82';
        }

        const img = document.createElement('img');
        img.className = 'thumb';
        try { img.decoding = 'async'; } catch (e) {}
        const thumbUrl = it.thumb || '';
        if (String(thumbUrl).startsWith('data:')) {
          setThumbSource(img, thumbUrl);
        } else {
          const real = thumbUrl || '';
          if (real) {
            setThumbSource(img, real);
          } else {
            setThumbSource(img, '');
          }
        }
        img.alt = it.title || '';
        img.onerror = () => {
          try {
            img.onerror = null;
            img.src = FALLBACK_THUMB;
          } catch (e) {}
        };

        const b1 = document.createElement('div');
        b1.className = 'badge';
        b1.textContent = it.platform || 'other';

        const b2 = document.createElement('div');
        b2.className = 'badge r';
        if (it && it.ready === false) {
          const st = (it.status || 'queued');
          const pct = Number.isFinite(Number(it.progress)) ? Math.max(0, Math.min(100, Number(it.progress))) : 0;
          b2.textContent = st + ' ' + pct + '%';
        } else {
          b2.textContent = it.type || '';
        }

        const meta = document.createElement('div');
        meta.className = 'meta';
        const l1 = document.createElement('div');
        l1.className = 'line1';
        l1.textContent = it.channel_display || it.channel || 'unknown';
        const l2 = document.createElement('div');
        l2.className = 'line2';
        if (it && it.ready === false) {
          const st = (it.status || 'queued');
          const pct = Number.isFinite(Number(it.progress)) ? Math.max(0, Math.min(100, Number(it.progress))) : 0;
          l2.textContent = (it.title || '(download)') + ' • ' + st + ' ' + pct + '%';
        } else {
          l2.textContent = it.title_display || it.title || '(zonder titel)';
        }
        meta.appendChild(l1);
        meta.appendChild(l2);
        try {
          const ratingEl = makeRatingEl(it);
          meta.appendChild(ratingEl);
        } catch (e) {}

        card.appendChild(img);
        card.appendChild(b1);
        card.appendChild(b2);
        card.appendChild(meta);
        
        if (it.source_url) {
          const srcBtn = document.createElement('button');
          srcBtn.className = 'src-btn';
          srcBtn.textContent = 'Source';
          srcBtn.title = 'Open bron';
          srcBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open(it.source_url, '_blank');
          });
          card.appendChild(srcBtn);
        }
        
        card.addEventListener('click', () => openModalByKey(key));
        frag.appendChild(card);
      }
      elGrid.appendChild(frag);
      try { requestAnimationFrame(() => primeThumbs(18)); } catch (e) { primeThumbs(18); }
    }

    function prependCards(items) {
      if (!items || !items.length) return;
      const keysToAdd = new Set();
      for (const it of items) {
        const k = itemKey(it);
        if (k) keysToAdd.add(k);
      }
      for (const k of keysToAdd) {
        try {
          const existing = elGrid.querySelector('.card[data-key="' + CSS.escape(String(k)) + '"]');
          if (existing) existing.remove();
        } catch (e) {
          for (const c of Array.from(elGrid.querySelectorAll('.card'))) {
            try {
              if (String(c.dataset.key || '') === String(k)) c.remove();
            } catch (e2) {}
          }
        }
      }
      const frag = document.createDocumentFragment();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const key = itemKey(it);
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.key = key;
        if (it && it.ready === false) {
          card.style.opacity = '0.82';
        }

        const img = document.createElement('img');
        img.className = 'thumb';
        try { img.decoding = 'async'; } catch (e) {}
        const thumbUrl = it.thumb || '';
        if (String(thumbUrl).startsWith('data:')) {
          setThumbSource(img, thumbUrl);
        } else {
          const real = thumbUrl || '';
          if (real) {
            setThumbSource(img, real);
          } else {
            setThumbSource(img, '');
          }
        }
        img.alt = it.title || '';
        img.onerror = () => {
          try {
            img.onerror = null;
            img.src = FALLBACK_THUMB;
          } catch (e) {}
        };

        const b1 = document.createElement('div');
        b1.className = 'badge';
        b1.textContent = it.platform || 'other';

        const b2 = document.createElement('div');
        b2.className = 'badge r';
        if (it && it.ready === false) {
          const st = (it.status || 'queued');
          const pct = Number.isFinite(Number(it.progress)) ? Math.max(0, Math.min(100, Number(it.progress))) : 0;
          b2.textContent = st + ' ' + pct + '%';
        } else {
          b2.textContent = it.type || '';
        }

        const meta = document.createElement('div');
        meta.className = 'meta';
        const l1 = document.createElement('div');
        l1.className = 'line1';
        l1.textContent = it.channel_display || it.channel || 'unknown';
        const l2 = document.createElement('div');
        l2.className = 'line2';
        if (it && it.ready === false) {
          const st = (it.status || 'queued');
          const pct = Number.isFinite(Number(it.progress)) ? Math.max(0, Math.min(100, Number(it.progress))) : 0;
          l2.textContent = (it.title || '(download)') + ' • ' + st + ' ' + pct + '%';
        } else {
          l2.textContent = it.title_display || it.title || '(zonder titel)';
        }
        meta.appendChild(l1);
        meta.appendChild(l2);
        try {
          const ratingEl = makeRatingEl(it);
          meta.appendChild(ratingEl);
        } catch (e) {}

        card.appendChild(img);
        card.appendChild(b1);
        card.appendChild(b2);
        card.appendChild(meta);
        
        if (it.source_url) {
          const srcBtn = document.createElement('button');
          srcBtn.className = 'src-btn';
          srcBtn.textContent = 'Source';
          srcBtn.title = 'Open bron';
          srcBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open(it.source_url, '_blank');
          });
          card.appendChild(srcBtn);
        }
        
        card.addEventListener('click', () => openModalByKey(key));
        frag.appendChild(card);
      }
      elGrid.insertBefore(frag, elGrid.firstChild);
      try { requestAnimationFrame(() => primeThumbs(18)); } catch (e) { primeThumbs(18); }
    }

    function openModalIndex(idx) {
      const it = state.items[idx];
      if (!it) return;
      
      history.pushState({ page: 'viewer', index: idx }, '', '/gallery#viewer');
      
      // Clean up previous media properly
      if (state.currentMediaEl) {
        try {
          if (state.currentMediaEl.tagName === 'VIDEO') {
            state.currentMediaEl.pause();
            state.currentMediaEl.src = '';
            state.currentMediaEl.load();
          }
        } catch (e) {}
      }
      if (state.reverseInterval) {
        clearInterval(state.reverseInterval);
        state.reverseInterval = null;
      }
      state.reversePlayback = false;
      
      state.current = it;
      state.currentIndex = idx;
      state.currentMediaEl = null;
      if (elPanel) elPanel.classList.remove('portrait');
      
      // Sync modal dropdowns with current state
      if (elMFilter) elMFilter.value = state.filter;
      if (elMSort) elMSort.value = state.sort;

      const isReady = !(it && it.ready === false);
      elBtnOpen.disabled = !isReady;
      elBtnFinder.disabled = !isReady;
      if (elBtnSource) { elBtnSource.style.display = it.source_url ? '' : 'none'; elBtnSource.onclick = () => window.open(it.source_url, '_blank'); }

      elMTitle.textContent = it.title_display || it.title || '(zonder titel)';
      elMSub.textContent = fmtItemSub(it);
      try {
        if (elMRating) {
          elMRating.innerHTML = '';
          const r = makeRatingEl(it);
          try {
            if (elMRating.dataset) {
              elMRating.dataset.kind = r && r.dataset ? String(r.dataset.kind || '') : '';
              elMRating.dataset.id = r && r.dataset ? String(r.dataset.id || '') : '';
            }
          } catch (e2) {}
          elMRating.appendChild(r);
          setStars(elMRating, it && it.rating != null ? it.rating : 0);
        }
      } catch (e) {}
      elMBody.innerHTML = '';

      if (!isReady) {
        const box = document.createElement('div');
        box.style.padding = '20px';
        box.style.color = '#d7e6ff';
        box.innerHTML = '<div style="font-size:13px;color:#00d4ff;font-weight:700">Download bezig…</div>'
          + '<div style="margin-top:8px;font-size:12px;color:#9aa7d1">Status: ' + (it.status || 'queued')
          + ' • ' + (Number.isFinite(Number(it.progress)) ? Math.max(0, Math.min(100, Number(it.progress))) : 0) + '%</div>'
          + '<div style="margin-top:10px;font-size:12px;color:#9aa7d1">Media verschijnt automatisch zodra bestanden klaar zijn.</div>';
        elMBody.appendChild(box);
        resetZoom();
        elModal.classList.add('open');
        return;
      }

      let el = null;
      if (it.type === 'video') {
        el = document.createElement('video');
        el.controls = true;
        el.playsInline = true;
        el.autoplay = true;
        el.volume = state.volume;
        el.playbackRate = state.playbackSpeed;
        state.currentMediaEl = el;
        const source = document.createElement('source');
        // Use /media/stream for remuxing MKV/AVI to browser-playable MP4
        var streamSrc = it.src ? it.src.replace('/media/file?', '/media/stream?') : it.src;
        source.src = streamSrc;
        source.type = 'video/mp4';
        el.appendChild(source);
        // Fallback: if stream fails, try direct file
        el.addEventListener('error', function() {
          if (source.src.includes('/media/stream?')) {
            source.src = it.src;
            el.load();
          }
        }, { once: true });
        el.addEventListener('volumechange', () => {
          state.volume = el.volume;
        });
        
        // Ensure slideshow wait timer recalculates if playback state changes
        const rescheduleIfSlideshow = () => {
          if (state.slideshow) {
            if (state.slideshowTimer) clearTimeout(state.slideshowTimer);
            scheduleSlideshowTick();
          }
        };
        el.addEventListener('play', rescheduleIfSlideshow);
        el.addEventListener('pause', rescheduleIfSlideshow);
        el.addEventListener('ended', () => {
          if (state.slideshow) {
            if (state.slideshowTimer) clearTimeout(state.slideshowTimer);
            gotoDelta(1).catch(() => {});
            scheduleSlideshowTick();
          }
        });

        try { el.disablePictureInPicture = true; } catch (e) {}
        try { el.setAttribute('disablePictureInPicture', ''); } catch (e) {}
        try { el.setAttribute('controlsList', 'noremoteplayback nodownload'); } catch (e) {}
        el.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); });
        el.addEventListener('click', (e) => { e.stopPropagation(); });
      } else {
        el = document.createElement('img');
        el.src = it.src;
        el.alt = it.title || '';
        el.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); });
      }
      elMBody.appendChild(el);
      attachZoomHandlers(el);
      elModal.classList.add('open');
      if (it.type === 'video') {
        setTimeout(() => {
          try {
            el.play();
          } catch (e) {}
        }, 3000);
      }
      
      // Auto-hide header after 3 seconds
      let hideHeaderTimer = null;
      if (elPanel && elPanel.querySelector('header')) {
        elPanel.querySelector('header').classList.add('hide');
      }
      const showHeader = () => {
        if (elPanel && elPanel.querySelector('header')) {
          elPanel.querySelector('header').classList.remove('hide');
        }
        if (hideHeaderTimer) clearTimeout(hideHeaderTimer);
        hideHeaderTimer = setTimeout(() => {
          if (elPanel && elPanel.querySelector('header')) {
            elPanel.querySelector('header').classList.add('hide');
          }
        }, 3000);
      };
      elMBody.addEventListener('mousemove', showHeader);
      elMBody.addEventListener('click', showHeader);
    }

    function closeModal(fromHistory = false) {
      if (fromHistory !== true && window.history.state && window.history.state.page === 'viewer') {
        window.history.back();
        return;
      }
      try { history.replaceState({ page: 'gallery' }, '', '/gallery'); } catch(e) {}
    
      stopSlideshow();
      if (state.reverseInterval) {
        clearInterval(state.reverseInterval);
        state.reverseInterval = null;
      }
      state.reversePlayback = false;
      
      // Stop video playback
      if (state.currentMediaEl) {
        try {
          if (state.currentMediaEl.tagName === 'VIDEO') {
            state.currentMediaEl.pause();
            state.currentMediaEl.src = '';
            state.currentMediaEl.load();
          }
        } catch (e) {}
      }
      
      elModal.classList.remove('open');
      elMBody.innerHTML = '';
      state.current = null;
      state.currentIndex = -1;
      state.currentMediaEl = null;
      resetZoom();
      resetRotation();
      
      if (!skipHistory && window.location.hash === '#viewer') {
        history.back();
      }
    }

    async function openCurrent(action) {
      const it = state.current;
      if (!it) return;
      if (it && it.ready === false) {
        alert('Download is nog bezig. Wacht tot het item klaar is.');
        return;
      }
      try {
        const isPath = it.open && it.open.path;
        const url = isPath ? '/media/open-path' : '/media/open';
        const payload = isPath ? { path: it.open.path, action: action } : { kind: it.open.kind, id: it.open.id, action: action };
        const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await resp.json().catch(() => null);
        if (!data || !data.success) throw new Error((data && data.error) ? data.error : 'actie mislukt');
      } catch (e) {
        alert((e && e.message) ? e.message : String(e));
      }
    }

    function currentVideo() {
      const el = state.currentMediaEl;
      if (!el || String(el.tagName || '').toUpperCase() !== 'VIDEO') return null;
      return el;
    }

    function stopReversePlayback() {
      if (state.reverseInterval) {
        clearInterval(state.reverseInterval);
        state.reverseInterval = null;
      }
      state.reversePlayback = false;
    }

    function applyPlaybackState() {
      const v = currentVideo();
      if (!v) return;
      if (state.reverseInterval) {
        clearInterval(state.reverseInterval);
        state.reverseInterval = null;
      }
      if (state.reversePlayback) {
        const speed = Math.max(0.25, Math.min(4, Number(state.playbackSpeed) || 1));
        try { v.pause(); } catch (e) {}
        const intervalMs = Math.max(16, Math.round(80 / speed));
        const stepSeconds = Math.max(0.04, 0.08 * speed);
        state.reverseInterval = setInterval(() => {
          if (state.currentMediaEl !== v) {
            stopReversePlayback();
            return;
          }
          try {
            const nextTime = Math.max(0, Number(v.currentTime || 0) - stepSeconds);
            v.currentTime = nextTime;
            if (nextTime <= 0) v.pause();
          } catch (e) {
            stopReversePlayback();
          }
        }, intervalMs);
        return;
      }
      if (!(Number(state.playbackSpeed) > 0)) {
        try { v.pause(); } catch (e) {}
        return;
      }
      try { v.playbackRate = Math.max(0.25, Math.min(4, Number(state.playbackSpeed) || 1)); } catch (e) {}
      try { v.play().catch(() => {}); } catch (e) {}
    }

    function stepPlaybackControl(delta) {
      const signed = state.reversePlayback ? -Math.max(0.25, Number(state.playbackSpeed) || 1) : (Number(state.playbackSpeed) || 0);
      let next = Math.round((signed + delta) * 100) / 100;
      next = Math.max(-4, Math.min(4, next));
      if (Math.abs(next) < 0.001) next = 0;
      if (next < 0) {
        state.reversePlayback = true;
        state.playbackSpeed = Math.max(0.25, Math.abs(next));
      } else {
        state.reversePlayback = false;
        state.playbackSpeed = next;
      }
      applyPlaybackState();
    }

    async function gotoDelta(delta) {
      if (state.reverseInterval) {
        clearInterval(state.reverseInterval);
        state.reverseInterval = null;
      }
      state.reversePlayback = false;
      if (state.currentIndex < 0) return;
      
      let target;
      if (state.slideshow && state.random) {
        if (state.items.length <= 1) return;
        let r;
        do {
          r = Math.floor(Math.random() * state.items.length);
        } while (r === state.currentIndex);
        target = r;
      } else {
        target = state.currentIndex + delta;
      }

      if (target >= 0 && target < state.items.length) {
        openModalIndex(target);
        return;
      }
      if (!state.random && delta > 0 && !state.done) {
        await loadNext();
        const nextTarget = Math.min(state.items.length - 1, state.currentIndex + delta);
        if (nextTarget !== state.currentIndex) openModalIndex(nextTarget);
      } else if (!state.random && delta > 0 && state.done && state.mode === 'channel') {
        await changeViewerChannel(1);
      } else if (state.random || state.wrap) {
        // Fallback wrap if we overshot despite random not supposed to, or if regular wrap
        openModalIndex((target % state.items.length + state.items.length) % state.items.length);
      }
    }

    function stopSlideshow() {
      state.slideshow = false;
      if (state.slideshowTimer) clearTimeout(state.slideshowTimer);
      state.slideshowTimer = null;
      if (elMBtnSlideshow) elMBtnSlideshow.textContent = '▶︎ Dia';
    }

    function scheduleSlideshowTick() {
      if (!state.slideshow) return;
      const sec = parseInt(elMSlideshowSec ? elMSlideshowSec.value : 4, 10) || 4;
      
      let waitTimeMs = Math.max(1, sec) * 1000;
      
      if (state.videoWait) {
        const v = state.currentMediaEl;
        if (v && v.tagName === 'VIDEO' && !v.paused && !v.ended && v.duration) {
          const remaining = (v.duration - v.currentTime) * 1000;
          if (remaining > 0) {
            waitTimeMs = Math.max(waitTimeMs, remaining + 500); 
          }
        }
      }

      state.slideshowTimer = setTimeout(() => {
        gotoDelta(1).catch(() => {});
        scheduleSlideshowTick();
      }, waitTimeMs);
    }

    function startSlideshow() {
      state.slideshow = true;
      if (elMBtnSlideshow) elMBtnSlideshow.textContent = '⏸ Dia';
      scheduleSlideshowTick();
    }

    async function loadChannels() {
      const data = await api('/api/media/channels?limit=800');
      if (!data.success) throw new Error(data.error || 'channels failed');
      state.channels = data.channels || [];
      elChannelSel.innerHTML = '';
      for (const ch of state.channels) {
        const opt = document.createElement('option');
        opt.value = ch.platform + '||' + ch.channel;
        const chLabel = (String(ch.platform || '').toLowerCase() === 'footfetishforum' && /^thread_\d+$/i.test(String(ch.channel || '')))
          ? ('Thread ' + String(ch.channel || '').replace(/^thread_/i, ''))
          : ch.channel;
        opt.textContent = ch.platform + '/' + chLabel + ' (' + ch.count + ')';
        elChannelSel.appendChild(opt);
      }
      if (!state.channel && state.channels.length) {
        state.channel = { platform: state.channels[0].platform, channel: state.channels[0].channel };
      }
      if (state.channel) {
        elChannelSel.value = state.channel.platform + '||' + state.channel.channel;
      }
    }

    async function changeViewerChannel(delta) {
      if (state.mode !== 'channel') {
        state.mode = 'channel';
        if (elMode) elMode.value = 'channel';
        if (elChannelSel) elChannelSel.style.display = '';
      }
      if (!Array.isArray(state.channels) || !state.channels.length) {
        await loadChannels();
      }
      if (!Array.isArray(state.channels) || !state.channels.length) return;
      let idx = state.channels.findIndex((ch) => {
        return ch && state.channel
          && String(ch.platform || '') === String(state.channel.platform || '')
          && String(ch.channel || '') === String(state.channel.channel || '');
      });
      if (idx < 0) {
        idx = 0;
      } else {
        idx = (idx + delta + state.channels.length) % state.channels.length;
      }
      const ch = state.channels[idx];
      if (!ch) return;
      state.channel = { platform: ch.platform, channel: ch.channel };
      if (elChannelSel) elChannelSel.value = state.channel.platform + '||' + state.channel.channel;
      resetPaging();
      await loadNext();
      if (state.items.length) openModalIndex(0);
    }

    async function reloadAll() {
      if (state.reloading) return;
      state.reloading = true;
      resetPaging();
      try {
        if (state.mode === 'channel') {
          elChannelSel.style.display = '';
          await loadChannels();
        } else {
          elChannelSel.style.display = 'none';
        }
        await loadNext();
      } finally {
        state.reloading = false;
      }
    }

    async function softRefreshTop() {
      if (state.loading || state.reloading || state.items.length === 0) return;
      try {
        let path = '';
        const dirsParam = state.enabledDirs ? '&dirs=' + encodeURIComponent(JSON.stringify(state.enabledDirs)) : '';
        if (state.mode === 'recent') {
          path = '/api/media/recent-files?limit=60&cursor=&type=' + encodeURIComponent(state.filter) + '&include_active=0' + dirsParam ;
        } else {
          const ch = state.channel;
          if (!ch) return;
          path = '/api/media/channel-files?platform=' + encodeURIComponent(ch.platform) + '&channel=' + encodeURIComponent(ch.channel) + '&limit=60&cursor=&type=' + encodeURIComponent(state.filter) + '&include_active=0' + dirsParam ;
        }
        const data = await api(path);
        if (!data || !data.success) return;
        const got = Array.isArray(data.items) ? data.items : [];
        const fresh = [];
        for (const it of got) {
          const k = itemKey(it);
          if (!k) continue;
          let found = false;
          for (const existing of state.items) {
            if (itemKey(existing) === k) { found = true; break; }
          }
          if (!found) fresh.push(it);
        }
        if (!fresh.length) return;
        state.items = fresh.concat(state.items);
        prependCards(fresh);
        setHint();
      } catch (e) {}
    }

    async function init() {
      try {
        const resp = await fetch('/api/directories');
        const data = await resp.json();
        if (data && data.success) {
          state.dirConfig = {
            directories: Array.isArray(data.directories) ? data.directories.slice() : [],
            enabled: Array.isArray(data.enabled) ? data.enabled.slice() : []
          };
          const sessionEnabledDirs = getSessionEnabledDirs();
          if (Array.isArray(sessionEnabledDirs)) {
            const validDirs = new Set(data.directories || []);
            const filtered = sessionEnabledDirs.filter(d => validDirs.has(d));
            if (filtered.length > 0) {
              state.enabledDirs = filtered;
            } else {
              state.enabledDirs = Array.isArray(data.directories) ? data.directories.slice() : null;
              setSessionEnabledDirs(null);
            }
          } else if (Array.isArray(data.directories)) {
            state.enabledDirs = data.directories.slice();
          } else {
            state.enabledDirs = null;
          }
        }
      } catch (e) {}
      
      elMode.value = state.mode;
      elFilter.value = state.filter;
      if (state.mode === 'recent') {
        await loadNext();
      } else {
        await loadChannels();
      }
    }

    function resetPaging() {
      state.cursor = '';
      state.done = false;
      state.items = [];
      state.autoFillLoads = 0;
      state.hasUserScrolled = false;
      clearGrid();
      setHint();
    }

    async function loadNext() {
      if (state.loading || state.done) return;
      state.loading = true;
      const startTime = Date.now();
      elSentinel.textContent = '⏳ Verbinden met server...';
      try {
        let path = '';
        const dirsParam = state.enabledDirs ? '&dirs=' + encodeURIComponent(JSON.stringify(state.enabledDirs)) : '';
        elSentinel.textContent = '📡 Aanvraag verzenden (limit=' + state.limit + ', filters=' + (state.enabledDirs ? state.enabledDirs.length : 'none') + ')...';
        if (state.mode === 'recent') {
          path = '/api/media/recent-files?limit=' + state.limit + '&cursor=' + encodeURIComponent(state.cursor) + '&type=' + encodeURIComponent(state.filter) + '&include_active=0&include_active_files=0' + '&sort=' + encodeURIComponent(state.sort || 'recent') + dirsParam;
        } else {
          const ch = state.channel;
          if (!ch) { state.done = true; return; }
          path = '/api/media/channel-files?platform=' + encodeURIComponent(ch.platform) + '&channel=' + encodeURIComponent(ch.channel) + '&limit=' + state.limit + '&cursor=' + encodeURIComponent(state.cursor) + '&type=' + encodeURIComponent(state.filter) + '&include_active=0&include_active_files=0' + '&sort=' + encodeURIComponent(state.sort || 'recent') + dirsParam;
        }
        const data = await api(path);
        const fetchTime = Date.now() - startTime;
        elSentinel.textContent = '⚙️ Verwerken (' + fetchTime + 'ms)...';
        if (!data.success) throw new Error(data.error || 'load failed');
        const items = data.items || [];
        const existing = new Set();
        for (const it of state.items) {
          try {
            const k = itemKey(it);
            if (k) existing.add(k);
          } catch (e) {}
        }
        const uniqueItems = [];
        for (const it of items) {
          try {
            const k = itemKey(it);
            if (!k) {
              uniqueItems.push(it);
              continue;
            }
            if (existing.has(k)) continue;
            existing.add(k);
            uniqueItems.push(it);
          } catch (e) {
            uniqueItems.push(it);
          }
        }
        state.items = state.items.concat(uniqueItems);
        state.cursor = data.next_cursor || '';
        state.done = data.done || false;
        addCards(uniqueItems);
        setHint();
        state.loading = false;
        const totalTime = Date.now() - startTime;
        const stats = items.length + ' items in ' + totalTime + 'ms';
        if (state.done) {
          elSentinel.innerHTML = '✓ Klaar: ' + stats;
        } else {
          elSentinel.innerHTML = '↓ Scroll voor meer (' + stats + ') <button onclick="loadNext()" style="margin-left:10px;padding:4px 8px;font-size:11px;background:#0f3460;color:#fff;border:1px solid #1f2a52;border-radius:4px;cursor:pointer;">Forceer laden</button>';
        }
      } catch (e) {
        state.loading = false;
        const totalTime = Date.now() - startTime;
        elSentinel.textContent = '❌ Fout na ' + totalTime + 'ms: ' + e.message;
        log('Load error: ' + e.message);
      }
    }

    window.addEventListener('scroll', () => {
      try {
        const y = window.scrollY || document.documentElement.scrollTop || 0;
        if (y > 50) state.hasUserScrolled = true;
      } catch (e) {}
    }, { passive: true });

    function pageIsScrollable() {
      try {
        const h = document.documentElement ? (document.documentElement.scrollHeight || 0) : 0;
        return h > (window.innerHeight + 40);
      } catch (e) {
        return true;
      }
    }

    var io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        if (state.loading || state.done) continue;
        
        const now = Date.now();
        if (now - (state.lastAutoLoadAt || 0) < 500) continue;
        state.lastAutoLoadAt = now;
        loadNext().catch(e => { log('LoadNext error: ' + e.message); });
      }
    }, { rootMargin: '3000px' });
    try { io.observe(elSentinel); } catch(e) {}

    // Fallback if IntersectionObserver gets stuck or scroll isn't detected
    setInterval(() => {
      if (state.loading || state.done) return;
      try {
        const r = elSentinel.getBoundingClientRect();
        if (r && r.top < window.innerHeight + 2000) {
          const now = Date.now();
          if (now - (state.lastAutoLoadAt || 0) > 1000) {
            state.lastAutoLoadAt = now;
            loadNext().catch(() => {});
          }
        }
      } catch (e) {}
    }, 1500);

    try {
      document.addEventListener('fullscreenchange', () => {
        try {
          if (!document.fullscreenElement) return;
          if (elModal.classList.contains('open') && elModal.contains(document.fullscreenElement)) {
            document.exitFullscreen().catch(() => {});
          }
        } catch (e) {}
      });
    } catch (e) {}

    try {
      const pollStatus = async () => {
        try {
          const s = await api('/status');
          if (s && typeof s === 'object') {
            state.status = s;
            setHint();
          }
        } catch (e) {}
      };
      setInterval(pollStatus, 2500);
      pollStatus();
    } catch (e) {}

    try {
      let last = null;
      let lastReloadAt = 0;
      let lastPeriodicAt = Date.now();
      const tick = async () => {
        try {
          const data = await api('/api/stats');
          const s = data && data.stats ? data.stats : null;
          if (!s) return;
          const modalOpen = elModal.classList.contains('open');
          const activeDl = state.status && Number.isFinite(Number(state.status.activeDownloads)) ? Number(state.status.activeDownloads) : 0;
          const key = (activeDl > 0)
            ? [s.downloads, s.downloads_created_last || '', s.downloads_finished_last || '', s.screenshots, s.download_files, s.screenshots_last, s.download_files_last].join('|')
            : [s.downloads, s.downloads_created_last || '', s.downloads_finished_last || '', s.screenshots, s.download_files, s.downloads_last || '', s.screenshots_last, s.download_files_last].join('|');
          const now = Date.now();
          const scrollTop = (typeof window !== 'undefined') ? (window.scrollY || document.documentElement.scrollTop || 0) : 0;
          const nearTop = scrollTop < 160;
          const canAutoReload = !modalOpen && nearTop && !state.loading && !state.reloading;
          const changed = !!(last && key !== last);
          if (canAutoReload && !changed && (now - lastPeriodicAt) >= (activeDl > 0 ? 12000 : 8000)) {
            lastPeriodicAt = now;
            lastReloadAt = now;
            softRefreshTop();
          }
          if (!modalOpen) {
            if (activeDl > 0) {
              if (changed && canAutoReload) {
                lastReloadAt = now;
                softRefreshTop();
              } else if (canAutoReload && (now - lastReloadAt) >= 15000) {
                lastReloadAt = now;
                softRefreshTop();
              } else if (!canAutoReload) {
                elHint.textContent = 'Download bezig — nieuwe files beschikbaar (klik Herladen)';
              }
            } else if (changed) {
              if (canAutoReload && (now - lastReloadAt) >= 2500) {
                lastReloadAt = now;
                softRefreshTop();
              } else if (!canAutoReload) {
                elHint.textContent = 'Nieuwe items — klik Herladen';
              }
            }
          } else if (changed) {
            elHint.textContent = 'Nieuwe items — klik Herladen';
          }
          last = key;
        } catch (e) {}
      };
      setInterval(tick, 2500);
      tick();
    } catch (e) {}

    document.getElementById('btnReload').addEventListener('click', () => reloadAll());
    const elBtnDirSelect = document.getElementById('btnDirSelect');
    const elDirModal = document.getElementById('dirModal');
    const elBtnDirClose = document.getElementById('btnDirClose');
    const elBtnDirCancel = document.getElementById('btnDirCancel');
    const elBtnDirApply = document.getElementById('btnDirApply');
    const elBtnDirSelectAll = document.getElementById('btnDirSelectAll');
    const elBtnDirDeselectAll = document.getElementById('btnDirDeselectAll');
    const elDirList = document.getElementById('dirList');
    const elDirCount = document.querySelector('#dirModal .dir-count');

    function getSelectedDirsFromModal() {
      if (!elDirList) return [];
      const selected = [];
      const topLevels = Array.from(elDirList.querySelectorAll('.dir-top-level > input[type="checkbox"]'))
                             .filter(c => c.checked).map(c => c.value);
      selected.push(...topLevels);

      const subLevels = Array.from(elDirList.querySelectorAll('.dir-sub-level input[type="checkbox"]'))
                             .filter(c => c.checked && !topLevels.includes(c.dataset.parent))
                             .map(c => c.value);
      selected.push(...subLevels);
      return selected;
    }

    function updateDirCount() {
      if (!elDirCount || !elDirList) return;
      const checks = Array.from(elDirList.querySelectorAll('.dir-top-level > input[type="checkbox"]'));
      const checked = checks.filter(c => c.checked).length;
      elDirCount.textContent = checked + '/' + checks.length + ' geselecteerd';
      
      Array.from(elDirList.querySelectorAll('.dir-top-level > input[type="checkbox"]')).forEach(c => {
         const parentVal = c.value;
         const isChecked = c.checked;
         const subBoxes = Array.from(elDirList.querySelectorAll('.dir-sub-level input[data-parent="' + parentVal + '"]'));
         subBoxes.forEach(sb => {
             sb.disabled = isChecked;
             if (isChecked) sb.checked = true;
         });
      });
    }

    function renderDirList(dirConfig) {
      if (!elDirList) return;
      const directories = Array.isArray(dirConfig && dirConfig.directories) ? dirConfig.directories : [];
      const dirInfo = Array.isArray(dirConfig && dirConfig.directoriesInfo) ? dirConfig.directoriesInfo : [];
      const enabled = Array.isArray(dirConfig && dirConfig.enabled) ? dirConfig.enabled : [];
      const enabledSet = new Set(enabled);
      
      const subMap = {};
      for (const info of dirInfo) {
        const parts = info.path.split('/');
        const parent = parts[0];
        if (!subMap[parent]) subMap[parent] = { files: 0, subs: [] };
        if (parts.length > 1) {
          subMap[parent].subs.push(info);
        }
        subMap[parent].files += info.count;
      }
      
      elDirList.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (const dirName of directories) {
         const topWrap = document.createElement('div');
         topWrap.className = 'dir-top-level';
         topWrap.style.marginBottom = '6px';
         topWrap.style.borderBottom = '1px solid #1f2a52';
         topWrap.style.paddingBottom = '6px';

         const label = document.createElement('label');
         label.style.display = 'flex';
         label.style.alignItems = 'center';
         label.style.gap = '8px';
         label.style.cursor = 'pointer';

         const input = document.createElement('input');
         input.type = 'checkbox';
         input.value = dirName;
         input.checked = enabledSet.has(dirName);
         input.addEventListener('change', updateDirCount);

         const title = document.createElement('span');
         title.style.fontSize = '14px';
         title.style.color = '#fff';
         title.style.fontWeight = 'bold';
         title.textContent = dirName;
         
         label.appendChild(input);
         label.appendChild(title);
         
         const infoBlock = subMap[dirName];
         if (infoBlock) {
             const badge = document.createElement('span');
             badge.style.fontSize = '10px';
             badge.style.background = '#0f3460';
             badge.style.padding = '2px 6px';
             badge.style.borderRadius = '10px';
             badge.style.marginLeft = 'auto';
             badge.textContent = infoBlock.files + ' files';
             
             if (infoBlock.subs.length > 0) {
                 const tgl = document.createElement('button');
                 tgl.textContent = '▼ ' + infoBlock.subs.length + ' subs';
                 tgl.style.fontSize = '10px';
                 tgl.style.background = 'none';
                 tgl.style.border = '1px solid #1f2a52';
                 tgl.style.color = '#00d4ff';
                 tgl.style.padding = '2px 6px';
                 tgl.style.borderRadius = '4px';
                 tgl.style.marginLeft = '6px';
                 
                 const subContainer = document.createElement('div');
                 subContainer.className = 'dir-sub-level';
                 subContainer.style.display = 'none';
                 subContainer.style.marginLeft = '24px';
                 subContainer.style.marginTop = '6px';
                 subContainer.style.flexDirection = 'column';
                 subContainer.style.gap = '4px';
                 
                 tgl.addEventListener('click', (e) => {
                     e.preventDefault();
                     e.stopPropagation();
                     const isViz = subContainer.style.display !== 'none';
                     subContainer.style.display = isViz ? 'none' : 'flex';
                     tgl.textContent = (isViz ? '▼ ' : '▲ ') + infoBlock.subs.length + ' subs';
                 });
                 
                 for (const sub of infoBlock.subs) {
                     const sLbl = document.createElement('label');
                     sLbl.style.display = 'flex';
                     sLbl.style.alignItems = 'center';
                     sLbl.style.gap = '6px';
                     sLbl.style.cursor = 'pointer';
                     
                     const sInp = document.createElement('input');
                     sInp.type = 'checkbox';
                     sInp.value = sub.path;
                     sInp.dataset.parent = dirName;
                     sInp.checked = enabledSet.has(sub.path) || input.checked;
                     sInp.disabled = input.checked;
                     
                     const sTxt = document.createElement('span');
                     sTxt.style.fontSize = '11px';
                     sTxt.style.color = '#ccc';
                     sTxt.textContent = sub.path.slice(dirName.length + 1) + ' (' + sub.count + ')';
                     
                     sLbl.appendChild(sInp);
                     sLbl.appendChild(sTxt);
                     subContainer.appendChild(sLbl);
                 }
                 label.appendChild(badge);
                 label.appendChild(tgl);
                 topWrap.appendChild(label);
                 topWrap.appendChild(subContainer);
             } else {
                 label.appendChild(badge);
                 topWrap.appendChild(label);
             }
         } else {
             topWrap.appendChild(label);
         }
         frag.appendChild(topWrap);
      }
      elDirList.appendChild(frag);
      updateDirCount();
    }

    async function loadDirConfig(force) {
      if (!force && state.dirConfig) return state.dirConfig;
      const data = await api('/api/directories');
      if (!data || !data.success) throw new Error(data && data.error ? data.error : 'directories load failed');
      state.dirConfig = {
        directories: Array.isArray(data.directories) ? data.directories.slice() : [],
        directoriesInfo: Array.isArray(data.directoriesInfo) ? data.directoriesInfo.slice() : [],
        enabled: Array.isArray(data.enabled) ? data.enabled.slice() : []
      };
      return state.dirConfig;
    }

    if (elBtnDirSelect && elDirModal) {
      const closeDirModal = () => { elDirModal.style.display = 'none'; };

      elBtnDirSelect.addEventListener('click', async () => {
        elDirModal.style.display = 'flex';
        if (!elDirList) return;
        elDirList.textContent = 'Mappen laden...';
        try {
          const dirConfig = await loadDirConfig(false);
          const enabled = Array.isArray(state.enabledDirs) ? state.enabledDirs.slice() : (Array.isArray(dirConfig.enabled) ? dirConfig.enabled.slice() : []);
          renderDirList({ directories: dirConfig.directories, directoriesInfo: dirConfig.directoriesInfo, enabled });
        } catch (e) {
          elDirList.textContent = 'Kon mappen niet laden';
          if (elDirCount) elDirCount.textContent = '';
        }
      });

      if (elBtnDirClose) elBtnDirClose.addEventListener('click', closeDirModal);
      if (elBtnDirCancel) elBtnDirCancel.addEventListener('click', closeDirModal);

      if (elBtnDirApply) {
        elBtnDirApply.addEventListener('click', async () => {
          const selected = getSelectedDirsFromModal();
          state.enabledDirs = selected.slice();
          if (state.dirConfig) state.dirConfig.enabled = selected.slice();
          setSessionEnabledDirs(selected.slice());
          closeDirModal();
          await reloadAll();
        });
      }

      elDirModal.addEventListener('click', (e) => {
        if (e.target === elDirModal) closeDirModal();
      });
      if (elBtnDirSelectAll) {
        elBtnDirSelectAll.addEventListener('click', () => {
          if (!elDirList) return;
          for (const c of elDirList.querySelectorAll('input[type="checkbox"]')) c.checked = true;
          updateDirCount();
        });
      }
      if (elBtnDirDeselectAll) {
        elBtnDirDeselectAll.addEventListener('click', () => {
          if (!elDirList) return;
          for (const c of elDirList.querySelectorAll('input[type="checkbox"]')) c.checked = false;
          updateDirCount();
        });
      }
    }

    elMode.addEventListener('change', async () => { state.mode = elMode.value; await reloadAll(); });
    elFilter.addEventListener('change', async () => { state.filter = elFilter.value; await reloadAll(); });
    elSort.addEventListener('change', async () => { state.sort = elSort.value; await reloadAll(); });
    elChannelSel.addEventListener('change', async () => {
      const parts = String(elChannelSel.value || '').split('||');
      if (parts.length === 2) state.channel = { platform: parts[0], channel: parts[1] };
      await reloadAll();
    });

    elBtnClose.addEventListener('click', closeModal);
    elModal.addEventListener('click', (e) => { if (e.target === elModal) closeModal(); });
    elModal.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    elBtnOpen.addEventListener('click', () => openCurrent('open'));
    elBtnFinder.addEventListener('click', () => openCurrent('finder'));

    if (elMBtnSlideshow) {
      elMBtnSlideshow.addEventListener('click', () => {
        if (state.slideshow) stopSlideshow();
        else startSlideshow();
      });
    }
    if (elMBtnRandom) {
      elMBtnRandom.addEventListener('click', () => {
        state.random = !state.random;
        elMBtnRandom.textContent = state.random ? '🔀 Aan' : '🔀 Uit';
      });
    }
    if (elMSlideshowSec) {
      elMSlideshowSec.addEventListener('change', () => {
        if (state.slideshow) {
          if (state.slideshowTimer) clearTimeout(state.slideshowTimer);
          scheduleSlideshowTick();
        }
      });
    }
    if (elMBtnVideoWait) {
      elMBtnVideoWait.addEventListener('click', () => {
        state.videoWait = !state.videoWait;
        elMBtnVideoWait.textContent = state.videoWait ? '⏳ Aan' : '⏳ Uit';
        // Apply immediately if slideshow is running
        if (state.slideshow) {
          if (state.slideshowTimer) clearTimeout(state.slideshowTimer);
          scheduleSlideshowTick();
        }
      });
    }

    if (elZoomRange) {
      elZoomRange.addEventListener('input', () => {
        const pct = Number(elZoomRange.value || '100');
        setZoom(pct / 100);
      });
    }
    if (elBtnZoomReset) {
      elBtnZoomReset.addEventListener('click', () => resetZoom());
    }

    window.addEventListener('mousemove', (e) => {
      if (!state.dragging || !state.dragStart || state.zoom <= 1 || !state.currentMediaEl) return;
      const dx = e.clientX - state.dragStart.x;
      const dy = e.clientY - state.dragStart.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) state.dragMoved = true;
      state.panX = state.dragStart.panX + dx;
      state.panY = state.dragStart.panY + dy;
      applyZoomTransform();
    });

    window.addEventListener('mouseup', () => {
      state.dragging = false;
      state.dragStart = null;
      if (state.currentMediaEl) state.currentMediaEl.classList.remove('dragging');
    });

    
    window.addEventListener('popstate', (e) => {
      if (elModal && elModal.classList.contains('open')) {
        closeModal(true);
      }
    });
    
    window.addEventListener('keydown', async (e) => {
      const tag = e.target && e.target.tagName ? String(e.target.tagName).toUpperCase() : '';
      const isFormTarget = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (!elModal.classList.contains('open')) {
        if (isFormTarget) return;
        return;
      }
      if (isFormTarget && e.key !== 'Escape') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); await gotoDelta(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); await gotoDelta(-1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); await changeViewerChannel(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); await changeViewerChannel(1); }
      else if (e.key === ' ') {
        const v = currentVideo();
        if (v) {
          if (state.reversePlayback) {
            stopReversePlayback();
          }
          if (v.paused) v.play().catch(() => {});
          else v.pause();
        }
        e.preventDefault();
      }
      else if (e.key === 'Control' && e.location === 1) {
        if (elMBtnRandom) elMBtnRandom.click();
        e.preventDefault();
      }
      else if (e.key.toLowerCase() === 'm') {
        const v = currentVideo();
        if (v) {
          v.muted = !v.muted;
        }
        e.preventDefault();
      }
      else if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
    });

    init().catch(e => { elSentinel.textContent = 'Fout: ' + e.message; });
  </script>
</body>
</html>`;
}


module.exports = getGalleryHTML;
