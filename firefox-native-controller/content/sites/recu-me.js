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

  itemTypes: [
    {
      name: 'video',
      match: (p) => /^(?:\/[a-z0-9_-]+)?\/video\/\d+(?:\/play)?\/?$/i.test(p),
      selector: '',
      endpoint: '/download',
      buildBody: (_url, channel) => {
        // Bij voorkeur de echte file-URL uit de "Download" knop, niet de HLS-
        // stream — die laatste vereist HLS-mux + is geen origineel bestand.
        // Probeer meerdere selectors voor de download-link/knop. Pak de href,
        // data-url, of fetch het zelf via JS als 't een form/button is.
        function findDownloadUrl() {
          const selectors = [
            'a[href*=".mp4"]',
            'a[href*="/download"]',
            'a[download]',
            'a.btn-download',
            'a.download-btn',
            'a.video-download',
            'button[data-download-url]',
            'button[data-url*=".mp4"]',
            '[data-download-url]',
            '[data-url*=".mp4"]',
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const u = el.href || el.dataset.downloadUrl || el.dataset.url || el.getAttribute('data-href') || '';
            if (u && /^https?:/i.test(u) && /\.mp4(?:[?#]|$)/i.test(u)) return u;
            if (u && /^https?:/i.test(u) && /\/download/i.test(u)) return u;
          }
          // Tekstuele Download-knop: scan alle <a> en <button> die "Download" zeggen
          const candidates = [...document.querySelectorAll('a, button')]
            .filter((el) => /\bdownload\b/i.test((el.textContent || '').trim()));
          for (const el of candidates) {
            const u = el.href || el.dataset.downloadUrl || el.dataset.url || el.getAttribute('data-href') || '';
            if (u && /^https?:/i.test(u)) return u;
          }
          return '';
        }

        try {
          let downloadUrl = findDownloadUrl();
          let usedFallback = '';
          if (!downloadUrl) {
            // Laatste redmiddel: m3u8 stream (yt-dlp handelt HLS native af).
            const source = document.querySelector('video source[src*=".m3u8"], video source[type*="mpegurl"], video source');
            const streamUrl = source && source.src ? source.src.trim() : '';
            if (streamUrl && !/^blob:/i.test(streamUrl)) {
              downloadUrl = streamUrl;
              usedFallback = 'hls-stream';
            }
          }
          if (!downloadUrl) {
            return { __webdlError: 'recu-me: geen Download-URL gevonden in DOM (probeer eerst de video af te spelen en kijk of de Download-knop verschenen is).' };
          }
          const h1 = document.querySelector('h1, .video-title');
          const title = (h1 && h1.textContent || document.title || '').trim() || `recu_${window.location.pathname.split('/').filter(Boolean).join('_')}`;
          const pageUrl = window.location.href.split('#')[0];
          return {
            url: downloadUrl,
            metadata: {
              platform: 'recu',
              channel: channel || 'recu',
              title,
              url: pageUrl,
              webdl_pin_context: true,
              original_platform: 'recu',
              original_channel: channel || 'recu',
              original_title: title,
              recu_extract_mode: usedFallback || 'download-button',
              source_context: {
                url: pageUrl,
                platform: 'recu',
                channel: channel || 'recu',
                title,
              },
            },
          };
        } catch (e) {
          return { __webdlError: `recu-me buildBody error: ${e && e.message ? e.message : e}` };
        }
      },
      singleLabel: '⬇ Download stream',
      listingNoun: 'video',
      color: '#ec4899',
    },
  ],

  // Single-page site — geen pagination
  paginationUrl: (b) => b,
  detectMaxPage: () => 1,
};

window.WEBDL_SITES['recu.me'] = RECU_CONFIG;
