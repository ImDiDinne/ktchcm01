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
import os, sys, json, time, argparse
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

    def login(self):
        """Đăng nhập Metabase, lấy session token."""
        if self.session_token:
            print("🔑 Dùng session token có sẵn...")
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
                return False

        return self._login_with_credentials()

    def _login_with_credentials(self):
        """Đăng nhập bằng username/password."""
        if not self.username or not self.password:
            print("❌ Thiếu thông tin đăng nhập.")
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
                return True

            print("❌ Đăng nhập thất bại. Nếu bạn đăng nhập bằng Google/SSO:")
            print("   → Dùng METABASE_SESSION trong .env (xem hướng dẫn)")
            return False
        except requests.exceptions.ConnectionError:
            print(f"❌ Không thể kết nối tới {self.base_url}. Kiểm tra mạng.")
            return False
        except Exception as e:
            print(f"❌ Lỗi đăng nhập: {e}")
            return False

    def _headers(self):
        """Headers cho mỗi request."""
        return {
            'X-Metabase-Session': self.session_token,
            'Content-Type': 'application/json'
        }

    def download_card_xlsx(self, card_id, output_path, parameters=None):
        """Tải kết quả query của card dưới dạng XLSX."""
        print(f"📥 Đang tải dữ liệu từ Card #{card_id}...")

        body = {}
        if parameters:
            body['parameters'] = parameters

        try:
            resp = requests.post(
                f"{self.base_url}/api/card/{card_id}/query/xlsx",
                headers=self._headers(),
                json=body,
                timeout=300,
                stream=True
            )

            if resp.status_code == 200:
                with open(output_path, 'wb') as f:
                    for chunk in resp.iter_content(chunk_size=8192):
                        f.write(chunk)
                file_size = os.path.getsize(output_path)
                print(f"✅ Đã tải: {output_path.name} ({file_size:,} bytes)")
                return True
            elif resp.status_code == 401:
                print("❌ Session hết hạn. Đang đăng nhập lại...")
                if self.login():
                    return self.download_card_xlsx(card_id, output_path, parameters)
                return False
            elif resp.status_code == 202:
                print("⏳ Query đang xử lý, chờ kết quả...")
                return self._wait_and_download(card_id, output_path, parameters)
            else:
                print(f"❌ Lỗi tải dữ liệu (HTTP {resp.status_code}): {resp.text[:300]}")
                return False
        except requests.exceptions.Timeout:
            print("❌ Timeout — query mất quá lâu. Thử lại sau.")
            return False
        except Exception as e:
            print(f"❌ Lỗi: {e}")
            return False

    def _wait_and_download(self, card_id, output_path, parameters=None, max_retries=24):
        """Chờ query xử lý xong rồi tải kết quả (retry mỗi 5 giây, tối đa 2 phút)."""
        for attempt in range(1, max_retries + 1):
            print(f"   ⏳ Chờ... ({attempt * 5}s)")
            time.sleep(5)

            body = {}
            if parameters:
                body['parameters'] = parameters

            resp = requests.post(
                f"{self.base_url}/api/card/{card_id}/query/xlsx",
                headers=self._headers(),
                json=body,
                timeout=300,
                stream=True
            )

            if resp.status_code == 200:
                with open(output_path, 'wb') as f:
                    for chunk in resp.iter_content(chunk_size=8192):
                        f.write(chunk)
                file_size = os.path.getsize(output_path)
                print(f"✅ Đã tải: {output_path.name} ({file_size:,} bytes)")
                return True
            elif resp.status_code != 202:
                print(f"❌ Lỗi (HTTP {resp.status_code}): {resp.text[:200]}")
                return False

        print(f"❌ Timeout sau {max_retries * 5}s. Query quá lâu.")
        return False


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
        print("  → Cookies → tìm 'metabase.DEVICE' → copy giá trị")
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
        sys.exit(1)

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
            os.system(f'cd "{BASE_DIR}" && python3 export_tonkho_v2.py')
        return success

    # Chạy 1 lần hoặc lặp
    if args.loop > 0:
        print(f"🔁 Chế độ tự động: cập nhật mỗi {args.loop} phút")
        print(f"   Nhấn Ctrl+C để dừng.\n")
        while True:
            try:
                fetch_once()
                print(f"\n⏰ Chờ {args.loop} phút đến lần tiếp theo...")
                time.sleep(args.loop * 60)
            except KeyboardInterrupt:
                print("\n\n🛑 Đã dừng tự động cập nhật.")
                break
    else:
        success = fetch_once()
        sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
