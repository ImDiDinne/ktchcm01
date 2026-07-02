-- 1. Tạo bảng system_secrets để chứa Cookies và cấu hình nhạy cảm
CREATE TABLE IF NOT EXISTS system_secrets (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Bật RLS bảo mật tuyệt đối
ALTER TABLE system_secrets ENABLE ROW LEVEL SECURITY;

-- Chỉ có Service Role (Máy chủ đám mây có Key ẩn) mới được phép ĐỌC và GHI
CREATE POLICY "Allow service_role full access to system_secrets"
ON system_secrets FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Chặn hoàn toàn quyền truy cập nặc danh và người dùng thông thường
REVOKE ALL ON system_secrets FROM anon, authenticated;


-- 2. Thêm cột unloaded_at vào bảng unloading_trips nếu chưa có
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'unloading_trips'
        AND column_name = 'unloaded_at'
    ) THEN
        ALTER TABLE unloading_trips ADD COLUMN unloaded_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;
