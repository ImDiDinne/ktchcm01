import os
import json
import time
import logging
from datetime import datetime
from pathlib import Path
import requests
from playwright.sync_api import sync_playwright

# Thiết lập logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Đọc cấu hình
BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / '.env'

def load_env():
    env = {}
    if ENV_FILE.exists():
        with open(ENV_FILE) as f:
            for line in f:
                if '=' in line and not line.startswith('#'):
                    k, v = line.strip().split('=', 1)
                    env[k] = v.strip("'").strip('"')
    return env

def send_telegram_alert(message):
    """Gửi thông báo lỗi qua Telegram"""
    env = load_env()
    bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
    chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
    if bot_token and chat_id:
        try:
            requests.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", json={"chat_id": chat_id, "text": message})
        except:
            pass

def main():
    env = load_env()
    supabase_url = env.get('SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    supabase_key = env.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if not supabase_url or not supabase_key:
        print("Missing Supabase credentials.")
        return

    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json"
    }

    # 1. Fetch pending trips
    print("Fetching pending trips...")
    trips_resp = requests.get(
        f"{supabase_url}/rest/v1/unloading_trips?unloaded_at=is.null",
        headers=headers
    )
    trips = trips_resp.json()
    
    if not trips:
        print("No pending trips. Exiting.")
        return
        
    print(f"Found {len(trips)} pending trips.")

    # 2. Fetch browser state (Cookies)
    print("Fetching browser state from system_secrets...")
    secret_resp = requests.get(
        f"{supabase_url}/rest/v1/system_secrets?key=eq.ghn_browser_state",
        headers=headers
    )
    secrets = secret_resp.json()
    if not secrets:
        print("No browser state found. The Mac hasn't uploaded it yet.")
        return
        
    state_json = secrets[0]['value']
    with open('state.json', 'w') as f:
        f.write(state_json)

    # 3. Scrape with Playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(storage_state='state.json')
        page = context.new_page()

        for trip in trips:
            trip_code = trip['code']
            print(f"Scraping trip {trip_code}...")
            url = f"https://nhanh.ghn.vn/ktc-van-tai/transport/detail?transportationCode={trip_code}&transportationStatus=SEARCH"
            
            # Khởi tạo biến lưu kết quả api
            session_completed_time = None
            
            # Rewrite locationId to 1626 (KTC HCM 01) to avoid INVALID_CURRENT_STOP
            def handle_route(route):
                if 'locationId=' in route.request.url:
                    import re
                    new_url = re.sub(r'locationId=\d+', 'locationId=1626', route.request.url)
                    route.continue_(url=new_url)
                else:
                    route.continue_()
            page.route("**/*", handle_route)
            
            def handle_response(response):
                nonlocal session_completed_time
                if 'application/json' in response.headers.get('content-type', ''):
                    if 'session' in response.url:
                        try:
                            data = response.json()
                            if data and data.get('data'):
                                for session in data['data']:
                                    # Tìm session DROPOFF đã COMPLETED
                                    if session.get('type') == 'DROPOFF' and session.get('status') == 'COMPLETED':
                                        end_time = session.get('endTime')
                                        if end_time:
                                            session_completed_time = end_time
                        except:
                            pass
                    elif 'tms-history' in response.url:
                        try:
                            data = response.json()
                            if data and data.get('data'):
                                for item in data['data']:
                                    # Nếu đã kết thúc quét kiện bàn giao (nhưng quên bấm xác nhận hoàn tất)
                                    if item.get('actionType') == 'STOP_SCAN_WAITING_FOR_CONFIRMATION':
                                        end_time = item.get('actionTime')
                                        if end_time and not session_completed_time:
                                            session_completed_time = end_time
                                        break
                        except:
                            pass
            
            page.on("response", handle_response)
            
            try:
                page.goto(url, wait_until='networkidle', timeout=30000)
                time.sleep(3) # Wait for APIs to resolve
                
                # Bấm vào LỊCH SỬ CHUYẾN ĐI để load log lịch sử
                try:
                    page.click("text='LỊCH SỬ CHUYẾN ĐI'", timeout=5000)
                    time.sleep(2)
                except:
                    pass
                
                # Kiểm tra xem có bị văng ra trang đăng nhập không
                body_text = page.inner_text('body').lower()
                if "mật khẩu" in body_text and "đăng nhập" in body_text:
                    print(f"⚠️ Cookies expired! Redirected to login page.")
                    # Gửi thông báo Telegram
                    bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
                    chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
                    if bot_token and chat_id:
                        msg = "⚠️ *CẢNH BÁO: CHÌA KHOÁ GHN ĐÃ HẾT HẠN!*\n\nCỗ máy cào dữ liệu xe tải trên Cloud vừa bị văng ra ngoài. Vui lòng gõ lệnh `/login` cho bot này để bắt đầu quá trình đăng nhập lại tự động qua Telegram."
                        requests.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", json={
                            "chat_id": chat_id,
                            "text": msg,
                            "parse_mode": "Markdown"
                        })
                    break # Ngừng scrape cho các xe khác vì cookie đã hỏng
                
                # Hủy lắng nghe để không bị trùng cho xe tiếp theo
                page.remove_listener("response", handle_response)
                
                if session_completed_time:
                    print(f"Trip {trip_code} is FINISHED! Unloaded at: {session_completed_time}")
                    # Cập nhật DB
                    update_resp = requests.patch(
                        f"{supabase_url}/rest/v1/unloading_trips?code=eq.{trip_code}",
                        headers=headers,
                        json={"unloaded_at": session_completed_time}
                    )
                    if update_resp.status_code in [200, 204]:
                        print(f"Updated {trip_code} unloaded_at successfully.")
                else:
                    print(f"Trip {trip_code} is still pending or API not found.")
                    
            except Exception as e:
                print(f"Error checking pending trips: {e}")
                send_telegram_alert(f"❌ [LỖI NGHIÊM TRỌNG] Quét chuyến xe tới thất bại!\nLỗi chi tiết: {e}")
                sys.exit(1)
                
        browser.close()

if __name__ == '__main__':
    main()
