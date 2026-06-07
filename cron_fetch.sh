#!/bin/bash
# ============================================
# 🔄 Auto Fetch Cron — Chạy tự động bởi launchd
# Logs ghi vào: ~/Desktop/AI dashboard/logs/
# ============================================

cd "$(dirname "$0")"
mkdir -p logs

LOG="logs/auto_fetch_$(date '+%Y%m%d').log"

echo "" >> "$LOG"
echo "========================================" >> "$LOG"
echo "🔄 $(date '+%d/%m/%Y %H:%M:%S') — Bắt đầu tải dữ liệu" >> "$LOG"
echo "========================================" >> "$LOG"

# Đồng bộ dữ liệu từ GitHub trước khi chạy để tránh xung đột
echo "🔄 Đang đồng bộ dữ liệu từ GitHub..." >> "$LOG"
git checkout HEAD -- tonkho_data.js tonkho_tuyen.json BaoCao_TonKho.xlsx >> "$LOG" 2>&1

if ! git diff --quiet || ! git diff --cached --quiet; then
    HAS_CHANGES=1
    git stash >> "$LOG" 2>&1
else
    HAS_CHANGES=0
fi

git pull origin main --rebase >> "$LOG" 2>&1
PULL_STATUS=$?

if [ $HAS_CHANGES -eq 1 ]; then
    git stash pop >> "$LOG" 2>&1
fi

if [ $PULL_STATUS -ne 0 ]; then
    echo "⚠️ Không thể pull từ GitHub, tiếp tục chạy..." >> "$LOG"
fi

# ── Auto Renew Session nếu cần ──
# Kiểm tra session hiện tại, nếu hết hạn thì tự động renew bằng Playwright
echo "🔑 Kiểm tra session token..." >> "$LOG"
python3 auto_renew_session.py --check-only >> "$LOG" 2>&1
CHECK_STATUS=$?

if [ $CHECK_STATUS -ne 0 ]; then
    echo "🔄 Session hết hạn — đang tự động renew..." >> "$LOG"
    python3 auto_renew_session.py >> "$LOG" 2>&1
    RENEW_STATUS=$?
    if [ $RENEW_STATUS -ne 0 ]; then
        echo "❌ Không thể tự động renew session. Cần mở browser đăng nhập lại." >> "$LOG"
        echo "💡 Chạy: python3 auto_renew_session.py --force-login" >> "$LOG"
    else
        echo "✅ Đã tự động renew session thành công!" >> "$LOG"
    fi
fi

# Tải dữ liệu từ Metabase + chạy export
python3 auto_fetch_data.py --run-export >> "$LOG" 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ $(date '+%H:%M:%S') — Export hoàn tất! Đang push lên GitHub..." >> "$LOG"
    
    # Auto push lên GitHub Pages
    git add -f tonkho_data.js tonkho_tuyen.json BaoCao_TonKho.xlsx >> "$LOG" 2>&1
    TIMESTAMP=$(date "+%d/%m/%Y %H:%M")
    git commit -m "chore(data): auto-update $TIMESTAMP" >> "$LOG" 2>&1
    git pull origin main --rebase --strategy-option=ours >> "$LOG" 2>&1
    git push origin main >> "$LOG" 2>&1
    
    if [ $? -eq 0 ]; then
        echo "🚀 $(date '+%H:%M:%S') — Đã push lên GitHub thành công!" >> "$LOG"
    else
        echo "⚠️ $(date '+%H:%M:%S') — Lỗi push GitHub (có thể mạng bị ngắt)" >> "$LOG"
    fi
else
    echo "❌ $(date '+%H:%M:%S') — Lỗi (exit code: $EXIT_CODE)" >> "$LOG"
fi

# Xóa log cũ hơn 7 ngày
find logs/ -name "auto_fetch_*.log" -mtime +7 -delete 2>/dev/null
