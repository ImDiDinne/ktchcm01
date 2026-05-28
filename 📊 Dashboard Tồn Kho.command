#!/bin/bash
cd "/Users/duyhuynh/Desktop/AI dashboard"

# Xuất dữ liệu mới nhất từ Excel
python3 export_tonkho.py

# Dừng server cũ nếu có
OLD_PID=$(lsof -ti :8080)
if [ -n "$OLD_PID" ]; then
    kill "$OLD_PID" 2>/dev/null
    sleep 0.5
fi

# Khởi động server
python3 -m http.server 8080 --bind 127.0.0.1 &>/dev/null &

# Chờ server sẵn sàng
for i in 1 2 3 4 5; do
    sleep 1
    if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/ | grep -q "200"; then
        break
    fi
done

open "http://127.0.0.1:8080/index.html"
