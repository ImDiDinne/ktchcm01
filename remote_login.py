import os
import json
import time
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

def send_telegram(msg, env):
    bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
    chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
    if bot_token and chat_id:
        try:
            requests.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", json={
                "chat_id": chat_id,
                "text": msg,
                "parse_mode": "Markdown"
            })
        except:
            pass

def poll_supabase(key, env, timeout_sec=180):
    supabase_url = env.get('SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    supabase_key = env.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    headers = {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}"}
    
    start_time = time.time()
    while time.time() - start_time < timeout_sec:
        try:
            resp = requests.get(f"{supabase_url}/rest/v1/system_secrets?key=eq.{key}", headers=headers)
            data = resp.json()
            if data and len(data) > 0:
                code = data[0]['value']
                # Xoá mã sau khi đọc để tránh dùng lại lần sau
                requests.delete(f"{supabase_url}/rest/v1/system_secrets?key=eq.{key}", headers=headers)
                return code
        except Exception as e:
            print(f"Error polling {key}: {e}")
        time.sleep(3)
    return None

def main():
    env = load_env()
    supabase_url = env.get('SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    supabase_key = env.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    username = env.get('GHN_USERNAME') or os.environ.get('GHN_USERNAME')
    password = env.get('GHN_PASSWORD') or os.environ.get('GHN_PASSWORD')
    
    if not supabase_url or not username or not password:
        send_telegram("❌ Lỗi: Máy chủ GitHub thiếu cấu hình GHN_USERNAME hoặc GHN_PASSWORD.", env)
        return

    send_telegram("🔄 Đang mở trình duyệt ngầm để đăng nhập vào GHN...", env)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        try:
            page.goto("https://sso.ghn.vn/ssoLogin?app=SSO", wait_until="networkidle")
            
            # 1. Đăng nhập Username / Password
            page.fill('input[placeholder="Nhập email/số điện thoại"]', username)
            page.fill('input[type="password"]', password)
            page.click('button:has-text("Đăng nhập")')
            
            time.sleep(3)
            
            # Kiểm tra xem có bị hỏi 2FA không
            body_text = page.inner_text('body').lower()
            
            if "nhập mã số từ ứng dụng google authenticator" in body_text or "mã xác thực" in body_text:
                send_telegram("🔐 Hệ thống yêu cầu mã 2FA. Vui lòng gõ lệnh:\n`/2fa [mã số]`\n(Bạn có 3 phút để thực hiện)", env)
                code_2fa = poll_supabase('ghn_2fa_code', env)
                if not code_2fa:
                    send_telegram("❌ Quá thời gian chờ mã 2FA. Đăng nhập thất bại.", env)
                    browser.close()
                    return
                
                # Điền mã 2FA
                # GHN thường có 6 ô input rời rạc hoặc 1 ô
                inputs = page.query_selector_all('input[type="tel"], input[type="text"]')
                if len(inputs) == 6:
                    for i, char in enumerate(code_2fa):
                        inputs[i].fill(char)
                else:
                    page.fill('input[type="text"]', code_2fa)
                
                try:
                    page.click('button:has-text("Xác nhận")', timeout=3000)
                except:
                    pass
                time.sleep(3)
            
            body_text = page.inner_text('body').lower()
            # 2. Kiểm tra nếu có hỏi OTP SMS
            if "mã otp" in body_text or "gửi mã" in body_text:
                try:
                    page.click('button:has-text("Gửi mã")', timeout=3000)
                except:
                    pass
                    
                send_telegram("📱 Hệ thống yêu cầu mã OTP SMS. Vui lòng gõ lệnh:\n`/otp [mã số]`\n(Bạn có 3 phút để thực hiện)", env)
                code_otp = poll_supabase('ghn_otp_code', env)
                if not code_otp:
                    send_telegram("❌ Quá thời gian chờ mã OTP. Đăng nhập thất bại.", env)
                    browser.close()
                    return
                    
                inputs = page.query_selector_all('input[type="tel"], input[type="text"]')
                if len(inputs) == 6:
                    for i, char in enumerate(code_otp):
                        inputs[i].fill(char)
                else:
                    page.fill('input[type="text"]', code_otp)
                
                try:
                    page.click('button:has-text("Xác nhận")', timeout=3000)
                except:
                    pass
                time.sleep(3)
                
            # Đợi load vào trang chính
            page.wait_for_url("**/profile**", timeout=15000)
            
            # Lấy cookies
            state_json = context.storage_state()
            
            # Lưu vào Supabase
            headers = {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}", "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"}
            requests.post(f"{supabase_url}/rest/v1/system_secrets", headers=headers, json={"key": "ghn_browser_state", "value": json.dumps(state_json)})
            
            send_telegram("✅ ĐĂNG NHẬP THÀNH CÔNG! Chìa khoá Cookies đã được làm mới tự động trên Cloud.", env)

        except Exception as e:
            send_telegram(f"❌ Lỗi trong quá trình đăng nhập ngầm: {e}", env)
            
        browser.close()

if __name__ == '__main__':
    main()
