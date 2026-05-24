#!/usr/bin/env python3
"""Download photo-albums van pictoa.com.

URL-types:
  /albums/<slug>-<id>.html                      → single album
  /s/<query>/                                   → search-listing
  /pornstar/<name>/, /category/<cat>/, /tag/<x>/ → andere listings

Album-flow:
  1. fetch HTML
  2. extract <img src="https://t1.pictoa.com/media/galleries/.../*.jpg">
  3. dedupe per filename
  4. download streaming → register in DB

Listing-flow:
  1. fetch search/category HTML
  2. extract href="https://www.pictoa.com/albums/<slug>-<id>.html"
  3. dedupe; voor elke album → single-flow

Gebruik:
  python3 pictoa_dl.py <url> [--channel-override X] [--pages N] [--max N] [--no-db]
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
ALBUM_HREF_RE = re.compile(r'href="(https://(?:www\.)?pictoa\.com/albums/[^"]+-(\d+)\.html)"')
IMG_SRC_RE = re.compile(r'(?:src|data-src)="(https://[a-z0-9]+\.pictoa\.com/media/galleries/[^"]+\.(?:jpe?g|png|webp))"', re.IGNORECASE)
TITLE_RE = re.compile(r'<meta\s+property="og:title"\s+content="([^"]+)"', re.IGNORECASE)
DEFAULT_BASE_DIR = os.environ.get('WEBDL_BASE_DIR') or '/Volumes/WEBDL Extra/WEBDL'


def make_opener():
    cj = CookieJar()
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    o.addheaders = [('User-Agent', UA)]
    return o


def fetch_text(o, url, ref=None, timeout=30):
    req = urllib.request.Request(url)
    if ref:
        req.add_header('Referer', ref)
    with o.open(req, timeout=timeout) as r:
        return r.read().decode('utf-8', errors='replace')


def fetch_to_file(o, url, target, ref=None, timeout=60):
    req = urllib.request.Request(url)
    if ref:
        req.add_header('Referer', ref)
    with o.open(req, timeout=timeout) as r:
        with open(target, 'wb') as f:
            while True:
                chunk = r.read(128 * 1024)
                if not chunk:
                    break
                f.write(chunk)
        return os.path.getsize(target), r.headers.get('Content-Type', '')


def safe_filename(s, fallback='album'):
    s = re.sub(r'[^\w\s.-]+', '_', s, flags=re.UNICODE)
    s = re.sub(r'\s+', ' ', s).strip()
    return (s[:120] or fallback)


def album_id_from_url(url):
    m = re.search(r'-(\d+)\.html', url)
    return m.group(1) if m else 'unknown'


def collect_album_urls_from_listing(html):
    seen_ids = set()
    out = []
    for full_url, aid in ALBUM_HREF_RE.findall(html):
        if aid in seen_ids:
            continue
        # alleen .html zonder photo-id-suffix (dus geen /<id>/<photoid>.html)
        # Onze regex matched al zonder /<digits>/ ervoor.
        # Skip cross-promo locale-variants: alleen www.pictoa.com nemen
        if '://www.pictoa.com/' not in full_url and '://pictoa.com/' not in full_url:
            continue
        seen_ids.add(aid)
        out.append(full_url)
    return out


def extract_images_from_album(html):
    seen = set()
    images = []
    for m in IMG_SRC_RE.findall(html):
        # Dedupe per filename (laatste path-segment)
        fn = os.path.basename(urllib.parse.urlparse(m).path)
        if fn in seen:
            continue
        seen.add(fn)
        images.append(m)
    title_m = TITLE_RE.search(html)
    title = title_m.group(1) if title_m else ''
    return {'images': images, 'title': title}


def download_album(o, album_url, channel, out_root, cur=None, sleep_ms=150):
    aid = album_id_from_url(album_url)
    html = fetch_text(o, album_url, ref='https://www.pictoa.com/')
    info = extract_images_from_album(html)
    title = info['title'] or f'album {aid}'
    safe = safe_filename(title)
    album_dir = os.path.join(out_root, f'{safe} [{aid}]')
    os.makedirs(album_dir, exist_ok=True)

    stats = {'ok': True, 'aid': aid, 'title': title, 'album_dir': album_dir,
             'new': 0, 'skip': 0, 'fail': 0}

    for iu in info['images']:
        fname = os.path.basename(urllib.parse.urlparse(iu).path)
        target = os.path.join(album_dir, fname)
        if os.path.exists(target) and os.path.getsize(target) > 1024:
            stats['skip'] += 1
            continue
        try:
            size, ctype = fetch_to_file(o, iu, target, ref=album_url, timeout=60)
            if size < 1024:
                try: os.remove(target)
                except OSError: pass
                stats['fail'] += 1
                continue
            stats['new'] += 1
            if cur is not None:
                register_in_db(cur, album_url, channel, target, size, title, aid, iu)
        except Exception as e:
            stats['fail'] += 1
            print(f"    IMG FAIL {iu[:80]} :: {e}")
        if sleep_ms > 0:
            time.sleep(sleep_ms / 1000)
    return stats


def register_in_db(cur, source_url, channel, filepath, size, title, aid, content_url):
    now = datetime.now(tz=timezone.utc)
    try:
        mtime = datetime.fromtimestamp(os.path.getmtime(filepath), tz=timezone.utc)
    except OSError:
        mtime = now
    fmt = os.path.splitext(filepath)[1].lstrip('.').lower() or 'jpg'
    meta = {
        'adapter': 'pictoa_dl',
        'platform': 'pictoa',
        'source_url': source_url,
        'content_url': content_url,
        'pictoa_album_id': aid,
        'kind': 'image',
        'indexed_channel': channel,
        '_imported_at': now.isoformat(),
        '_import_source': 'pictoa_dl.py',
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
            ON CONFLICT DO NOTHING
            """,
            (
                content_url, source_url,
                'pictoa', channel, (title or '')[:200],
                os.path.basename(filepath), filepath,
                size, fmt, 'completed', 100,
                json.dumps(meta),
                now, now, mtime,
                True, 0,
            ),
        )
    except Exception as e:
        print(f"  DB error: {e}")


def derive_channel_from_url(url, override=None):
    if override:
        return override
    p = urllib.parse.urlparse(url)
    path = p.path or ''
    segs = [s for s in path.split('/') if s]
    if segs and segs[0] == 'albums' and segs[-1].endswith('.html'):
        return f'album_{album_id_from_url(url)}'
    if segs and segs[0] == 's' and len(segs) >= 2:
        return f'search_{segs[1]}'
    if segs and segs[0] in ('category', 'categories') and len(segs) >= 2:
        return f'category_{segs[1]}'
    if segs and segs[0] in ('tag', 'tags') and len(segs) >= 2:
        return f'tag_{segs[1]}'
    if segs and segs[0] == 'pornstar' and len(segs) >= 2:
        return f'pornstar_{segs[1]}'
    if len(segs) == 1:
        return segs[0]
    return 'pictoa'


def pagination_url(base_url, page):
    if page <= 1:
        return base_url
    # Pictoa listings gebruiken meestal /<path>/<page>/ of /<path>/?page=N.
    # Eerst proberen path-style /<path>/page/<N>/, fallback ?page=N.
    p = urllib.parse.urlparse(base_url)
    qs = urllib.parse.parse_qs(p.query)
    qs['page'] = [str(page)]
    new_q = urllib.parse.urlencode(qs, doseq=True)
    return urllib.parse.urlunparse((p.scheme, p.netloc, p.path, p.params, new_q, p.fragment))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('url')
    p.add_argument('--channel-override', default=None)
    p.add_argument('--no-db', action='store_true')
    p.add_argument('--db', default='dbname=webdl')
    p.add_argument('--throttle-ms', type=int, default=150)
    p.add_argument('--max', type=int, default=0, help='max aantal albums (0 = onbeperkt)')
    p.add_argument('--pages', type=int, default=1, help='hoeveel listing-pages te scannen')
    args = p.parse_args()

    o = make_opener()
    parsed = urllib.parse.urlparse(args.url)
    path = parsed.path or ''
    is_album = path.startswith('/albums/') and path.endswith('.html') and '/' not in path.removeprefix('/albums/').replace('.html', '')
    channel = derive_channel_from_url(args.url, override=args.channel_override)

    if is_album:
        album_urls = [args.url]
    else:
        album_urls = []
        for page in range(1, args.pages + 1):
            page_url = pagination_url(args.url, page) if page > 1 else args.url
            try:
                html = fetch_text(o, page_url, ref='https://www.pictoa.com/')
            except Exception as e:
                print(f"  LISTING page {page} FAIL: {e}")
                continue
            found = collect_album_urls_from_listing(html)
            print(f"  page {page}: {len(found)} albums")
            for a in found:
                if a not in album_urls:
                    album_urls.append(a)

    if args.max and len(album_urls) > args.max:
        album_urls = album_urls[:args.max]

    out_root = os.path.join(DEFAULT_BASE_DIR, 'pictoa', channel)
    os.makedirs(out_root, exist_ok=True)
    print(f"Channel  : {channel}")
    print(f"Output   : {out_root}")
    print(f"Albums   : {len(album_urls)}")
    print()

    conn = None; cur = None
    if not args.no_db:
        if psycopg2 is None:
            print("WAARSCHUWING: psycopg2 niet beschikbaar")
        else:
            conn = psycopg2.connect(args.db); conn.autocommit = True; cur = conn.cursor()

    tot = {'ok': 0, 'fail': 0, 'imgs_new': 0, 'imgs_skip': 0}
    for i, au in enumerate(album_urls, 1):
        print(f"[{i}/{len(album_urls)}] {au}")
        try:
            s = download_album(o, au, channel, out_root, cur=cur, sleep_ms=args.throttle_ms)
            if s.get('ok'):
                tot['ok'] += 1
                tot['imgs_new'] += s['new']; tot['imgs_skip'] += s['skip']
                print(f"  OK  +{s['new']} new, {s['skip']} skip, {s['fail']} fail")
            else:
                tot['fail'] += 1
        except Exception as e:
            tot['fail'] += 1
            print(f"  EXC {e}")

    print()
    print(f"Klaar. Albums OK: {tot['ok']}, fail: {tot['fail']}")
    print(f"       Images nieuw: {tot['imgs_new']}, skip: {tot['imgs_skip']}")
    print(f"Gallery filter: platform=pictoa channel={channel}")


if __name__ == '__main__':
    main()
