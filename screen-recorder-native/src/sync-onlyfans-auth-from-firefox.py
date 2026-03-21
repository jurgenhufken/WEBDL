#!/usr/bin/env python3
import argparse
import json
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path


def find_default_firefox_profile() -> Path:
    root = Path.home() / 'Library' / 'Application Support' / 'Firefox' / 'Profiles'
    if not root.exists():
        raise FileNotFoundError(f'Firefox profiles folder not found: {root}')
    profiles = [p for p in root.iterdir() if p.is_dir()]
    if not profiles:
        raise FileNotFoundError(f'No Firefox profiles found in: {root}')
    profiles.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return profiles[0]


def copy_sqlite_for_read(src: Path) -> Path:
    tmp = Path(tempfile.mkstemp(suffix=src.suffix)[1])
    shutil.copy2(src, tmp)
    return tmp


def read_onlyfans_cookies(profile: Path) -> dict:
    cookie_db = profile / 'cookies.sqlite'
    if not cookie_db.exists():
        raise FileNotFoundError(f'cookies.sqlite not found: {cookie_db}')
    tmp = copy_sqlite_for_read(cookie_db)
    try:
        con = sqlite3.connect(str(tmp))
        cur = con.cursor()
        cur.execute(
            "SELECT name, value FROM moz_cookies WHERE host IN ('onlyfans.com', '.onlyfans.com') AND name IN ('sess','auth_id','csrf','st','c','fp') ORDER BY name"
        )
        rows = cur.fetchall()
        return {str(k): str(v) for k, v in rows}
    finally:
        try:
            con.close()
        except Exception:
            pass
        try:
            tmp.unlink()
        except Exception:
            pass


def parse_cookie_string(cookie_str: str) -> list:
    out = []
    seen = set()
    for chunk in str(cookie_str or '').split(';'):
        chunk = chunk.strip()
        if not chunk or '=' not in chunk:
            continue
        key, value = chunk.split('=', 1)
        key = key.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append((key, value.strip()))
    return out


def build_cookie_string(existing_cookie: str, live_cookies: dict) -> str:
    existing_pairs = parse_cookie_string(existing_cookie)
    preserved = []
    auth_id = str(live_cookies.get('auth_id') or '')
    for key, value in existing_pairs:
        if key in live_cookies:
            continue
        if key.startswith('auth_uid_') or key.startswith('auth_uniq_') or key == 'auth_hash':
            preserved.append((key, value))
    ordered = []
    for key in ['auth_id', 'sess', 'csrf', 'st', 'c', 'fp']:
        value = live_cookies.get(key)
        if value is not None:
            ordered.append((key, value))
    if auth_id:
        has_auth_uid = any(k == f'auth_uid_{auth_id}' for k, _ in preserved)
        has_auth_uniq = any(k == f'auth_uniq_{auth_id}' for k, _ in preserved)
        if not has_auth_uid:
            preserved.append((f'auth_uid_{auth_id}', ''))
        if not has_auth_uniq:
            preserved.append((f'auth_uniq_{auth_id}', ''))
    if not any(k == 'auth_hash' for k, _ in preserved):
        preserved.append(('auth_hash', ''))
    ordered.extend(preserved)
    return '; '.join(f'{k}={v}' for k, v in ordered)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', default='', help='Firefox profile directory')
    parser.add_argument('--auth', default=str(Path.home() / '.config' / 'ofscraper' / 'auth.json'), help='Path to ofscraper auth.json')
    args = parser.parse_args()

    profile = Path(args.profile).expanduser() if args.profile else find_default_firefox_profile()
    auth_path = Path(args.auth).expanduser()
    if not auth_path.exists():
        raise FileNotFoundError(f'auth.json not found: {auth_path}')

    live_cookies = read_onlyfans_cookies(profile)
    required = ['sess', 'auth_id', 'fp']
    missing = [k for k in required if not live_cookies.get(k)]
    if missing:
        raise RuntimeError(f'Missing required live OnlyFans cookies in Firefox profile {profile}: {", ".join(missing)}')

    obj = json.loads(auth_path.read_text(encoding='utf-8'))
    if not isinstance(obj, dict):
        raise RuntimeError('auth.json root is not an object')
    auth = obj.get('auth')
    if not isinstance(auth, dict):
        auth = {}
        obj['auth'] = auth

    existing_cookie = str(auth.get('cookie') or '')
    auth['cookie'] = build_cookie_string(existing_cookie, live_cookies)
    auth['x_bc'] = str(live_cookies.get('fp') or auth.get('x_bc') or '')
    if not auth.get('user_agent'):
        auth['user_agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0'

    backup = auth_path.with_name(auth_path.name + '.pre_firefox_sync.bak')
    shutil.copy2(auth_path, backup)
    auth_path.write_text(json.dumps(obj, indent=2), encoding='utf-8')

    print(f'profile={profile}')
    print(f'auth={auth_path}')
    print(f'backup={backup}')
    print('cookies=' + ','.join(sorted(live_cookies.keys())))
    print('auth_id=' + str(live_cookies.get('auth_id', '')))
    print('sess_prefix=' + str(live_cookies.get('sess', ''))[:8])
    print('x_bc_prefix=' + str(auth.get('x_bc', ''))[:8])
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
