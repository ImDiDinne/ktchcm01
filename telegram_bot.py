import json
import urllib.request
import urllib.error
import time
import os
import datetime

# ==========================================
# CẤU HÌNH TELEGRAM BOT
# ==========================================
base_dir = os.path.dirname(os.path.abspath(__file__))

def load_env(env_path):
    env_vars = {}
    if os.path.exists(env_path):
        try:
            with open(env_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, val = line.split('=', 1)
                        env_vars[key.strip()] = val.strip().strip('"').strip("'")
        except Exception as e:
            print(f"⚠️ Không thể đọc file .env: {e}")
    return env_vars

env_vars = load_env(os.path.join(base_dir, '.env'))

TELEGRAM_BOT_TOKEN = env_vars.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
TELEGRAM_CHAT_ID = env_vars.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')

if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
    print("⚠️ Thiếu cấu hình Telegram. Vui lòng tạo file .env với TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID.")
    print("   Xem file .env.example để biết định dạng.")

# File paths
COT_ALERTS_FILE = os.path.join(base_dir, 'cot_alerts.json')
ALERTS_FILE     = os.path.join(base_dir, 'inventory_alerts.json')

def send_telegram_message(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        'chat_id': TELEGRAM_CHAT_ID,
        'text': message,
        'parse_mode': 'HTML'
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    try:
        with urllib.request.urlopen(req) as response:
            if response.status == 200:
                print("✅ Gửi Telegram thành công!")
            else:
                print(f"❌ Lỗi gửi Telegram: {response.status}")
    except urllib.error.URLError as e:
        print(f"❌ Lỗi kết nối Telegram: {e}")

def fmt_num(n):
    try:
        return f"{int(n):,}".replace(',', '.')
    except:
        return str(n)

def build_cot_message(alert):
    """Build a rich Telegram message for a COT departure reminder."""
    tuyen       = alert.get('tuyen', '—')
    cot_type    = alert.get('cot_type', '—')
    gio_xuat    = alert.get('gio_xuat_hcm01', '—')
    mins_left   = alert.get('minutes_left', 0)
    suc_chua    = alert.get('suc_chua_don', 0)
    tong_ton    = alert.get('tong_ton', 0)
    ty_le       = alert.get('ty_le_lay_day', '—')
    drop_risk   = alert.get('drop_risk', '—')
    stops       = alert.get('stops', [])

    # Header
    msg  = f"🚨 <b>NHẮC NHỞ COT XUẤT SẮP TỚI</b> 🚨\n"
    msg += f"━━━━━━━━━━━━━━━━━━━━\n"
    msg += f"🚛 <b>Tuyến:</b> {tuyen}  |  Nhóm: {cot_type}\n"
    msg += f"⏱ <b>Giờ xuất HCM01:</b> {gio_xuat}  (<b>{mins_left:.0f} phút nữa</b>)\n"
    msg += f"━━━━━━━━━━━━━━━━━━━━\n"

    # Inventory summary
    msg += f"📦 <b>Tổng tồn kho:</b> {fmt_num(tong_ton)} đơn\n"
    msg += f"🏋 <b>Sức chứa:</b> {fmt_num(suc_chua)} đơn\n"
    msg += f"📊 <b>Tỷ lệ lấp đầy:</b> {ty_le}\n"
    msg += f"━━━━━━━━━━━━━━━━━━━━\n"

    # Per-stop breakdown (only stops with data or loai)
    if stops:
        msg += f"🗺 <b>Lộ trình & tồn kho từng điểm:</b>\n"
        for s in stops:
            name = s.get('name', '—')
            inv  = s.get('inventory', 0)
            loai = s.get('loai', '')
            gden = s.get('gio_den', '')
            groi = s.get('gio_roi', '')

            time_info = ''
            if gden and groi:
                time_info = f"  ({gden}→{groi})"
            elif gden:
                time_info = f"  (đến {gden})"
            elif groi:
                time_info = f"  (rời {groi})"

            inv_str = f"<b>{fmt_num(inv)} đơn</b>" if inv > 0 else "0 đơn"
            type_str = f" [{loai}]" if loai else ""
            msg += f"  • {name}{type_str}{time_info}: {inv_str}\n"

    msg += f"━━━━━━━━━━━━━━━━━━━━\n"
    msg += f"⚠️ <b>Khả năng rớt hàng:</b> {drop_risk}\n"
    msg += f"━━━━━━━━━━━━━━━━━━━━\n"
    msg += f"👉 <i>Vui lòng kiểm tra và chuẩn bị ngay!</i>"
    return msg


def run_cot_reminder():
    """Send COT departure reminders for routes within 30 minutes."""
    now_str = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"\n[{now_str}] Kiểm tra COT sắp xuất (trong 30 phút)...")

    if not os.path.exists(COT_ALERTS_FILE):
        print(f"⚠️  Không tìm thấy {COT_ALERTS_FILE}. Hãy chạy alert_system.py trước.")
        return

    try:
        with open(COT_ALERTS_FILE, 'r', encoding='utf-8') as f:
            cot_alerts = json.load(f)
    except Exception as e:
        print(f"❌ Lỗi đọc {COT_ALERTS_FILE}: {e}")
        return

    if not cot_alerts:
        print("✅ Không có COT nào sắp xuất trong 30 phút tới.")
        return

    print(f"🚀 Phát hiện {len(cot_alerts)} COT sắp xuất. Đang gửi nhắc nhở...")

    # Group-header message
    group_header = (
        f"📋 <b>CÓ {len(cot_alerts)} COT XUẤT TRONG 30 PHÚT TỚI</b>\n"
        f"🕐 Thời gian kiểm tra: {datetime.datetime.now().strftime('%H:%M - %d/%m/%Y')}\n"
        f"⬇️ Chi tiết từng tuyến bên dưới:"
    )
    send_telegram_message(group_header)
    time.sleep(1)

    for alert in cot_alerts:
        msg = build_cot_message(alert)
        send_telegram_message(msg)
        time.sleep(1.5)  # Avoid Telegram rate limit


def run_inventory_alerts():
    """Send critical/warning inventory alerts (legacy)."""
    now_str = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"\n[{now_str}] Quét cảnh báo tồn kho...")

    if not os.path.exists(ALERTS_FILE):
        print(f"⚠️  Không tìm thấy {ALERTS_FILE}.")
        return

    try:
        with open(ALERTS_FILE, 'r', encoding='utf-8') as f:
            alerts = json.load(f)
    except Exception as e:
        print(f"❌ Lỗi đọc {ALERTS_FILE}: {e}")
        return

    relevant = [a for a in alerts if a.get('level') in ('critical', 'warning')]

    if not relevant:
        print("✅ Mọi thứ an toàn. Không có Báo Động tồn kho.")
        return

    print(f"⚠️  Phát hiện {len(relevant)} cảnh báo tồn kho. Đang gửi...")

    for alert in relevant[:5]:
        title       = alert.get('title', 'Cảnh báo')
        desc        = alert.get('desc', '')
        level       = alert.get('level', 'info')
        gio_xuat    = alert.get('gio_xuat', '—')
        gio_con_lai = alert.get('gio_con_lai', '—')
        ty_le       = alert.get('ty_le', '—')

        icon   = "🚨" if level == 'critical' else "⚠️"
        header = "BÁO ĐỘNG ĐỎ" if level == 'critical' else "CẢNH BÁO VÀNG"

        message  = f"{icon} <b>[{header}]</b>\n"
        message += f"🚛 <b>Tuyến:</b> {title.split(':')[-1].strip()}\n"
        message += f"⏰ <b>Giờ xuất (COT):</b> {gio_xuat}\n"
        message += f"⏳ <b>Còn lại:</b> {gio_con_lai}\n"
        message += f"📊 <b>Lấp đầy:</b> {ty_le}\n"
        message += f"📝 <b>Chi tiết:</b> {desc}\n\n"
        message += f"👉 <i>Vui lòng kiểm tra và xử lý ngay!</i>"

        send_telegram_message(message)
        time.sleep(1)

    if len(relevant) > 5:
        send_telegram_message(
            f"⚠️ Còn {len(relevant) - 5} cảnh báo khác. Vui lòng mở Dashboard để xem chi tiết!"
        )


if __name__ == '__main__':
    import sys

    # Usage: python telegram_bot.py [cot|inventory|all]
    mode = sys.argv[1] if len(sys.argv) > 1 else 'cot'

    if mode == 'cot':
        run_cot_reminder()
    elif mode == 'inventory':
        run_inventory_alerts()
    else:
        # Run both
        run_cot_reminder()
        time.sleep(2)
        run_inventory_alerts()

    # Uncomment below to run on a loop every 5 minutes:
    # print("\nBot chạy ngầm (mỗi 5 phút). Nhấn Ctrl+C để dừng.")
    # while True:
    #     time.sleep(5 * 60)
    #     run_cot_reminder()
