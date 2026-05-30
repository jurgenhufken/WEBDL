// WEBDL site-config — Telegram (t.me, web.telegram.org, t.me/s/<channel>)
// 2026-05-30 (Jürgen): 1-klik knop voor "Download volledig kanaal" zodat een
// publieke telegram-channel (zoals t.me/s/FeetGirlClub) direct via tdl wordt
// gequeued zonder dat de gebruiker URL hoeft te kopiëren.
window.WEBDL_SITES = window.WEBDL_SITES || {};

const TELEGRAM_HOSTS = ['t.me', 'telegram.me', 'web.telegram.org'];

function extractTelegramChannel(url) {
  try {
    const u = new URL(url);
    // t.me/s/<channel>  of  t.me/<channel>  of  t.me/<channel>/<post-id>
    const m = u.pathname.match(/^\/(?:s\/)?([A-Za-z0-9_]+)/);
    if (m) return m[1];
    // web.telegram.org/k/#@channel
    const hashMatch = String(u.hash || '').match(/#@([A-Za-z0-9_]+)/);
    if (hashMatch) return hashMatch[1];
    return '';
  } catch (e) { return ''; }
}

const telegramConfig = {
  label: 'telegram',
  platform: 'telegram',

  pageType(path) {
    // Channel-preview /s/<channel> of /<channel> = channel-page → "single" intent
    return 'single';
  },

  // Geen automatisch geëxtraheerde itemTypes — telegram heeft tdl-tool nodig
  itemTypes: [],

  extraButtons: [
    {
      label: '📥 Download volledig kanaal (tdl)',
      color: '#0088cc',  // telegram-blauw
      match(ctx) {
        const ch = extractTelegramChannel(location.href);
        return Boolean(ch);
      },
      async onClick(ctx) {
        const channel = extractTelegramChannel(location.href);
        if (!channel) return { text: '✗ Geen kanaal-naam' };
        const url = `https://t.me/${channel}`;
        const subs = (document.body.innerText.match(/([\d.,]+K?)\s+subscribers/i) || [])[1] || '?';
        try {
          // POST direct naar /download endpoint — server-side slave-router
          // routes telegram URLs naar tdl voor whole-channel download.
          const r = await fetch('http://localhost:35729/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url,
              metadata: {
                platform: 'telegram',
                channel,
                title: `${channel} (${subs} subscribers)`,
                webdl_kind: 'channel',
                whole_channel: true,
              },
            }),
          });
          const body = await r.json().catch(() => ({}));
          if (r.ok && body.success !== false) {
            return { text: `✓ ${channel} gequeued` };
          }
          return { text: `✗ ${body.error || ('HTTP ' + r.status)}` };
        } catch (e) {
          return { text: `✗ ${String(e.message || e).slice(0, 40)}` };
        }
      },
    },
    {
      label: '🖼 Alleen foto\'s (photos)',
      color: '#5cb85c',
      match(ctx) {
        return Boolean(extractTelegramChannel(location.href));
      },
      async onClick(ctx) {
        const channel = extractTelegramChannel(location.href);
        if (!channel) return { text: '✗ Geen kanaal-naam' };
        const url = `https://t.me/${channel}`;
        try {
          const r = await fetch('http://localhost:35729/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url,
              metadata: {
                platform: 'telegram',
                channel,
                title: `${channel} (photos only)`,
                webdl_kind: 'channel',
                whole_channel: true,
                tdl_filter: 'photos',
              },
            }),
          });
          const body = await r.json().catch(() => ({}));
          return { text: r.ok ? `✓ ${channel} photos gequeued` : `✗ ${body.error || 'fail'}` };
        } catch (e) {
          return { text: `✗ ${String(e.message || e).slice(0, 40)}` };
        }
      },
    },
  ],
};

// Registreer voor alle telegram-hosts
for (const host of TELEGRAM_HOSTS) {
  window.WEBDL_SITES[host] = telegramConfig;
}
