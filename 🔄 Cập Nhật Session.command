#!/usr/bin/env bash
# macOS Terminal Command

# Di chuyển đến thư mục chứa script
cd "$(dirname "$0")"

clear
echo "=========================================================="
echo "🔄 CẬP NHẬT PHIÊN ĐĂNG NHẬP METABASE (SESSION TOKEN)"
echo "=========================================================="
echo
echo "ℹ️ Phiên đăng nhập (Session) của Metabase thường hết hạn sau 14 - 30 ngày."
echo "   Mỗi tháng ní chỉ cần chạy file này 1-2 lần để cập nhật."
echo
echo "🌐 Đang mở trình duyệt tới trang GitHub Secrets..."
open "https://github.com/ImDiDinne/ktchcm01/settings/secrets/actions"
echo "👉 Hãy nhấn vào nút 'Edit' của METABASE_SESSION trên GitHub và dán mã mới."
echo
echo "----------------------------------------------------------"
echo "✍️ ĐỒNG BỘ HOÁ FILE .ENV CỤC BỘ (LOCAL)"
echo "----------------------------------------------------------"
echo "Ní dán mã Session mới lấy từ trình duyệt vào đây để cập nhật máy local:"
echo -n "👉 Nhập Session Token: "
read new_session

if [ -n "$new_session" ]; then
    # Kiểm tra xem .env có tồn tại không
    if [ ! -f .env ]; then
        touch .env
    fi

    # Cập nhật giá trị vào file .env bằng python thông qua đối số
    python3 -c "
import sys, os
new_sess = sys.argv[1]
env_file = '.env'
lines = []
found = False
if os.path.exists(env_file):
    with open(env_file, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip().startswith('METABASE_SESSION='):
                lines.append(f'METABASE_SESSION=\"{new_sess}\"\n')
                found = True
            else:
                lines.append(line)
if not found:
    lines.append(f'METABASE_SESSION=\"{new_sess}\"\n')
with open(env_file, 'w', encoding='utf-8') as f:
    f.writelines(lines)
" "$new_session"
    echo
    echo "✅ Đã đồng bộ thành công vào file .env local!"
else
    echo
    echo "⚠️ Không nhập mã, giữ nguyên file .env local."
fi

echo
echo "=========================================================="
echo "🎉 Xong! Ní có thể tắt cửa sổ Terminal này."
echo "=========================================================="
read -p "Nhấn Enter để đóng..."
