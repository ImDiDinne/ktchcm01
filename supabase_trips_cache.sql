-- ======================================================
-- 📊 SQL DDL: TẠO BẢNG TRIPS_CACHE TRÊN SUPABASE
-- Chạy đoạn mã này trong mục "SQL Editor" trên trang quản trị Supabase.
-- ======================================================

CREATE TABLE IF NOT EXISTS public.trips_cache (
    id text PRIMARY KEY,
    code text,
    date text,
    time text,
    slot text,
    username text,
    "syncedAt" text,
    status text,
    "driverName" text,
    phone text,
    vehicle text,
    capacity text,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Bật tính năng Row Level Security (RLS) để bảo mật
ALTER TABLE public.trips_cache ENABLE ROW LEVEL SECURITY;

-- Tạo Policy cho phép Đọc dữ liệu công khai (dành cho client/frontend gọi hiển thị)
CREATE POLICY "Allow public read on trips_cache" ON public.trips_cache
    FOR SELECT TO anon USING (true);

-- Tạo Policy cho phép Ghi/Chèn dữ liệu (dành cho Python daemon/cronjob sử dụng service_role_key)
CREATE POLICY "Allow service_role write on trips_cache" ON public.trips_cache
    FOR ALL TO service_role USING (true) WITH CHECK (true);
