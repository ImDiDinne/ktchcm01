#!/usr/bin/env python3
"""
🤖 ai_reporter.py — Tự động thống kê và dùng AI (Gemini) để sinh báo cáo.
Sẽ phân tích dữ liệu chuyến xe hôm qua và gửi vào nhóm Telegram.
"""
import os
import sys
import json
import requests
import datetime
from zoneinfo import ZoneInfo
from pathlib import Path

BASE_DIR = Path(__file__).parent
ENV_FILE = BASE_DIR / '.env'

def load_env():
    env_vars = {}
    if ENV_FILE.exists():
        with open(ENV_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    env_vars[key.strip()] = val.strip().strip('"').strip("'")
    return env_vars

def fetch_last_n_days_data(supabase_url, supabase_key, days=7):
    vn_tz = ZoneInfo('Asia/Ho_Chi_Minh')
    now = datetime.datetime.now(vn_tz)
    
    all_trips = []
    dates_str = []
    
    for i in range(1, days + 1):
        target_date = now - datetime.timedelta(days=i)
        date_str = target_date.strftime('%d/%m/%Y')
        dates_str.append(date_str)
        
        url = f"{supabase_url}/rest/v1/trips_cache?date=eq.{date_str}"
        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}"
        }
        try:
            r = requests.get(url, headers=headers)
            if r.status_code == 200:
                all_trips.extend(r.json())
        except Exception:
            pass
            
    return dates_str, all_trips

def analyze_data(trips):
    total = len(trips)
    if total == 0:
        return {"total": 0, "completed": 0, "sla": 0, "peak_hour": "N/A", "peak_count": 0, "daily_stats": {}}
        
    daily_stats = {}
    for t in trips:
        date_str = t.get('date', 'Unknown')
        if date_str not in daily_stats:
            daily_stats[date_str] = {'total': 0, 'completed': 0}
        daily_stats[date_str]['total'] += 1
        if t.get('status') == 'Đã nhận':
            daily_stats[date_str]['completed'] += 1
            
    for d, stats in daily_stats.items():
        stats['sla'] = round(stats['completed'] / stats['total'] * 100, 1) if stats['total'] > 0 else 0
        
    completed = sum(s['completed'] for s in daily_stats.values())
    sla_percent = round(completed / total * 100, 1)
    
    hours = {}
    for t in trips:
        try:
            h = int(t.get('time', '00:00:00').split(':')[0])
            hours[h] = hours.get(h, 0) + 1
        except:
            pass
            
    peak_hour = max(hours, key=hours.get) if hours else None
    peak_count = hours[peak_hour] if peak_hour is not None else 0
    
    return {
        "total": total,
        "completed": completed,
        "sla": sla_percent,
        "peak_hour": f"{peak_hour:02d}:00" if peak_hour is not None else "N/A",
        "peak_count": peak_count,
        "daily_stats": daily_stats
    }

def generate_ai_report(dates_str, stats, gemini_key):
    if stats['total'] == 0:
        return f"📊 Báo cáo dự báo:\nKhông có đủ dữ liệu chuyến xe nào trong 7 ngày qua để phân tích."
        
    prompt = f"""
Bạn là chuyên gia phân tích vận hành kho. Dưới đây là dữ liệu 7 ngày qua:
- Tổng số chuyến xe: {stats['total']}
- Số chuyến đã hoàn thành: {stats['completed']}
- Tỷ lệ SLA trung bình: {stats['sla']}%
- Giờ cao điểm (nhiều xe nhất): {stats['peak_hour']} ({stats['peak_count']} chuyến)

Thống kê theo từng ngày:
{json.dumps(stats.get('daily_stats', {}), indent=2, ensure_ascii=False)}

Hãy viết báo cáo ngắn gọn (dưới 150 chữ):
1. Đánh giá tỷ lệ SLA trung bình và xu hướng qua các ngày.
2. Dự báo tình hình hôm nay dựa trên giờ cao điểm.
3. Lời khuyên vận hành cho đội ngũ kho.
Giọng điệu chuyên nghiệp, có icon minh họa.
"""
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
    payload = {
        "contents": [{"parts":[{"text": prompt}]}]
    }
    
    try:
        r = requests.post(url, json=payload, headers={'Content-Type': 'application/json'}, timeout=30)
        if r.status_code == 200:
            data = r.json()
            text = data['candidates'][0]['content']['parts'][0]['text']
            # Strip all legacy Markdown characters to prevent Telegram parser errors
            clean_text = text.replace('*', '').replace('_', '').replace('`', '').replace('[', '').replace(']', '')
            return f"🔮 *\"Bà Đồng AI\" Dự Báo Tương Lai (7-day AI Forecast)*\n\n{clean_text.strip()}"
        else:
            return f"⚠️ Lỗi gọi Gemini: {r.text}"
    except Exception as e:
        return f"⚠️ Lỗi gọi Gemini: {e}"

def send_telegram(bot_token, chat_id, message):
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "Markdown"
    }
    r = print("Using token:", bot_token[:10])
    r = requests.post(url, json=payload)
    print("Telegram response:", r.text)

def save_report_to_supabase(supabase_url, supabase_key, report_msg):
    url = f"{supabase_url}/rest/v1/system_secrets"
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }
    payload = {
        "key": "latest_ai_report",
        "value": report_msg
    }
    try:
        requests.post(url, headers=headers, json=payload, timeout=10)
        print("Đã lưu báo cáo AI lên Supabase (Web Dashboard).")
    except Exception as e:
        print(f"Lỗi lưu báo cáo lên Supabase: {e}")

def run_daily_report():
    print("--- BẮT ĐẦU CHẠY AI REPORT ---")
    env = load_env()
    supabase_url = env.get('SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    supabase_key = env.get('SUPABASE_SERVICE_ROLE_KEY') or env.get('SUPABASE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    bot_token = env.get('TELEGRAM_BOT_TOKEN') or os.environ.get('TELEGRAM_BOT_TOKEN')
    chat_id = env.get('TELEGRAM_CHAT_ID') or os.environ.get('TELEGRAM_CHAT_ID')
    gemini_key = env.get('GEMINI_API_KEY') or os.environ.get('GEMINI_API_KEY')
    
    if not supabase_url or not supabase_key:
        print("Lỗi: Thiếu Supabase config")
        return
        
    dates_str, trips = fetch_last_n_days_data(supabase_url.rstrip('/'), supabase_key, days=7)
    print(f"Đã lấy {len(trips)} chuyến xe trong 7 ngày qua.")
    
    stats = analyze_data(trips)
    print(f"Thống kê 7 ngày: {stats}")
    
    report_msg = ""
    if not gemini_key:
        print("Cảnh báo: Không có GEMINI_API_KEY, sẽ gửi báo cáo số liệu thô.")
        report_msg = f"📊 BÁO CÁO DỰ BÁO (7 NGÀY)\nTổng xe: {stats.get('total')}\nHoàn thành: {stats.get('completed')} ({stats.get('sla')}%) \nCao điểm: {stats.get('peak_hour')} ({stats.get('peak_count')} xe)\n\n(Vui lòng thêm GEMINI_API_KEY vào .env để AI tự viết phân tích dự báo)"
    else:
        print("Đang gọi Gemini AI để viết báo cáo...")
        report_msg = generate_ai_report(dates_str, stats, gemini_key)
        
    # Lưu lên web dashboard
    save_report_to_supabase(supabase_url.rstrip('/'), supabase_key, report_msg)
    
    # Gửi Telegram
    if bot_token and chat_id:
        print("Đã nhận báo cáo, đang gửi Telegram...")
        send_telegram(bot_token, chat_id, report_msg)
    else:
        print("Lỗi: Thiếu cấu hình Telegram, không thể gửi báo cáo.")
        
    print("HOÀN TẤT!")

if __name__ == '__main__':
    run_daily_report()
