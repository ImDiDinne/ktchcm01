import os
import json
import time
import logging
from datetime import datetime
from pathlib import Path
import requests
import asyncio
from playwright.async_api import async_playwright

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

async def scrape_trip(context, trip_code, sem):
    async with sem:
        page = await context.new_page()
        logger.info(f"Scraping trip {trip_code}...")
        url = f"https://nhanh.ghn.vn/ktc-van-tai/transport/detail?transportationCode={trip_code}&transportationStatus=SEARCH"
        
        session_completed_time = None
        
        # Rewrite locationId to 1626 (KTC HCM 01)
        async def handle_route(route):
            if 'locationId=' in route.request.url:
                import re
                new_url = re.sub(r'locationId=\d+', 'locationId=1626', route.request.url)
                await route.continue_(url=new_url)
            else:
                await route.continue_()
                
        await page.route("**/*", handle_route)
        
        async def handle_response(response):
            nonlocal session_completed_time
            if 'application/json' in response.headers.get('content-type', ''):
                if 'session' in response.url:
                    try:
                        data = await response.json()
                        if data and data.get('data'):
                            for session in data['data']:
                                if session.get('type') == 'DROPOFF' and session.get('status') == 'COMPLETED':
                                    end_time = session.get('endTime')
                                    if end_time:
                                        session_completed_time = end_time
                    except:
                        pass
                elif 'tms-history' in response.url:
                    try:
                        data = await response.json()
                        if data and data.get('data'):
                            for item in data['data']:
                                if item.get('actionType') == 'STOP_SCAN_WAITING_FOR_CONFIRMATION':
                                    end_time = item.get('actionTime')
                                    if end_time and not session_completed_time:
                                        session_completed_time = end_time
                                    break
                    except:
                        pass
        
        page.on("response", handle_response)
        
        try:
            await page.goto(url, wait_until='networkidle', timeout=30000)
            await asyncio.sleep(2)
            
            # Click LỊCH SỬ CHUYẾN ĐI
            try:
                await page.click("text='LỊCH SỬ CHUYẾN ĐI'", timeout=3000)
                await asyncio.sleep(1)
            except:
                pass
                
            body_text = await page.inner_text('body')
            if "mật khẩu" in body_text.lower() and "đăng nhập" in body_text.lower():
                logger.error(f"⚠️ Cookies expired! Redirected to login page for {trip_code}.")
                await page.close()
                return "EXPIRED"
                
        except Exception as e:
            logger.error(f"Error checking pending trip {trip_code}: {e}")
            
        await page.close()
        return session_completed_time

async def async_main():
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

    # 3. Async Scrape with Playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(storage_state='state.json')
        
        sem = asyncio.Semaphore(10) # Process 10 trips concurrently
        tasks = []
        for trip in trips:
            trip_code = trip['code']
            tasks.append(scrape_trip(context, trip_code, sem))
            
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        expired = False
        for trip, result in zip(trips, results):
            trip_code = trip['code']
            if result == "EXPIRED":
                expired = True
            elif isinstance(result, str): # Valid completed time
                print(f"Trip {trip_code} is FINISHED! Unloaded at: {result}")
                # Cập nhật DB
                update_resp = requests.patch(
                    f"{supabase_url}/rest/v1/unloading_trips?code=eq.{trip_code}",
                    headers=headers,
                    json={"unloaded_at": result}
                )
                if update_resp.status_code in [200, 204]:
                    print(f"Updated {trip_code} unloaded_at successfully.")
            elif isinstance(result, Exception):
                logger.error(f"Task failed for {trip_code}: {result}")
            else:
                print(f"Trip {trip_code} is still pending or API not found.")
                
        await browser.close()
        
        if expired:
            bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
            chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
            if bot_token and chat_id:
                msg = "⚠️ *CẢNH BÁO: CHÌA KHOÁ GHN ĐÃ HẾT HẠN!*\n\nCỗ máy cào dữ liệu xe tải trên Cloud vừa bị văng ra ngoài. Vui lòng gõ lệnh `/login` cho bot này để bắt đầu quá trình đăng nhập lại tự động qua Telegram."
                requests.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", json={
                    "chat_id": chat_id,
                    "text": msg,
                    "parse_mode": "Markdown"
                })
            import sys
            sys.exit(1)

def main():
    asyncio.run(async_main())

if __name__ == '__main__':
    main()
