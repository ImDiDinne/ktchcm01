#!/usr/bin/env python3
"""
🔄 sync_trips_daemon.py — Đồng bộ dữ liệu TripScan từ GHN sang Supabase Cache.
Chạy ngầm liên tục (daemon) hoặc chạy theo chu kỳ.
Thay vì gọi Google Apps Script, script này sẽ trích xuất token bằng Playwright
và gọi trực tiếp API của GHN để lấy dữ liệu.
"""
import os
import sys
import time
import requests
import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from playwright.sync_api import sync_playwright

# ── Đường dẫn cấu hình ─────────────────────────────────────────
BASE_DIR = Path(__file__).parent
ENV_FILE = BASE_DIR / '.env'
LOG_FILE = BASE_DIR / 'logs' / 'sync_trips_daemon.log'
STATE_FILE = BASE_DIR / 'state.json'
CACHE_FILE = BASE_DIR / '.ghn_headers.json'
LAST_REPORT_FILE = BASE_DIR / '.last_ai_report'

# Đảm bảo thư mục logs tồn tại
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

def log(msg):
    """Ghi log kèm timestamp"""
    timestamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
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

import json

def send_telegram_alert(msg):
    env = load_env()
    bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
    chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
    if bot_token and chat_id:
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        try:
            requests.post(url, json={"chat_id": chat_id, "text": f"🚨 Cảnh Báo \"Cháy Nhà\" Tức Thời (Real-time Alert): {msg}"}, timeout=10)
        except Exception as e:
            log(f"⚠️ Lỗi gửi Telegram alert: {e}")


def get_ghn_headers(force_renew=False):
    """Trích xuất Headers từ cache hoặc dùng Playwright nếu cache lỗi/hết hạn"""
    if not force_renew and CACHE_FILE.exists():
        try:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass

    log("🌐 Đang khởi động Playwright để trích xuất token mới từ GHN...")
    extracted_headers = {}
    if not STATE_FILE.exists():
        msg = "❌ Lỗi: Không tìm thấy state.json. Hệ thống cào dữ liệu GHN đã bị DỪNG. Vui lòng chạy 🔄 Cập Nhật Session.command!"
        log(msg)
        send_telegram_alert(msg)
        return None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(storage_state=str(STATE_FILE))
            page = context.new_page()
            
            def handle_request(request):
                if 'transportation/general' in request.url:
                    extracted_headers.update(request.headers)
            
            page.on("request", handle_request)
            page.goto("https://nhanh.ghn.vn/ktc-van-tai/transport/list", wait_until='networkidle', timeout=30000)
            page.wait_for_timeout(3000)
            browser.close()
            
        if 'x-auth-token' in extracted_headers:
            headers = {
                'Accept': 'application/json, text/plain, */*',
                'Authorization': extracted_headers.get('authorization', ''),
                'X-Auth-Token': extracted_headers.get('x-auth-token', ''),
                'User-Agent': extracted_headers.get('user-agent', '')
            }
            try:
                with open(CACHE_FILE, 'w', encoding='utf-8') as f:
                    json.dump(headers, f)
            except:
                pass
            return headers
        else:
            msg = "❌ Không thể trích xuất token từ GHN. Phiên đăng nhập có thể đã hết hạn. Vui lòng chạy 🔄 Cập Nhật Session.command!"
            log(msg)
            send_telegram_alert(msg)
            return None
    except Exception as e:
        msg = f"⚠️ Lỗi Playwright: {e}"
        log(msg)
        send_telegram_alert(msg)
        return None

def fetch_trips_from_ghn(headers):
    """Gọi API GHN lấy danh sách chuyến xe trong 2 ngày gần nhất"""
    now = datetime.datetime.now()
    yesterday = now - datetime.timedelta(days=1)
    
    # fromTime từ đầu ngày hôm qua
    from_dt = datetime.datetime(yesterday.year, yesterday.month, yesterday.day, 0, 0, 0)
    to_dt = now
    
    from_time_ms = int(from_dt.timestamp() * 1000)
    to_time_ms = int(to_dt.timestamp() * 1000)
    
    statuses = ['PROCESSING', 'COMPLETED', 'WAITING_FOR_PROCESSING']
    hub_id = 1626
    
    all_trips = []
    
    for status in statuses:
        skip = 0
        limit = 50
        while True:
            url = f"https://inside-prd-api.ghn.vn/tms/v1/transportation/general?hubId={hub_id}&status={status}&limit={limit}&skip={skip}&fromTime={from_time_ms}&toTime={to_time_ms}"
            try:
                r = requests.get(url, headers=headers, timeout=20)
                if r.status_code == 200:
                    data = r.json().get('data', [])
                    if not data:
                        break
                    all_trips.extend(data)
                    if len(data) < limit:
                        break
                    skip += limit
                elif r.status_code == 401:
                    log(f"⚠️ API báo lỗi 401 Unauthorized. Cần lấy lại token!")
                    return "UNAUTHORIZED"
                else:
                    log(f"⚠️ Lỗi API {status}: HTTP {r.status_code}")
                    break
            except Exception as e:
                log(f"⚠️ Lỗi gọi API {status}: {e}")
                break

    return all_trips

def format_trip(t):
    """Chuyển định dạng GHN API sang chuẩn Supabase trips_cache"""
    vn_tz = ZoneInfo('Asia/Ho_Chi_Minh')
    
    created_at = t.get('created_at') or t.get('actual_start_time') or '0001-01-01T00:00:00Z'
    try:
        if created_at != '0001-01-01T00:00:00Z':
            dt = datetime.datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            dt_vn = dt.astimezone(vn_tz)
        else:
            dt_vn = datetime.datetime.now(vn_tz)
            dt = datetime.datetime.now(datetime.timezone.utc)
    except:
        dt_vn = datetime.datetime.now(vn_tz)
        dt = datetime.datetime.now(datetime.timezone.utc)
        
    date_str = dt_vn.strftime('%d/%m/%Y')
    time_str = dt_vn.strftime('%H:%M:%S')
    slot_str = f"{dt_vn.hour:02d}:00"
    synced_at = dt_vn.strftime('%H:%M:%S %d/%m/%Y')
    
    stable_id = str(int(dt.timestamp() * 1000))
    
    # Mapping status
    ghn_status = t.get('status', '')
    if ghn_status == 'COMPLETED':
        status_vi = 'Đã nhận'
    elif ghn_status == 'PROCESSING':
        status_vi = 'Đang nhập'
    elif ghn_status == 'WAITING_FOR_PROCESSING':
        status_vi = 'Chờ dỡ'
    else:
        status_vi = ghn_status
        
    return {
        'id': stable_id,
        'code': t.get('transportation_code', ''),
        'date': date_str,
        'time': time_str,
        'slot': slot_str,
        'username': 'Auto-Scraper',
        'syncedAt': synced_at,
        'status': status_vi,
        'driverName': t.get('driver_name', ''),
        'phone': t.get('driver_phone', ''),
        'vehicle': t.get('plate', ''),
        'capacity': f"{t.get('capacity', 0)} Kg"
    }

def sync_trips():
    """Lấy dữ liệu từ GHN và đẩy vào Supabase"""
    env = load_env()
    supabase_url = env.get('SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    supabase_key = env.get('SUPABASE_SERVICE_ROLE_KEY') or env.get('SUPABASE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_KEY')

    if not supabase_url or not supabase_key:
        log("❌ Lỗi: Thiếu SUPABASE_URL hoặc KEY!")
        return False

    supabase_url = supabase_url.rstrip('/')

    headers = get_ghn_headers(force_renew=False)
    if not headers:
        return False

    ghn_trips = fetch_trips_from_ghn(headers)
    
    # Nếu API báo 401, xoá cache và làm lại 1 lần duy nhất
    if ghn_trips == "UNAUTHORIZED":
        log("🔄 Đang thử lấy lại token mới...")
        headers = get_ghn_headers(force_renew=True)
        if not headers:
            return False
        ghn_trips = fetch_trips_from_ghn(headers)

    if not ghn_trips or ghn_trips == "UNAUTHORIZED":
        msg = "⚠️ Không thể gọi API GHN (UNAUTHORIZED hoặc không có dữ liệu). Cào dữ liệu THẤT BẠI."
        log(msg)
        send_telegram_alert(msg)
        return False
        
    log(f"✅ Đã tải {len(ghn_trips)} chuyến xe từ GHN. Đang chuyển đổi định dạng...")
    
    unique_trips = {}
    for t in ghn_trips:
        formatted = format_trip(t)
        # Nếu có nhiều chuyến trùng mã xe, lấy cái mới nhất (ghi đè vào dict)
        tid = formatted['id']
        unique_trips[tid] = formatted
        
    trips = list(unique_trips.values())
    log(f"🧹 Đã lọc trùng lặp, còn {len(trips)} dòng. Tiến hành đẩy vào Supabase...")

    # Đẩy dữ liệu vào Supabase dùng REST API
    sub_url = f"{supabase_url}/rest/v1/trips_cache"
    sub_headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }

    batches = list(chunk_list(trips, 1000))
    success_count = 0

    for i, batch in enumerate(batches):
        try:
            sub_resp = requests.post(sub_url, headers=sub_headers, json=batch, timeout=20)
            if sub_resp.status_code in [200, 201]:
                success_count += len(batch)
            else:
                log(f"   ❌ Lỗi chèn Batch {i+1} (HTTP {sub_resp.status_code}): {sub_resp.text}")
        except Exception as ex:
            log(f"   ❌ Lỗi kết nối chèn Batch {i+1}: {ex}")

    log(f"✅ Đồng bộ hoàn tất! Thành công: {success_count}/{len(trips)} dòng.")

    # Dọn dẹp dữ liệu cũ hơn 30 ngày
    try:
        from datetime import timedelta
        cleanup_date = (datetime.datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
        cleanup_iso = (datetime.datetime.now() - timedelta(days=30)).isoformat()

        cleanup_headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
        }

        cleanup_id = int((datetime.datetime.now() - timedelta(days=30)).timestamp() * 1000)
        cleanup_url = f"{supabase_url}/rest/v1/trips_cache?id=lt.{cleanup_id}"
        cleanup_resp = requests.delete(cleanup_url, headers=cleanup_headers, timeout=10)
        if cleanup_resp.status_code in [200, 204]:
            log(f"🧹 Đã dọn dẹp dữ liệu trips_cache cũ hơn 30 ngày (id < {cleanup_id}).")

        cleanup_url2 = f"{supabase_url}/rest/v1/unloading_trips?started_at=lt.{cleanup_iso}"
        cleanup_resp2 = requests.delete(cleanup_url2, headers=cleanup_headers, timeout=10)
        if cleanup_resp2.status_code in [200, 204]:
            log(f"🧹 Đã dọn dẹp dữ liệu unloading_trips cũ hơn {cleanup_date}.")
    except Exception as ce:
        log(f"⚠️ Lỗi dọn dẹp: {ce}")

    return True

def check_and_run_ai_report():
    """Kiểm tra xem đã tới giờ gửi báo cáo AI chưa (6h sáng)"""
    now = datetime.datetime.now()
    if now.hour == 6 and now.minute <= 10:
        today_str = now.strftime('%Y-%m-%d')
        last_report = ""
        if LAST_REPORT_FILE.exists():
            with open(LAST_REPORT_FILE, 'r') as f:
                last_report = f.read().strip()
                
        if last_report != today_str:
            log("🤖 Tới giờ gửi báo cáo AI buổi sáng...")
            try:
                import ai_reporter
                ai_reporter.run_daily_report()
                with open(LAST_REPORT_FILE, 'w') as f:
                    f.write(today_str)
                log("✅ Đã gửi báo cáo AI thành công!")
            except Exception as e:
                log(f"⚠️ Lỗi khi chạy AI report: {e}")

def main():
    log("==================================================")
    log("🔄 BẮT ĐẦU CHẠY DAEMON ĐỒNG BỘ TRIPSCAN...")
    log("==================================================")
    
    sync_trips()
    
    log("⏳ Đang thiết lập vòng lặp chạy ngầm mỗi 60 giây...")
    while True:
        try:
            time.sleep(60)
            sync_trips()
            check_and_run_ai_report()
        except KeyboardInterrupt:
            log("🛑 Daemon đã dừng hoạt động (KeyboardInterrupt).")
            break
        except Exception as e:
            log(f"💥 Lỗi vòng lặp chính: {e}")
            time.sleep(10)

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--once':
        success = sync_trips()
        if not success:
            sys.exit(1)
    else:
        main()
