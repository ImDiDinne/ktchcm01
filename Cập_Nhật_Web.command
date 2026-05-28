#!/bin/bash
echo "=========================================="
echo "🚀 CẬP NHẬT DỮ LIỆU LÊN WEB (GitHub Pages)"
echo "=========================================="

cd "/Users/duyhuynh/Desktop/AI dashboard"

echo ""
echo "[1/4] Đang xuất dữ liệu tồn kho vào KTC Health Dashboard..."
python3 export_tonkho.py
if [ $? -ne 0 ]; then
    echo "❌ Lỗi khi chạy export_tonkho.py. Dừng lại."
    read -p "Bấm Enter để thoát..."
    exit 1
fi

echo ""
echo "[2/4] Đang phân tích dữ liệu tồn kho (cảnh báo)..."
python3 alert_system.py
if [ $? -ne 0 ]; then
    echo "❌ Lỗi khi chạy alert_system.py. Dừng lại."
    read -p "Bấm Enter để thoát..."
    exit 1
fi

echo ""
echo "[3/4] Đang push dữ liệu mới lên GitHub..."
cp ktc_health.html index.html
git add fleet.json inventory_data.json hierarchy_inventory.json inventory_alerts.json cot_alerts.json route_inventory.json ktc_health.html index.html tonkho_tuyen.json tonkho_data.js zoneCfg.js lich_tai/

# Tạo commit message với timestamp
TIMESTAMP=$(date "+%d/%m/%Y %H:%M")
git commit -m "Cập nhật dữ liệu: $TIMESTAMP"

git push origin main
if [ $? -ne 0 ]; then
    echo "❌ Lỗi khi push lên GitHub. Kiểm tra kết nối mạng."
    read -p "Bấm Enter để thoát..."
    exit 1
fi

echo ""
echo "=========================================="
echo "✅ XONG! Dữ liệu đã được cập nhật lên web."
echo "📦 KTC Health Dashboard đã đồng bộ tồn kho mới."
echo "🌐 Mở: https://imdidinne.github.io/ktchcm01/"
echo "⏳ (Chờ ~1-2 phút để GitHub cập nhật)"
echo "=========================================="

# Mở trình duyệt để kiểm tra
sleep 2 && open "https://imdidinne.github.io/ktchcm01/" &

read -p "Bấm Enter để thoát..."
