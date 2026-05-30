#!/usr/bin/env python3
"""Download videos+images van erome.com.

URL-types:
  /a/<ID>                       → single album (videos + images)
  /search?q=<query>&page=N      → search-listing
  /<username>                   → user-profile (zelfde patroon als search)

Single-album flow:
  1. fetch HTML
  2. extract <source src="https://v1.erome.com/.../<ID>/<file>_720p.mp4">  → videos
  3. extract data-src="https://s1.erome.com/.../<ID>/<file>.jpeg?v=N"     → images
  4. dedupe per file-id (strip query/size-suffix)
  5. download streaming, register in public.downloads

Listing-flow:
  1. fetch search/profile HTML
  2. extract href="https://www.erome.com/a/<ID>"
  3. voor elke album → single-album flow

Gebruik:
  python3 erome_dl.py <url> [--channel-override X] [--no-db] [--max N]
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
ALBUM_LINK_RE = re.compile(r'href="(https://www\.erome\.com/a/[A-Za-z0-9]+)"')
VIDEO_SRC_RE = re.compile(r'<source\s+src="(https://v[0-9]+\.erome\.com/[^"]+\.mp4)"', re.IGNORECASE)
IMG_DATA_SRC_RE = re.compile(r'data-src="(https://s[0-9]+\.erome\.com/[^"]+\.(?:jpe?g|png|webp))(?:\?[^"]*)?"', re.IGNORECASE)
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


def fetch_to_file(o, url, target, ref=None, timeout=180):
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
    m = re.search(r'/a/([A-Za-z0-9]+)', url)
    return m.group(1) if m else 'unknown'


def collect_album_urls_from_listing(html):
    seen = set()
    out = []
    for m in ALBUM_LINK_RE.findall(html):
        if m in seen:
            continue
        seen.add(m)
        out.append(m)
    return out


def extract_media_from_album(html):
    videos_seen = set()
    videos = []
    for v in VIDEO_SRC_RE.findall(html):
        if v in videos_seen:
            continue
        videos_seen.add(v)
        videos.append(v)
    images_seen = set()
    images = []
    for i in IMG_DATA_SRC_RE.findall(html):
        if i in images_seen:
            continue
        images_seen.add(i)
        images.append(i)
    title_m = TITLE_RE.search(html)
    title = title_m.group(1) if title_m else ''
    return {'videos': videos, 'images': images, 'title': title}


def download_album(o, album_url, channel, out_root, cur=None, sleep_ms=200):
    aid = album_id_from_url(album_url)
    html = fetch_text(o, album_url, ref='https://www.erome.com/')
    info = extract_media_from_album(html)
    title = info['title'] or f'album {aid}'
    safe = safe_filename(title)
    album_dir = os.path.join(out_root, f'{safe} [{aid}]')
    os.makedirs(album_dir, exist_ok=True)

    stats = {'ok': True, 'aid': aid, 'title': title, 'album_dir': album_dir,
             'videos_new': 0, 'videos_skip': 0, 'videos_fail': 0,
             'images_new': 0, 'images_skip': 0, 'images_fail': 0}

    for i, vu in enumerate(info['videos'], 1):
        fname = os.path.basename(urllib.parse.urlparse(vu).path)
        target = os.path.join(album_dir, fname)
        if os.path.exists(target) and os.path.getsize(target) > 50 * 1024:
            stats['videos_skip'] += 1
            continue
        try:
            size, ctype = fetch_to_file(o, vu, target, ref=album_url, timeout=300)
            if size < 20 * 1024:
                try: os.remove(target)
                except OSError: pass
                stats['videos_fail'] += 1
                continue
            stats['videos_new'] += 1
            if cur is not None:
                register_in_db(cur, album_url, channel, target, size, title, aid, vu, kind='video')
        except Exception as e:
            stats['videos_fail'] += 1
            print(f"    VID FAIL {vu[:80]} :: {e}")
        if sleep_ms > 0:
            time.sleep(sleep_ms / 1000)

    for i, iu in enumerate(info['images'], 1):
        fname = os.path.basename(urllib.parse.urlparse(iu).path)
        target = os.path.join(album_dir, fname)
        if os.path.exists(target) and os.path.getsize(target) > 1024:
            stats['images_skip'] += 1
            continue
        try:
            size, ctype = fetch_to_file(o, iu, target, ref=album_url, timeout=60)
            if size < 1024:
                try: os.remove(target)
                except OSError: pass
                stats['images_fail'] += 1
                continue
            stats['images_new'] += 1
            if cur is not None:
                register_in_db(cur, album_url, channel, target, size, title, aid, iu, kind='image')
        except Exception as e:
            stats['images_fail'] += 1
            print(f"    IMG FAIL {iu[:80]} :: {e}")
        if sleep_ms > 0:
            time.sleep(sleep_ms / 1000)

    return stats


def register_in_db(cur, source_url, channel, filepath, size, title, aid, content_url, kind='video'):
    now = datetime.now(tz=timezone.utc)
    try:
        mtime = datetime.fromtimestamp(os.path.getmtime(filepath), tz=timezone.utc)
    except OSError:
        mtime = now
    fmt = os.path.splitext(filepath)[1].lstrip('.').lower() or ('mp4' if kind == 'video' else 'jpg')
    meta = {
        'adapter': 'erome_dl',
        'platform': 'erome',
        'source_url': source_url,
        'content_url': content_url,
        'erome_album_id': aid,
        'kind': kind,
        'indexed_channel': channel,
        '_imported_at': now.isoformat(),
        '_import_source': 'erome_dl.py',
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
                'erome', channel, (title or '')[:200],
                os.path.basename(filepath), filepath,
                size, fmt, 'completed', 100,
                json.dumps(meta),
                now, now, mtime,
                (kind == 'image'), 0,
            ),
        )
    except Exception as e:
        print(f"  DB error: {e}")


def derive_channel_from_url(url, override=None):
    if override:
        return override
    p = urllib.parse.urlparse(url)
    path = p.path or ''
    if path.startswith('/a/'):
        return f'album_{album_id_from_url(url)}'
    if path.startswith('/search'):
        qs = urllib.parse.parse_qs(p.query)
        q = qs.get('q', [''])[0]
        return f'search_{q.replace(" ", "-")}' if q else 'erome_search'
    segs = [s for s in path.split('/') if s]
    if segs:
        return f'user_{segs[0]}'
    return 'erome'


def pagination_url(base_url, page):
    if page <= 1:
        return base_url
    p = urllib.parse.urlparse(base_url)
    qs = urllib.parse.parse_qs(p.query)
    qs['page'] = [str(page)]
    new_q = urllib.parse.urlencode(qs, doseq=True)
    return urllib.parse.urlunparse((p.scheme, p.netloc, p.path, p.params, new_q, p.fragment))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('url', help='erome URL (/a/<id> of /search?q=...)')
    p.add_argument('--channel-override', default=None)
    p.add_argument('--no-db', action='store_true')
    p.add_argument('--db', default='dbname=webdl')
    p.add_argument('--throttle-ms', type=int, default=300)
    p.add_argument('--max', type=int, default=0, help='max aantal albums (0 = onbeperkt)')
    p.add_argument('--pages', type=int, default=1, help='hoeveel listing-pages (1 = alleen huidige)')
    args = p.parse_args()

    o = make_opener()
    parsed = urllib.parse.urlparse(args.url)
    is_album = parsed.path.startswith('/a/')
    channel = derive_channel_from_url(args.url, override=args.channel_override)

    if is_album:
        album_urls = [args.url]
    else:
        album_urls = []
        for page in range(1, args.pages + 1):
            page_url = pagination_url(args.url, page) if page > 1 else args.url
            try:
                html = fetch_text(o, page_url, ref='https://www.erome.com/')
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

    out_root = os.path.join(DEFAULT_BASE_DIR, 'erome', channel)
    os.makedirs(out_root, exist_ok=True)
    print(f"Channel  : {channel}")
    print(f"Output   : {out_root}")
    print(f"Albums   : {len(album_urls)}")
    print()

    conn = None
    cur = None
    if not args.no_db:
        if psycopg2 is None:
            print("WAARSCHUWING: psycopg2 niet beschikbaar")
        else:
            conn = psycopg2.connect(args.db)
            conn.autocommit = True
            cur = conn.cursor()

    tot = {'ok': 0, 'fail': 0, 'v_new': 0, 'v_skip': 0, 'i_new': 0, 'i_skip': 0}
    for i, au in enumerate(album_urls, 1):
        print(f"[{i}/{len(album_urls)}] {au}")
        try:
            s = download_album(o, au, channel, out_root, cur=cur, sleep_ms=args.throttle_ms)
            if s.get('ok'):
                tot['ok'] += 1
                tot['v_new'] += s['videos_new']; tot['v_skip'] += s['videos_skip']
                tot['i_new'] += s['images_new']; tot['i_skip'] += s['images_skip']
                print(f"  OK  v:+{s['videos_new']}/skip{s['videos_skip']}/fail{s['videos_fail']}"
                      f"  i:+{s['images_new']}/skip{s['images_skip']}/fail{s['images_fail']}")
            else:
                tot['fail'] += 1
        except Exception as e:
            tot['fail'] += 1
            print(f"  EXC {e}")

    print()
    print(f"Klaar. Albums OK: {tot['ok']}, fail: {tot['fail']}")
    print(f"       Videos nieuw: {tot['v_new']}, skip: {tot['v_skip']}")
    print(f"       Images nieuw: {tot['i_new']}, skip: {tot['i_skip']}")
    print(f"Gallery filter: platform=erome channel={channel}")


if __name__ == '__main__':
    main()
