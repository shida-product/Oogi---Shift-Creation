-- ==============================================
-- Supabase Advisory: Function Search Path Mutable の解消
-- ==============================================
-- 関数の実行時に意図しないスキーマが参照されないよう、
-- search_path を明示的に設定（空、またはpublic）することで警告を解消します。

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
