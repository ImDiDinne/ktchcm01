#!/bin/bash
echo "Đang khởi động Dashboard GHN..."
cd "/Users/duyhuynh/Desktop/AI dashboard"

# Mở trình duyệt trỏ tới localhost
sleep 1 && open "http://localhost:8080" &

# Chạy server tĩnh bằng Python
python3 -m http.server 8080
