// WEBDL site-config — recu.me (Chaturbate / cam-rec replays).
//
// recu.me staat achter Cloudflare → server-side fetch geeft 403. De extensie
// (browser-side) heeft wel een geldige sessie. We extracten de echte HLS
// stream-URL uit het <video source> element en POSTen alleen die naar de
// server. De stream zit op mediafront.net CDN met signed expires-token —
// geen Cloudflare, yt-dlp kan 'm probleemloos downloaden.
//
// Belangrijk: we raken de "Download" knop op recu.me NIET aan — die zou
// recu.me's eigen download-counter triggeren en mogelijk een quota verbruiken.
// Wij pakken de stream-URL die de player al heeft geladen voor afspelen.
window.WEBDL_SITES = window.WEBDL_SITES || {};

const RECU_CONFIG = {
  label: 'recu.me',
  platform: 'recu',

  pageType(path) {
    if (/^(?:\/[a-z0-9_-]+)?\/video\/\d+(?:\/play)?\/?$/i.test(path)) return 'single';
    return null;
  },

  // Channel = model-naam uit URL of titel. recu.me URLs zijn:
  //   /video/<id>/play          (anonymous flow)
  //   /<username>/video/<id>/play  (model-page-flow, bv. /breeding_material/...)
  // Voor de tweede vorm gebruiken we de username uit het path direct. Anders
  // leunen we op de stream-URL (vorm: /vod/<model>/...) of de page-title
  // ("_kamaxx_ Show from Chaturbate on ...").
  deriveChannel() {
    try {
      const pathM = String(window.location.pathname || '').match(/^\/([a-z0-9_-]+)\/video\/\d+/i);
      if (pathM && pathM[1] && pathM[1].toLowerCase() !== 'video') {
        return pathM[1].replace(/^_+|_+$/g, '');
      }
      const source = document.querySelector('video source[src*=".m3u8"], video source');
      const src = source && source.src ? source.src : '';
      const m = src.match(/\/vod\/([^/?#]+)/i);
      if (m && m[1]) return decodeURIComponent(m[1]).replace(/^_+|_+$/g, '');
      const h1 = document.querySelector('h1, .video-title');
      const txt = (h1 && h1.textContent || '').trim();
      const tm = txt.match(/^(\S+)\s+Show from/i);
      if (tm && tm[1]) return tm[1].replace(/^_+|_+$/g, '');
    } catch (_) {}
    return 'recu';
  },

  // 2026-05-30: GEEN panel-knop op recu.me. User gebruikt alleen
  // rechtermuisknop → "WEBDL download". URL-extractie + browser-download
  // worden door background/simple-background.js gedaan (zie context-menu
  // handler met needsBrowserDl pad voor CLOUDFLARE_BROWSER_DL_HOSTS).
  // De DOM-scrape voor de snelle no-q "Full video" URL zit in
  // content/debug-toolbar.js scrapeMetadata.
  itemTypes: [],

  // Single-page site — geen pagination
  paginationUrl: (b) => b,
  detectMaxPage: () => 1,
};

window.WEBDL_SITES['recu.me'] = RECU_CONFIG;
