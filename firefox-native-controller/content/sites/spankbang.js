// WEBDL site-config — spankbang.com (yt-dlp native)
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['spankbang.com'] = {
  label: 'spankbang',
  platform: 'spankbang',

  pageType(path) {
    // /<id>/video/<slug> single
    if (/^\/[a-z0-9]+\/video\/[^/]+\/?$/i.test(path)) return 'single';
    // /<user>/playlist/<name>/ — gebruiker-playlist (thread-achtig)
    if (/^\/[a-z0-9]+\/playlist\/[^/]+\/?/i.test(path)) return 'listing';
    if (/^\/(s|tag|category|categories|pornstar|model|playlist)\//i.test(path)) return 'listing';
    return null;
  },

  itemTypes: [
    {
      name: 'video',
      match: (p) => /^\/[a-z0-9]+\/video\/[^/]+\/?$/i.test(p),
      // Selector matcht zowel `/<id>/video/<slug>` als de playlist-thumb
      // `<a class="thumb" href="/<id>/playlist/<x>/video/<slug>">` — laatste
      // wordt door spankbang gebruikt op playlist-pages om play-context te
      // bewaren. We extracten alleen de video-id en bouwen de canonieke URL.
      selector: 'a[href*="/video/"]',
      endpoint: '/download',
      buildBody: (url, channel) => {
        // Normaliseer playlist-context URL → canonieke /<id>/video/<slug>
        try {
          const u = new URL(url);
          const m = u.pathname.match(/\/([a-z0-9]+)\/(?:playlist\/[^/]+\/)?video\/([^/?#]+)/i);
          if (m) {
            const clean = `https://spankbang.com/${m[1]}/video/${m[2]}/`;
            return { url: clean, platform: 'spankbang', channel, title: '' };
          }
        } catch (_) {}
        return { url, platform: 'spankbang', channel, title: '' };
      },
      singleLabel: '⬇ Download deze video',
      listingNoun: 'videos',
      color: '#2196F3',
    },
  ],

  // spankbang pagination:
  //   /s/<q>/<page>/                   (search)
  //   /<user>/playlist/<name>/<page>/  (user playlist)
  //   /<listing-path>?p=<page>         (catch-all)
  paginationUrl(baseHref, page) {
    if (page <= 1) return baseHref;
    try {
      const u = new URL(baseHref, window.location.href);
      const segs = u.pathname.split('/').filter(Boolean);
      if (segs[0] === 's' && segs[1]) {
        u.pathname = `/s/${segs[1]}/${page}/`;
        return u.toString();
      }
      // user/playlist/<name>[/<page>]
      if (segs.length >= 3 && segs[1] === 'playlist') {
        u.pathname = `/${segs[0]}/playlist/${segs[2]}/${page}/`;
        return u.toString();
      }
      u.searchParams.set('p', String(page));
      return u.toString();
    } catch (_) { return baseHref; }
  },

  deriveChannel(url) {
    try {
      const u = new URL(url, window.location.href);
      const segs = String(u.pathname || '').split('/').filter(Boolean);
      if (segs[0] === 's' && segs[1]) return `search_${segs[1]}`;
      if (segs[0] === 'tag' && segs[1]) return `tag_${segs[1]}`;
      if (segs[0] === 'pornstar' && segs[1]) return `pornstar_${segs[1]}`;
      if (segs[0] === 'category' && segs[1]) return `category_${segs[1]}`;
      // /<user>/playlist/<name>/ → playlist_<user>_<name>
      if (segs.length >= 3 && segs[1] === 'playlist') {
        return `playlist_${segs[0]}_${segs[2]}`;
      }
      // single /<id>/video/<slug> → video_<id>
      if (segs.length >= 3 && segs[1] === 'video') return `video_${segs[0]}`;
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'spankbang';
  },
};
