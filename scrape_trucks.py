import os
import json
import time
from datetime import datetime
import requests
from playwright.sync_api import sync_playwright

def load_env():
    env_vars = {}
    if os.path.exists('.env'):
        with open('.env', 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    env_vars[key.strip()] = val.strip().strip('"').strip("'")
    return env_vars

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
            
            def handle_response(response):
                nonlocal session_completed_time
                if 'application/json' in response.headers.get('content-type', '') and 'session' in response.url:
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
            
            page.on("response", handle_response)
            
            try:
                page.goto(url, wait_until='networkidle', timeout=30000)
                time.sleep(3) # Wait for APIs to resolve
                
                # Kiểm tra xem có bị văng ra trang đăng nhập không
                body_text = page.inner_text('body').lower()
                if "mật khẩu" in body_text and "đăng nhập" in body_text:
                    print(f"⚠️ Cookies expired! Redirected to login page.")
                    # Gửi thông báo Telegram
                    bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
                    chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
                    if bot_token and chat_id:
                        msg = "⚠️ *CẢNH BÁO: CHÌA KHOÁ GHN ĐÃ HẾT HẠN!*\n\nCỗ máy cào dữ liệu xe tải trên Cloud vừa bị văng ra ngoài. Vui lòng mở máy Mac và chạy lệnh cấp phép lại:\n`cd \"/Users/duyhuynh/Desktop/AI dashboard\" && python3 auto_renew_session.py --force-login`"
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
                print(f"Error scraping {trip_code}: {e}")
                
        browser.close()

if __name__ == '__main__':
    main()
