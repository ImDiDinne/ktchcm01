-- =========================================================================
-- 👤 SQL CHẠY TRÊN SUPABASE SQL EDITOR ĐỂ BẬT QUẢN LÝ NGƯỜI DÙNG
-- =========================================================================
-- Sao chép toàn bộ nội dung file này và chạy trong SQL Editor của Supabase
-- để tạo các hàm RPC (Stored Procedures) cho phép Hub Manager quản lý người dùng.
-- =========================================================================

-- 1. Hàm lấy danh sách toàn bộ người dùng
CREATE OR REPLACE FUNCTION public.get_all_users()
RETURNS TABLE(id uuid, email varchar, name text, role text, approved boolean)
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id, 
    u.email::varchar, 
    (u.raw_user_meta_data->>'name')::text as name,
    (u.raw_user_meta_data->>'role')::text as role,
    coalesce((u.raw_user_meta_data->>'approved')::boolean, false) as approved
  FROM auth.users u
  ORDER BY u.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- 2. Hàm thay đổi vai trò (Role) của người dùng (manager <=> operator)
CREATE OR REPLACE FUNCTION public.update_user_role(target_user_id uuid, target_role text)
RETURNS void
SECURITY DEFINER
AS $$
BEGIN
  UPDATE auth.users
  SET raw_user_meta_data = 
    coalesce(raw_user_meta_data, '{}'::jsonb) || 
    jsonb_build_object('role', target_role)
  WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql;

-- 3. Hàm phê duyệt hoặc chặn/thu hồi (Approve/Block) tài khoản người dùng
CREATE OR REPLACE FUNCTION public.update_user_approved(target_user_id uuid, is_approved boolean)
RETURNS void
SECURITY DEFINER
AS $$
BEGIN
  UPDATE auth.users
  SET raw_user_meta_data = 
    coalesce(raw_user_meta_data, '{}'::jsonb) || 
    jsonb_build_object('approved', is_approved)
  WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql;

-- 4. Hàm xóa tài khoản người dùng
CREATE OR REPLACE FUNCTION public.delete_user_by_id(target_user_id uuid)
RETURNS void
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql;
