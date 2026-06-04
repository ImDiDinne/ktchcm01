#!/bin/bash
echo "=========================================="
echo "🔄 TỰ ĐỘNG TẢI & CẬP NHẬT DỮ LIỆU TỒN KHO"
echo "=========================================="

cd "$(dirname "$0")"

echo ""
echo "[1/3] Đang đồng bộ dữ liệu từ GitHub..."
# Bỏ các thay đổi của file tự sinh để tránh xung đột khi pull
git checkout HEAD -- tonkho_data.js tonkho_tuyen.json BaoCao_TonKho.xlsx 2>/dev/null
git pull origin main --rebase
if [ $? -ne 0 ]; then
    echo "⚠️ Không thể tự động pull từ GitHub. Bỏ qua và chạy tiếp..."
fi

echo ""
echo "[2/3] Đang tải dữ liệu từ Metabase và tổng hợp..."
python3 auto_fetch_data.py --run-export
if [ $? -ne 0 ]; then
    echo "❌ Lỗi khi tải hoặc tổng hợp dữ liệu."
    echo "💡 Kiểm tra file .env hoặc chạy '🔄 Cập Nhật Session.command' để cập nhật token mới."
    read -p "Bấm Enter để thoát..."
    exit 1
fi

echo ""
echo "[3/3] Đang push dữ liệu mới lên GitHub..."
git add -f tonkho_data.js tonkho_tuyen.json BaoCao_TonKho.xlsx mapping_params.csv index.html style.css export_tonkho_v2.py auto_fetch_data.py api/metabase_proxy.js

TIMESTAMP=$(date "+%d/%m/%Y %H:%M")
git commit -m "chore(data): auto-update inventory data: $TIMESTAMP"

git push origin main
if [ $? -ne 0 ]; then
    echo "❌ Lỗi khi push lên GitHub."
    echo "💡 Hãy đảm bảo máy tính có kết nối mạng và repository không bị xung đột."
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

