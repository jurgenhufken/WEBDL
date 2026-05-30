// WEBDL site-config — mega.nz file/folder share-links
// 2026-05-30 (Jürgen): 1-klik knop op mega.nz pages die de huidige URL
// (incl. #KEY fragment) naar /api/mega/download POSTet zodat mega_dl.py
// 'm op de achtergrond download via megatools.
//
// LET OP: alleen share-links met #KEY werken (publiek-gedeelde folders/files).
// Eigen ingelogde account-URLs zonder #KEY worden afgewezen door de server.
window.WEBDL_SITES = window.WEBDL_SITES || {};

const MEGA_HOSTS = ['mega.nz', 'mega.co.nz', 'www.mega.nz', 'www.mega.co.nz'];

function getCurrentMegaUrl() {
  // window.location.href bevat het #key fragment dat we nodig hebben.
  return String(window.location.href || '');
}

function hasMegaKey(url) {
  return /^https?:\/\/(?:www\.)?mega\.(?:nz|co\.nz)\/(?:file|folder)\/[A-Za-z0-9_-]+#[A-Za-z0-9_-]+/i.test(url);
}

function describeMegaUrl(url) {
  const m = url.match(/\/(file|folder)\/([A-Za-z0-9_-]+)/);
  if (!m) return '?';
  const kind = m[1];
  const id = m[2].slice(0, 8);
  return `${kind}/${id}…`;
}

const megaConfig = {
  label: 'mega',
  platform: 'mega',

  pageType() {
    return 'single';
  },

  // Default deriveChannel — engine roept dit altijd op voor channel-hint;
  // zonder def throwt het en worden extraButtons niet gerendeerd.
  deriveChannel(url) {
    try {
      const u = new URL(url, window.location.href);
      const m = String(u.pathname || '').match(/\/(file|folder)\/([A-Za-z0-9_-]+)/);
      if (m) return `${m[1]}_${m[2].slice(0, 12)}`;
    } catch (_) {}
    return 'mega';
  },

  itemTypes: [],

  extraButtons: [
    {
      label: '📥 Download deze mega (folder/file)',
      color: '#d9272e',  // mega-rood
      match() {
        // Toon de knop altijd op mega.nz pages; de validatie gebeurt on-click.
        return /(^|\.)mega\.(?:nz|co\.nz)$/i.test(location.hostname);
      },
      async onClick() {
        const url = getCurrentMegaUrl();
        if (!hasMegaKey(url)) {
          return {
            text: '✗ URL mist #KEY — gebruik "Get link" in mega-menu om share-link te kopiëren',
          };
        }
        try {
          const r = await fetch('http://localhost:35729/api/mega/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
          });
          const body = await r.json().catch(() => ({}));
          if (r.ok && body.success !== false) {
            return { text: `✓ ${describeMegaUrl(url)} gequeued (pid ${body.pid || '?'})` };
          }
          return { text: `✗ ${body.error || ('HTTP ' + r.status)}` };
        } catch (e) {
          return { text: `✗ ${String(e.message || e).slice(0, 60)}` };
        }
      },
    },
  ],
};

for (const host of MEGA_HOSTS) {
  window.WEBDL_SITES[host] = megaConfig;
}
