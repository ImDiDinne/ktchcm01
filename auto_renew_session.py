#!/usr/bin/env python3
"""
🔑 Auto Renew Session — Tự động lấy lại Session Token từ Metabase

Sử dụng Playwright (headless browser) với persistent context:
  - Lần đầu: Mở browser CÓ GIAO DIỆN để bạn đăng nhập Google/SSO 1 lần duy nhất
  - Sau đó: Tự động lấy cookie metabase.SESSION mà không cần can thiệp

Quy trình:
  1. Mở trình duyệt tới data-bi.ghn.vn
  2. Nếu đã đăng nhập (Google session còn) → lấy cookie
  3. Nếu chưa → mở browser có giao diện để đăng nhập thủ công 1 lần
  4. Lưu session mới vào .env + GitHub Secrets (nếu có GH_PAT)

Sử dụng:
    python3 auto_renew_session.py              # Tự động renew
    python3 auto_renew_session.py --force-login # Bắt buộc mở browser để đăng nhập lại
"""

import os, sys, json, re, time, argparse
from pathlib import Path
from datetime import datetime

BASE_DIR = Path(__file__).parent
ENV_FILE = BASE_DIR / '.env'
METABASE_URL = 'https://data-bi.ghn.vn'
BROWSER_DATA_DIR = BASE_DIR / '.browser_data'

# ── Helpers ──────────────────────────────────────────────

def load_env():
    """Đọc file .env"""
    env_vars = {}
    if ENV_FILE.exists():
        with open(ENV_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    env_vars[key.strip()] = val.strip().strip('"').strip("'")
    return env_vars


def update_env_session(new_token):
    """Cập nhật METABASE_SESSION trong file .env"""
    lines = []
    found = False

    if ENV_FILE.exists():
        with open(ENV_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip().startswith('METABASE_SESSION='):
                    lines.append(f'METABASE_SESSION="{new_token}"\n')
                    found = True
                else:
                    lines.append(line)

    if not found:
        lines.append(f'METABASE_SESSION="{new_token}"\n')

    with open(ENV_FILE, 'w', encoding='utf-8') as f:
        f.writelines(lines)

    print(f"✅ Đã cập nhật .env với session mới: {new_token[:8]}...")


def update_github_secret(new_token):
    """Cập nhật GitHub Secret METABASE_SESSION qua GitHub API (không cần gh CLI)"""
    import requests as req

    env = load_env()
    gh_pat = env.get('GH_PAT') or os.environ.get('GH_PAT')

    if not gh_pat:
        print("⚠️ Chưa có GH_PAT trong .env — bỏ qua cập nhật GitHub Secrets.")
        print("   💡 Để tự động cập nhật, thêm GH_PAT=\"ghp_xxx\" vào file .env")
        return

    repo = 'ImDiDinne/ktchcm01'

    # Thử dùng gh CLI trước vì nó ổn định hơn và không cần PyNaCl
    try:
        import subprocess
        # Pass GH_TOKEN env var to authenticate gh CLI
        env_vars = os.environ.copy()
        env_vars['GH_TOKEN'] = gh_pat
        
        cmd = f'echo "{new_token}" | gh secret set METABASE_SESSION --repo {repo}'
        result = subprocess.run(cmd, shell=True, env=env_vars, capture_output=True, text=True)
        if result.returncode == 0:
            print("✅ Đã tự động cập nhật METABASE_SESSION bằng gh CLI thành công!")
            return
        else:
            print(f"⚠️ Thử dùng gh CLI thất bại: {result.stderr.strip()}. Chuyển sang dùng API...")
    except Exception as e:
        print(f"⚠️ Lỗi chạy gh CLI: {e}. Chuyển sang dùng API...")

    headers = {
        'Authorization': f'Bearer {gh_pat}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    }

    try:
        # 1. Lấy public key của repo để mã hóa secret
        pk_resp = req.get(
            f'https://api.github.com/repos/{repo}/actions/secrets/public-key',
            headers=headers, timeout=15
        )
        if pk_resp.status_code != 200:
            print(f"⚠️ Không thể lấy public key ({pk_resp.status_code}): {pk_resp.text[:200]}")
            return

        pk_data = pk_resp.json()
        public_key = pk_data['key']
        key_id = pk_data['key_id']

        # 2. Mã hóa secret value bằng libsodium (PyNaCl)
        try:
            from nacl import encoding, public as nacl_public
            sealed_box = nacl_public.SealedBox(
                nacl_public.PublicKey(public_key.encode("utf-8"), encoding.Base64Encoder())
            )
            encrypted = sealed_box.encrypt(new_token.encode("utf-8"))
            import base64
            encrypted_value = base64.b64encode(encrypted).decode("utf-8")
        except ImportError:
            # Fallback: dùng subprocess gọi python one-liner nếu có PyNaCl ở chỗ khác
            print("⚠️ PyNaCl chưa được cài. Đang thử cài tự động...")
            try:
                import subprocess
                subprocess.run([sys.executable, '-m', 'pip', 'install', 'PyNaCl', '--quiet', '--break-system-packages'],
                               capture_output=True, timeout=60)
                from nacl import encoding, public as nacl_public
                sealed_box = nacl_public.SealedBox(
                    nacl_public.PublicKey(public_key.encode("utf-8"), encoding.Base64Encoder())
                )
                encrypted = sealed_box.encrypt(new_token.encode("utf-8"))
                import base64
                encrypted_value = base64.b64encode(encrypted).decode("utf-8")
            except Exception as e2:
                print(f"⚠️ Không thể mã hóa secret (cần PyNaCl): {e2}")
                print("   💡 Cài thủ công: pip3 install PyNaCl")
                return

        # 3. Cập nhật secret
        put_resp = req.put(
            f'https://api.github.com/repos/{repo}/actions/secrets/METABASE_SESSION',
            headers=headers,
            json={
                'encrypted_value': encrypted_value,
                'key_id': key_id,
            },
            timeout=15
        )

        if put_resp.status_code in (201, 204):
            print("✅ Đã cập nhật METABASE_SESSION trong GitHub Secrets!")
        else:
            print(f"⚠️ Lỗi cập nhật GitHub Secret ({put_resp.status_code}): {put_resp.text[:200]}")

    except Exception as e:
        print(f"⚠️ Lỗi cập nhật GitHub Secret: {e}")


def verify_token(token):
    """Kiểm tra token có hợp lệ không bằng Metabase API"""
    try:
        import requests
        resp = requests.get(
            f"{METABASE_URL}/api/user/current",
            headers={'X-Metabase-Session': token},
            timeout=10
        )
        if resp.status_code == 200:
            user = resp.json()
            name = user.get('common_name', user.get('email', 'Unknown'))
            print(f"✅ Token hợp lệ! Xác thực: {name}")
            return True
        else:
            print(f"❌ Token không hợp lệ (HTTP {resp.status_code})")
            return False
    except requests.exceptions.RequestException as e:
        print(f"⚠️ Lỗi kết nối mạng khi kiểm tra token: {e}")
        return "connection_error"
    except Exception as e:
        print(f"⚠️ Không thể kiểm tra token: {e}")
        return False


def send_notification(title, message):
    """Gửi thông báo macOS"""
    if sys.platform == 'darwin':
        try:
            import subprocess
            script = f'display notification "{message}" with title "{title}" sound name "Glass"'
            subprocess.run(['osascript', '-e', script], check=True)
        except:
            pass


# ── Supabase Cookie Sync ─────────────────────────────────

def upload_cookies_to_supabase(context):
    """Lấy toàn bộ Cookies từ browser và upload lên bảng system_secrets trên Supabase"""
    print("🍪 Đang trích xuất toàn bộ Session Cookies...")
    try:
        import requests
        env = load_env()
        supabase_url = env.get('SUPABASE_URL') or os.environ.get('SUPABASE_URL')
        supabase_key = env.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

        if not supabase_url or not supabase_key:
            print("⚠️ Không tìm thấy SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY để upload cookies.")
            return

        # Trích xuất storage state (chứa toàn bộ cookie của các domain đã truy cập)
        state = context.storage_state()
        state_json = json.dumps(state)

        url = f"{supabase_url}/rest/v1/system_secrets"
        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"
        }
        
        payload = {
            "key": "ghn_browser_state",
            "value": state_json,
            "updated_at": datetime.now().isoformat()
        }

        resp = requests.post(url, headers=headers, json=payload, timeout=15)
        if resp.status_code in [200, 201]:
            print("✅ Đã tải Cookies an toàn lên Supabase (system_secrets)!")
        else:
            print(f"⚠️ Lỗi tải Cookies lên Supabase ({resp.status_code}): {resp.text[:200]}")
            
    except Exception as e:
        print(f"⚠️ Lỗi khi trích xuất và tải Cookies: {e}")

# ── Playwright Session Renewal ───────────────────────────

def renew_session_with_playwright(force_login=False, headless_mode=True):
    """
    Tự động lấy metabase.SESSION cookie bằng Playwright.
    Dùng persistent context để lưu phiên Google/SSO giữa các lần chạy.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("❌ Playwright chưa được cài. Chạy: pip3 install playwright && python3 -m playwright install chromium")
        return None

    print(f"\n🌐 Đang mở trình duyệt tới {METABASE_URL}...")

    # Tạo thư mục lưu browser data
    BROWSER_DATA_DIR.mkdir(exist_ok=True)

    with sync_playwright() as p:
        # ── Bước 1: Thử headless trước (tự động hoàn toàn) ──
        if not force_login and headless_mode:
            print("🤖 Thử chế độ tự động (headless)...")
            try:
                context = p.chromium.launch_persistent_context(
                    user_data_dir=str(BROWSER_DATA_DIR),
                    headless=True,
                    args=['--disable-blink-features=AutomationControlled'],
                    ignore_default_args=['--enable-automation'],
                )
                page = context.new_page()
                try:
                    page.goto(METABASE_URL, wait_until='load', timeout=30000)
                except Exception as goto_err:
                    print(f"⚠️ Page.goto load timeout/error: {goto_err}")

                # Chờ trang tải thêm 3 giây
                time.sleep(3)

                # Kiểm tra xem đã đăng nhập chưa (redirect về homepage thay vì login)
                current_url = page.url
                print(f"📍 URL hiện tại: {current_url}")

                # Lấy cookie metabase.SESSION
                cookies = context.cookies(METABASE_URL)
                session_cookie = None
                for c in cookies:
                    if c['name'] == 'metabase.SESSION':
                        session_cookie = c['value']
                        break

                if session_cookie and verify_token(session_cookie) == True:
                    print("🎉 Lấy session thành công ở chế độ tự động!")
                    upload_cookies_to_supabase(context)
                    context.close()
                    return session_cookie

                print("⚠️ Chưa có session hợp lệ ở chế độ headless, chuyển sang mở browser...")
                context.close()

            except Exception as e:
                print(f"⚠️ Headless thất bại: {e}")

        # ── Bước 2: Mở browser có giao diện để đăng nhập ──
        print("\n👀 Mở trình duyệt có giao diện — hãy đăng nhập Google/SSO nếu cần...")
        send_notification("KTC HCM 01", "Mở trình duyệt để đăng nhập Metabase...")

        context = p.chromium.launch_persistent_context(
            user_data_dir=str(BROWSER_DATA_DIR),
            headless=False,
            args=['--disable-blink-features=AutomationControlled'],
            ignore_default_args=['--enable-automation'],
        )
        page = context.new_page()
        try:
            page.goto(METABASE_URL, wait_until='load', timeout=60000)
            # Mở thêm tab cho nhanh.ghn.vn
            page2 = context.new_page()
            page2.goto("https://nhanh.ghn.vn/ktc-van-tai", wait_until='load', timeout=60000)
        except Exception as goto_err:
            print(f"⚠️ Page.goto load error in GUI browser: {goto_err}")

        session_cookie = None
        
        if force_login:
            print("\n🚨 QUAN TRỌNG: Hãy đăng nhập vào CẢ 2 TRANG (Metabase và Nhanh.GHN).")
            input("👉 Sau khi đăng nhập thành công cả 2, hãy quay lại đây và bấm ENTER để tiếp tục...")
            
            # Sau khi bấm Enter, lấy metabase cookie
            for c in context.cookies(METABASE_URL):
                if c['name'] == 'metabase.SESSION':
                    session_cookie = c['value']
                    break
        else:
            # Chờ cho đến khi có cookie metabase.SESSION (tối đa 5 phút)
            print("⏳ Chờ bạn đăng nhập... (tự động tắt sau khi hoàn tất, tối đa 5 phút)")
            max_wait = 300  # 5 phút
            start_time = time.time()

            while time.time() - start_time < max_wait:
                cookies = context.cookies(METABASE_URL)
                for c in cookies:
                    if c['name'] == 'metabase.SESSION':
                        session_cookie = c['value']
                        break

                if session_cookie:
                    # Xác nhận token hợp lệ
                    res = verify_token(session_cookie)
                    if res == True:
                        print("🎉 Đã lấy session token thành công!")
                        break
                    elif res == "connection_error":
                        print("⚠️ Lỗi kết nối mạng khi kiểm tra token mới. Sẽ thử lại sau...")
                        session_cookie = None
                    else:
                        session_cookie = None

                elapsed = int(time.time() - start_time)
                remaining = max_wait - elapsed
                if elapsed % 10 == 0:
                    print(f"   ⏳ Đang chờ đăng nhập... ({remaining}s còn lại)")

                time.sleep(2)

        upload_cookies_to_supabase(context)
        context.close()

        if not session_cookie:
            print("❌ Timeout — không lấy được session token sau 5 phút.")
            return None

        return session_cookie


# ── Main ──────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='🔑 Tự động renew Metabase Session Token')
    parser.add_argument('--force-login', action='store_true',
                        help='Bắt buộc mở browser để đăng nhập lại (dùng khi Google session hết hạn)')
    parser.add_argument('--check-only', action='store_true',
                        help='Chỉ kiểm tra token hiện tại có hợp lệ không, không renew')
    args = parser.parse_args()

    now = datetime.now().strftime('%d/%m/%Y %H:%M:%S')
    print(f"\n{'='*55}")
    print(f"🔑 Auto Renew Metabase Session — {now}")
    print(f"{'='*55}")

    # Đọc token hiện tại
    env = load_env()
    current_token = env.get('METABASE_SESSION', '')

    if args.check_only:
        if current_token:
            print(f"\n📋 Token hiện tại: {current_token[:8]}...")
            res = verify_token(current_token)
            if res == True:
                sys.exit(0)
            elif res == "connection_error":
                print("⚠️ Lỗi kết nối mạng, bỏ qua kiểm tra session.")
                sys.exit(2)
            else:
                sys.exit(1)
        else:
            print("\n❌ Chưa có session token trong .env")
            sys.exit(1)

    # Kiểm tra token hiện tại còn dùng được không
    if current_token and not args.force_login:
        print(f"\n🔍 Kiểm tra token hiện tại: {current_token[:8]}...")
        res = verify_token(current_token)
        if res == True:
            print("✅ Token hiện tại vẫn hợp lệ! Không cần renew.")
            return
        elif res == "connection_error":
            print("⚠️ Lỗi kết nối mạng. Không thể renew lúc này.")
            sys.exit(2)

    print("\n🔄 Token đã hết hạn, đang tự động renew...")

    # Chạy Playwright để lấy session mới
    new_token = renew_session_with_playwright(force_login=args.force_login)

    if new_token:
        # Cập nhật .env
        update_env_session(new_token)

        # Cập nhật GitHub Secrets
        update_github_secret(new_token)

        # Xóa cờ session_expired (nếu có)
        try:
            json_path = BASE_DIR / 'tonkho_tuyen.json'
            if json_path.exists():
                with open(json_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                if data.get('session_expired'):
                    data['session_expired'] = False
                    with open(json_path, 'w', encoding='utf-8') as f:
                        json.dump(data, f, ensure_ascii=False, indent=2)
                    print("✅ Đã xóa cờ session_expired trong dữ liệu.")

                    # Cập nhật tonkho_data.js
                    js_path = BASE_DIR / 'tonkho_data.js'
                    js_text = f"// Auto-generated — {data.get('updated', '')}\nvar TONKHO_DATA={json.dumps(data, ensure_ascii=False)};\n"
                    js_path.write_text(js_text, encoding='utf-8')
        except Exception as e:
            print(f"⚠️ Lỗi xóa cờ session_expired cục bộ: {e}")

        # Xóa cờ session_expired trên Supabase
        supabase_url = env.get('SUPABASE_URL') or os.environ.get('SUPABASE_URL')
        supabase_key = env.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or env.get('SUPABASE_KEY') or os.environ.get('SUPABASE_KEY')
        if supabase_url and supabase_key:
            try:
                import requests
                supabase_url = supabase_url.rstrip('/')
                headers = {
                    "apikey": supabase_key,
                    "Authorization": f"Bearer {supabase_key}",
                    "Content-Type": "application/json"
                }
                get_url = f"{supabase_url}/rest/v1/inventory_data?id=eq.1"
                resp = requests.get(get_url, headers=headers, timeout=15)
                if resp.status_code == 200 and len(resp.json()) > 0:
                    row = resp.json()[0]
                    row_data = row.get('data', {})
                    row_data['session_expired'] = False
                    
                    put_url = f"{supabase_url}/rest/v1/inventory_data"
                    headers_upsert = {**headers, "Prefer": "resolution=merge-duplicates"}
                    payload = {
                        "id": 1,
                        "data": row_data,
                        "updated_at": datetime.now().isoformat()
                    }
                    requests.post(put_url, headers=headers_upsert, json=payload, timeout=15)
                    print("✅ Đã xóa cờ session_expired trên Supabase thành công!")
            except Exception as se_err:
                print(f"⚠️ Không thể xóa cờ session_expired trên Supabase: {se_err}")

        send_notification(
            "KTC HCM 01 ✅",
            f"Session Metabase đã được tự động renew thành công! ({new_token[:8]}...)"
        )
        print(f"\n{'='*55}")
        print(f"🎉 HOÀN TẤT! Session mới: {new_token[:8]}...")
        print(f"{'='*55}")
    else:
        send_notification(
            "KTC HCM 01 ❌",
            "Không thể tự động renew session. Cần đăng nhập thủ công."
        )
        print("\n❌ Không thể renew session tự động.")
        sys.exit(1)


if __name__ == '__main__':
    main()
