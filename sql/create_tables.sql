-- ==============================================
-- シフト作成ツール - 全テーブル作成SQL（M1 + M2 統合版）
-- ==============================================
-- ※ 既存テーブルを削除して再作成するリセットSQL
-- ※ Supabase SQL Editor で実行すること

-- 既存テーブルの削除（依存関係の順序に注意）
DROP TABLE IF EXISTS shift_assignments CASCADE;
DROP TABLE IF EXISTS shift_requests CASCADE;
DROP TABLE IF EXISTS monthly_settings CASCADE;
DROP TABLE IF EXISTS staff CASCADE;

-- ============================================================
-- 1. staff テーブル（M2拡張カラム込み）
-- ============================================================
CREATE TABLE staff (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_no TEXT UNIQUE,                        -- 会社の従業員番号（CSV出力に使用）
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  -- M2追加カラム
  role TEXT NOT NULL DEFAULT 'office' CHECK (role IN ('pharmacist', 'office')),
  staff_type TEXT NOT NULL DEFAULT 'part_time' CHECK (staff_type IN ('special', 'employee', 'part_time', 'external')),
  assigned_store TEXT NOT NULL DEFAULT 'both' CHECK (assigned_store IN ('ebisu', 'shibuya', 'both')),
  work_conditions JSONB DEFAULT '{}',
  store_priority JSONB DEFAULT '{}',
  -- タイムスタンプ
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. shift_requests テーブル（希望休）
-- ============================================================
CREATE TABLE shift_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('off', 'am', 'pm', 'other', 'dispense')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(staff_id, date)
);

CREATE INDEX idx_shift_requests_date ON shift_requests(date);
CREATE INDEX idx_shift_requests_staff_date ON shift_requests(staff_id, date);

-- ============================================================
-- 3. shift_assignments テーブル（シフト生成結果）
-- ============================================================
-- CSV出力と1:1対応する構造に設計
--   attendance_type → CSV「勤怠区分」にそのまま出力
--   work_pattern    → CSV「勤務パターン」にそのまま出力
CREATE TABLE shift_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  year_month TEXT NOT NULL,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  attendance_type TEXT NOT NULL DEFAULT '平日',    -- 平日 / 所定休日 / 法定休日
  work_pattern TEXT DEFAULT '',                    -- ○恵比寿 / ☆渋谷 / ◯開発 等（空欄=勤務なし）
  is_manual_override BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(staff_id, date)
);

CREATE INDEX idx_shift_assignments_yearmonth ON shift_assignments(year_month);
CREATE INDEX idx_shift_assignments_date ON shift_assignments(date);

-- ============================================================
-- 4. monthly_settings テーブル（月別公休数設定）
-- ============================================================
CREATE TABLE monthly_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  year_month TEXT NOT NULL UNIQUE,
  employee_days_off INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. トリガー（updated_at 自動更新）
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER staff_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER shift_requests_updated_at
  BEFORE UPDATE ON shift_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 6. 初期データ投入
-- ============================================================

-- 月別公休数
INSERT INTO monthly_settings (year_month, employee_days_off) VALUES
  ('2026-01', 10), ('2026-02', 9), ('2026-03', 10), ('2026-04', 10),
  ('2026-05', 10), ('2026-06', 9), ('2026-07', 10), ('2026-08', 10),
  ('2026-09', 9),  ('2026-10', 9), ('2026-11', 10), ('2026-12', 10),
  ('2027-01', 10), ('2027-02', 9), ('2027-03', 10), ('2027-04', 10);

-- スタッフ（薬剤師）
INSERT INTO staff (employee_no, name, display_order, role, staff_type, assigned_store, work_conditions, store_priority) VALUES
  ('01', '村上正樹',   1, 'pharmacist', 'special',   'both',    '{}', '{}'),
  ('05', '信太和人',   2, 'pharmacist', 'employee',  'shibuya', '{}', '{}'),
  ('08', '小野夏海',   3, 'pharmacist', 'employee',  'ebisu',   '{}', '{}'),
  ('03', '徳永麻衣子', 4, 'pharmacist', 'part_time', 'both',    '{"target_days_per_month": 17, "max_days_per_month": 22, "max_sunday_per_month": 2}', '{}');

-- スタッフ（事務）
INSERT INTO staff (employee_no, name, display_order, role, staff_type, assigned_store, work_conditions, store_priority) VALUES
  ('12', '木庭弥生',   5, 'office', 'part_time', 'both', '{"target_days_per_month": 17, "max_days_per_month": 22, "max_consecutive_days": 4}', '{"ebisu": 1, "shibuya": 4}'),
  ('11', '中村かな子', 6, 'office', 'part_time', 'both', '{"target_days_per_month": 10, "max_days_per_month": 10, "alternating_weeks": [2, 3], "max_consecutive_days": 4}', '{"ebisu": 2, "shibuya": 3}'),
  ('14', '諫早千佳',   7, 'office', 'part_time', 'both', '{"target_days_per_month": 13, "max_days_per_month": 17, "max_consecutive_days": 4}', '{"ebisu": 3, "shibuya": 1}'),
  ('13', '本庄里帆',   8, 'office', 'part_time', 'both', '{"max_consecutive_days": 3}', '{"ebisu": 4, "shibuya": 2}');

-- スタッフ（別薬局：リスト掲載のみ、シフト生成対象外）
INSERT INTO staff (employee_no, name, display_order, role, staff_type, assigned_store, work_conditions, store_priority) VALUES
  ('60', '野口由美子', 9, 'office', 'external', 'both', '{}', '{}'),
  ('61', '福島真依子', 10, 'office', 'external', 'both', '{}', '{}');
