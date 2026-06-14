#!/usr/bin/env python3
import os
import requests
import json
from datetime import datetime

def load_env():
    env_vars = {}
    env_file = '.env'
    if os.path.exists(env_file):
        with open(env_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    env_vars[key.strip()] = val.strip().strip('"').strip("'")
    return env_vars

def get_inventory_data(supabase_url, supabase_key):
    url = f"{supabase_url}/rest/v1/inventory_data?id=eq.1"
    headers = {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}"}
    resp = requests.get(url, headers=headers, timeout=15)
    if resp.status_code == 200 and len(resp.json()) > 0:
        return resp.json()[0].get('data', {})
    return None

def send_telegram_message(token, chat_ids, message):
    for chat_id in chat_ids.split(','):
        chat_id = chat_id.strip()
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {"chat_id": chat_id, "text": message, "parse_mode": "HTML"}
        requests.post(url, json=payload, timeout=10)

def main():
    env = load_env()
    supabase_url = env.get('SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    supabase_key = (
        env.get('SUPABASE_SERVICE_ROLE_KEY') or 
        os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or 
        env.get('SUPABASE_KEY') or 
        os.environ.get('SUPABASE_KEY')
    )
    bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
    chat_ids = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
    
    if not all([supabase_url, supabase_key, bot_token, chat_ids]):
        print("Thiếu cấu hình environment.")
        return

    data = get_inventory_data(supabase_url, supabase_key)
    if not data:
        print("Không thể lấy dữ liệu tồn kho.")
        return
    
    # Tính toán
    all_data = data.get('all', {})
    grand_total = all_data.get('grand_total', 0)
    
    # Đếm số đơn quá hạn 24h
    over_24h = 0
    # AGING_ORDER = ['1. 0-6', '2. 6-12', '3. 12-24', '4. 24-36', '5. 36-48', '6. 48-72', '7. 72-96', '8. 96-120', '9. 120+']
    if 'pivot' in all_data:
        for row in all_data['pivot']:
            if row[0] == 'Grand Total':
                # row structure: [name, 0-6, 6-12, 12-24, 24-36, 36-48, 48-72, 72-96, 96-120, 120+, Total]
                # over 24h = sum of cols index 4 to 9 (from 24-36 to 120+)
                over_24h = sum([val for val in row[4:10] if isinstance(val, (int, float))])
                break
                
    # Ước tính Freelancer
    # Tỷ lệ tiêu chuẩn
    required_freelancers = int((grand_total / 1000) * 2) # ví dụ: 2 người cho mỗi 1000 đơn
    
    now = datetime.now()
    ca_lam = "Sáng" if now.hour < 12 else "Tối"
    
    msg = f"🌅 <b>BÁO CÁO ĐẦU CA {ca_lam.upper()}</b>\n"
    msg += f"🗓 Ngày: {now.strftime('%d/%m/%Y %H:%M')}\n\n"
    msg += f"📦 <b>Tổng tồn kho:</b> {grand_total:,} đơn\n"
    msg += f"⚠️ <b>Tồn quá 24h:</b> {over_24h:,} đơn\n\n"
    msg += f"👥 <b>Khuyến nghị nhân sự ca này:</b>\n"
    msg += f"Dựa trên tổng tồn kho, hệ thống đề xuất cần khoảng <b>{required_freelancers} nhân sự (Freelancer)</b> để xử lý luồng hàng hiện tại.\n\n"
    msg += f"👉 <i>Xem chi tiết tại: https://imdidinne.github.io/ktchcm01/</i>"
    
    send_telegram_message(bot_token, chat_ids, msg)
    print("Đã gửi báo cáo Telegram thành công.")

if __name__ == '__main__':
    main()
