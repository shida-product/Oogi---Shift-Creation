-- ==============================================
-- RLS (Row Level Security) 有効化と全許可ポリシー
-- ==============================================
-- 現在のアプリはSupabase Auth非依存（独自のPIN認証）のため、
-- フロントエンドからのアクセス（anonロール）に対して
-- 読み書きのフルアクセスを許可する設定です。

-- 1. RLSの有効化
ALTER TABLE public.ogi_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ogi_shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ogi_monthly_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ogi_shift_requests ENABLE ROW LEVEL SECURITY;

-- 2. anon（匿名）ユーザーに対する全許可ポリシーの作成
CREATE POLICY "Allow all access to ogi_staff" ON public.ogi_staff FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to ogi_shift_assignments" ON public.ogi_shift_assignments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to ogi_monthly_settings" ON public.ogi_monthly_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to ogi_shift_requests" ON public.ogi_shift_requests FOR ALL USING (true) WITH CHECK (true);
