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
      // 2026-05-24: recu.me staat achter Cloudflare → server-side fetch geeft
      // 403. Browser heeft wel geldige CF-sessie, dus we laten de extensie
      // zelf de file via browser.downloads.download() binnenhalen. Daarna
      // POSTt background een filepath naar /api/import-file zodat de file
      // in de gallery verschijnt. Zie firefox-native-controller/background/
      // simple-background.js → action 'browserDownload'.
      useBrowserDownload: true,
      buildBody: (_url, channel) => {
        // Bij voorkeur de echte file-URL uit de "Full video" optie in de
        // Download dropdown op recu.me. Niet de HLS-stream — die vereist
        // HLS-mux + is geen origineel bestand. "Full video" is de standaard
        // download zonder kwaliteits-keuze.
        function findDownloadUrl() {
          // 1) Tekstuele "Full video" / "Download" knoppen (recu.me-specifiek)
          //    Dropdown-items: <a>Full video</a> / <a>Cut fragment</a>
          const textCandidates = [...document.querySelectorAll('a, button')]
            .map((el) => ({ el, txt: (el.textContent || '').trim() }))
            .filter(({ txt }) => /\b(full\s*video|download)\b/i.test(txt) && !/\bcut\s*fragment\b/i.test(txt));
          // Sort: "full video" links eerst (primary), "download" labels daarna
          textCandidates.sort((a, b) => {
            const ar = /\bfull\s*video\b/i.test(a.txt) ? 0 : 1;
            const br = /\bfull\s*video\b/i.test(b.txt) ? 0 : 1;
            return ar - br;
          });
          for (const { el } of textCandidates) {
            const u = el.href || el.dataset.downloadUrl || el.dataset.url || el.getAttribute('data-href') || '';
            if (u && /^https?:/i.test(u)) return u;
          }
          // 2) Generieke selectors als fallback
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
          // Filename voor browser.downloads.download — channel/title als folder/naam.
          // Sanitize: geen path-separators of speciale tekens.
          const safeChan = (channel || 'recu').replace(/[\/\\:*?"<>|]/g, '_').slice(0, 60);
          const safeTitle = String(title).replace(/[\/\\:*?"<>|]/g, '_').slice(0, 80) || 'video';
          const videoId = (window.location.pathname.match(/\/video\/(\d+)/) || [])[1] || '';
          const filename = `webdl/recu/${safeChan}/${safeTitle}${videoId ? '_' + videoId : ''}.mp4`;
          return {
            url: downloadUrl,
            filename,
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
