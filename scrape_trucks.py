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
            
            try:
                page.goto(url, wait_until='networkidle', timeout=30000)
                time.sleep(3) # Extra wait for React/Vue to render
                
                # Extract text to find status
                body_text = page.inner_text('body').lower()
                
                # Các từ khoá chứng tỏ xe đã hạ tải xong (tạm đoán, có thể tuỳ chỉnh sau)
                finished_keywords = ['đã nhận', 'đã hoàn tất', 'hoàn thành dỡ hàng', 'đã dỡ', 'completed']
                is_finished = any(k in body_text for k in finished_keywords)
                
                if is_finished:
                    print(f"Trip {trip_code} is FINISHED!")
                    unloaded_at = datetime.now().isoformat()
                    
                    # Cập nhật DB
                    update_resp = requests.patch(
                        f"{supabase_url}/rest/v1/unloading_trips?code=eq.{trip_code}",
                        headers=headers,
                        json={"unloaded_at": unloaded_at}
                    )
                    if update_resp.status_code in [200, 204]:
                        print(f"Updated {trip_code} unloaded_at successfully.")
                else:
                    print(f"Trip {trip_code} is still pending.")
                    
            except Exception as e:
                print(f"Error scraping {trip_code}: {e}")
                
        browser.close()

if __name__ == '__main__':
    main()
