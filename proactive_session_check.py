#!/usr/bin/env python3
"""
🔑 Proactive Session Health Check
Kiểm tra tình trạng session Metabase + GHN mỗi 4 giờ.
Nếu sắp/đã hết hạn → tự động renew + thông báo Telegram.

Flow:
  1. Check Metabase session → nếu lỗi → tự login lại bằng username/password
  2. Check GHN browser state → nếu lỗi → tự login lại bằng Playwright
  3. Gửi kết quả qua Telegram
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timezone, timedelta

# ── Config ──
METABASE_URL = 'https://data-bi.ghn.vn'
GHN_URL = 'https://nhanh.ghn.vn'
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = os.environ.get('TELEGRAM_CHAT_ID', '')

VN_TZ = timezone(timedelta(hours=7))

def log(msg):
    now = datetime.now(VN_TZ).strftime('%H:%M:%S')
    print(f"[{now}] {msg}")

def send_telegram(message):
    """Gửi thông báo Telegram"""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        log("⚠️ Thiếu TELEGRAM config, bỏ qua gửi.")
        return
    chat_ids = TELEGRAM_CHAT_ID.split(',')
    for cid in chat_ids:
        cid = cid.strip()
        if not cid:
            continue
        try:
            requests.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={"chat_id": cid, "text": message, "parse_mode": "HTML"},
                timeout=10
            )
        except Exception as e:
            log(f"⚠️ Lỗi gửi Telegram cho {cid}: {e}")

# ── 1. Metabase Session Check ──

def check_metabase_session():
    """Kiểm tra Metabase session còn hợp lệ không. Trả về (valid, user_name)"""
    token = os.environ.get('METABASE_SESSION', '')
    if not token:
        log("❌ Metabase: Không có METABASE_SESSION")
        return False, None, token
    
    try:
        resp = requests.get(
            f"{METABASE_URL}/api/user/current",
            headers={'X-Metabase-Session': token},
            timeout=15
        )
        if resp.status_code == 200:
            user = resp.json()
            name = user.get('common_name', user.get('email', 'Unknown'))
            log(f"✅ Metabase: Session hợp lệ ({name})")
            return True, name, token
        else:
            log(f"❌ Metabase: Session hết hạn (HTTP {resp.status_code})")
            return False, None, token
    except requests.exceptions.RequestException as e:
        log(f"⚠️ Metabase: Lỗi kết nối — {e}")
        return None, None, token  # None = network error, don't renew

def renew_metabase_session():
    """Đăng nhập lại Metabase bằng username/password → lấy session mới"""
    username = os.environ.get('METABASE_USERNAME', '')
    password = os.environ.get('METABASE_PASSWORD', '')
    
    if not username or not password:
        log("❌ Metabase: Thiếu METABASE_USERNAME hoặc METABASE_PASSWORD")
        return None
    
    try:
        log("🔄 Metabase: Đang đăng nhập lại...")
        resp = requests.post(
            f"{METABASE_URL}/api/session",
            json={"username": username, "password": password},
            timeout=30
        )
        if resp.status_code == 200:
            data = resp.json()
            new_token = data.get('id', '')
            if new_token:
                log(f"✅ Metabase: Đã lấy session mới ({new_token[:8]}...)")
                # Ghi ra file để GitHub Actions step sau cập nhật Secret
                with open('.session_token', 'w') as f:
                    f.write(new_token)
                # Cũng cập nhật Supabase
                update_supabase_session_expired(False)
                return new_token
        log(f"❌ Metabase: Đăng nhập thất bại (HTTP {resp.status_code})")
        return None
    except Exception as e:
        log(f"❌ Metabase: Exception khi đăng nhập — {e}")
        return None

# ── 2. GHN Browser State Check ──

def check_ghn_session():
    """Kiểm tra GHN browser state còn hoạt động không"""
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("⚠️ GHN: Thiếu Supabase config, bỏ qua.")
        return None  # Can't check
    
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    
    try:
        # Lấy browser_state từ Supabase
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/system_secrets?key=eq.browser_state&select=value,updated_at",
            headers=headers, timeout=10
        )
        if resp.status_code != 200 or not resp.json():
            log("⚠️ GHN: Không tìm thấy browser_state trong Supabase")
            return False
        
        record = resp.json()[0]
        updated_at = record.get('updated_at', '')
        
        if updated_at:
            # Kiểm tra browser state đã cũ bao lâu
            try:
                updated_dt = datetime.fromisoformat(updated_at.replace('Z', '+00:00'))
                age_hours = (datetime.now(timezone.utc) - updated_dt).total_seconds() / 3600
                log(f"📋 GHN: Browser state cập nhật {age_hours:.1f} giờ trước")
                
                if age_hours > 72:
                    log("⚠️ GHN: Browser state quá cũ (> 72 giờ) — có thể đã hết hạn")
                    return False
            except:
                pass
        
        # Thử validate bằng cách load 1 trang GHN
        browser_state = record.get('value', '')
        if browser_state:
            return validate_ghn_with_playwright(browser_state)
        
        return False
        
    except Exception as e:
        log(f"⚠️ GHN: Lỗi kiểm tra — {e}")
        return None

def validate_ghn_with_playwright(browser_state_json):
    """Dùng Playwright để verify GHN session còn sống"""
    try:
        from playwright.sync_api import sync_playwright
        
        # Parse browser state
        if isinstance(browser_state_json, str):
            state = json.loads(browser_state_json)
        else:
            state = browser_state_json
        
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(storage_state=state)
            page = context.new_page()
            
            # Navigate to GHN
            page.goto(f"{GHN_URL}/vi/tms/hub-transport", timeout=30000, wait_until="networkidle")
            time.sleep(3)
            
            current_url = page.url
            page_content = page.content().lower()
            
            browser.close()
            
            # Nếu bị redirect về trang login → session hết hạn
            if 'login' in current_url or 'sso' in current_url:
                log("❌ GHN: Session hết hạn (redirect về login)")
                return False
            
            if 'hub-transport' in current_url or 'dashboard' in current_url:
                log("✅ GHN: Session hợp lệ")
                return True
            
            log(f"⚠️ GHN: Không rõ trạng thái (URL: {current_url[:80]})")
            return False
            
    except Exception as e:
        log(f"⚠️ GHN: Playwright validation lỗi — {e}")
        return None

def renew_ghn_session():
    """Tự động đăng nhập lại GHN bằng Playwright"""
    username = os.environ.get('GHN_USERNAME', '')
    password = os.environ.get('GHN_PASSWORD', '')
    
    if not username or not password:
        log("❌ GHN: Thiếu GHN_USERNAME hoặc GHN_PASSWORD")
        return False
    
    try:
        from playwright.sync_api import sync_playwright
        
        log("🔄 GHN: Đang đăng nhập lại...")
        
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context()
            page = context.new_page()
            
            # Login GHN
            page.goto(f"{GHN_URL}/vi/login", timeout=30000)
            time.sleep(2)
            
            # Điền form
            username_input = page.query_selector('input[name="username"], input[type="text"]')
            password_input = page.query_selector('input[name="password"], input[type="password"]')
            
            if username_input and password_input:
                username_input.fill(username)
                password_input.fill(password)
                
                # Click login button
                login_btn = page.query_selector('button[type="submit"], .btn-login, .login-btn')
                if login_btn:
                    login_btn.click()
                else:
                    password_input.press('Enter')
                
                time.sleep(5)
                page.wait_for_load_state("networkidle", timeout=15000)
                
                # Check if 2FA required
                current_url = page.url
                page_text = page.content().lower()
                
                if 'otp' in page_text or '2fa' in page_text or 'xác thực' in page_text:
                    log("⚠️ GHN: Yêu cầu 2FA — gửi thông báo Telegram")
                    send_telegram(
                        "🔐 <b>GHN yêu cầu mã 2FA/OTP</b>\n\n"
                        "Hệ thống đang tự động đăng nhập lại GHN nhưng cần mã xác thực.\n"
                        "Gửi <code>/2fa [mã]</code> hoặc <code>/otp [mã]</code> trong 3 phút."
                    )
                    
                    # Poll Supabase for 2FA code
                    code = poll_supabase_code(timeout_sec=180)
                    if code:
                        otp_input = page.query_selector('input[name="otp"], input[name="code"], input[type="tel"]')
                        if otp_input:
                            otp_input.fill(code)
                            otp_input.press('Enter')
                            time.sleep(5)
                    else:
                        log("❌ GHN: Timeout chờ mã 2FA")
                        browser.close()
                        return False
                
                # Check login success
                if 'login' not in page.url and 'sso' not in page.url:
                    # Save browser state
                    state = context.storage_state()
                    save_browser_state_to_supabase(state)
                    log("✅ GHN: Đăng nhập thành công, đã lưu browser state")
                    browser.close()
                    return True
            
            log("❌ GHN: Không tìm thấy form đăng nhập")
            browser.close()
            return False
            
    except Exception as e:
        log(f"❌ GHN: Exception — {e}")
        return False

def poll_supabase_code(timeout_sec=180):
    """Poll Supabase để lấy mã 2FA/OTP từ Telegram"""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    
    start = time.time()
    while time.time() - start < timeout_sec:
        for key in ['2fa_code', 'otp_code']:
            try:
                r = requests.get(
                    f"{SUPABASE_URL}/rest/v1/system_secrets?key=eq.{key}&select=value",
                    headers=headers, timeout=10
                )
                if r.status_code == 200 and r.json():
                    code = r.json()[0]['value']
                    requests.delete(
                        f"{SUPABASE_URL}/rest/v1/system_secrets?key=eq.{key}",
                        headers=headers
                    )
                    return code
            except:
                pass
        time.sleep(3)
    return None

def save_browser_state_to_supabase(state):
    """Lưu browser state vào Supabase system_secrets"""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }
    
    try:
        payload = {
            "key": "browser_state",
            "value": json.dumps(state),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        requests.post(
            f"{SUPABASE_URL}/rest/v1/system_secrets",
            headers=headers, json=payload, timeout=15
        )
        log("✅ Browser state đã lưu vào Supabase")
    except Exception as e:
        log(f"⚠️ Lỗi lưu browser state: {e}")

def update_supabase_session_expired(expired):
    """Cập nhật flag session_expired trong Supabase"""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }
    
    try:
        payload = {"id": 1, "session_expired": expired}
        requests.post(
            f"{SUPABASE_URL}/rest/v1/inventory_data",
            headers=headers, json=payload, timeout=10
        )
    except:
        pass

# ── Main ──

def main():
    now = datetime.now(VN_TZ).strftime('%d/%m/%Y %H:%M')
    log(f"{'='*55}")
    log(f"🔑 Proactive Session Health Check — {now}")
    log(f"{'='*55}")
    
    results = []
    metabase_renewed = False
    ghn_renewed = False
    
    # ── Check Metabase ──
    log("\n📊 [1/2] Kiểm tra Metabase Session...")
    mb_valid, mb_user, mb_token = check_metabase_session()
    
    if mb_valid == True:
        results.append("✅ Metabase: Hợp lệ")
    elif mb_valid == False:
        log("🔄 Metabase session hết hạn — thử renew...")
        new_token = renew_metabase_session()
        if new_token:
            results.append("🔄 Metabase: Đã renew thành công")
            metabase_renewed = True
        else:
            results.append("❌ Metabase: Hết hạn + RENEW THẤT BẠI")
    else:
        results.append("⚠️ Metabase: Lỗi mạng (bỏ qua)")
    
    # ── Check GHN ──
    log("\n🚛 [2/2] Kiểm tra GHN Session...")
    ghn_valid = check_ghn_session()
    
    if ghn_valid == True:
        results.append("✅ GHN: Hợp lệ")
    elif ghn_valid == False:
        log("🔄 GHN session hết hạn — thử renew...")
        if renew_ghn_session():
            results.append("🔄 GHN: Đã renew thành công")
            ghn_renewed = True
        else:
            results.append("❌ GHN: Hết hạn + RENEW THẤT BẠI")
    else:
        results.append("⚠️ GHN: Không kiểm tra được (bỏ qua)")
    
    # ── Summary ──
    log(f"\n{'='*55}")
    log("📋 KẾT QUẢ:")
    for r in results:
        log(f"  {r}")
    
    # Gửi Telegram nếu có vấn đề hoặc có renew
    has_issue = any('❌' in r for r in results)
    has_renew = metabase_renewed or ghn_renewed
    
    if has_issue or has_renew:
        status_icon = "❌" if has_issue else "🔄"
        telegram_msg = (
            f"{status_icon} <b>Session Health Check — {now}</b>\n\n"
            + "\n".join(results)
        )
        
        if has_issue:
            telegram_msg += (
                "\n\n⚠️ <b>Cần kiểm tra:</b>\n"
                "• Chạy <code>/login</code> để đăng nhập lại thủ công\n"
                "• Hoặc chạy file <b>🔄 Cập Nhật Session.command</b> trên Mac"
            )
        
        send_telegram(telegram_msg)
        
        if has_issue:
            sys.exit(1)
    else:
        log("\n✅ Tất cả session đều khỏe mạnh!")


if __name__ == '__main__':
    main()
