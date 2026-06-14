#!/bin/bash
# ============================================
# 🔄 Tự Động Gia Hạn Session Metabase
# ============================================

cd "$(dirname "$0")"

# Chạy kiểm tra session hiện tại
python3 auto_renew_session.py --check-only > /dev/null 2>&1
CHECK_STATUS=$?

# Nếu session hết hạn hoặc lỗi (exit code khác 0), tiến hành lấy lại session
if [ $CHECK_STATUS -ne 0 ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Session hết hạn, đang tiến hành lấy lại..." >> logs/renew_session.log
    python3 auto_renew_session.py >> logs/renew_session.log 2>&1
fi
