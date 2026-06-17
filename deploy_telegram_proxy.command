#!/bin/bash
cd "$(dirname "$0")"
echo "=========================================================="
echo "🛡️ ĐANG BẢO MẬT TELEGRAM BOT TOKEN LÊN SUPABASE CLOUD 🛡️"
echo "=========================================================="
echo ""

echo "Vui lòng nhập Telegram Bot Token của bạn:"
echo "Gợi ý: Token thường có dạng số:chuỗi_kí_tự (ví dụ: 8919718466:AAHo...)"
read -s TELEGRAM_TOKEN

if [ -z "$TELEGRAM_TOKEN" ]; then
  echo "❌ Lỗi: Bạn chưa nhập token. Quá trình triển khai bị hủy."
  exit 1
fi

echo ""
echo "⏳ Đang thiết lập biến môi trường trên Supabase..."
supabase secrets set TELEGRAM_BOT_TOKEN="$TELEGRAM_TOKEN"

if [ $? -ne 0 ]; then
  echo "❌ Lỗi: Không thể thiết lập biến môi trường."
  exit 1
fi

echo "⏳ Đang deploy telegram-proxy function lên Supabase..."
supabase functions deploy telegram-proxy

if [ $? -eq 0 ]; then
  echo "✅ Triển khai thành công! Telegram Bot Token của bạn đã được bảo vệ tuyệt đối trên Cloud."
else
  echo "❌ Có lỗi xảy ra trong quá trình deploy hàm proxy."
fi

echo ""
echo "Nhấn phím bất kỳ để thoát..."
read -n 1
