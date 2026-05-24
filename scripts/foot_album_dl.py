#!/usr/bin/env python3
"""Download een footstockings.com album: alle full-size images.

Footstockings serveert album-pages met thumbnail-URLs in
data-original="https://footstockings.com/contents/albums/main/200x150/0/<album-id>/<num>.jpg"

De full-size variant zit op:
  /contents/albums/sources/0/<album-id>/<num>.jpg

Beide vereisen een PHPSESSID cookie + referer header. Dit script
maakt zelf een sessie (haalt homepage → krijg cookies → fetch album).

Usage:
  python3 foot_album_dl.py <album-url> [output-dir]

Output-dir default: ~/WEBDL/footstockings/<channel>/<id>_<slug>/

Geen schrijven naar DB — dit script schrijft alleen files naar disk.
Voor gallery-zichtbaarheid: run scripts/foot_album_import.py daarna,
of laat simple-server's auto-import scanner het oppakken.
"""
import argparse
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar


UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0'
ALBUM_URL_RE = re.compile(r'^/albums/(\d+)/([^/]+)/?$')
THUMB_PATTERN_RE = re.compile(
    r'data-original="https://footstockings\.com/contents/albums/main/\d+x\d+/0/(\d+)/(\d+)\.jpg"',
    re.IGNORECASE,
)
DEFAULT_BASE_DIR = os.environ.get('WEBDL_BASE_DIR') or '/Volumes/WEBDL Extra/WEBDL'


def make_opener():
    cj = CookieJar()
    handler = urllib.request.HTTPCookieProcessor(cj)
    opener = urllib.request.build_opener(handler)
    opener.addheaders = [('User-Agent', UA)]
    return opener, cj


def get(opener, url, referer=None, save_to=None):
    req = urllib.request.Request(url)
    if referer:
        req.add_header('Referer', referer)
    with opener.open(req, timeout=20) as resp:
        if save_to:
            with open(save_to, 'wb') as f:
                while True:
                    chunk = resp.read(64 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
            return resp.status, os.path.getsize(save_to)
        return resp.status, resp.read()


def parse_album_url(album_url):
    parsed = urllib.parse.urlparse(album_url)
    if parsed.netloc and 'footstockings.com' not in parsed.netloc.lower():
        raise ValueError(f"URL is geen footstockings: {album_url}")
    m = ALBUM_URL_RE.match(parsed.path.rstrip('/') + '/')
    if not m:
        raise ValueError(f"URL is geen /albums/<id>/<slug>/: {album_url}")
    return m.group(1), m.group(2)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('url', help='https://footstockings.com/albums/<id>/<slug>/')
    p.add_argument('output_dir', nargs='?', default=None, help='target folder (default per channel/album)')
    p.add_argument('--throttle-ms', type=int, default=200, help='ms tussen image-downloads (default 200)')
    p.add_argument('--dry-run', action='store_true', help='alleen tellen, niet downloaden')
    args = p.parse_args()

    album_id, slug = parse_album_url(args.url)
    out_dir = args.output_dir or os.path.join(DEFAULT_BASE_DIR, 'footstockings', slug, f'{album_id}_{slug}')

    print(f"Album    : {args.url}")
    print(f"Album-id : {album_id}")
    print(f"Slug     : {slug}")
    print(f"Output   : {out_dir}")
    print(f"Mode     : {'DRY-RUN' if args.dry_run else 'DOWNLOAD'}")
    print()

    opener, cj = make_opener()

    # Stap 1: homepage voor sessie-cookies
    print("Sessie aanmaken (homepage)…")
    status, _ = get(opener, 'https://footstockings.com/')
    php = next((c.value for c in cj if c.name == 'PHPSESSID'), None)
    print(f"  HTTP {status}, PHPSESSID = {php[:12] + '…' if php else '(geen)'}")

    # Stap 2: album-page voor image-IDs
    print(f"Album-page ophalen…")
    status, html = get(opener, args.url, referer='https://footstockings.com/')
    print(f"  HTTP {status}, {len(html)} bytes")
    matches = THUMB_PATTERN_RE.findall(html.decode('utf-8', errors='replace'))
    # Dedup, behoud volgorde
    seen = set()
    pairs = []
    for aid, num in matches:
        key = (aid, num)
        if key not in seen:
            seen.add(key)
            pairs.append(key)
    print(f"  Gevonden: {len(pairs)} unieke images")
    print()

    if not pairs:
        print("Geen images gevonden — sessie/auth probleem?")
        sys.exit(1)

    if args.dry_run:
        print("Eerste 5 image-URLs die zouden gedownload worden:")
        for aid, num in pairs[:5]:
            print(f"  https://footstockings.com/contents/albums/sources/0/{aid}/{num}.jpg")
        print()
        print(f"(DRY-RUN. Run zonder --dry-run om alle {len(pairs)} te downloaden.)")
        sys.exit(0)

    # Stap 3: download elk full-size image
    os.makedirs(out_dir, exist_ok=True)
    referer = args.url
    ok, fail, skip = 0, 0, 0
    for i, (aid, num) in enumerate(pairs, 1):
        target = os.path.join(out_dir, f'{num}.jpg')
        if os.path.exists(target) and os.path.getsize(target) > 0:
            skip += 1
            print(f"  [{i}/{len(pairs)}] {num}.jpg — bestaat al ({os.path.getsize(target)} bytes)")
            continue
        url = f'https://footstockings.com/contents/albums/sources/0/{aid}/{num}.jpg'
        try:
            status, size = get(opener, url, referer=referer, save_to=target)
            if status == 200 and size > 0:
                ok += 1
                print(f"  [{i}/{len(pairs)}] {num}.jpg — {size} bytes")
            else:
                fail += 1
                print(f"  [{i}/{len(pairs)}] {num}.jpg — HTTP {status} size={size}")
                try: os.remove(target)
                except OSError: pass
        except Exception as e:
            fail += 1
            print(f"  [{i}/{len(pairs)}] {num}.jpg — FAIL {e}")
        if args.throttle_ms > 0:
            time.sleep(args.throttle_ms / 1000)

    print()
    print(f"Klaar. Nieuw: {ok}, skip: {skip}, fout: {fail}, totaal: {len(pairs)}")
    print(f"Files in: {out_dir}")


if __name__ == '__main__':
    main()
