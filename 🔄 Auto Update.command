#!/bin/bash
echo "=========================================="
echo "🔄 TỰ ĐỘNG TẢI & CẬP NHẬT DỮ LIỆU TỒN KHO"
echo "=========================================="

cd "$(dirname "$0")"

echo ""
echo "[1/3] Đang tải dữ liệu từ Metabase..."
python3 auto_fetch_data.py --run-export
if [ $? -ne 0 ]; then
    echo "❌ Lỗi khi tải dữ liệu từ Metabase."
    echo "💡 Kiểm tra file .env đã có METABASE_USERNAME và METABASE_PASSWORD chưa."
    read -p "Bấm Enter để thoát..."
    exit 1
fi

echo ""
echo "[2/3] Đang phân tích dữ liệu (cảnh báo)..."
python3 alert_system.py
if [ $? -ne 0 ]; then
    echo "⚠️ Cảnh báo: alert_system.py có lỗi (không ảnh hưởng dữ liệu)."
fi

echo ""
echo "[3/3] Đang push dữ liệu mới lên GitHub..."
cp ktc_health.html index.html
git add fleet.json inventory_data.json hierarchy_inventory.json inventory_alerts.json cot_alerts.json route_inventory.json ktc_health.html index.html tonkho_tuyen.json tonkho_data.js zoneCfg.js lich_tai/

TIMESTAMP=$(date "+%d/%m/%Y %H:%M")
git commit -m "Cập nhật dữ liệu tự động: $TIMESTAMP"

git push origin main
if [ $? -ne 0 ]; then
    echo "❌ Lỗi khi push lên GitHub. Kiểm tra kết nối mạng."
    read -p "Bấm Enter để thoát..."
    exit 1
fi

echo ""
echo "=========================================="
echo "✅ XONG! Dữ liệu đã được tự động tải & cập nhật."
echo "🌐 Mở: https://imdidinne.github.io/ktchcm01/"
echo "⏳ (Chờ ~1-2 phút để GitHub cập nhật)"
echo "=========================================="

sleep 2 && open "https://imdidinne.github.io/ktchcm01/" &

read -p "Bấm Enter để thoát..."
