-- ==============================================
-- 旧テーブルから新テーブル（ogi_プレフィックス）へのデータ移行SQL
-- ==============================================
-- ※ 必ず先に新しい create_tables.sql を実行し、
-- 空の ogi_ テーブルが作成されている状態で実行してください。

-- 1. 親テーブル（外部キーを持たないテーブル）のデータを移行
INSERT INTO ogi_staff SELECT * FROM staff;
INSERT INTO ogi_monthly_settings SELECT * FROM monthly_settings;

-- 2. 子テーブル（親テーブルを参照しているテーブル）のデータを移行
INSERT INTO ogi_shift_requests SELECT * FROM shift_requests;
INSERT INTO ogi_shift_assignments SELECT * FROM shift_assignments;

-- ==============================================
-- 移行結果のチェッククエリ
-- ==============================================
-- 以下のクエリを実行し、結果がすべて「OK」になれば移行成功です。

SELECT 
    'staff' AS table_name,
    (SELECT count(*) FROM staff) AS old_count,
    (SELECT count(*) FROM ogi_staff) AS new_count,
    CASE WHEN (SELECT count(*) FROM staff) = (SELECT count(*) FROM ogi_staff) THEN 'OK' ELSE 'NG' END AS status
UNION ALL
SELECT 
    'monthly_settings',
    (SELECT count(*) FROM monthly_settings),
    (SELECT count(*) FROM ogi_monthly_settings),
    CASE WHEN (SELECT count(*) FROM monthly_settings) = (SELECT count(*) FROM ogi_monthly_settings) THEN 'OK' ELSE 'NG' END
UNION ALL
SELECT 
    'shift_requests',
    (SELECT count(*) FROM shift_requests),
    (SELECT count(*) FROM ogi_shift_requests),
    CASE WHEN (SELECT count(*) FROM shift_requests) = (SELECT count(*) FROM ogi_shift_requests) THEN 'OK' ELSE 'NG' END
UNION ALL
SELECT 
    'shift_assignments',
    (SELECT count(*) FROM shift_assignments),
    (SELECT count(*) FROM ogi_shift_assignments),
    CASE WHEN (SELECT count(*) FROM shift_assignments) = (SELECT count(*) FROM ogi_shift_assignments) THEN 'OK' ELSE 'NG' END;

-- ※ 移行が完了し、アプリの動作確認が済んだら
-- 古いテーブル（staff, monthly_settings, shift_requests, shift_assignments）
-- は削除して構いません。
