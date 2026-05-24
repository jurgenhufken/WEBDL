#!/usr/bin/env python3
"""Download channel profile-photo via Telethon (read-only).

Usage:
  python3 tg_channel_photo.py <channel_id> <output_dir>

Gebruikt de bestaande tdl-session ~/.tdl/webdl_telegram.session. Maakt een
kopie naar /tmp als de session gelocked is door een ander tdl-proces,
zodat de download parallel kan lopen.
"""
import asyncio
import os
import shutil
import sys
import sqlite3

from telethon import TelegramClient

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


async def main(channel_id_str, output_dir):
    channel_id = int(channel_id_str)
    os.makedirs(output_dir, exist_ok=True)
    out_base = os.path.join(output_dir, f'_channel_profile_{channel_id}')

    session = resolve_session_path()
    client = TelegramClient(session, API_ID, API_HASH)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            print("ERROR: session not authorized")
            return 1
        entity = await client.get_entity(channel_id)
        members = getattr(entity, 'participants_count', None) or '?'
        print(f"Channel: {entity.title!r} (id={entity.id}, members≈{members})")
        path = await client.download_profile_photo(entity, file=out_base)
        if path:
            print(f"OK: saved {path}  ({os.path.getsize(path)} bytes)")
            return 0
        print("Geen profielfoto beschikbaar")
        return 2
    finally:
        await client.disconnect()


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <channel_id> <output_dir>")
        sys.exit(1)
    sys.exit(asyncio.run(main(sys.argv[1], sys.argv[2])))
