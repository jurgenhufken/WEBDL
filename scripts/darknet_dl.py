#!/usr/bin/env python3
"""Download videos van darknetvideos.com — een aggregator die voor elke
video een JSON-LD VideoObject schema met directe MP4 contentUrl serveert.

URL-types:
  /video.php?id=<id>                  → single video
  /index.php?...&search=<q>&page=N    → listing (paginatie via ?page=N)

Single video flow:
  1. fetch HTML met Cookie iam18over=yes
  2. extract JSON-LD VideoObject → contentUrl (mp4 op cdn5-videos.motherlessmedia.com)
  3. download met streaming + dedup op filepath
  4. registreer in public.downloads voor gallery-zichtbaarheid

Listing flow:
  1. fetch search HTML
  2. extract alle video.php?id= URLs
  3. voor elke: roep single-flow aan

Gebruik:
  python3 darknet_dl.py <url> [--channel-override X] [--no-db]
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
JSON_LD_RE = re.compile(r'<script type="application/ld\+json">\s*(\{.*?\})\s*</script>', re.DOTALL)
VIDEO_LINK_RE = re.compile(r'href="video\.php\?id=(\d+)([^"]*)"')
DEFAULT_BASE_DIR = os.environ.get('WEBDL_BASE_DIR') or '/Volumes/WEBDL Extra/WEBDL'


def make_opener():
    cj = CookieJar()
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    o.addheaders = [('User-Agent', UA), ('Cookie', 'iam18over=yes')]
    return o


def fetch_text(o, url, ref=None, timeout=30):
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
        with open(target, 'wb') as f:
            while True:
                chunk = r.read(128 * 1024)
                if not chunk:
                    break
                f.write(chunk)
        return os.path.getsize(target), r.headers.get('Content-Type', '')


def parse_jsonld(html):
    for m in JSON_LD_RE.findall(html):
        try:
            data = json.loads(m)
        except Exception:
            continue
        if isinstance(data, dict) and data.get('@type') == 'VideoObject':
            return data
    return None


def safe_filename(s, fallback='video'):
    s = re.sub(r'[^\w\s.-]+', '_', s, flags=re.UNICODE)
    s = re.sub(r'\s+', ' ', s).strip()
    return (s[:120] or fallback)


def download_single(o, video_url, channel, out_dir, cur=None):
    html = fetch_text(o, video_url, ref='https://darknetvideos.com/')
    ld = parse_jsonld(html)
    if not ld:
        return {'ok': False, 'error': 'geen JSON-LD VideoObject gevonden'}
    content_url = ld.get('contentUrl')
    if not content_url:
        return {'ok': False, 'error': 'geen contentUrl in JSON-LD'}
    title = ld.get('name') or 'video'
    safe = safe_filename(title)
    id_match = re.search(r'id=(\d+)', video_url)
    vid_id = id_match.group(1) if id_match else 'unknown'
    target = os.path.join(out_dir, f'{safe} [{vid_id}].mp4')
    if os.path.exists(target) and os.path.getsize(target) > 100 * 1024:
        return {'ok': True, 'skip': True, 'filepath': target, 'size': os.path.getsize(target)}
    os.makedirs(out_dir, exist_ok=True)
    try:
        size, ctype = fetch_to_file(o, content_url, target, ref=video_url, timeout=180)
    except Exception as e:
        try: os.remove(target)
        except OSError: pass
        return {'ok': False, 'error': f'download faalde: {e}'}
    if size < 50 * 1024:
        try: os.remove(target)
        except OSError: pass
        return {'ok': False, 'error': f'te klein ({size} bytes) — waarschijnlijk error-page'}
    result = {'ok': True, 'filepath': target, 'size': size, 'title': title, 'vid_id': vid_id, 'url': video_url, 'content_url': content_url}
    if cur is not None:
        register_in_db(cur, video_url, channel, target, size, title, vid_id, content_url, ld)
    return result


def register_in_db(cur, source_url, channel, filepath, size, title, vid_id, content_url, ld):
    now = datetime.now(tz=timezone.utc)
    try:
        mtime = datetime.fromtimestamp(os.path.getmtime(filepath), tz=timezone.utc)
    except OSError:
        mtime = now
    meta = {
        'adapter': 'darknet_dl',
        'platform': 'darknetvideos',
        'source_url': source_url,
        'content_url': content_url,
        'darknet_video_id': vid_id,
        'indexed_channel': channel,
        '_imported_at': now.isoformat(),
        '_import_source': 'darknet_dl.py',
    }
    if isinstance(ld, dict):
        if ld.get('duration'):
            meta['duration_iso'] = ld['duration']
        if ld.get('uploadDate'):
            meta['source_published_at'] = ld['uploadDate']
        if ld.get('thumbnailUrl'):
            meta['thumbnailUrl'] = ld['thumbnailUrl']
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
                source_url, source_url,
                'darknetvideos', channel, (title or '')[:200],
                os.path.basename(filepath), filepath,
                size, 'mp4', 'completed', 100,
                json.dumps(meta),
                now, now, mtime,
                False, 0,
            ),
        )
    except Exception as e:
        print(f"  DB error: {e}")


def collect_video_urls_from_listing(html):
    out = []
    seen = set()
    for vid, qs in VIDEO_LINK_RE.findall(html):
        full = f"https://darknetvideos.com/video.php?id={vid}{qs}"
        if vid in seen:
            continue
        seen.add(vid)
        out.append(full)
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('url', help='darknetvideos URL (video.php?id=… of search-page)')
    p.add_argument('--channel-override', default=None, help='channel-naam voor gallery-groepering')
    p.add_argument('--no-db', action='store_true', help='alleen disk, geen DB-registratie')
    p.add_argument('--db', default='dbname=webdl', help='Postgres conn-string')
    p.add_argument('--throttle-ms', type=int, default=500, help='pauze tussen video-downloads (default 500ms)')
    p.add_argument('--max', type=int, default=0, help='limiteer aantal videos (0 = onbeperkt)')
    args = p.parse_args()

    o = make_opener()
    parsed = urllib.parse.urlparse(args.url)
    is_single = parsed.path == '/video.php'

    if is_single:
        vid_match = re.search(r'id=(\d+)', parsed.query)
        if not vid_match:
            print(f"FOUT: geen id= in URL: {args.url}")
            sys.exit(1)
        vid = vid_match.group(1)
        channel = args.channel_override or f'video_{vid}'
        urls = [args.url]
    else:
        # listing: search of category
        qs = urllib.parse.parse_qs(parsed.query)
        search_term = qs.get('search', [''])[0]
        channel = args.channel_override or (
            f'search_{search_term}'.replace(' ', '-') if search_term else 'darknetvideos_listing'
        )
        print(f"Listing: {args.url}")
        html = fetch_text(o, args.url, ref='https://darknetvideos.com/')
        urls = collect_video_urls_from_listing(html)
        print(f"Gevonden: {len(urls)} unieke videos")

    out_dir = os.path.join(DEFAULT_BASE_DIR, 'darknetvideos', channel)
    print(f"Channel  : {channel}")
    print(f"Output   : {out_dir}")
    print()

    if args.max and len(urls) > args.max:
        urls = urls[:args.max]
        print(f"Beperkt tot --max {args.max}")

    conn = None
    cur = None
    if not args.no_db:
        if psycopg2 is None:
            print("WAARSCHUWING: psycopg2 niet beschikbaar, ga door zonder DB-registratie")
        else:
            conn = psycopg2.connect(args.db)
            conn.autocommit = True
            cur = conn.cursor()

    ok, skip, fail = 0, 0, 0
    for i, vu in enumerate(urls, 1):
        print(f"  [{i}/{len(urls)}] {vu[:80]}")
        try:
            res = download_single(o, vu, channel, out_dir, cur=cur)
        except Exception as e:
            fail += 1
            print(f"    EXC {e}")
            continue
        if res.get('skip'):
            skip += 1
            print(f"    SKIP bestaat al ({res.get('size')} bytes)")
        elif res.get('ok'):
            ok += 1
            print(f"    OK {res.get('size')} bytes")
        else:
            fail += 1
            print(f"    FAIL {res.get('error')}")
        if args.throttle_ms > 0 and i < len(urls):
            time.sleep(args.throttle_ms / 1000)

    print()
    print(f"Klaar. Nieuw: {ok}, skip: {skip}, fout: {fail}, totaal: {len(urls)}")
    print(f"Gallery filter: platform=darknetvideos channel={channel}")


if __name__ == '__main__':
    main()
