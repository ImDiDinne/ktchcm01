import os
import sys
import json
import time
from playwright.sync_api import sync_playwright
import requests

def load_env():
    env_vars = {}
    if os.path.exists('.env'):
        with open('.env', 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    env_vars[key.strip()] = val.strip().strip('"').strip("'")
    return env_vars

def send_telegram(message, env):
    bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
    chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
    if bot_token and chat_id:
        try:
            requests.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", json={"chat_id": chat_id, "text": message})
        except Exception as e:
            print(f"Error sending telegram message: {e}")

def poll_supabase(key, env, timeout_sec=180):
    supabase_url = env.get('SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    supabase_key = env.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    headers = {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}"}
    
    start_time = time.time()
    while time.time() - start_time < timeout_sec:
        try:
            r = requests.get(f"{supabase_url}/rest/v1/system_secrets?key=eq.{key}&select=value", headers=headers)
            if r.status_code == 200 and len(r.json()) > 0:
                code = r.json()[0]['value']
                # Delete the code after reading it
                requests.delete(f"{supabase_url}/rest/v1/system_secrets?key=eq.{key}", headers=headers)
                return code
        except Exception as e:
            print(f"Error polling {key}: {e}")
        time.sleep(3)
    return None

def handle_2fa_if_needed(page, env, supabase_url, supabase_key, context_name):
    max_steps = 3
    for step in range(max_steps):
        time.sleep(5)
        try:
            page.wait_for_load_state("networkidle", timeout=10000)
        except:
            pass
        
        if "sso" not in page.url and "login" not in page.url:
            break
            
        # Check if there are input fields
        inputs = page.query_selector_all('input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="password"])')
        if len(inputs) == 0:
            break
            
        page.screenshot(path="2fa_screen.png")
        bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
        chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
        
        # Xóa các mã cũ để chờ mã mới
        headers = {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}", "Content-Type": "application/json"}
        requests.delete(f"{supabase_url}/rest/v1/system_secrets?key=eq.ghn_2fa_code", headers=headers)
        requests.delete(f"{supabase_url}/rest/v1/system_secrets?key=eq.ghn_otp_code", headers=headers)
        
        if bot_token and chat_id:
            with open('2fa_screen.png', 'rb') as photo:
                step_text = "tiếp theo" if step > 0 else "bảo mật"
                caption = (
                    f"🔐 {context_name} yêu cầu xác thực {step_text}.\n\n"
                    "⚠️ LƯU Ý: Máy chủ Cloud có địa chỉ IP khác máy của bạn, nên GHN bắt buộc xác thực lại.\n\n"
                    "Vui lòng gõ lệnh sau vào nhóm chat:\n"
                    "`/2fa [mã số]`\n"
                    "(Ví dụ: /2fa 123456. Bạn có 3 phút)"
                )
                requests.post(f"https://api.telegram.org/bot{bot_token}/sendPhoto", data={"chat_id": chat_id, "caption": caption}, files={"photo": photo})
        
        code_2fa = poll_supabase('ghn_2fa_code', env)
        if not code_2fa:
            code_2fa = poll_supabase('ghn_otp_code', env)
            
        if not code_2fa:
            raise Exception(f"Quá thời gian chờ mã cho {context_name} (Bước {step+1})")
            
        # Refetch inputs as page might have slightly updated
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

def main():
    env = load_env()
    supabase_url = env.get('SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    supabase_key = env.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    username = env.get('GHN_USERNAME') or os.environ.get('GHN_USERNAME')
    password = env.get('GHN_PASSWORD') or os.environ.get('GHN_PASSWORD')
    
    if not supabase_url or not username or not password:
        send_telegram("❌ Lỗi: Máy chủ thiếu cấu hình GHN_USERNAME hoặc GHN_PASSWORD.", env)
        return

    send_telegram("🔄 Đang mở trình duyệt ngầm để đăng nhập vào GHN...", env)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        try:
            # 1. NHANH.GHN.VN/KTC-VAN-TAI
            page.goto("https://nhanh.ghn.vn/ktc-van-tai", wait_until="domcontentloaded")
            time.sleep(5)
            
            # Form login
            try:
                page.wait_for_selector('input[type="password"]', timeout=20000)
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
                send_telegram(f"⚠️ Không tìm thấy form đăng nhập. URL: {page.url}", env)
                bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
                chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
                if bot_token and chat_id:
                    with open('redirect_fail.png', 'rb') as photo:
                        requests.post(f"https://api.telegram.org/bot{bot_token}/sendPhoto", data={"chat_id": chat_id, "caption": "Ảnh màn hình:"}, files={"photo": photo})
                browser.close()
                return

            time.sleep(5)
            # Handle 2FA for nhanh.ghn.vn
            handle_2fa_if_needed(page, env, supabase_url, supabase_key, "Hệ thống TripScan (nhanh.ghn.vn)")
            
            try:
                page.wait_for_url("https://nhanh.ghn.vn/**", timeout=15000)
                if "login" in page.url or "sso" in page.url:
                    raise Exception(f"Bị kẹt ở trang đăng nhập: {page.url}")
            except:
                raise Exception(f"Không thể truy cập nhanh.ghn.vn/ktc-van-tai. URL hiện tại: {page.url}")

            # Lưu browser state
            state_json = context.storage_state()
            headers = {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}", "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"}
            requests.post(f"{supabase_url}/rest/v1/system_secrets", headers=headers, json={"key": "ghn_browser_state", "value": json.dumps(state_json)})
            
            # Take a success screenshot for TripScan
            page.screenshot(path="success_screen.png")
            bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
            chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
            success_msg = "✅ ĐĂNG NHẬP TRIPSCAN THÀNH CÔNG! Chìa khoá xe tải đã được tự động cấp mới."
            if bot_token and chat_id:
                try:
                    with open('success_screen.png', 'rb') as photo:
                        requests.post(f"https://api.telegram.org/bot{bot_token}/sendPhoto", data={"chat_id": chat_id, "caption": success_msg}, files={"photo": photo})
                except Exception as pic_err:
                    send_telegram(f"{success_msg}\n(Không thể gửi ảnh: {pic_err})", env)
            else:
                send_telegram(success_msg, env)
            
            # 2. DATA-BI.GHN.VN (Thử lấy cookies nếu có sẵn, không hiện screenshot)
            try:
                page.goto("https://data-bi.ghn.vn", wait_until="networkidle", timeout=15000)
                time.sleep(3)
                for cookie in context.cookies():
                    if cookie['name'] == 'metabase.SESSION':
                        with open('.session_token', 'w') as f:
                            f.write(cookie['value'])
                        break
            except Exception as bi_e:
                print(f"Lỗi Metabase: {bi_e}")

        except Exception as e:
            try:
                page.screenshot(path="error.png")
                bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
                chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
                if bot_token and chat_id:
                    with open('error.png', 'rb') as photo:
                        requests.post(f"https://api.telegram.org/bot{bot_token}/sendPhoto", data={"chat_id": chat_id, "caption": f"❌ Lỗi: {e}"}, files={"photo": photo})
            except:
                send_telegram(f"❌ Lỗi: {e}", env)

        finally:
            browser.close()
            # Dọn dẹp ảnh chụp màn hình để bảo mật
            for png in ["2fa_screen.png", "redirect_fail.png", "success_screen.png", "error.png"]:
                if os.path.exists(png):
                    try:
                        os.remove(png)
                    except:
                        pass

if __name__ == '__main__':
    main()
