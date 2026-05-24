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

Output-dir default: <BASE_DIR>/footstockings/<channel>/<id>_<slug>/

Schrijft per image een rij naar public.downloads zodat het album in de
gallery verschijnt (platform=footstockings, channel=<slug>, status=
completed, is_thumb_ready=true). Dedup op filepath; rerun is veilig.

Bij --no-db slaat DB-registratie over (alleen disk).
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
    p.add_argument('--no-db', action='store_true', help='sla DB-registratie over (alleen disk-download)')
    p.add_argument('--db', default='dbname=webdl', help='Postgres conn string (default: dbname=webdl)')
    p.add_argument('--channel-override', default=None,
                   help='overschrijf de slug-derived channel met deze waarde (voor groepering '
                        'onder listing-context, bv. "search_flexible-feet-joi")')
    args = p.parse_args()

    album_id, slug = parse_album_url(args.url)
    channel = args.channel_override or slug
    out_dir = args.output_dir or os.path.join(DEFAULT_BASE_DIR, 'footstockings', channel, f'{album_id}_{slug}')

    print(f"Album    : {args.url}")
    print(f"Album-id : {album_id}")
    print(f"Slug     : {slug}")
    print(f"Channel  : {channel}{' (override)' if args.channel_override else ' (slug)'}")
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
    print(f"Disk klaar. Nieuw: {ok}, skip: {skip}, fout: {fail}, totaal: {len(pairs)}")
    print(f"Files in: {out_dir}")

    if args.no_db:
        return

    if psycopg2 is None:
        print()
        print("WARN: psycopg2 niet beschikbaar — DB-registratie overgeslagen.")
        print("      Install: pip3 install psycopg2-binary")
        return

    print()
    print("Inserteren in public.downloads voor gallery-zichtbaarheid…")
    conn = psycopg2.connect(args.db)
    cur = conn.cursor()
    cur.execute(
        "SELECT filepath FROM public.downloads WHERE filepath LIKE %s",
        (f'{out_dir}/%',),
    )
    existing = {r[0] for r in cur.fetchall()}
    now = datetime.now(tz=timezone.utc)
    inserted, db_skip, db_fail = 0, 0, 0
    for i, (aid, num) in enumerate(pairs, 1):
        target = os.path.join(out_dir, f'{num}.jpg')
        if not os.path.exists(target):
            continue
        if target in existing:
            db_skip += 1
            continue
        try:
            stat = os.stat(target)
        except OSError:
            db_fail += 1
            continue
        image_url = f'https://footstockings.com/contents/albums/sources/0/{aid}/{num}.jpg'
        title = f'{slug} #{num}'
        meta = {
            'adapter': 'foot_album_dl',
            'platform': 'footstockings',
            'kind': 'album_image',
            'album_id': aid,
            'album_slug': slug,
            'album_url': args.url,
            'image_id': num,
            'source_url': args.url,
            'source_thread_url': args.url,
            'source_thread_title': slug,
            'indexed_channel': channel,
            '_imported_at': now.isoformat(),
            '_import_source': 'foot_album_dl.py',
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
                """,
                (
                    image_url, args.url,
                    'footstockings', channel, title[:200],
                    f'{num}.jpg', target,
                    stat.st_size, 'jpg', 'completed', 100,
                    json.dumps(meta),
                    now, now,
                    datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
                    True,  # is_thumb_ready (image is z'n eigen thumb)
                    0,
                ),
            )
            conn.commit()
            inserted += 1
        except Exception as e:
            conn.rollback()
            db_fail += 1
            print(f"  DB ERROR {target}: {e}")
    print(f"DB klaar. Inserted: {inserted}, skip-bestaand: {db_skip}, fout: {db_fail}")
    print(f"Gallery filter: platform=footstockings channel={channel}")


if __name__ == '__main__':
    main()
