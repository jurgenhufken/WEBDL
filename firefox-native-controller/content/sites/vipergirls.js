// WEBDL site-config — vipergirls.to + viper.to
//
// EERSTE site die de NIEUWE STACK gebruikt (ARCHITECTURE.md fase 1-4):
// extension POSTt naar /api/jobs ipv directe /download per item.
// Scheduler in webdl-core/jobs/scheduler.js doet de inspect + dispatch
// server-side. Panel polt /api/jobs/:id voor live progress.
//
// Vlag `useJobsApi: true` schakelt site-engine om naar jobs-mode.
// Vipergirls/viper.to wordt hierdoor afgehandeld door site-engine,
// NIET meer door debug-toolbar.js (vipergirls.to staat nu in
// SITE_ENGINE_HOSTS van debug-toolbar.js).
window.WEBDL_SITES = window.WEBDL_SITES || {};
const VG_CONFIG = {
  label: 'vipergirls',
  platform: 'vipergirls',

  // NIEUWE FLAG: gebruik /api/jobs ipv per-item POST /download
  useJobsApi: true,

  pageType(path, search) {
    if (/^\/threads\/\d+-/.test(path)) return 'listing';
    if (/\/forumdisplay\.php/.test(path) || /^\/forums\/\d+-/.test(path)) return 'forum';
    if (path === '/forum.php' && /\bf=\d+/.test(search)) return 'forum';
    return null;
  },

  // Voor jobs-API hoeven we GEEN itemTypes te definiëren — server-side Source
  // doet de extract. Maar we houden een dummy zodat panel weet wat te tonen.
  itemTypes: [{
    name: 'media',
    match: () => false,        // niet relevant: items komen via /api/jobs
    selector: '',              // idem
    endpoint: '/api/jobs',
    buildBody: () => ({}),     // niet gebruikt
    singleLabel: '⬇ Download',
    listingNoun: 'media',
    color: '#2196F3',
  }],

  // Voor jobs-API: paginate/detectMaxPage niet gebruikt door engine —
  // server-side Source.inspect levert paginationUrls.
  paginationUrl: (b) => b,
  detectMaxPage: () => 1,

  deriveChannel(url) {
    try {
      const u = new URL(url, window.location.href);
      const m = u.pathname.match(/\/threads\/(\d+)-([^\/\?#]+)/);
      if (m) {
        const slug = String(m[2] || '').toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').slice(0, 40).replace(/-+$/, '');
        return slug ? `thread_${m[1]}_${slug}` : `thread_${m[1]}`;
      }
      const fm = (u.pathname + u.search).match(/(?:forumdisplay\.php\?[^#]*\bf=(\d+)|\/forums\/(\d+)-)/);
      if (fm) return `forum_${fm[1] || fm[2]}`;
    } catch (_) {}
    return 'vipergirls';
  },
};

window.WEBDL_SITES['vipergirls.to'] = VG_CONFIG;
window.WEBDL_SITES['viper.to'] = VG_CONFIG;
