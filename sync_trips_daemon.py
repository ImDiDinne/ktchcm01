#!/usr/bin/env python3
"""
🔄 sync_trips_daemon.py — Đồng bộ dữ liệu TripScan từ Google Sheets sang Supabase Cache.
Chạy ngầm liên tục (daemon) hoặc chạy theo chu kỳ.
"""
import os
import sys
import time
import requests
from datetime import datetime
from pathlib import Path

# ── Đường dẫn cấu hình ─────────────────────────────────────────
BASE_DIR = Path(__file__).parent
ENV_FILE = BASE_DIR / '.env'
LOG_FILE = BASE_DIR / 'logs' / 'sync_trips_daemon.log'

# Đảm bảo thư mục logs tồn tại
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

def log(msg):
    """Ghi log kèm timestamp"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_line = f"[{timestamp}] {msg}"
    print(log_line)
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(log_line + '\n')
    except Exception as e:
        print(f"⚠️ Không thể ghi file log: {e}")

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
            log(f"⚠️ Không thể đọc file .env: {e}")
    return env_vars

def chunk_list(lst, n):
    """Chia nhỏ danh sách thành các phần bằng nhau"""
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

def sync_trips():
    """Gọi API Google Sheets và đẩy vào Supabase"""
    env = load_env()
    supabase_url = env.get('SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    supabase_key = env.get('SUPABASE_SERVICE_ROLE_KEY') or env.get('SUPABASE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_KEY')

    if not supabase_url or not supabase_key:
        log("❌ Lỗi: Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY trong file .env và môi trường!")
        return False

    supabase_url = supabase_url.rstrip('/')
    
    # URL Google Apps Script
    gscript_url = 'https://script.google.com/macros/s/AKfycbxpLqnIOLSV6MkEhss1vPVh7AxBZqVUv6F0xGmMGNtv1A55XVElUgBkoJuvJXgv2cHP/exec?action=getTrips'

    log("🌐 Đang tải dữ liệu từ Google Apps Script...")
    try:
        resp = requests.get(gscript_url, timeout=30)
        if resp.status_code != 200:
            log(f"❌ Lỗi tải Google Sheet (HTTP {resp.status_code})")
            return False
        
        result = resp.json()
        if result.get("status") != "success" or "data" not in result:
            log(f"❌ Dữ liệu trả về không đúng cấu trúc: {result}")
            return False

        trips = result["data"]
        log(f"📦 Đã tải {len(trips)} chuyến xe.")

        # Lọc bỏ các bản ghi trùng lặp ID trước khi đẩy vào Supabase để tránh lỗi Postgres ON CONFLICT
        unique_trips = {}
        for t in trips:
            tid = t.get("id")
            if tid:
                unique_trips[tid] = t
        trips = list(unique_trips.values())
        log(f"🧹 Đã lọc trùng lặp ID, còn {len(trips)} dòng. Tiến hành đẩy vào Supabase...")

        # Đẩy dữ liệu vào Supabase dùng REST API
        sub_url = f"{supabase_url}/rest/v1/trips_cache"
        sub_headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"  # Tự động UPSERT đè lên dựa theo primary key 'id'
        }

        # Chia nhỏ thành các batch 1000 dòng để gửi an toàn
        batches = list(chunk_list(trips, 1000))
        success_count = 0

        for i, batch in enumerate(batches):
            try:
                sub_resp = requests.post(sub_url, headers=sub_headers, json=batch, timeout=20)
                if sub_resp.status_code in [200, 201]:
                    success_count += len(batch)
                    # log(f"   [Batch {i+1}/{len(batches)}] Đã chèn/cập nhật {len(batch)} dòng.")
                else:
                    log(f"   ❌ Lỗi chèn Batch {i+1} (HTTP {sub_resp.status_code}): {sub_resp.text}")
            except Exception as ex:
                log(f"   ❌ Lỗi kết nối chèn Batch {i+1}: {ex}")

        log(f"✅ Đồng bộ hoàn tất! Thành công: {success_count}/{len(trips)} dòng.")

        # Dọn dẹp dữ liệu cũ hơn 30 ngày
        try:
            from datetime import timedelta
            cleanup_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
            cleanup_iso = (datetime.now() - timedelta(days=30)).isoformat()

            cleanup_headers = {
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
            }

            # Cleanup trips_cache
            cleanup_url = f"{supabase_url}/rest/v1/trips_cache?date=lt.{cleanup_date}"
            cleanup_resp = requests.delete(cleanup_url, headers=cleanup_headers, timeout=10)
            if cleanup_resp.status_code in [200, 204]:
                log(f"🧹 Đã dọn dẹp dữ liệu trips_cache cũ hơn {cleanup_date}.")
            else:
                log(f"⚠️ Cleanup trips_cache lỗi (HTTP {cleanup_resp.status_code})")

            # Cleanup unloading_trips
            cleanup_url2 = f"{supabase_url}/rest/v1/unloading_trips?started_at=lt.{cleanup_iso}"
            cleanup_resp2 = requests.delete(cleanup_url2, headers=cleanup_headers, timeout=10)
            if cleanup_resp2.status_code in [200, 204]:
                log(f"🧹 Đã dọn dẹp dữ liệu unloading_trips cũ hơn {cleanup_date}.")
            else:
                log(f"⚠️ Cleanup unloading_trips lỗi (HTTP {cleanup_resp2.status_code})")
        except Exception as ce:
            log(f"⚠️ Lỗi dọn dẹp: {ce}")

        return True

    except Exception as e:
        log(f"❌ Lỗi không xác định trong quá trình đồng bộ: {e}")
        return False

def main():
    log("==================================================")
    log("🔄 BẮT ĐẦU CHẠY DAEMON ĐỒNG BỘ TRIPSCAN...")
    log("==================================================")
    
    # Đồng bộ lần đầu ngay khi mở
    sync_trips()
    
    log("⏳ Đang thiết lập vòng lặp chạy ngầm mỗi 60 giây...")
    while True:
        try:
            time.sleep(60)
            sync_trips()
        except KeyboardInterrupt:
            log("🛑 Daemon đã dừng hoạt động (KeyboardInterrupt).")
            break
        except Exception as e:
            log(f"💥 Lỗi vòng lặp chính: {e}")
            time.sleep(10)

if __name__ == '__main__':
    # Hỗ trợ chạy một lần duy nhất nếu truyền tham số --once
    if len(sys.argv) > 1 and sys.argv[1] == '--once':
        success = sync_trips()
        if not success:
            sys.exit(1)
    else:
        main()
