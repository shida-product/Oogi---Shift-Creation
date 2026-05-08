import { supabase } from './supabase-config.js';

/**
 * 現在のセッションを取得し、未ログインであれば login.html にリダイレクトする
 * @returns {Promise<Object|null>} セッションオブジェクト
 */
export async function checkAuth() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) throw error;
    
    if (!session) {
      window.location.href = 'login.html';
      return null;
    }
    
    return session;
  } catch (error) {
    console.error('認証エラー:', error.message);
    window.location.href = 'login.html';
    return null;
  }
}

/**
 * ログアウト処理を行い、login.html にリダイレクトする
 */
export async function logout() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    window.location.href = 'login.html';
  } catch (error) {
    console.error('ログアウトエラー:', error.message);
    alert('ログアウトに失敗しました。');
  }
}

/**
 * ログアウトボタン（ID: btn-logout）が存在すればイベントリスナーを登録する
 */
export function setupLogoutButton() {
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      
      // ボタンをローディング状態にする（オプション）
      const originalHtml = logoutBtn.innerHTML;
      logoutBtn.innerHTML = '<i data-lucide="loader-2" class="animate-spin" style="width:16px;height:16px;margin-right:6px;"></i> ログアウト中...';
      if (typeof lucide !== 'undefined') lucide.createIcons();
      
      await logout();
      
      // 万が一エラーで戻ってきた場合
      logoutBtn.innerHTML = originalHtml;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    });
  }
}
