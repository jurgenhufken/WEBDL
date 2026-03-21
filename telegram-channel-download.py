#!/usr/bin/env python3
import os
import sys
import asyncio
from telethon import TelegramClient
from telethon.tl.types import MessageMediaPhoto, MessageMediaDocument

# Using Telegram Desktop API credentials (public, used by many open source tools)
API_ID = 2040
API_HASH = 'b18441a1ff607e10a989891a5462e627'

PHONE = os.getenv('TELEGRAM_PHONE', '')
SESSION_DIR = os.path.expanduser('~/.tdl')
SESSION_NAME = os.path.join(SESSION_DIR, 'webdl_telegram.session')

async def download_message(client, message, output_dir, semaphore, stats):
    """Download a single message's media with concurrency control"""
    async with semaphore:
        try:
            path = await message.download_media(file=output_dir)
            if path:
                stats['count'] += 1
                print(f"✅ [{stats['count']}] Downloaded: {os.path.basename(path)}")
            return True
        except Exception as e:
            print(f"⚠️  Error downloading message {message.id}: {e}")
            return False

async def download_channel(chat_id, output_dir, limit=None, parallel=5):
    """Download all media from a Telegram channel/chat with parallel downloads"""
    client = TelegramClient(SESSION_NAME, API_ID, API_HASH)
    
    # Use existing session if available, otherwise prompt for login
    if PHONE:
        await client.start(phone=PHONE)
    else:
        await client.start()
    print(f"✅ Connected to Telegram")
    
    try:
        # Convert chat ID to proper format
        # For groups/channels, Telegram uses -100<id> format
        cid = int(chat_id)
        if cid > 0:
            cid = -1000000000000 - cid
        
        print(f"📋 Using chat ID: {cid}")
        entity = await client.get_entity(cid)
        print(f"📥 Downloading from: {entity.title}")
        print(f"⚡ Parallel downloads: {parallel} simultaneous")
        
        os.makedirs(output_dir, exist_ok=True)
        
        # Collect all messages with media first
        download_tasks = []
        semaphore = asyncio.Semaphore(parallel)
        stats = {'count': 0}
        
        async for message in client.iter_messages(entity, limit=limit):
            if message.media and isinstance(message.media, (MessageMediaPhoto, MessageMediaDocument)):
                print(f"📎 Message {message.id}: {type(message.media).__name__}")
                download_tasks.append(download_message(client, message, output_dir, semaphore, stats))
            elif message.media:
                print(f"📎 Message {message.id}: {type(message.media).__name__} (skipped)")
            else:
                print(f"💬 Message {message.id}: geen media")
        
        # Download all in parallel (controlled by semaphore)
        if download_tasks:
            print(f"\n⚡ Starting {len(download_tasks)} downloads...")
            await asyncio.gather(*download_tasks)
        
        print(f"\n🎉 Done! Downloaded {stats['count']} files to {output_dir}")
    
    finally:
        await client.disconnect()

if __name__ == '__main__':
    
    if len(sys.argv) < 3:
        print("Usage: python telegram-channel-download.py <chat_id> <output_dir> [limit] [parallel]")
        print("Example: python telegram-channel-download.py 2594686490 ~/Downloads/WEBDL/telegram/test/ 50 10")
        print("  - parallel: number of simultaneous downloads (default: 5, max recommended: 10)")
        sys.exit(1)
    
    chat_id = sys.argv[1]
    output_dir = sys.argv[2]
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else None
    parallel = int(sys.argv[4]) if len(sys.argv) > 4 else 5
    
    asyncio.run(download_channel(chat_id, output_dir, limit, parallel))
