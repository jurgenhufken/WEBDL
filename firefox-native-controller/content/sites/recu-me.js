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
  // 2026-05-30 (Jürgen): GEEN download-knop op recu.me — user gebruikt alleen
  // de rechtermuisknop ("WEBDL download" → kwaliteit-submenu). itemTypes leeg
  // → site-engine toont alleen header + channel-hint + globale Screenshot/REC.

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

  itemTypes: [],

  // 2026-05-30 (Jürgen "Hele thread weer terug"): klikt programmatisch de
  // verborgen debug-toolbar "Hele thread" knop aan. Logica blijft daar, we
  // tonen alleen een duidelijke entry-button in het site-engine paneel.
  extraButtons: [
    {
      label: '🧵 Hele thread (alle videos van model)',
      color: '#0ea5e9',
      match: () => /^\/[a-z0-9_-]+\/?$/i.test(window.location.pathname),
      async onClick() {
        try {
          const tb = document.getElementById('webdl-toolbar');
          if (!tb) return { text: '✗ toolbar niet geladen' };
          const btn = Array.from(tb.querySelectorAll('button'))
            .find((b) => /hele\s+thread/i.test((b.textContent || '').trim()));
          if (!btn) return { text: '✗ Hele thread-knop niet gevonden' };
          btn.click();
          return { text: '✓ thread-walk gestart' };
        } catch (e) { return { text: '✗ ' + String(e.message || e).slice(0, 60) }; }
      },
    },
  ],

  // Single-page site — geen pagination
  paginationUrl: (b) => b,
  detectMaxPage: () => 1,
};

window.WEBDL_SITES['recu.me'] = RECU_CONFIG;
