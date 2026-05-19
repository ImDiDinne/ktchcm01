#!/bin/bash
echo "=========================================="
echo "🚀 ĐANG CẬP NHẬT DỮ LIỆU TỒN KHO & CẢNH BÁO"
echo "=========================================="

cd "/Users/duyhuynh/Desktop/AI dashboard"

echo "[1/3] Đang phân tích Tồn kho (alert_system.py)..."
python3 alert_system.py

# (Đã gộp vào alert_system.py)

echo "[2/2] Đang quét và gửi cảnh báo Telegram (telegram_bot.py)..."
cd "/Users/duyhuynh/Desktop/AI dashboard"
# Tạm thời tắt chạy tự động bot telegram nếu người dùng chưa có Token, 
# nhưng cứ để chạy vì nó có chế độ "MÔ PHỎNG".
python3 "/Users/duyhuynh/Desktop/AI dashboard/telegram_bot.py"

echo "=========================================="
echo "✅ HOÀN TẤT! HÃY F5 LẠI TRANG DASHBOARD."
echo "=========================================="
read -p "Bấm phím Enter để thoát..."
