#!/bin/bash
# ======================================================
# 🔄 Khởi Động Đồng Bộ Xe.command
# Double-click file này để kích hoạt đồng bộ chạy ngầm.
# Có thể thêm vào Hệ Thống > Mục Đăng Nhập để tự khởi chạy khi bật máy Mac.
# ======================================================

cd "$(dirname "$0")"
clear
echo "=================================================="
echo "🔄 KÍCH HOẠT ĐỒNG BỘ XE TRIPSCAN (SUPABASE CACHE)"
echo "=================================================="
echo ""

# Tắt tiến trình cũ nếu có để tránh chạy đè nhiều bản trùng lặp
pkill -f sync_trips_daemon.py 2>/dev/null

echo "⏳ Đang khởi chạy tập lệnh đồng bộ ngầm..."
nohup python3 sync_trips_daemon.py >/dev/null 2>&1 &

sleep 1.5
echo ""
echo "✅ ĐÃ KÍCH HOẠT CHẠY ẨN THÀNH CÔNG!"
echo "🌐 Dữ liệu TripScan sẽ tự động cập nhật mỗi 60 giây."
echo "💡 Bạn có thể đóng cửa sổ Terminal này lại."
echo "=================================================="
sleep 3
