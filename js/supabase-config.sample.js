/**
 * Supabase接続設定（サンプル）
 * 
 * 使い方:
 * 1. このファイルを同じフォルダに「supabase-config.js」としてコピー
 * 2. 'YOUR_PROJECT' と 'YOUR_ANON_KEY' を実際の値に置き換える
 * 3. supabase-config.js は .gitignore で除外済み
 */

const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export { supabase, SUPABASE_URL, SUPABASE_ANON_KEY };
