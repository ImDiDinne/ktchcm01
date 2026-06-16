#!/usr/bin/env python3
"""
🔄 Auto Fetch Data — Tự động tải dữ liệu tồn kho từ Metabase (data-bi.ghn.vn)

Thay thế việc phải mở trình duyệt tải file thủ công.
Credentials được đọc từ file .env (KHÔNG hardcode).

Sử dụng:
    python3 auto_fetch_data.py                  # Tải 1 lần
    python3 auto_fetch_data.py --loop 10        # Tự động mỗi 10 phút
    python3 auto_fetch_data.py --output data.xlsx  # Lưu vào file cụ thể
"""
import os, sys, json, time, argparse, re, subprocess
from pathlib import Path
from datetime import datetime

try:
    import requests
except ImportError:
    print("❌ Thiếu thư viện 'requests'. Cài đặt bằng: pip3 install requests")
    sys.exit(1)

# ── Cấu hình ──────────────────────────────────────────────
BASE_DIR        = Path(__file__).parent
ENV_FILE        = BASE_DIR / '.env'
DEFAULT_OUTPUT  = BASE_DIR / 'Datatonkho.xlsx'

METABASE_URL    = 'https://data-bi.ghn.vn'
CARD_ID         = 1386  # Question "Tồn chi tiết đơn"
WAREHOUSE_NAME  = 'Kho Trung Chuyển Hồ Chí Minh 01'

# Cấu hình Dashboard để lọc trước khi tải (Tránh bị Metabase truncate ở giới hạn 1M dòng)
DASHBOARD_ID    = 152
DASHCARD_ID     = 1599
PARAMETER_ID    = '6d90f1e2'

# ── Đọc .env ──────────────────────────────────────────────
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
            print(f"⚠️ Không thể đọc file .env: {e}")
    return env_vars

# ── Metabase API ──────────────────────────────────────────
class MetabaseClient:
    def __init__(self, base_url, username=None, password=None, session_token=None):
        self.base_url = base_url.rstrip('/')
        self.username = username
        self.password = password
        self.session_token = session_token
        self.auth_failed = False

    def login(self):
        """Đăng nhập Metabase, lấy session token."""
        if self.session_token:
            print("🔑 Dùng session token có sẵn...")
            try:
                resp = requests.get(
                    f"{self.base_url}/api/user/current",
                    headers=self._headers(),
                    timeout=15
                )
                if resp.status_code == 200:
                    user = resp.json()
                    print(f"✅ Đã xác thực: {user.get('common_name', user.get('email', 'OK'))}")
                    return True
                else:
                    print("⚠️ Session token hết hạn hoặc không hợp lệ.")
                    if self.username and self.password:
                        self.session_token = None
                        return self._login_with_credentials()
                    print("❌ Hãy lấy lại session token mới (xem hướng dẫn bên dưới).")
                    self.auth_failed = True
                    with open('.auth_error', 'w') as f: f.write('1')
                    return False
            except requests.exceptions.RequestException as re_err:
                print(f"❌ Không thể kết nối tới {self.base_url} để kiểm tra session: {re_err}")
                self.auth_failed = False
                return False
            except Exception as e:
                print(f"❌ Lỗi kiểm tra session: {e}")
                self.auth_failed = False
                return False

        return self._login_with_credentials()

    def _login_with_credentials(self):
        """Đăng nhập bằng username/password."""
        if not self.username or not self.password:
            print("❌ Thiếu thông tin đăng nhập.")
            self.auth_failed = True
            with open('.auth_error', 'w') as f: f.write('1')
            return False

        print(f"🔑 Đăng nhập Metabase ({self.base_url})...")
        try:
            # Thử đăng nhập thường
            resp = requests.post(
                f"{self.base_url}/api/session",
                json={"username": self.username, "password": self.password},
                timeout=30
            )
            if resp.status_code == 200:
                self.session_token = resp.json().get('id')
                print("✅ Đăng nhập thành công!")
                self._save_new_token()
                return True

            # Nếu thất bại, thử LDAP
            print("   Thử đăng nhập LDAP...")
            resp2 = requests.post(
                f"{self.base_url}/api/session",
                json={"username": self.username, "password": self.password, "ldap": True},
                timeout=30
            )
            if resp2.status_code == 200:
                self.session_token = resp2.json().get('id')
                print("✅ Đăng nhập LDAP thành công!")
                self._save_new_token()
                return True

            print("❌ Đăng nhập thất bại. Nếu bạn đăng nhập bằng Google/SSO:")
            print("   → Dùng METABASE_SESSION trong .env (xem hướng dẫn)")
            self._notify_telegram_auth_failed()
            self.auth_failed = True
            with open('.auth_error', 'w') as f: f.write('1')
            return False
        except requests.exceptions.ConnectionError:
            print(f"❌ Không thể kết nối tới {self.base_url}. Kiểm tra mạng.")
            self.auth_failed = False
            return False
        except Exception as e:
            print(f"❌ Lỗi đăng nhập: {e}")
            self.auth_failed = False
            return False

    def _notify_telegram_auth_failed(self):
        env = load_env()
        bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
        chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
        if bot_token and chat_id:
            try:
                msg = "⚠️ *CẢNH BÁO: CHÌA KHOÁ TỒN KHO ĐÃ HẾT HẠN!*\n\nHệ thống không thể tải dữ liệu Tồn Kho từ Metabase vì phiên đăng nhập đã hết hạn. Vui lòng vào Telegram và gõ lệnh `/login` để hệ thống tự động làm mới."
                requests.post(
                    f"https://api.telegram.org/bot{bot_token}/sendMessage",
                    json={"chat_id": chat_id, "text": msg, "parse_mode": "Markdown"},
                    timeout=5
                )
            except:
                pass

    def _save_new_token(self):
        """Lưu session token mới vào file để GitHub Actions cập nhật Secrets."""
        token_file = BASE_DIR / '.session_token'
        try:
            token_file.write_text(self.session_token)
            print(f"💾 Đã lưu session token mới vào {token_file.name}")
        except Exception as e:
            print(f"⚠️ Không thể lưu token: {e}")

    def _headers(self):
        """Headers cho mỗi request."""
        return {
            'X-Metabase-Session': self.session_token,
            'Content-Type': 'application/json'
        }

    def download_card_xlsx(self, card_id, output_path, parameters=None, max_retries=2):
        """Tải kết quả query của card dưới dạng XLSX (ưu tiên dùng Dashboard API để có lọc tránh bị truncate)."""
        print(f"📥 Đang tải dữ liệu từ Card #{card_id}...")

        body = {}
        use_dashboard_api = False
        
        # Nếu đang tải card 1386, dùng Dashboard API để có lọc theo kho
        if card_id == 1386:
            use_dashboard_api = True
            body = {
                "parameters": [
                    {
                        "type": "string/=",
                        "value": [WAREHOUSE_NAME],
                        "id": PARAMETER_ID
                    }
                ]
            }
        elif parameters:
            body['parameters'] = parameters

        try:
            if use_dashboard_api:
                query_url = f"{self.base_url}/api/dashboard/{DASHBOARD_ID}/dashcard/{DASHCARD_ID}/card/{card_id}/query/xlsx"
                print(f"🎯 Sử dụng Dashboard API (#{DASHBOARD_ID}) với bộ lọc: {WAREHOUSE_NAME}")
            else:
                query_url = f"{self.base_url}/api/card/{card_id}/query/xlsx"

            resp = requests.post(
                query_url,
                headers=self._headers(),
                json=body,
                timeout=300,
                stream=True
            )

            # Fallback nếu Dashboard API thất bại
            if use_dashboard_api and resp.status_code != 200 and resp.status_code != 202:
                print(f"⚠️ Dashboard API lỗi ({resp.status_code}). Fallback về Card API gốc (không lọc)...")
                query_url = f"{self.base_url}/api/card/{card_id}/query/xlsx"
                body = {}
                resp = requests.post(
                    query_url,
                    headers=self._headers(),
                    json=body,
                    timeout=300,
                    stream=True
                )

            if resp.status_code == 200:
                tmp_path = output_path.with_suffix('.tmp')
                with open(tmp_path, 'wb') as f:
                    for chunk in resp.iter_content(chunk_size=8192):
                        f.write(chunk)
                if tmp_path.exists() and tmp_path.stat().st_size > 5000:
                    if output_path.exists():
                        output_path.unlink()
                    tmp_path.rename(output_path)
                    file_size = os.path.getsize(output_path)
                    print(f"✅ Đã tải: {output_path.name} ({file_size:,} bytes)")
                    return True
                else:
                    print("❌ Lỗi: File tải về rỗng hoặc kích thước quá nhỏ. Không lưu đè.")
                    if tmp_path.exists():
                        tmp_path.unlink()
                    return False
            elif resp.status_code == 401:
                if max_retries > 0:
                    print(f"❌ Session hết hạn. Đang đăng nhập lại... (còn {max_retries} lần thử)")
                    if self.login():
                        return self.download_card_xlsx(card_id, output_path, parameters, max_retries=max_retries - 1)
                    return False
                else:
                    print("❌ Session hết hạn và đã hết số lần thử đăng nhập lại.")
                    self.auth_failed = True
                    with open('.auth_error', 'w') as f:
                        f.write('1')
                    return None
            elif resp.status_code == 202:
                print("⏳ Query đang xử lý, chờ kết quả...")
                return self._wait_and_download(query_url, output_path, body)
            else:
                print(f"❌ Lỗi tải dữ liệu (HTTP {resp.status_code}): {resp.text[:300]}")
                return False
        except requests.exceptions.Timeout:
            print("❌ Timeout — query mất quá lâu. Thử lại sau.")
            return False
        except Exception as e:
            print(f"❌ Lỗi: {e}")
            send_telegram_alert(f"❌ [LỖI NGHIÊM TRỌNG] Tải dữ liệu tồn kho thất bại!\nLỗi chi tiết: {e}")
            return False

    def _wait_and_download(self, query_url, output_path, body, max_retries=24):
        """Chờ query xử lý xong rồi tải kết quả (retry mỗi 5 giây, tối đa 2 phút)."""
        for attempt in range(1, max_retries + 1):
            print(f"   ⏳ Chờ... ({attempt * 5}s)")
            time.sleep(5)

            resp = requests.post(
                query_url,
                headers=self._headers(),
                json=body,
                timeout=300,
                stream=True
            )

            if resp.status_code == 200:
                tmp_path = output_path.with_suffix('.tmp')
                with open(tmp_path, 'wb') as f:
                    for chunk in resp.iter_content(chunk_size=8192):
                        f.write(chunk)
                if tmp_path.exists() and tmp_path.stat().st_size > 5000:
                    if output_path.exists():
                        output_path.unlink()
                    tmp_path.rename(output_path)
                    file_size = os.path.getsize(output_path)
                    print(f"✅ Đã tải: {output_path.name} ({file_size:,} bytes)")
                    return True
                else:
                    print("❌ Lỗi: File tải về rỗng hoặc kích thước quá nhỏ. Không lưu đè.")
                    if tmp_path.exists():
                        tmp_path.unlink()
                    return False
            elif resp.status_code != 202:
                print(f"❌ Lỗi (HTTP {resp.status_code}): {resp.text[:200]}")
                return False

        print(f"❌ Timeout sau {max_retries * 5}s. Query quá lâu.")
        return False


# ── Helpers for Expiration Notifications ─────────────────
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

def send_macos_notification(title, subtitle, message):
    """Gửi thông báo hệ thống trên macOS"""
    if sys.platform == 'darwin':
        try:
            import subprocess
            safe_title = title.replace('\\', '\\\\').replace('"', '\\"')
            safe_subtitle = subtitle.replace('\\', '\\\\').replace('"', '\\"')
            safe_message = message.replace('\\', '\\\\').replace('"', '\\"')
            script = f'display notification "{safe_message}" with title "{safe_title}" subtitle "{safe_subtitle}" sound name "Glass"'
            subprocess.run(['osascript', '-e', script], check=True)
            print("🔔 Đã hiển thị thông báo macOS.")
        except Exception as e:
            print(f"⚠️ Không thể gửi thông báo macOS: {e}")

def send_telegram_notification(message):
    """Gửi tin nhắn cảnh báo qua Telegram Bot nếu được cấu hình trong .env"""
    env = load_env()
    token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
    chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
    
    if token and chat_id:
        try:
            url = f"https://api.telegram.org/bot{token}/sendMessage"
            payload = {
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "HTML"
            }
            resp = requests.post(url, json=payload, timeout=15)
            if resp.status_code == 200:
                print("📨 Đã gửi cảnh báo qua Telegram thành công.")
            else:
                print(f"⚠️ Gửi Telegram thất bại (HTTP {resp.status_code}): {resp.text}")
        except Exception as e:
            print(f"⚠️ Không thể gửi cảnh báo Telegram: {e}")

def open_terminal_for_session_update():
    """Tự động mở file 🔄 Cập Nhật Session.command trên Terminal của macOS"""
    if sys.platform == 'darwin':
        try:
            cmd = f'open "{BASE_DIR}/🔄 Cập Nhật Session.command"'
            os.system(cmd)
            print("🚀 Đã tự động kích hoạt Terminal để cập nhật Session.")
        except Exception as e:
            print(f"⚠️ Không thể tự động mở Terminal: {e}")

def is_already_marked_expired():
    """Kiểm tra xem file dữ liệu đã được đánh dấu là hết hạn trước đó chưa"""
    json_path = BASE_DIR / 'tonkho_tuyen.json'
    if json_path.exists():
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data.get('session_expired', False)
        except:
            pass
    return False

def set_session_expired_flag(is_expired=True):
    """Cập nhật cờ session_expired vào file dữ liệu cũ để hiển thị trên dashboard"""
    if os.environ.get('CI') == 'true':
        print("⚠️ Chạy trong môi trường CI (GitHub Actions) — không ghi đè cờ session_expired lên Supabase.")
        return
    json_path = BASE_DIR / 'tonkho_tuyen.json'
    js_path = BASE_DIR / 'tonkho_data.js'
    
    data = None
    if json_path.exists():
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            print(f"⚠️ Không thể đọc {json_path.name}: {e}")
            
    if not data and js_path.exists():
        try:
            js_content = js_path.read_text(encoding='utf-8')
            match = re.search(r'var TONKHO_DATA=(.*);', js_content, re.DOTALL)
            if match:
                data = json.loads(match.group(1))
        except Exception as e:
            print(f"⚠️ Không thể đọc {js_path.name}: {e}")
            
    if data:
        data['session_expired'] = is_expired
        try:
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"✅ Đã ghi nhận cờ session_expired={is_expired} vào {json_path.name}")
        except Exception as e:
            print(f"⚠️ Lỗi ghi {json_path.name}: {e}")
            
        try:
            js_text = f"// Auto-generated — {data.get('updated', '')}\nvar TONKHO_DATA={json.dumps(data, ensure_ascii=False).replace('</script>', '<' + '/script>')};\n"
            js_path.write_text(js_text, encoding='utf-8')
            print(f"✅ Đã ghi nhận cờ session_expired={is_expired} vào {js_path.name}")
        except Exception as e:
            print(f"⚠️ Lỗi ghi {js_path.name}: {e}")

    # Cập nhật cờ session_expired lên Supabase
    env = load_env()
    supabase_url = env.get('SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    supabase_key = env.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or env.get('SUPABASE_KEY') or os.environ.get('SUPABASE_KEY')
    if supabase_url and supabase_key:
        supabase_url = supabase_url.rstrip('/')
        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json"
        }
        try:
            get_url = f"{supabase_url}/rest/v1/inventory_data?id=eq.1"
            resp = requests.get(get_url, headers=headers, timeout=15)
            if resp.status_code == 200 and len(resp.json()) > 0:
                row = resp.json()[0]
                row_data = row.get('data', {})
                row_data['session_expired'] = is_expired
                
                put_url = f"{supabase_url}/rest/v1/inventory_data"
                headers_upsert = {**headers, "Prefer": "resolution=merge-duplicates"}
                payload = {
                    "id": 1,
                    "data": row_data,
                    "updated_at": datetime.now().isoformat()
                }
                requests.post(put_url, headers=headers_upsert, json=payload, timeout=15)
                print(f"✅ Đã cập nhật cờ session_expired={is_expired} trên Supabase thành công!")
        except Exception as se_err:
            print(f"⚠️ Không thể cập nhật cờ session_expired lên Supabase: {se_err}")


# ── Main ──────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='🔄 Tự động tải dữ liệu tồn kho từ Metabase')
    parser.add_argument('--output', '-o', type=str, default=str(DEFAULT_OUTPUT),
                        help=f'Đường dẫn file output (mặc định: {DEFAULT_OUTPUT.name})')
    parser.add_argument('--loop', '-l', type=int, default=0,
                        help='Chạy lặp lại mỗi N phút (0 = chạy 1 lần)')
    parser.add_argument('--warehouse', '-w', type=str, default=WAREHOUSE_NAME,
                        help=f'Tên kho (mặc định: {WAREHOUSE_NAME})')
    parser.add_argument('--run-export', action='store_true',
                        help='Tự động chạy export_tonkho.py sau khi tải xong')
    args = parser.parse_args()

    # Đọc credentials
    env = load_env()
    username = env.get('METABASE_USERNAME') or os.environ.get('METABASE_USERNAME')
    password = env.get('METABASE_PASSWORD') or os.environ.get('METABASE_PASSWORD')
    session  = env.get('METABASE_SESSION') or os.environ.get('METABASE_SESSION')

    if not session and not (username and password):
        print("=" * 55)
        print("❌ THIẾU THÔNG TIN ĐĂNG NHẬP METABASE")
        print("=" * 55)
        print()
        print("Thêm vào file .env MỘT trong các cách sau:")
        print()
        print("─── Cách 1: Session Token (cho SSO/Google) ───")
        print('  METABASE_SESSION="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"')
        print()
        print("  Lấy token: Mở data-bi.ghn.vn → F12 → Application")
        print("  → Cookies → tìm 'metabase.SESSION' → copy giá trị (dạng UUID)")
        print()
        print("─── Cách 2: Email/Password ───")
        print('  METABASE_USERNAME="email@ghn.vn"')
        print('  METABASE_PASSWORD="mat_khau"')
        print()
        print(f"File .env: {ENV_FILE}")
        sys.exit(1)

    # Khởi tạo client
    client = MetabaseClient(METABASE_URL, username, password, session)

    if not client.login():
        if client.auth_failed:
            print("❌ Đăng nhập thất bại. Có thể Session Token đã hết hạn.")
            already_expired = is_already_marked_expired()
            set_session_expired_flag(True)
            send_macos_notification(
                title="KTC HCM 01 Dashboard",
                subtitle="Phiên đăng nhập hết hạn",
                message="Session Token Metabase đã hết hạn. Hãy chạy '🔄 Cập Nhật Session.command'!"
            )
            if not already_expired:
                open_terminal_for_session_update()
        else:
            print("⚠️ Lỗi kết nối mạng khi đăng nhập. Giữ nguyên trạng thái cũ.")
        sys.exit(1)

    # Nếu đăng nhập thành công, xoá cờ session_expired nếu trước đó bị đánh dấu
    if is_already_marked_expired():
        print("🎉 Đăng nhập thành công! Đang xoá cờ session_expired...")
        set_session_expired_flag(False)

    output_path = Path(args.output)

    def fetch_once():
        """Thực hiện 1 lần tải dữ liệu."""
        now = datetime.now().strftime('%d/%m/%Y %H:%M:%S')
        print(f"\n{'='*50}")
        print(f"🔄 Bắt đầu tải dữ liệu — {now}")
        print(f"📦 Kho: {args.warehouse}")
        print(f"{'='*50}")

        success = client.download_card_xlsx(CARD_ID, output_path)
        if success and args.run_export:
            print("\n📊 Chạy export_tonkho_v2.py...")
            result = subprocess.run(
                [sys.executable, str(BASE_DIR / 'export_tonkho_v2.py')],
                cwd=str(BASE_DIR),
                capture_output=True,
                text=True
            )
            if result.stdout:
                print(result.stdout)
            if result.stderr:
                print(f"⚠️ export_tonkho_v2.py stderr: {result.stderr}")
            
            if result.returncode != 0:
                print(f"❌ export_tonkho_v2.py thất bại (exit code: {result.returncode})")
                return False
        return success

    # Chạy 1 lần hoặc lặp
    if args.loop > 0:
        print(f"🔁 Chế độ tự động: cập nhật mỗi {args.loop} phút")
        print(f"   Nhấn Ctrl+C để dừng.\n")
        while True:
            try:
                if not client.login():
                    if client.auth_failed:
                        print("❌ Phiên đăng nhập hết hạn.")
                        already_expired = is_already_marked_expired()
                        set_session_expired_flag(True)
                        send_macos_notification(
                            title="KTC HCM 01 Dashboard",
                            subtitle="Phiên đăng nhập hết hạn",
                            message="Session Token Metabase đã hết hạn. Hãy chạy '🔄 Cập Nhật Session.command'!"
                        )
                        if not already_expired:
                            open_terminal_for_session_update()
                    else:
                        print("⚠️ Lỗi kết nối mạng khi đăng nhập. Giữ nguyên trạng thái cũ.")
                else:
                    # Nếu đăng nhập thành công, xoá cờ session_expired nếu trước đó bị đánh dấu
                    if is_already_marked_expired():
                        print("🎉 Đăng nhập thành công! Đang xoá cờ session_expired...")
                        set_session_expired_flag(False)
                    success = fetch_once()
                    if not success:
                        print("❌ Tải dữ liệu thất bại.")
                        if client.auth_failed:
                            already_expired = is_already_marked_expired()
                            set_session_expired_flag(True)
                            send_macos_notification(
                                title="KTC HCM 01 Dashboard",
                                subtitle="Lỗi tải dữ liệu",
                                message="Không thể tải dữ liệu từ Metabase. Có thể Session Token đã hết hạn."
                            )
                            if not already_expired:
                                open_terminal_for_session_update()
                        else:
                            print("⚠️ Lỗi mạng hoặc Metabase phản hồi chậm (Timeout). Bỏ qua và giữ nguyên trạng thái cũ.")
                print(f"\n⏰ Chờ {args.loop} phút đến lần tiếp theo...")
                time.sleep(args.loop * 60)
            except KeyboardInterrupt:
                print("\n\n🛑 Đã dừng tự động cập nhật.")
                break
    else:
        success = fetch_once()
        if not success:
            if client.auth_failed:
                already_expired = is_already_marked_expired()
                set_session_expired_flag(True)
                send_macos_notification(
                    title="KTC HCM 01 Dashboard",
                    subtitle="Phiên đăng nhập hết hạn",
                    message="Vui lòng cung cấp Session Token mới cho Metabase."
                )
                if not already_expired:
                    open_terminal_for_session_update()
            else:
                print("⚠️ Lỗi mạng hoặc Metabase phản hồi chậm (Timeout). Bỏ qua và giữ nguyên trạng thái cũ.")
            sys.exit(1)
        sys.exit(0)


if __name__ == '__main__':
    main()
