#!/bin/bash
# ======================================================
# ▶️ Khởi Động Telegram Bot.command
# Double-click file này để kích hoạt bot nhận tin nhắn Telegram.
# ======================================================

cd "$(dirname "$0")"
clear
echo "=================================================="
echo "🤖 KÍCH HOẠT TELEGRAM TRIPS BOT"
echo "=================================================="
echo ""

pkill -f telegram_trips_bot.py 2>/dev/null

echo "⏳ Đang khởi chạy bot đọc tin nhắn Telegram..."
nohup python3 telegram_trips_bot.py > logs/telegram_trips_bot.log 2>&1 &

sleep 1.5
echo ""
echo "✅ ĐÃ KÍCH HOẠT BOT THÀNH CÔNG!"
echo "🤖 Bot đang chạy ngầm và theo dõi các mã chuyến đi trên Telegram."
echo "💡 Bạn có thể đóng cửa sổ Terminal này lại."
echo "=================================================="
sleep 3
