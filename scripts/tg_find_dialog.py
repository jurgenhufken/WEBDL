#!/usr/bin/env python3
"""Read-only Telethon lookup: zoek dialogs (channels/groups/users) op naam.

Usage:
  python3 tg_find_dialog.py [zoekwoord]   # default: 'feet'

Toont per match: kind, id, members, naam, @username (of 'private'),
en bruikbare t.me link. Voor private channels zonder @username:
gebruik 'https://t.me/c/<id>' als URL voor downloads.

Gebruikt de bestaande tdl-session ~/.tdl/webdl_telegram.session;
kopieert naar /tmp als de session gelocked is door een tdl-job.
"""
import asyncio
import os
import shutil
import sqlite3
import sys

from telethon import TelegramClient
from telethon.tl.types import Channel

API_ID = 2040
API_HASH = 'b18441a1ff607e10a989891a5462e627'
DEFAULT_SESSION = os.path.expanduser('~/.tdl/webdl_telegram.session')


def resolve_session_path():
    override = os.environ.get('TG_SESSION')
    if override:
        return override
    if not os.path.exists(DEFAULT_SESSION):
        raise SystemExit(f"Session ontbreekt: {DEFAULT_SESSION}")
    try:
        conn = sqlite3.connect(DEFAULT_SESSION, timeout=0.5)
        conn.execute('SELECT 1 FROM sessions LIMIT 1')
        conn.close()
        return DEFAULT_SESSION
    except sqlite3.OperationalError:
        tmp = '/tmp/tg_lookup.session'
        shutil.copyfile(DEFAULT_SESSION, tmp)
        return tmp


SESSION = resolve_session_path()


def fmt(d):
    e = d.entity
    name = getattr(e, 'title', None) or getattr(e, 'first_name', '') or '<no name>'
    uname = getattr(e, 'username', None)
    eid = getattr(e, 'id', None)
    kind = type(e).__name__
    members = ''
    if isinstance(e, Channel):
        members = f"  members≈{getattr(e, 'participants_count', '?')}"
        if getattr(e, 'broadcast', False):
            kind = 'Channel(broadcast)'
        elif getattr(e, 'megagroup', False):
            kind = 'Channel(megagroup)'
    uname_str = f"@{uname}" if uname else "(no @username — private)"
    link = f"https://t.me/{uname}" if uname else "(no public link — needs invite)"
    return f"  [{kind}] id={eid}{members}\n    name : {name!r}\n    user : {uname_str}\n    url  : {link}"


async def main():
    client = TelegramClient(SESSION, API_ID, API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        print("ERROR: session not authorized")
        return
    me = await client.get_me()
    print(f"Logged in als: {me.first_name} (id={me.id})")
    print()

    needle = sys.argv[1].lower() if len(sys.argv) > 1 else 'feet'
    print(f"Zoeken naar dialogs met '{needle}' in display-name of @username...")
    print()

    matches = []
    async for d in client.iter_dialogs(limit=None):
        e = d.entity
        name = (getattr(e, 'title', '') or getattr(e, 'first_name', '') or '').lower()
        uname = (getattr(e, 'username', '') or '').lower()
        if needle in name or needle in uname:
            matches.append(d)

    if not matches:
        print(f"Geen matches voor '{needle}'")
    else:
        print(f"=== {len(matches)} match(es) ===")
        for d in matches:
            print(fmt(d))
            print()

    await client.disconnect()


asyncio.run(main())
