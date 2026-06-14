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
            page.goto("https://nhanh.ghn.vn/ktc-van-tai", wait_until="domcontentloaded")
            time.sleep(5)
            
            try:
                # Chờ form xuất hiện bằng cách chờ ô password
                page.wait_for_selector('input[type="password"]', timeout=20000)
                
                # Tìm ô input đầu tiên hiển thị (thường là username)
                # Dùng thuộc tính password để định vị, ô phía trên nó thường là username
                # Tuy nhiên cách an toàn nhất là lấy tất cả các thẻ input hiển thị trên màn hình
                visible_inputs = page.query_selector_all('input:not([type="hidden"])')
                if len(visible_inputs) >= 2:
                    visible_inputs[0].fill(username)
                    visible_inputs[1].fill(password)
                else:
                    page.fill('input[type="text"]', username)
                    page.fill('input[type="password"]', password)
                    
                page.click('button:has-text("Đăng nhập"), button[type="submit"], button.btn-login')
            except Exception as form_err:
                page.screenshot(path="redirect_fail.png")
                send_telegram(f"⚠️ Không tìm thấy form đăng nhập. URL hiện tại: {page.url}", env)
                bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
                chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
                if bot_token and chat_id:
                    with open('redirect_fail.png', 'rb') as photo:
                        requests.post(f"https://api.telegram.org/bot{bot_token}/sendPhoto", data={"chat_id": chat_id, "caption": "Ảnh màn hình hiện tại:"}, files={"photo": photo})
                browser.close()
                return
            
            # Chờ hệ thống xử lý đăng nhập (có thể chuyển hướng hoặc load trang 2FA)
            time.sleep(5)
            try:
                page.wait_for_load_state("networkidle", timeout=10000)
            except:
                pass
            
            # Kiểm tra URL để biết trạng thái
            if "sso" in page.url or "login" in page.url:
                # Nếu vẫn còn ở trang SSO, tức là bị đòi 2FA/OTP hoặc sai mật khẩu
                page.screenshot(path="2fa_screen.png")
                bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
                chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
                if bot_token and chat_id:
                    with open('2fa_screen.png', 'rb') as photo:
                        requests.post(f"https://api.telegram.org/bot{bot_token}/sendPhoto", data={"chat_id": chat_id, "caption": "🔐 Hệ thống yêu cầu mã xác thực (Hoặc có lỗi đăng nhập).\n\nNếu hệ thống đòi mã OTP, vui lòng gõ lệnh:\n`/2fa [mã số]`\n(Bạn có 3 phút để nhập mã)"}, files={"photo": photo})
                else:
                    send_telegram("🔐 Hệ thống yêu cầu mã xác thực 2FA/OTP. Vui lòng gõ lệnh:\n`/2fa [mã số]`\n(Bạn có 3 phút để thực hiện)", env)
                    
                code_2fa = poll_supabase('ghn_2fa_code', env)
                if not code_2fa:
                    send_telegram("❌ Quá thời gian chờ mã. Đăng nhập thất bại.", env)
                    browser.close()
                    return
                
                # Điền mã 2FA
                # Lấy tất cả các input hiển thị (loại trừ button, checkbox, radio, password)
                inputs = page.query_selector_all('input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="password"])')
                if len(inputs) == 6:
                    for i, char in enumerate(code_2fa):
                        if i < len(inputs):
                            inputs[i].fill(char)
                elif len(inputs) > 0:
                    inputs[0].fill(code_2fa)
                else:
                    page.fill('input[type="text"]', code_2fa)
                
                try:
                    page.click('button:has-text("Xác nhận"), button:has-text("Đăng nhập"), button[type="submit"]', timeout=3000)
                except:
                    pass
                
                time.sleep(5)
                try:
                    page.wait_for_load_state("networkidle", timeout=10000)
                except:
                    pass
            
            # Đợi load vào trang đích nhanh.ghn.vn
            try:
                page.wait_for_url("**nhanh.ghn.vn**", timeout=15000)
            except:
                # Nếu vẫn không đúng URL, kiểm tra lại xem có lỗi không
                if "sso" in page.url or "login" in page.url:
                    raise Exception("Vẫn kẹt ở trang đăng nhập, có thể mã OTP sai hoặc lỗi hệ thống.")
            
            # Lấy cookies
            state_json = context.storage_state()
            
            # Lưu vào Supabase
            headers = {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}", "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"}
            requests.post(f"{supabase_url}/rest/v1/system_secrets", headers=headers, json={"key": "ghn_browser_state", "value": json.dumps(state_json)})
            
            # Lấy thêm cookie cho data-bi.ghn.vn (Metabase)
            try:
                page.goto("https://data-bi.ghn.vn", wait_until="networkidle", timeout=15000)
                time.sleep(3)
                for cookie in context.cookies():
                    if cookie['name'] == 'metabase.SESSION':
                        with open('.session_token', 'w') as f:
                            f.write(cookie['value'])
                        break
            except Exception as e:
                print(f"Không thể lấy metabase session: {e}")

            send_telegram("✅ ĐĂNG NHẬP THÀNH CÔNG! Chìa khoá Cookies đã được làm mới tự động trên Cloud. Bạn đã có thể chạy quy trình Automation một cách mượt mà!", env)

        except Exception as e:
            try:
                page.screenshot(path="error.png")
                bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
                chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
                if bot_token and chat_id:
                    with open('error.png', 'rb') as photo:
                        requests.post(f"https://api.telegram.org/bot{bot_token}/sendPhoto", data={"chat_id": chat_id, "caption": f"❌ Lỗi: {e}"}, files={"photo": photo})
            except Exception as pic_err:
                send_telegram(f"❌ Lỗi trong quá trình đăng nhập ngầm: {e}\n(Không thể chụp ảnh màn hình: {pic_err})", env)
            
        browser.close()

if __name__ == '__main__':
    main()
