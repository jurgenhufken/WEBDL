#!/usr/bin/env python3
"""
foot_member_walk.py — walk een footstockings member-page, queue alle videos+albums.

Gebruik:
  python3 foot_member_walk.py <member-url>
  bv: python3 foot_member_walk.py https://footstockings.com/members/4675/

Wat het doet:
- Fetch member-page → extract member-naam (bv "Mia") + totaal videos + albums
- Walk alle video-pages (?from_videos=N waar N=1..pages)
- Walk alle album-pages (?from_albums=N waar N=1..pages)
- Per video: dedup-check via DB, anders POST naar http://localhost:35729/download
- Per album: dedup-check via DB, anders POST naar /api/footstockings/album
- Channel = member-naam (bv "Mia"), platform="footstockings"
- Logged stats: pages, items found, dispatched, duplicates skipped, errors

Geen dubbelen: queries directe SELECT in postgres voor existing URL.
"""

import sys
import re
import time
import json
import urllib.request
import urllib.parse
import subprocess
from urllib.error import HTTPError, URLError

SERVER = "http://localhost:35729"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Firefox/115.0",
    "Accept": "text/html,application/xhtml+xml",
}
PAGE_SLEEP_SEC = 1.0       # tussen page-fetches, beleefdheid
ITEM_SLEEP_SEC = 0.05      # tussen POST's (server kan dedup snel doen)
FETCH_TIMEOUT = 25
POST_TIMEOUT = 30          # server is mogelijk traag door andere scrape jobs
SKIP_LOCAL_DEDUP = True    # server doet z'n eigen dedup bij POST /download


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_member_page(html):
    """Extract name, video-count, album-count, max-page."""
    name_match = re.search(r"<h1[^>]*>\s*([^<]+?)'s\s*Page\s*</h1>", html, re.IGNORECASE)
    if not name_match:
        name_match = re.search(r"<title>\s*([^<']+?)'s\s*Page", html, re.IGNORECASE)
    name = name_match.group(1).strip() if name_match else "unknown"

    vcount = 0
    m = re.search(r"Videos\s*\(\s*(\d+)\s*\)", html)
    if m:
        vcount = int(m.group(1))

    acount = 0
    m = re.search(r"Albums\s*\(\s*(\d+)\s*\)", html)
    if m:
        acount = int(m.group(1))

    # Max page voor videos: hoogste from_videos:NN in HTML
    max_v_page = 1
    for m in re.finditer(r"from_videos[:=](\d+)", html):
        n = int(m.group(1))
        if n > max_v_page:
            max_v_page = n
    max_a_page = 1
    for m in re.finditer(r"from_albums[:=](\d+)", html):
        n = int(m.group(1))
        if n > max_a_page:
            max_a_page = n

    return {"name": name, "videos": vcount, "albums": acount, "max_v_page": max_v_page, "max_a_page": max_a_page}


def extract_video_urls(html):
    urls = set()
    for m in re.finditer(r'href="(https?://(?:www\.)?footstockings\.com/videos/\d+/[^"?#]+/?)"', html):
        urls.add(m.group(1))
    return sorted(urls)


def extract_album_urls(html):
    urls = set()
    for m in re.finditer(r'href="(https?://(?:www\.)?footstockings\.com/albums/\d+/[^"?#]+/?)"', html):
        urls.add(m.group(1))
    return sorted(urls)


def url_already_in_db(url):
    """Return True als deze URL al een row heeft in downloads (any status).
    Server doet z'n eigen dedup bij POST /download (geeft duplicate=true terug),
    dus deze lokale check is optioneel om POSTs te besparen."""
    if SKIP_LOCAL_DEDUP:
        return False
    try:
        safe = url.replace("'", "''")
        result = subprocess.run(
            ["psql", "-U", "jurgen", "-d", "webdl", "-tAc",
             f"SELECT 1 FROM downloads WHERE url = '{safe}' LIMIT 1"],
            capture_output=True, text=True, timeout=5
        )
        return result.stdout.strip() == "1"
    except Exception:
        return False


MEMBER_URL_GLOBAL = ""  # set in main() — gebruikt als source_url voor video/album rows


def post_download(url, channel, title=""):
    """Direct INSERT in DB als 'pending'. Sneller dan POST /download
    (vermijdt sync disk-IO + dedup-check op external HDDs). Scheduler pakt
    pending items automatisch op via auto-rehydrate. INSERT ... ON CONFLICT
    DO NOTHING geeft dedup gratis.
    """
    safe_url = url.replace("'", "''")
    safe_channel = channel.replace("'", "''")
    safe_title = title.replace("'", "''")
    safe_source = (MEMBER_URL_GLOBAL or url).replace("'", "''")
    metadata_json = json.dumps({"platform": "footstockings", "channel": channel, "title": title, "url": url, "source_member_url": MEMBER_URL_GLOBAL})
    safe_meta = metadata_json.replace("'", "''")
    sql = f"""
INSERT INTO downloads (url, platform, channel, title, status, metadata, source_url, created_at, updated_at)
SELECT '{safe_url}', 'footstockings', '{safe_channel}', '{safe_title}', 'pending', '{safe_meta}', '{safe_source}', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM downloads WHERE url = '{safe_url}')
RETURNING id;
"""
    try:
        result = subprocess.run(
            ["psql", "-U", "jurgen", "-d", "webdl", "-tAc", sql],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            return False, f"psql err: {result.stderr[:150]}"
        new_id = result.stdout.strip()
        if new_id:
            return True, f"inserted id={new_id}"
        else:
            return True, "duplicate (skipped)"
    except Exception as e:
        return False, f"exception: {e}"


def post_album(album_url, channel):
    """Direct INSERT album-row. Server-side endpoint /api/footstockings/album
    is voor on-demand resolve; voor batch is INSERT als 'pending' met
    platform=footstockings + filepath patroon /albums/ voldoende."""
    safe_url = album_url.replace("'", "''")
    safe_channel = channel.replace("'", "''")
    safe_source = (MEMBER_URL_GLOBAL or album_url).replace("'", "''")
    metadata_json = json.dumps({"platform": "footstockings", "channel": channel, "url": album_url, "webdl_kind": "album", "source_member_url": MEMBER_URL_GLOBAL})
    safe_meta = metadata_json.replace("'", "''")
    sql = f"""
INSERT INTO downloads (url, platform, channel, title, status, metadata, source_url, created_at, updated_at)
SELECT '{safe_url}', 'footstockings', '{safe_channel}', 'album', 'pending', '{safe_meta}', '{safe_source}', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM downloads WHERE url = '{safe_url}')
RETURNING id;
"""
    try:
        result = subprocess.run(
            ["psql", "-U", "jurgen", "-d", "webdl", "-tAc", sql],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            return False, f"psql err: {result.stderr[:150]}"
        new_id = result.stdout.strip()
        return True, f"inserted id={new_id}" if new_id else "duplicate (skipped)"
    except Exception as e:
        return False, f"exception: {e}"


def main():
    if len(sys.argv) < 2:
        print("Usage: foot_member_walk.py <member-url>")
        sys.exit(1)
    member_url = sys.argv[1].rstrip("/") + "/"
    if not re.match(r"^https?://(?:www\.)?footstockings\.com/members/\d+/?", member_url):
        print(f"Geen geldige footstockings member URL: {member_url}")
        sys.exit(1)

    print(f"== Member URL: {member_url}")
    global MEMBER_URL_GLOBAL
    MEMBER_URL_GLOBAL = member_url  # gebruikt als source_url in INSERTs
    html = fetch(member_url)
    info = parse_member_page(html)
    name = info["name"]
    channel = name  # gebruik member-naam als channel
    print(f"== Member: {name!r}  videos={info['videos']}  albums={info['albums']}  v_pages={info['max_v_page']}  a_pages={info['max_a_page']}")

    stats = {"v_dispatched": 0, "v_dup": 0, "v_err": 0, "a_dispatched": 0, "a_dup": 0, "a_err": 0, "pages": 0}

    # ---- Videos ----
    if info["videos"] > 0:
        for page in range(1, max(1, info["max_v_page"]) + 1):
            url = member_url + f"?from_videos={page}"
            try:
                page_html = fetch(url) if page > 1 else html
            except Exception as e:
                print(f"  page {page} fetch FAIL: {e}")
                continue
            stats["pages"] += 1
            urls = extract_video_urls(page_html)
            print(f"  v_page {page}/{info['max_v_page']}: {len(urls)} video links")
            for vurl in urls:
                if url_already_in_db(vurl):
                    stats["v_dup"] += 1
                    continue
                # title uit URL slug
                title = vurl.rstrip("/").rsplit("/", 1)[-1].replace("-", " ").title()
                ok, msg = post_download(vurl, channel, title)
                if ok:
                    stats["v_dispatched"] += 1
                else:
                    stats["v_err"] += 1
                    print(f"    POST fail {vurl}: {msg}")
                time.sleep(ITEM_SLEEP_SEC)
            if page < info["max_v_page"]:
                time.sleep(PAGE_SLEEP_SEC)

    # ---- Albums ----
    if info["albums"] > 0:
        for page in range(1, max(1, info["max_a_page"]) + 1):
            url = member_url + f"albums/?from_albums={page}"
            try:
                page_html = fetch(url)
            except Exception as e:
                print(f"  a_page {page} fetch FAIL: {e}")
                continue
            stats["pages"] += 1
            urls = extract_album_urls(page_html)
            print(f"  a_page {page}/{info['max_a_page']}: {len(urls)} album links")
            for aurl in urls:
                if url_already_in_db(aurl):
                    stats["a_dup"] += 1
                    continue
                ok, msg = post_album(aurl, channel)
                if ok:
                    stats["a_dispatched"] += 1
                else:
                    stats["a_err"] += 1
                    print(f"    POST fail {aurl}: {msg}")
                time.sleep(ITEM_SLEEP_SEC)
            if page < info["max_a_page"]:
                time.sleep(PAGE_SLEEP_SEC)

    print()
    print(f"== DONE: {channel}")
    print(f"   videos: {stats['v_dispatched']} dispatched, {stats['v_dup']} duplicates, {stats['v_err']} errors")
    print(f"   albums: {stats['a_dispatched']} dispatched, {stats['a_dup']} duplicates, {stats['a_err']} errors")
    print(f"   pages_scanned: {stats['pages']}")


if __name__ == "__main__":
    main()
