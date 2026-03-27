/**
 * スタッフ管理画面ロジック
 * - スタッフの追加・編集・無効化
 * - 表示順の並び替え
 * - 職種・区分・配属・勤務条件の管理
 * - 月別公休数の管理
 */

import { supabase } from './supabase-config.js';

// ============================================================
// ラベル定義
// ============================================================
const ROLE_LABELS = { pharmacist: '薬剤師', office: '事務' };
const TYPE_LABELS = { special: '特別枠', employee: '社員', part_time: 'パート' };
const STORE_LABELS = { ebisu: '恵比寿', shibuya: '渋谷', both: '両方' };

// ============================================================
// 状態
// ============================================================
let staffList = [];
let editingStaffId = null;

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('add-staff-form').addEventListener('submit', addStaff);
  document.getElementById('edit-cancel').addEventListener('click', closeEditModal);

  document.getElementById('edit-save').addEventListener('click', saveEditModal);
  document.getElementById('edit-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEditModal();
  });
  await loadStaff();
  await loadMonthlySettings();
});

// ============================================================
// データ取得
// ============================================================
async function loadStaff() {
  const { data, error } = await supabase
    .from('staff')
    .select('*')
    .order('display_order');

  if (error) {
    showToast('読み込みに失敗しました', 'error');
    console.error(error);
    return;
  }

  staffList = data || [];
  renderStaffList();
}

// ============================================================
// スタッフ一覧描画
// ============================================================
function renderStaffList() {
  const container = document.getElementById('staff-list');

  if (staffList.length === 0) {
    container.innerHTML = '<p style="color:var(--color-text-muted);text-align:center;padding:40px 0;">スタッフが登録されていません</p>';
    return;
  }

  container.innerHTML = staffList.map((staff, index) => {
    const statusCls = staff.is_active ? 'staff-card__status--active' : 'staff-card__status--inactive';
    const statusText = staff.is_active ? '有効' : '無効';
    const cardCls = staff.is_active ? '' : 'is-inactive';
    const toggleBtnText = staff.is_active ? '無効化' : '有効化';
    const toggleBtnCls = staff.is_active ? 'btn--danger btn--sm' : 'btn--primary btn--sm';

    const roleLabel = ROLE_LABELS[staff.role] || staff.role;
    const typeLabel = TYPE_LABELS[staff.staff_type] || staff.staff_type;
    const storeLabel = STORE_LABELS[staff.assigned_store] || staff.assigned_store;

    // 勤務条件のサマリー
    const cond = staff.work_conditions || {};
    const condParts = [];
    if (cond.min_days_per_week) condParts.push(`週${cond.min_days_per_week}日〜`);
    if (cond.target_days_per_month) {
      if (cond.max_days_per_month && cond.max_days_per_month !== cond.target_days_per_month) {
        condParts.push(`月${cond.target_days_per_month}〜${cond.max_days_per_month}回`);
      } else {
        condParts.push(`月${cond.target_days_per_month}回`);
      }
    } else if (cond.max_days_per_month) {
      condParts.push(`最大月${cond.max_days_per_month}回`);
    }
    if (cond.max_sunday_per_month != null) condParts.push(`日曜${cond.max_sunday_per_month}回迄`);
    if (cond.alternating_weeks) condParts.push(`${cond.alternating_weeks.join('/')}交互`);
    const condSummary = condParts.length > 0 ? condParts.join(' / ') : '';

    return `
      <div class="staff-card ${cardCls}" data-id="${staff.id}">
        <div class="staff-card__main">
          <span class="staff-card__order">${index + 1}</span>
          <span class="staff-card__name">${escapeHtml(staff.name)}</span>
          <span class="staff-card__badge staff-card__badge--role">${roleLabel}</span>
          <span class="staff-card__badge staff-card__badge--type">${typeLabel}</span>
          <span class="staff-card__badge staff-card__badge--store">${storeLabel}</span>
          <span class="staff-card__status ${statusCls}">${statusText}</span>
        </div>
        ${condSummary ? `<div class="staff-card__conditions">${condSummary}</div>` : ''}
        <div class="staff-card__actions">
          <button class="sort-btn" onclick="moveStaff('${staff.id}', -1)" ${index === 0 ? 'disabled' : ''} title="上へ">▲</button>
          <button class="sort-btn" onclick="moveStaff('${staff.id}', 1)" ${index === staffList.length - 1 ? 'disabled' : ''} title="下へ">▼</button>
          <button class="btn btn--outline btn--sm" onclick="openEditModal('${staff.id}')"><i data-lucide="pencil" style="width:12px;height:12px;"></i> 編集</button>
          <button class="${toggleBtnCls}" onclick="toggleActive('${staff.id}')">${toggleBtnText}</button>
        </div>
      </div>`;
  }).join('');

  // 動的に追加したHTML内のLucideアイコンを初期化
  if (window.lucide) lucide.createIcons();
}

// ============================================================
// スタッフ追加
// ============================================================
async function addStaff(e) {
  e.preventDefault();
  const name = document.getElementById('new-staff-name').value.trim();
  if (!name) return;

  const maxOrder = staffList.reduce((max, s) => Math.max(max, s.display_order || 0), 0);

  const { error } = await supabase
    .from('staff')
    .insert({
      name,
      display_order: maxOrder + 1,
      is_active: true,
      role: document.getElementById('new-staff-role').value,
      staff_type: document.getElementById('new-staff-type').value,
      assigned_store: document.getElementById('new-staff-store').value,
    });

  if (error) {
    showToast('追加に失敗しました: ' + error.message, 'error');
    console.error(error);
    return;
  }

  showToast(`${name} を追加しました`, 'success');
  document.getElementById('new-staff-name').value = '';
  await loadStaff();
}

// ============================================================
// スタッフ編集モーダル
// ============================================================
window.openEditModal = function (id) {
  const staff = staffList.find(s => s.id === id);
  if (!staff) return;
  editingStaffId = id;

  document.getElementById('edit-modal-title').textContent = `${staff.name} を編集`;
  document.getElementById('edit-name').value = staff.name;
  document.getElementById('edit-role').value = staff.role || 'office';
  document.getElementById('edit-staff-type').value = staff.staff_type || 'part_time';
  document.getElementById('edit-store').value = staff.assigned_store || 'both';

  const cond = staff.work_conditions || {};
  document.getElementById('edit-min-days').value = cond.min_days_per_week || '';
  document.getElementById('edit-target-month').value = cond.target_days_per_month || '';
  document.getElementById('edit-max-month').value = cond.max_days_per_month || '';
  document.getElementById('edit-max-sunday').value = cond.max_sunday_per_month ?? '';

  const prio = staff.store_priority || {};
  document.getElementById('edit-priority-ebisu').value = prio.ebisu || '';
  document.getElementById('edit-priority-shibuya').value = prio.shibuya || '';

  document.getElementById('edit-modal-overlay').classList.add('active');
};

function closeEditModal() {
  document.getElementById('edit-modal-overlay').classList.remove('active');
  editingStaffId = null;
}

async function saveEditModal() {
  if (!editingStaffId) return;

  // 勤務条件をJSONに組み立て
  const workConditions = {};
  const minDays = parseInt(document.getElementById('edit-min-days').value);
  const targetMonth = parseInt(document.getElementById('edit-target-month').value);
  const maxMonth = parseInt(document.getElementById('edit-max-month').value);
  const maxSunday = parseInt(document.getElementById('edit-max-sunday').value);
  if (!isNaN(minDays) && minDays > 0) workConditions.min_days_per_week = minDays;
  if (!isNaN(targetMonth) && targetMonth > 0) workConditions.target_days_per_month = targetMonth;
  if (!isNaN(maxMonth) && maxMonth > 0) workConditions.max_days_per_month = maxMonth;
  if (!isNaN(maxSunday)) workConditions.max_sunday_per_month = maxSunday;

  // 店舗優先順位をJSONに組み立て
  const storePriority = {};
  const prioEbisu = parseInt(document.getElementById('edit-priority-ebisu').value);
  const prioShibuya = parseInt(document.getElementById('edit-priority-shibuya').value);
  if (!isNaN(prioEbisu) && prioEbisu > 0) storePriority.ebisu = prioEbisu;
  if (!isNaN(prioShibuya) && prioShibuya > 0) storePriority.shibuya = prioShibuya;

  const { error } = await supabase
    .from('staff')
    .update({
      name: document.getElementById('edit-name').value.trim(),
      role: document.getElementById('edit-role').value,
      staff_type: document.getElementById('edit-staff-type').value,
      assigned_store: document.getElementById('edit-store').value,
      work_conditions: workConditions,
      store_priority: storePriority,
    })
    .eq('id', editingStaffId);

  if (error) {
    showToast('保存に失敗しました: ' + error.message, 'error');
    console.error(error);
    return;
  }

  showToast('保存しました', 'success');
  closeEditModal();
  await loadStaff();
}

// ============================================================
// 有効/無効 切り替え
// ============================================================
window.toggleActive = async function (id) {
  const staff = staffList.find(s => s.id === id);
  if (!staff) return;

  const newState = !staff.is_active;
  const action = newState ? '有効化' : '無効化';

  if (!confirm(`${staff.name} を${action}しますか？`)) return;

  const { error } = await supabase
    .from('staff')
    .update({ is_active: newState })
    .eq('id', id);

  if (error) {
    showToast(`${action}に失敗しました`, 'error');
    console.error(error);
    return;
  }

  showToast(`${staff.name} を${action}しました`, 'success');
  await loadStaff();
};

// ============================================================
// 並び替え
// ============================================================
window.moveStaff = async function (id, direction) {
  const idx = staffList.findIndex(s => s.id === id);
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= staffList.length) return;

  const a = staffList[idx];
  const b = staffList[swapIdx];

  const { error: err1 } = await supabase.from('staff').update({ display_order: b.display_order }).eq('id', a.id);
  const { error: err2 } = await supabase.from('staff').update({ display_order: a.display_order }).eq('id', b.id);

  if (err1 || err2) {
    showToast('並び替えに失敗しました', 'error');
    console.error(err1, err2);
    return;
  }

  await loadStaff();
};

// ============================================================
// 月別公休数の管理
// ============================================================
async function loadMonthlySettings() {
  const container = document.getElementById('monthly-settings');
  const now = new Date();
  const currentYear = now.getFullYear();

  // 年ごとにグルーピング（今年と来年）
  const years = [currentYear, currentYear + 1];

  const { data, error } = await supabase.from('monthly_settings').select('*');
  if (error) { console.error(error); return; }

  const settingsMap = {};
  (data || []).forEach(s => settingsMap[s.year_month] = s);

  let html = '';
  years.forEach(y => {
    html += `<div class="yearly-group" style="margin-bottom:20px;">`;
    html += `<div style="font-weight:600;font-size:var(--font-size-sm);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--color-border);color:var(--color-text-secondary);">${y}年</div>`;
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px;">`;
    for (let m = 1; m <= 12; m++) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      const existing = settingsMap[ym];
      const val = existing ? existing.employee_days_off : 10;
      html += `<div style="display:flex;align-items:center;gap:4px;font-size:var(--font-size-xs);">
        <span style="min-width:32px;text-align:right;">${m}月</span>
        <input type="number" min="0" max="15" value="${val}" data-ym="${ym}" class="input-field" style="width:50px; text-align:center; padding: 4px 6px;">
        <span style="color:var(--color-text-muted);">日</span>
      </div>`;
    }
    html += `</div></div>`;
  });
  container.innerHTML = html;

  // 変更時に自動保存
  container.querySelectorAll('input[data-ym]').forEach(input => {
    input.addEventListener('change', async () => {
      const ym = input.dataset.ym;
      const val = parseInt(input.value);
      if (isNaN(val)) return;

      const { error } = await supabase
        .from('monthly_settings')
        .upsert({ year_month: ym, employee_days_off: val }, { onConflict: 'year_month' });

      if (error) {
        console.error(error);
        showToast('公休数の保存に失敗', 'error');
      } else {
        showToast(`${ym} の公休数を ${val} 日に更新`, 'success');
      }
    });
  });
}

// ============================================================
// ユーティリティ
// ============================================================
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = type === 'success' ? `✅ ${message}` : `❌ ${message}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}
