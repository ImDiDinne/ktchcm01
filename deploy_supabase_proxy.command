#!/bin/bash
cd "$(dirname "$0")"
echo "=========================================================="
echo "🚀 ĐANG TRIỂN KHAI BẢO MẬT GITHUB PAT LÊN SUPABASE CLOUD 🚀"
echo "=========================================================="
echo ""

echo "Vui lòng nhập GitHub Personal Access Token (PAT) của bạn:"
echo "Gợi ý: Token thường bắt đầu bằng ghp_..."
read -s GITHUB_PAT

if [ -z "$GITHUB_PAT" ]; then
  echo "❌ Lỗi: Bạn chưa nhập token. Quá trình triển khai bị hủy."
  exit 1
fi

echo ""
echo "⏳ Đang thiết lập biến môi trường trên Supabase..."
supabase secrets set GITHUB_PAT="$GITHUB_PAT"

if [ $? -ne 0 ]; then
  echo "❌ Lỗi: Không thể thiết lập biến môi trường. Vui lòng đảm bảo bạn đã đăng nhập (supabase login) và liên kết dự án (supabase link)."
  exit 1
fi

echo "⏳ Đang deploy github-proxy function lên Supabase..."
supabase functions deploy github-proxy

if [ $? -eq 0 ]; then
  echo "✅ Triển khai thành công! Hệ thống dashboard giờ đã sử dụng bảo mật Edge Function."
else
  echo "❌ Có lỗi xảy ra trong quá trình deploy hàm proxy."
fi

echo ""
echo "Nhấn phím bất kỳ để thoát..."
read -n 1
