#!/usr/bin/env python3
"""
🤖 Telegram Trips Bot — Tự động bắt mã chuyến đi và ghi nhận dỡ hàng lên Supabase.
Chạy độc lập trên máy local hoặc server.
"""
import os
import sys
import json
import time
import re
import requests
from datetime import datetime
from pathlib import Path

# ── Đường dẫn cấu hình ─────────────────────────────────────────
BASE_DIR = Path(__file__).parent
ENV_FILE = BASE_DIR / '.env'

def load_env():
    """Đọc credentials từ file .env"""
    env_vars = {}
    if ENV_FILE.exists():
        try:
            with open(ENV_FILE, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, val = line.split('=', 1)
                        env_vars[key.strip()] = val.strip().strip('"').strip("'")
        except Exception as e:
            print(f"⚠️ Không thể đọc file .env: {e}")
    return env_vars

def main():
    print("==================================================")
    print("🤖 KHỞI ĐỘNG TELEGRAM TRIPS BOT...")
    print("==================================================")

    env = load_env()
    token = env.get('TELEGRAM_BOT_TOKEN')
    supabase_url = env.get('SUPABASE_URL')
    supabase_key = env.get('SUPABASE_KEY')
    allowed_chat_id = env.get('TELEGRAM_CHAT_ID')

    allowed_chat_ids = []
    if allowed_chat_id:
        allowed_chat_ids = [cid.strip() for cid in allowed_chat_id.split(',') if cid.strip()]

    if not token:
        print("❌ Lỗi: Thiếu TELEGRAM_BOT_TOKEN trong file .env!")
        sys.exit(1)
    if not supabase_url or not supabase_key:
        print("❌ Lỗi: Thiếu SUPABASE_URL hoặc SUPABASE_KEY trong file .env!")
        sys.exit(1)

    supabase_url = supabase_url.rstrip('/')
    api_url = f"https://api.telegram.org/bot{token}"

    print("🤖 Bot đang lắng nghe tin nhắn...")
    print(f"🔗 Kết nối Supabase: {supabase_url}")
    if allowed_chat_ids:
        print(f"🎯 Lọc nhóm chat IDs: {', '.join(allowed_chat_ids)}")
    else:
        print("🌍 Đang lắng nghe tất cả các nhóm Bot được thêm vào.")
    print("--------------------------------------------------")

    offset = 0
    # Biểu thức regex bắt mã chuyến đi: Bắt đầu bằng E + 6 chữ số (ngày) + 8 ký tự alphanumeric
    trip_regex = re.compile(r'\b(E\d{6}[A-Z0-9]{8})\b')

    while True:
        try:
            # Long polling với timeout 30s
            url = f"{api_url}/getUpdates?offset={offset}&timeout=30"
            resp = requests.get(url, timeout=35)
            if resp.status_code != 200:
                print(f"⚠️ Telegram API lỗi (HTTP {resp.status_code}), thử lại sau 5 giây...")
                time.sleep(5)
                continue

            updates = resp.json().get('result', [])
            for update in updates:
                offset = update.get('update_id') + 1

                message = update.get('message')
                if not message or 'text' not in message:
                    continue

                chat = message.get('chat', {})
                chat_id = str(chat.get('id', ''))
                text = message.get('text', '').strip()

                # Nếu cấu hình TELEGRAM_CHAT_ID, lọc chỉ xử lý tin nhắn từ các nhóm đó
                if allowed_chat_ids and chat_id not in allowed_chat_ids:
                    continue

                # Tìm mã chuyến đi trong tin nhắn
                match = trip_regex.search(text)
                if match:
                    trip_code = match.group(1)
                    now_utc = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
                    now_local = datetime.now().strftime('%H:%M:%S')
                    
                    print(f"🔔 [{now_local}] Nhận diện mã chuyến: {trip_code} từ nhóm {chat.get('title', chat_id)}")

                    # Gọi Supabase REST API để lưu/upsert
                    sub_url = f"{supabase_url}/rest/v1/unloading_trips"
                    sub_headers = {
                        "apikey": supabase_key,
                        "Authorization": f"Bearer {supabase_key}",
                        "Content-Type": "application/json",
                        "Prefer": "resolution=merge-duplicates"
                    }
                    sub_body = {
                        "code": trip_code,
                        "started_at": now_utc
                    }

                    try:
                        sub_resp = requests.post(sub_url, headers=sub_headers, json=sub_body, timeout=10)
                        if sub_resp.status_code in [200, 201]:
                            print(f"✅ Đã ghi nhận dỡ hàng cho xe {trip_code} lên Supabase!")
                            
                            # Gửi tin nhắn phản hồi xác nhận trên nhóm Telegram
                            reply_text = (
                                f"🤖 <b>[GHI NHẬN DỠ HÀNG]</b>\n"
                                f"• Mã chuyến: <code>{trip_code}</code>\n"
                                f"• Trạng thái: <b>Đang nhập hàng 📥</b>\n"
                                f"• Bắt đầu lúc: <code>{now_local}</code>"
                            )
                            send_url = f"{api_url}/sendMessage"
                            requests.post(send_url, json={
                                "chat_id": chat_id,
                                "text": reply_text,
                                "parse_mode": "HTML",
                                "reply_to_message_id": message.get('message_id')
                            }, timeout=10)
                        else:
                            print(f"❌ Không thể lưu vào Supabase (HTTP {sub_resp.status_code}): {sub_resp.text}")
                    except Exception as e:
                        print(f"❌ Lỗi kết nối Supabase: {e}")

            # Tránh overload CPU
            time.sleep(0.5)

        except requests.exceptions.ConnectionError:
            print("⚠️ Mất kết nối internet, thử lại sau 10 giây...")
            time.sleep(10)
        except KeyboardInterrupt:
            print("\n🛑 Bot đã dừng hoạt động.")
            break
        except Exception as e:
            print(f"💥 Lỗi không xác định: {e}")
            time.sleep(5)

if __name__ == '__main__':
    main()
