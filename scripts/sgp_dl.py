#!/usr/bin/env python3
"""sgp_dl.py — sexygirlspics.com scraper.

URL-types:
  /search/<term>/                  → listing (walk pages 1..N tot geen /pics/ meer)
  /pics/<slug>-<id>/               → single album (download alle 1280px images)

Single-album:
  - Fetch HTML; extract cdni.sexygirlspics.com/1280/.../<id>_NNN_<hash>.<ext>
  - Download elke image → /Volumes/WEBDL Extra/WEBDL/sexygirlspics/<channel>/<id>_<slug>/
  - INSERT public.downloads row per image (platform=sexygirlspics, status=completed)

Listing:
  - Walk pages /search/<term>/N/ tot geen nieuwe /pics/ links of 0 albums
  - Per album → single-album flow, channel = "search_<term>"
  - source_url = listing-URL (zodat alle albums onder de search-context vallen)

Gebruik:
  python3 sgp_dl.py https://sexygirlspics.com/search/sandals/
  python3 sgp_dl.py https://sexygirlspics.com/pics/<slug>/
  python3 sgp_dl.py <url> --max 20 --throttle-ms 200 --no-db
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.cookiejar import CookieJar

try:
    import psycopg2
except ImportError:
    psycopg2 = None


UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0'
BASE = 'https://sexygirlspics.com'
DEFAULT_BASE_DIR = os.environ.get('WEBDL_BASE_DIR') or '/Volumes/WEBDL Extra/WEBDL'

ALBUM_LINK_RE = re.compile(r"https://sexygirlspics\.com/pics/[A-Za-z0-9-]+-(\d+)/", re.IGNORECASE)
ALBUM_TITLE_RE = re.compile(r"<a[^>]*href='https://sexygirlspics\.com/pics/[A-Za-z0-9-]+-(\d+)/'\s+title='([^']+)'", re.IGNORECASE)
PIC_URL_RE = re.compile(r"^https?://(?:www\.)?sexygirlspics\.com/pics/([A-Za-z0-9-]+)-(\d+)/?$", re.IGNORECASE)
SEARCH_URL_RE = re.compile(r"^https?://(?:www\.)?sexygirlspics\.com/search/([A-Za-z0-9-]+)/?(?:(\d+)/?)?$", re.IGNORECASE)
SEARCH_NAV_RE_TMPL = r"/search/{term}/(\d+)/"
# 2026-05-30: generieke listing-categorie (bv. /beautiful/, /asian/, /feet/).
# Sluit interne paden uit (/pics/, /search/, /albums/, /tag/, /category/,
# /pornstars/) zodat we niet dubbel matchen.
LISTING_URL_RE = re.compile(
    r"^https?://(?:www\.)?sexygirlspics\.com/"
    r"(?!pics/|search/|albums?/|gallery/|galleries/|tag/|tags/|category/|categories/|pornstars/)"
    r"([a-z0-9-]+)/?(?:\?page=(\d+))?/?$",
    re.IGNORECASE,
)
IMAGE_1280_RE = re.compile(r"https://cdni\.sexygirlspics\.com/1280/\d+/\d+/(\d+)/(\1_\d+_[a-z0-9]+\.(?:jpg|jpeg|png|webp))", re.IGNORECASE)


def make_opener():
    cj = CookieJar()
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    o.addheaders = [('User-Agent', UA), ('Accept', 'text/html,application/xhtml+xml')]
    return o


def fetch_text(o, url, ref=None, timeout=25):
    req = urllib.request.Request(url)
    if ref:
        req.add_header('Referer', ref)
    with o.open(req, timeout=timeout) as r:
        return r.read().decode('utf-8', errors='replace')


def fetch_to_file(o, url, target, ref=None, timeout=120):
    req = urllib.request.Request(url)
    if ref:
        req.add_header('Referer', ref)
    with o.open(req, timeout=timeout) as r:
        tmp = target + '.part'
        with open(tmp, 'wb') as f:
            while True:
                chunk = r.read(128 * 1024)
                if not chunk:
                    break
                f.write(chunk)
        os.rename(tmp, target)
        return os.path.getsize(target)


def safe_dirname(s, fallback='album', maxlen=120):
    s = re.sub(r'[^\w\s.-]+', '_', s, flags=re.UNICODE).strip()
    s = re.sub(r'\s+', '_', s)
    return (s[:maxlen] or fallback)


def parse_pic_url(url):
    """Return (slug, id) for /pics/<slug>-<id>/ URL, else None."""
    m = PIC_URL_RE.match(url.rstrip('/') + '/')
    if not m:
        # try with no trailing slash
        m = PIC_URL_RE.match(url.rstrip('/'))
    if not m:
        # extract from URL even with extra slashes
        m2 = re.search(r"/pics/([A-Za-z0-9-]+)-(\d+)/?", url)
        if m2:
            return m2.group(1), m2.group(2)
        return None
    return m.group(1), m.group(2)


def parse_search_url(url):
    """Return (term, start_page) for /search/<term>/[N]/ URL, else None."""
    m = SEARCH_URL_RE.match(url.rstrip('/') + '/')
    if not m:
        return None
    return m.group(1), int(m.group(2) or '1')


def parse_listing_url(url):
    """Return (category, start_page) voor /<category>/?page=N URL, else None.

    Bv. https://sexygirlspics.com/beautiful/ → ('beautiful', 1).
    Sluit interne paden uit (pics/search/albums/tag/category/pornstars).
    """
    # Strip trailing slash voor regex match, ?page=N voor query
    base = url.split('#')[0]
    page_match = re.search(r'[?&]page=(\d+)', base)
    page = int(page_match.group(1)) if page_match else 1
    base_no_query = base.split('?')[0].rstrip('/')
    m = LISTING_URL_RE.match(base_no_query + '/')
    if not m:
        return None
    return m.group(1), page


def collect_pic_urls(html):
    """Return ordered list of (url, title, id, slug)."""
    seen = set()
    out = []
    # Prefer the variant with title= (richer)
    title_map = {}
    for m in re.finditer(r"<a[^>]*href='(https://sexygirlspics\.com/pics/([A-Za-z0-9-]+)-(\d+)/)'\s+title='([^']+)'", html):
        url, slug, pid, title = m.group(1), m.group(2), m.group(3), m.group(4)
        if pid in seen:
            continue
        seen.add(pid)
        title_map[pid] = title
        out.append((url, title, pid, slug))
    # Fallback: bare URLs without title
    for m in re.finditer(r"https://sexygirlspics\.com/pics/([A-Za-z0-9-]+)-(\d+)/", html):
        slug, pid = m.group(1), m.group(2)
        if pid in seen:
            continue
        seen.add(pid)
        url = f"https://sexygirlspics.com/pics/{slug}-{pid}/"
        out.append((url, slug.replace('-', ' '), pid, slug))
    return out


def extract_images_from_album(html):
    """Return ordered list of dicts {url, filename, pid}."""
    seen = set()
    out = []
    for m in IMAGE_1280_RE.finditer(html):
        pid, fname = m.group(1), m.group(2)
        if fname in seen:
            continue
        seen.add(fname)
        url = f"https://cdni.sexygirlspics.com/1280/1/{pid[-3:] if len(pid) >= 3 else pid}/{pid}/{fname}"
        # path-segment 3 (the "175" in samples) isn't always derivable from pid;
        # parse it back from the actual match instead
        full = re.search(r"https://cdni\.sexygirlspics\.com/1280/(\d+)/(\d+)/" + re.escape(pid) + "/" + re.escape(fname), html)
        if full:
            url = full.group(0)
        out.append({'url': url, 'filename': fname, 'pid': pid})
    return out


def extract_og_title(html):
    m = re.search(r'<meta\s+property="og:title"\s+content="([^"]+)"', html, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    m = re.search(r'<title>\s*([^<]+?)\s*</title>', html, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return ''


def download_album(o, album_url, channel, out_root, cur=None, sleep_ms=150, source_url=None):
    parsed = parse_pic_url(album_url)
    if not parsed:
        return {'ok': False, 'reason': 'parse_failed', 'url': album_url}
    slug, pid = parsed
    try:
        html = fetch_text(o, album_url, ref=BASE + '/')
    except Exception as e:
        return {'ok': False, 'reason': f'fetch_fail: {e}', 'url': album_url}

    images = extract_images_from_album(html)
    title = extract_og_title(html) or slug.replace('-', ' ')
    folder = safe_dirname(f"{pid}_{slug}")
    album_dir = os.path.join(out_root, folder)
    os.makedirs(album_dir, exist_ok=True)

    stats = {'ok': True, 'pid': pid, 'slug': slug, 'title': title, 'album_dir': album_dir,
             'images_total': len(images), 'images_new': 0, 'images_skip': 0, 'images_fail': 0}

    if not images:
        stats['ok'] = False
        stats['reason'] = 'no_images_in_html'
        return stats

    for i, img in enumerate(images, 1):
        target = os.path.join(album_dir, img['filename'])
        if os.path.exists(target) and os.path.getsize(target) > 1024:
            stats['images_skip'] += 1
            if cur is not None:
                register_in_db(cur, source_url or album_url, channel, target,
                               os.path.getsize(target), title, pid, slug, img['url'])
            continue
        try:
            size = fetch_to_file(o, img['url'], target, ref=album_url, timeout=60)
            if size < 1024:
                try: os.remove(target)
                except OSError: pass
                stats['images_fail'] += 1
                continue
            stats['images_new'] += 1
            if cur is not None:
                register_in_db(cur, source_url or album_url, channel, target, size, title, pid, slug, img['url'])
        except Exception as e:
            stats['images_fail'] += 1
            print(f"    IMG FAIL {img['filename']}: {e}")
        if sleep_ms > 0:
            time.sleep(sleep_ms / 1000)
    return stats


def register_in_db(cur, source_url, channel, filepath, size, title, pid, slug, content_url):
    now = datetime.now(tz=timezone.utc)
    try:
        mtime = datetime.fromtimestamp(os.path.getmtime(filepath), tz=timezone.utc)
    except OSError:
        mtime = now
    fmt = os.path.splitext(filepath)[1].lstrip('.').lower() or 'jpg'
    meta = {
        'adapter': 'sgp_dl',
        'platform': 'sexygirlspics',
        'kind': 'album_image',
        'album_id': pid,
        'album_slug': slug,
        'album_url': f"https://sexygirlspics.com/pics/{slug}-{pid}/",
        'source_url': source_url,
        'indexed_channel': channel,
        '_imported_at': now.isoformat(),
        '_import_source': 'sgp_dl.py',
    }
    try:
        cur.execute(
            """
            INSERT INTO public.downloads
              (url, source_url, platform, channel, title, filename, filepath,
               filesize, format, status, progress, metadata,
               created_at, updated_at, finished_at, is_thumb_ready, priority)
            VALUES
              (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
               %s, %s, %s, %s, %s)
            ON CONFLICT (filepath) DO NOTHING
            """,
            (
                content_url, source_url,
                'sexygirlspics', channel, (title or '')[:200],
                os.path.basename(filepath), filepath,
                size, fmt, 'completed', 100,
                json.dumps(meta),
                now, now, mtime,
                True, 0,
            ),
        )
    except Exception as e:
        # filepath has unique-index in some schemas; fall back without ON CONFLICT
        try:
            cur.execute(
                """
                INSERT INTO public.downloads
                  (url, source_url, platform, channel, title, filename, filepath,
                   filesize, format, status, progress, metadata,
                   created_at, updated_at, finished_at, is_thumb_ready, priority)
                SELECT %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                       %s, %s, %s, %s, %s
                WHERE NOT EXISTS (SELECT 1 FROM public.downloads WHERE filepath = %s)
                """,
                (
                    content_url, source_url,
                    'sexygirlspics', channel, (title or '')[:200],
                    os.path.basename(filepath), filepath,
                    size, fmt, 'completed', 100,
                    json.dumps(meta),
                    now, now, mtime,
                    True, 0,
                    filepath,
                ),
            )
        except Exception as e2:
            print(f"  DB error: {e2}")


def walk_listing(o, category, channel, out_root, cur, throttle_ms, max_albums, max_pages, source_url, start_page=1):
    """Walk een generieke listing-categorie (bv. /beautiful/?page=N).

    Pagination: /<category>/ → /<category>/?page=2 → /<category>/?page=3.
    Detecteert nieuwe pages via ?page=N anchors in HTML.
    """
    print(f"== Walk listing: {category} (channel={channel})")
    page_nav_re = re.compile(rf"/{re.escape(category)}/\?page=(\d+)", re.IGNORECASE)
    page = start_page
    all_urls = []
    seen = set()
    while page <= max_pages:
        purl = BASE + f"/{category}/" if page == 1 else BASE + f"/{category}/?page={page}"
        try:
            html = fetch_text(o, purl, ref=BASE + '/')
        except Exception as e:
            print(f"  page {page} fetch FAIL: {e}")
            break
        items = collect_pic_urls(html)
        new = [it for it in items if it[2] not in seen]
        for it in new:
            seen.add(it[2])
        print(f"  page {page}: {len(items)} albums ({len(new)} nieuw)")
        if not items or not new:
            break
        all_urls.extend(new)
        next_pages = [int(n) for n in page_nav_re.findall(html) if int(n) > page]
        if not next_pages:
            break
        page = min(next_pages)
        if max_albums and len(all_urls) >= max_albums:
            break
        time.sleep(throttle_ms / 1000)
    if max_albums:
        all_urls = all_urls[:max_albums]

    print(f"== Totaal: {len(all_urls)} albums")
    tot = {'ok': 0, 'fail': 0, 'i_new': 0, 'i_skip': 0, 'i_fail': 0}
    for i, (aurl, title, pid, slug) in enumerate(all_urls, 1):
        print(f"[{i}/{len(all_urls)}] {aurl}")
        s = download_album(o, aurl, channel, out_root, cur=cur,
                           sleep_ms=throttle_ms, source_url=source_url)
        if s.get('ok'):
            tot['ok'] += 1
            tot['i_new'] += s['images_new']
            tot['i_skip'] += s['images_skip']
            tot['i_fail'] += s['images_fail']
            print(f"  OK  imgs:+{s['images_new']}/skip{s['images_skip']}/fail{s['images_fail']} ({s['images_total']} totaal)")
        else:
            tot['fail'] += 1
            print(f"  FAIL: {s.get('reason')}")
    return tot


def walk_search(o, term, channel, out_root, cur, throttle_ms, max_albums, max_pages, source_url):
    print(f"== Walk search: {term} (channel={channel})")
    nav_re = re.compile(SEARCH_NAV_RE_TMPL.format(term=re.escape(term)))
    page = 1
    all_urls = []
    seen = set()
    while page <= max_pages:
        purl = BASE + f"/search/{term}/" if page == 1 else BASE + f"/search/{term}/{page}/"
        try:
            html = fetch_text(o, purl, ref=BASE + '/')
        except Exception as e:
            print(f"  page {page} fetch FAIL: {e}")
            break
        items = collect_pic_urls(html)
        new = [it for it in items if it[2] not in seen]
        for it in new:
            seen.add(it[2])
        print(f"  page {page}: {len(items)} albums ({len(new)} nieuw)")
        if not items or not new:
            break
        all_urls.extend(new)
        next_pages = [int(n) for n in nav_re.findall(html) if int(n) > page]
        if not next_pages:
            # No further pagination → done
            break
        page = min(next_pages)
        if max_albums and len(all_urls) >= max_albums:
            break
        time.sleep(throttle_ms / 1000)
    if max_albums:
        all_urls = all_urls[:max_albums]

    print(f"== Totaal: {len(all_urls)} albums")
    tot = {'ok': 0, 'fail': 0, 'i_new': 0, 'i_skip': 0, 'i_fail': 0}
    for i, (aurl, title, pid, slug) in enumerate(all_urls, 1):
        print(f"[{i}/{len(all_urls)}] {aurl}")
        s = download_album(o, aurl, channel, out_root, cur=cur,
                           sleep_ms=throttle_ms, source_url=source_url)
        if s.get('ok'):
            tot['ok'] += 1
            tot['i_new'] += s['images_new']
            tot['i_skip'] += s['images_skip']
            tot['i_fail'] += s['images_fail']
            print(f"  OK  imgs:+{s['images_new']}/skip{s['images_skip']}/fail{s['images_fail']} ({s['images_total']} totaal)")
        else:
            tot['fail'] += 1
            print(f"  FAIL: {s.get('reason')}")
    return tot


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('url', help='sexygirlspics URL (/search/<term>/ of /pics/<slug>-<id>/)')
    p.add_argument('--channel-override', default=None)
    p.add_argument('--no-db', action='store_true')
    p.add_argument('--db', default='dbname=webdl')
    p.add_argument('--throttle-ms', type=int, default=150)
    p.add_argument('--max', type=int, default=0, help='max aantal albums (0 = onbeperkt)')
    p.add_argument('--max-pages', type=int, default=200)
    args = p.parse_args()

    o = make_opener()

    # Detect URL type (volgorde: meest specifiek eerst)
    pic = parse_pic_url(args.url)
    search = parse_search_url(args.url)
    listing = None if (pic or search) else parse_listing_url(args.url)

    if not pic and not search and not listing:
        print(f"Onbekend URL-formaat: {args.url}", file=sys.stderr)
        sys.exit(1)

    conn = None
    cur = None
    if not args.no_db:
        if psycopg2 is None:
            print("WAARSCHUWING: psycopg2 niet beschikbaar — geen DB-registratie")
        else:
            conn = psycopg2.connect(args.db)
            conn.autocommit = True
            cur = conn.cursor()

    if pic:
        slug, pid = pic
        channel = args.channel_override or f"album_{pid}"
        out_root = os.path.join(DEFAULT_BASE_DIR, 'sexygirlspics', channel)
        os.makedirs(out_root, exist_ok=True)
        print(f"Album    : {args.url}")
        print(f"Channel  : {channel}")
        print(f"Output   : {out_root}")
        print()
        s = download_album(o, args.url, channel, out_root, cur=cur,
                           sleep_ms=args.throttle_ms, source_url=args.url)
        if s.get('ok'):
            print(f"Klaar. nieuw:{s['images_new']} skip:{s['images_skip']} fail:{s['images_fail']} totaal:{s['images_total']}")
        else:
            print(f"FAIL: {s.get('reason')}")
            sys.exit(1)
    elif search:
        term, _ = search
        channel = args.channel_override or f"search_{term}"
        out_root = os.path.join(DEFAULT_BASE_DIR, 'sexygirlspics', channel)
        os.makedirs(out_root, exist_ok=True)
        print(f"Search   : {term}")
        print(f"Channel  : {channel}")
        print(f"Output   : {out_root}")
        print()
        tot = walk_search(o, term, channel, out_root, cur,
                          args.throttle_ms, args.max, args.max_pages,
                          source_url=args.url)
        print()
        print(f"DONE. albums ok:{tot['ok']} fail:{tot['fail']}")
        print(f"      images nieuw:{tot['i_new']} skip:{tot['i_skip']} fail:{tot['i_fail']}")
        print(f"Gallery filter: platform=sexygirlspics channel={channel}")
    else:
        # generieke listing-categorie (bv. /beautiful/)
        category, start_page = listing
        channel = args.channel_override or f"category_{category}"
        out_root = os.path.join(DEFAULT_BASE_DIR, 'sexygirlspics', channel)
        os.makedirs(out_root, exist_ok=True)
        print(f"Listing  : {category} (start page {start_page})")
        print(f"Channel  : {channel}")
        print(f"Output   : {out_root}")
        print()
        tot = walk_listing(o, category, channel, out_root, cur,
                           args.throttle_ms, args.max, args.max_pages,
                           source_url=args.url, start_page=start_page)
        print()
        print(f"DONE. albums ok:{tot['ok']} fail:{tot['fail']}")
        print(f"      images nieuw:{tot['i_new']} skip:{tot['i_skip']} fail:{tot['i_fail']}")
        print(f"Gallery filter: platform=sexygirlspics channel={channel}")


if __name__ == '__main__':
    main()
