#!/bin/bash
# ============================================
# 🔄 Auto Fetch Cron — Chạy tự động bởi cron
# Logs ghi vào: ~/Desktop/AI dashboard/logs/
# ============================================

cd "$(dirname "$0")"
mkdir -p logs

LOG="logs/auto_fetch_$(date '+%Y%m%d').log"

echo "" >> "$LOG"
echo "========================================" >> "$LOG"
echo "🔄 $(date '+%d/%m/%Y %H:%M:%S') — Bắt đầu tải dữ liệu" >> "$LOG"
echo "========================================" >> "$LOG"

# Tải dữ liệu từ Metabase + chạy export
python3 auto_fetch_data.py --run-export >> "$LOG" 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ $(date '+%H:%M:%S') — Hoàn tất!" >> "$LOG"
else
    echo "❌ $(date '+%H:%M:%S') — Lỗi (exit code: $EXIT_CODE)" >> "$LOG"
fi

# Xóa log cũ hơn 7 ngày
find logs/ -name "auto_fetch_*.log" -mtime +7 -delete 2>/dev/null
