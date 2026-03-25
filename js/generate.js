/**
 * シフト生成 メインロジック
 * - シフト自動生成アルゴリズム（ルールベース貪欲法）
 * - ガントチャート描画
 * - セルクリック→ドロップダウン手動編集
 * - CSV出力（Shift-JIS）
 */

import { supabase } from './supabase-config.js';

// ============================================================
// 定数
// ============================================================
const STORES = { EBISU: 'ebisu', SHIBUYA: 'shibuya' };

// 勤務パターン定義
const PATTERNS = {
  EMPLOYEE_EBISU: '○恵比寿',
  EMPLOYEE_SHIBUYA: '○渋谷',
  DEV: '◯開発',
  PART_EBISU: '☆恵比寿',
  PART_SHIBUYA: '☆渋谷',
  PM_PART_SHIBUYA: '午後☆渋谷',
};

// パターン→CSSクラスのマッピング
const PATTERN_CSS = {
  '○恵比寿': 'pattern-marker--employee-ebisu',
  '○渋谷': 'pattern-marker--employee-shibuya',
  '◯開発': 'pattern-marker--dev',
  '☆恵比寿': 'pattern-marker--part-ebisu',
  '☆渋谷': 'pattern-marker--part-shibuya',
  '午後☆渋谷': 'pattern-marker--pm-part-shibuya',
};

// パターン→短縮ラベル
const PATTERN_LABEL = {
  '○恵比寿': '恵',
  '○渋谷': '渋',
  '◯開発': '開発',
  '☆恵比寿': '恵',
  '☆渋谷': '渋',
  '午後☆渋谷': '午渋',
};

// スタッフ別の使用可能パターン（staff_type + role で決定）
function getAvailablePatterns(staff) {
  if (staff.staff_type === 'external') return [''];
  if (staff.staff_type === 'special') {
    // 村上：社員パターン + 特殊
    return ['', '○恵比寿', '○渋谷', 'りんご', '出張', '応援'];
  }
  if (staff.staff_type === 'employee' && staff.role === 'pharmacist') {
    if (staff.assigned_store === 'ebisu') return ['', '○恵比寿'];
    if (staff.assigned_store === 'shibuya') return ['', '○渋谷', '◯開発'];
  }
  if (staff.staff_type === 'part_time' && staff.role === 'pharmacist') {
    return ['', '☆恵比寿', '☆渋谷'];
  }
  if (staff.staff_type === 'part_time' && staff.role === 'office') {
    return ['', '☆恵比寿', '☆渋谷', '午後☆渋谷'];
  }
  return [''];
}

// ============================================================
// 祝日データ
// ============================================================
function getHolidays(year) {
  const fixed = [
    [1, 1, '元日'], [2, 11, '建国記念の日'], [2, 23, '天皇誕生日'],
    [4, 29, '昭和の日'], [5, 3, '憲法記念日'], [5, 4, 'みどりの日'],
    [5, 5, 'こどもの日'], [8, 11, '山の日'], [11, 3, '文化の日'],
    [11, 23, '勤労感謝の日'],
  ];
  const holidays = {};
  fixed.forEach(([m, d, name]) => {
    holidays[`${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`] = name;
  });
  const shunbun = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  holidays[`${year}-03-${String(shunbun).padStart(2, '0')}`] = '春分の日';
  const shubun = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  holidays[`${year}-09-${String(shubun).padStart(2, '0')}`] = '秋分の日';
  const happyMonday = (m, week) => {
    let d = new Date(year, m - 1, 1);
    let count = 0;
    while (count < week) {
      if (d.getDay() === 1) count++;
      if (count < week) d.setDate(d.getDate() + 1);
    }
    return d;
  };
  [[1, 2, '成人の日'], [7, 3, '海の日'], [9, 3, '敬老の日'], [10, 2, 'スポーツの日']].forEach(([m, week, name]) => {
    const d = happyMonday(m, week);
    holidays[formatDate(d)] = name;
  });
  Object.keys({ ...holidays }).forEach(key => {
    const d = new Date(key + 'T00:00:00');
    if (d.getDay() === 0) {
      let next = new Date(d);
      next.setDate(next.getDate() + 1);
      while (holidays[formatDate(next)]) next.setDate(next.getDate() + 1);
      holidays[formatDate(next)] = '振替休日';
    }
  });
  return holidays;
}

// ============================================================
// 状態管理
// ============================================================
const state = {
  staffList: [],
  requests: [],       // shift_requests（希望休）
  assignments: [],     // shift_assignments（生成結果）
  monthlySettings: {},
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),
  holidays: {},
  warnings: [],
  hasGenerated: false,
  // Undo/Redo/Reset用
  baselineAssignments: null,  // 生成直後のスナップショット（リセット先）
  history: [],                // [snapshot, snapshot, ...]
  historyIndex: -1,           // 現在のhistory位置
};

const HISTORY_MAX = 50; // 履歴の最大件数

// ディープコピー（assignments配列用）
function cloneAssignments(assignments) {
  return assignments.map(a => ({ ...a }));
}

// 履歴にpush（手動変更時に呼ぶ）
function pushHistory() {
  // 現在位置より先の履歴を切り捨て（redoスタックをクリア）
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(cloneAssignments(state.assignments));
  if (state.history.length > HISTORY_MAX) state.history.shift();
  state.historyIndex = state.history.length - 1;
  updateUndoRedoButtons();
}

// 履歴からassignmentsを復元してUI更新
async function restoreFromHistory(index) {
  state.historyIndex = index;
  state.assignments = cloneAssignments(state.history[index]);
  const yearMonth = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}`;
  await saveAssignments(yearMonth, state.assignments);
  renderGantt();
  renderConditionsCheck();
  updateUndoRedoButtons();
}

function handleUndo() {
  if (state.historyIndex > 0) restoreFromHistory(state.historyIndex - 1);
}

function handleRedo() {
  if (state.historyIndex < state.history.length - 1) restoreFromHistory(state.historyIndex + 1);
}

async function handleReset() {
  if (!state.baselineAssignments) return;
  state.assignments = cloneAssignments(state.baselineAssignments);
  // 手動変更フラグもクリア（赤バッジ除去）
  state.assignments.forEach(a => a.is_manual_override = false);
  // 履歴をクリアして初期状態に戻す
  state.history = [cloneAssignments(state.assignments)];
  state.historyIndex = 0;
  const yearMonth = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}`;
  await saveAssignments(yearMonth, state.assignments);
  renderGantt();
  renderConditionsCheck();
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('btn-undo');
  const redoBtn = document.getElementById('btn-redo');
  const resetBtn = document.getElementById('btn-reset');
  if (undoBtn) undoBtn.disabled = state.historyIndex <= 0;
  if (redoBtn) redoBtn.disabled = state.historyIndex >= state.history.length - 1;
  if (resetBtn) resetBtn.disabled = !state.baselineAssignments;
}

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  state.holidays = { ...getHolidays(state.currentYear), ...getHolidays(state.currentYear + 1) };
  renderMonth();
  await loadData();
  // 既存の生成結果があれば読み込み
  await loadExistingAssignments();
});

function bindEvents() {
  document.getElementById('prev-month').addEventListener('click', () => changeMonth(-1));
  document.getElementById('next-month').addEventListener('click', () => changeMonth(1));
  document.getElementById('btn-generate').addEventListener('click', handleGenerate);
  document.getElementById('btn-csv').addEventListener('click', handleCSVExport);
  document.getElementById('btn-undo').addEventListener('click', handleUndo);
  document.getElementById('btn-redo').addEventListener('click', handleRedo);
  document.getElementById('btn-reset').addEventListener('click', handleReset);
  // セルエディタの外クリックで閉じる
  document.addEventListener('click', (e) => {
    const editor = document.getElementById('cell-editor');
    if (editor.style.display !== 'none' && !editor.contains(e.target) && !e.target.closest('.day-cell')) {
      editor.style.display = 'none';
    }
  });
  setupGanttHover();
}

// ============================================================
// ガントチャート ホバー（クロスハイライト）
// ============================================================
function setupGanttHover() {
  const ganttTable = document.getElementById('gantt-table');
  if (!ganttTable) return;

  function clearCrossHighlight() {
    ganttTable.querySelectorAll('.cross-highlight').forEach(c => c.classList.remove('cross-highlight'));
  }

  ganttTable.addEventListener('mouseover', (e) => {
    clearCrossHighlight();
    const cell = e.target.closest('td.day-cell');
    if (!cell) return;

    // 行のハイライト
    const tr = cell.closest('tr');
    if (tr) {
      tr.querySelectorAll('td').forEach(td => td.classList.add('cross-highlight'));
    }

    // 列のハイライト
    const dateStr = cell.dataset.date;
    if (dateStr) {
      ganttTable.querySelectorAll(`td.day-cell[data-date="${dateStr}"]`).forEach(td => td.classList.add('cross-highlight'));
      const th = ganttTable.querySelector(`th[data-date="${dateStr}"]`);
      if (th) th.classList.add('cross-highlight');
    }
  });

  ganttTable.addEventListener('mouseleave', () => {
    clearCrossHighlight();
  });
}

function changeMonth(delta) {
  state.currentMonth += delta;
  if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
  else if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
  state.holidays = { ...getHolidays(state.currentYear), ...getHolidays(state.currentYear + 1) };
  renderMonth();
  loadExistingAssignments();
}

function renderMonth() {
  document.getElementById('month-label').textContent = `${state.currentYear}年 ${state.currentMonth + 1}月`;
}

// ============================================================
// データ取得
// ============================================================
async function loadData() {
  const [staffRes, settingsRes] = await Promise.all([
    supabase.from('staff').select('*').order('display_order'),
    supabase.from('monthly_settings').select('*'),
  ]);
  if (staffRes.error) { console.error(staffRes.error); return; }
  if (settingsRes.error) { console.error(settingsRes.error); return; }
  state.staffList = staffRes.data || [];
  // monthly_settings を year_month → employee_days_off の map に変換
  state.monthlySettings = {};
  (settingsRes.data || []).forEach(s => { state.monthlySettings[s.year_month] = s.employee_days_off; });
}

async function loadRequests(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('shift_requests')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate);
  if (error) { console.error(error); return []; }
  return data || [];
}

async function loadExistingAssignments() {
  const yearMonth = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}`;

  // 描画のための希望休データを先にロード
  state.requests = await loadRequests(yearMonth);

  const { data, error } = await supabase
    .from('shift_assignments')
    .select('*')
    .eq('year_month', yearMonth);
  if (error) { console.error(error); return; }

  state.assignments = data || [];
  if (state.assignments.length > 0) {
    state.hasGenerated = true;
    document.getElementById('btn-csv').disabled = false;
    renderGantt();
    renderConditionsCheck();
  } else {
    state.hasGenerated = false;
    document.getElementById('btn-csv').disabled = true;
    document.getElementById('gantt-table').style.display = 'none';
    document.getElementById('gantt-placeholder').style.display = 'flex';
    const condPanel = document.getElementById('conditions-panel');
    if (condPanel) condPanel.style.display = 'none';
  }
}

// ============================================================
// シフト生成アルゴリズム
// ============================================================
async function handleGenerate() {
  const btn = document.getElementById('btn-generate');
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> 生成中...';

  try {
    const yearMonth = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}`;
    state.requests = await loadRequests(yearMonth);

    // スコアリング生成：複数回試行して最高スコアを採用
    const TRIAL_COUNT = 30;
    let bestAssignments = null;
    let bestScore = -Infinity;
    let bestBreakdown = [];
    let bestWarnings = [];

    // 1回目はランダムなし（ベースライン）
    for (let trial = 0; trial < TRIAL_COUNT; trial++) {
      const randomize = trial > 0;
      const result = generateShifts(yearMonth, [], new Set(), randomize);
      const { score, breakdown } = scoreShifts(result, yearMonth);
      if (score > bestScore) {
        bestScore = score;
        bestBreakdown = breakdown;
        bestAssignments = result;
        bestWarnings = [...state.warnings];
      }
    }

    // 常に新規生成結果を採用（気に入らなければundo/resetで戻せる）
    state.assignments = bestAssignments;
    state.warnings = bestWarnings;
    state.lastScore = bestScore;
    state.lastBreakdown = bestBreakdown;
    await saveAssignments(yearMonth, bestAssignments);
    console.log(`シフト生成完了 スコア: ${bestScore}`, bestBreakdown);

    state.hasGenerated = true;
    document.getElementById('btn-csv').disabled = false;
    renderGantt();
    renderConditionsCheck();

    // baseline保存 + 履歴初期化
    state.baselineAssignments = cloneAssignments(state.assignments);
    state.history = [cloneAssignments(state.assignments)];
    state.historyIndex = 0;
    updateUndoRedoButtons();
  } catch (err) {
    console.error(err);
    showToast('生成エラー: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="sparkles" style="width:16px;height:16px;"></i> シフト生成';
    lucide.createIcons();
  }
}

// ============================================================
// チェック用ヘルパー関数（scoreShifts / renderConditionsCheck 共通）
// ============================================================
function _staffAssignments(assignments, staffId) {
  return assignments.filter(a => a.staff_id === staffId);
}
function _workDays(assignments, staffId) {
  return _staffAssignments(assignments, staffId).filter(a => a.work_pattern && a.work_pattern !== '');
}
function _restDays(assignments, staffId) {
  return _staffAssignments(assignments, staffId).filter(a => !a.work_pattern || a.work_pattern === '');
}
function _countPattern(assignments, staffId, pattern) {
  return _staffAssignments(assignments, staffId).filter(a => a.work_pattern === pattern).length;
}
function _maxConsecutiveWork(assignments, staffId) {
  const sorted = _staffAssignments(assignments, staffId).sort((a, b) => a.date.localeCompare(b.date));
  let max = 0, count = 0;
  for (const a of sorted) {
    if (a.work_pattern && a.work_pattern !== '') { count++; max = Math.max(max, count); }
    else { count = 0; }
  }
  return max;
}
function _maxConsecutiveWorkIncludingDispense(assignments, staffId, yearMonth, daysInMonth) {
  const works = _workDays(assignments, staffId).map(a => a.date);
  const dispenses = state.requests.filter(r => r.staff_id === staffId && r.request_type === 'dispense').map(r => r.date);
  const allWorkDates = new Set([...works, ...dispenses]);
  let max = 0, currentConsec = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${yearMonth}-${String(d).padStart(2, '0')}`;
    if (allWorkDates.has(dateStr)) { currentConsec++; max = Math.max(max, currentConsec); }
    else { currentConsec = 0; }
  }
  return max;
}
function _countSundays(assignments, staffId) {
  return _workDays(assignments, staffId).filter(a => new Date(a.date + 'T00:00:00').getDay() === 0).length;
}
function _checkConsecutiveRestPairs(assignments, staffId) {
  const rests = _restDays(assignments, staffId).map(a => a.date).sort();
  let pairs = 0;
  for (let i = 0; i < rests.length - 1; i++) {
    const d1 = new Date(rests[i] + 'T00:00:00');
    const d2 = new Date(rests[i + 1] + 'T00:00:00');
    if ((d2 - d1) / 86400000 === 1) { pairs++; i++; }
  }
  return pairs;
}
function _restOverlap(assignments, id1, id2) {
  const r1 = new Set(_restDays(assignments, id1).map(a => a.date));
  const r2 = new Set(_restDays(assignments, id2).map(a => a.date));
  let overlap = 0;
  for (const d of r1) {
    if (r2.has(d) && new Date(d + 'T00:00:00').getDay() !== 0) overlap++;
  }
  return overlap;
}
function _countCrossStore(assignments, staffId, mainStore) {
  const mainPattern = mainStore === 'ebisu' ? PATTERNS.PART_EBISU : PATTERNS.PART_SHIBUYA;
  return _workDays(assignments, staffId).filter(a => a.work_pattern !== mainPattern).length;
}
function _getWeeklyBreakdown(assignments, staffId) {
  const weeks = {};
  for (const a of _workDays(assignments, staffId)) {
    const dt = new Date(a.date + 'T00:00:00');
    const wk = Math.floor((dt.getDate() - 1) / 7);
    weeks[wk] = (weeks[wk] || 0) + 1;
  }
  return weeks;
}
function _dispenseCount(staffId) {
  return state.requests.filter(r => r.staff_id === staffId && r.request_type === 'dispense').length;
}

// ============================================================
// 全チェック実行（共通エンジン）
// scoreShifts と renderConditionsCheck の両方がこれを使う
// ============================================================
function runAllChecks(assignments, yearMonth) {
  const staffList = state.staffList.filter(s => s.is_active);
  const [year, month] = yearMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysOff = state.monthlySettings[yearMonth] || 10;

  // スタッフ分類
  const murakami = staffList.find(s => s.staff_type === 'special');
  const shinoda = staffList.find(s => s.staff_type === 'employee' && s.assigned_store === 'shibuya');
  const ono = staffList.find(s => s.staff_type === 'employee' && s.assigned_store === 'ebisu');
  const tokunaga = staffList.find(s => s.staff_type === 'part_time' && s.role === 'pharmacist');
  const officeStaff = staffList.filter(s => s.staff_type === 'part_time' && s.role === 'office');

  // ショートカット
  const work = (id) => _workDays(assignments, id);
  const rest = (id) => _restDays(assignments, id);

  // ===== 全体チェック =====
  const globalItems = [];

  // G1. 店舗充足
  let ebisuShort = 0, shibuyaShort = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${yearMonth}-${String(d).padStart(2, '0')}`;
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    const dayWork = assignments.filter(a => a.date === dateStr && a.work_pattern && a.work_pattern !== '');
    if (dow !== 0) {
      const ep = dayWork.filter(a => [PATTERNS.EMPLOYEE_EBISU, PATTERNS.PART_EBISU].includes(a.work_pattern))
        .filter(a => staffList.find(s => s.id === a.staff_id)?.role === 'pharmacist').length;
      const eo = dayWork.filter(a => [PATTERNS.EMPLOYEE_EBISU, PATTERNS.PART_EBISU].includes(a.work_pattern))
        .filter(a => staffList.find(s => s.id === a.staff_id)?.role === 'office').length;
      if (ep < 1) ebisuShort++;
      if (eo < 1) ebisuShort++;
    }
    const sp = dayWork.filter(a => [PATTERNS.EMPLOYEE_SHIBUYA, PATTERNS.PART_SHIBUYA].includes(a.work_pattern))
      .filter(a => staffList.find(s => s.id === a.staff_id)?.role === 'pharmacist').length;
    const so = dayWork.filter(a => [PATTERNS.EMPLOYEE_SHIBUYA, PATTERNS.PART_SHIBUYA].includes(a.work_pattern))
      .filter(a => staffList.find(s => s.id === a.staff_id)?.role === 'office').length;
    if (sp < 1) shibuyaShort++;
    if (so < 1) shibuyaShort++;
  }
  globalItems.push(
    { id: 'G1-ebisu', tag: '絶対', status: ebisuShort === 0 ? 'pass' : 'fail', text: '恵比寿（薬1+事1）', value: ebisuShort === 0 ? '充足' : `${ebisuShort}日不足`, scoreDelta: ebisuShort > 0 ? -100 * ebisuShort : 0 },
    { id: 'G1-shibuya', tag: '絶対', status: shibuyaShort === 0 ? 'pass' : 'fail', text: '渋谷（薬1+事1）', value: shibuyaShort === 0 ? '充足' : `${shibuyaShort}日不足`, scoreDelta: shibuyaShort > 0 ? -100 * shibuyaShort : 0 },
  );

  // G2. 希望休反映
  let violations = 0;
  const offRequests = state.requests.filter(r => r.request_type === 'off');
  for (const req of offRequests) {
    const assign = assignments.find(a => a.staff_id === req.staff_id && a.date === req.date);
    if (assign && assign.work_pattern && assign.work_pattern !== '') violations++;
  }
  globalItems.push(
    { id: 'G2', tag: '絶対', status: violations === 0 ? 'pass' : 'fail', text: '希望休が全て反映されている', value: violations === 0 ? '○' : `${violations}件違反`, scoreDelta: 0 },
  );

  // ===== スタッフ別チェック =====
  const staffChecks = {}; // staffId → { name, section, items[] }

  // --- 小野（恵比寿固定） ---
  if (ono) {
    const restCount = rest(ono.id).length;
    const allEbisu = work(ono.id).every(a => a.work_pattern === PATTERNS.EMPLOYEE_EBISU);
    const consec = _maxConsecutiveWork(assignments, ono.id);
    const restDateList = rest(ono.id).map(a => a.date).sort();
    let nonSundayPairs = 0;
    for (let i = 0; i < restDateList.length - 1; i++) {
      const d1 = new Date(restDateList[i] + 'T00:00:00');
      const d2 = new Date(restDateList[i + 1] + 'T00:00:00');
      if ((d2 - d1) / 86400000 === 1) {
        if (d1.getDay() !== 0 && d2.getDay() !== 0) nonSundayPairs++;
        i++;
      }
    }
    const sundayPairs = _checkConsecutiveRestPairs(assignments, ono.id) - nonSundayPairs;

    staffChecks[ono.id] = {
      name: ono.name, section: '薬剤師', items: [
        { id: 'ono-store', tag: '絶対', status: allEbisu ? 'pass' : 'fail', text: '恵比寿固定', value: allEbisu ? '○' : '他店あり', scoreDelta: 0 },
        { id: 'ono-rest', tag: '絶対', status: restCount === daysOff ? 'pass' : 'warn', text: `公休数 (${daysOff}日)`, value: `${restCount}日`, scoreDelta: 0 },
        { id: 'ono-consec', tag: '絶対', status: consec <= 5 ? 'pass' : 'fail', text: '連勤：5連勤まで', value: `${consec}日`, scoreDelta: consec > 5 ? -50 * (consec - 5) : 0 },
        { id: 'ono-sundaypair', tag: '高', status: sundayPairs >= 1 ? 'pass' : 'warn', text: '日曜隣接2連休', value: `${sundayPairs}回`, scoreDelta: 0 },
        { id: 'ono-nonsunpair', tag: '高', status: nonSundayPairs === 0 ? 'pass' : 'warn', text: '日曜日を含まない連休', value: nonSundayPairs === 0 ? 'なし○' : `${nonSundayPairs}回`, scoreDelta: nonSundayPairs > 0 ? -nonSundayPairs * 20 : 0 },
      ]
    };
  }

  // --- 信太（渋谷固定） ---
  if (shinoda) {
    const restCount = rest(shinoda.id).length;
    const devCount = _countPattern(assignments, shinoda.id, PATTERNS.DEV);
    const allShibuya = work(shinoda.id).every(a =>
      a.work_pattern === PATTERNS.EMPLOYEE_SHIBUYA || a.work_pattern === PATTERNS.DEV
    );
    const consec = _maxConsecutiveWork(assignments, shinoda.id);
    const pairs = _checkConsecutiveRestPairs(assignments, shinoda.id);
    const restDateList = rest(shinoda.id).map(a => a.date).sort();
    let adjacentPairs = 0;
    for (let i = 0; i < restDateList.length - 2; i++) {
      const d1 = new Date(restDateList[i] + 'T00:00:00');
      const d2 = new Date(restDateList[i + 1] + 'T00:00:00');
      const d3 = new Date(restDateList[i + 2] + 'T00:00:00');
      if ((d2 - d1) / 86400000 === 1 && (d3 - d2) / 86400000 === 1) adjacentPairs++;
    }
    const items = [
      { id: 'shinoda-store', tag: '絶対', status: allShibuya ? 'pass' : 'fail', text: '渋谷固定', value: allShibuya ? '○' : '他店あり', scoreDelta: 0 },
      { id: 'shinoda-rest', tag: '絶対', status: restCount === daysOff ? 'pass' : 'warn', text: `公休数 (${daysOff}日)`, value: `${restCount}日`, scoreDelta: 0 },
      { id: 'shinoda-dev', tag: '絶対', status: devCount <= 2 ? 'pass' : 'fail', text: '開発業務の割り当て回数（0~2回まで）', value: `${devCount}回`, scoreDelta: 0 },
      { id: 'shinoda-consec', tag: '絶対', status: consec <= 5 ? 'pass' : 'fail', text: '連勤：5連勤まで', value: `${consec}日`, scoreDelta: consec > 5 ? -50 * (consec - 5) : 0 },
      { id: 'shinoda-pairs', tag: '低', status: pairs >= 2 ? 'pass' : 'warn', text: '2連休取得回数（シフトに余裕がある場合）', value: `${pairs}回`, scoreDelta: pairs > 0 ? pairs * 5 : 0 },
      { id: 'shinoda-adjpair', tag: '高', status: adjacentPairs === 0 ? 'pass' : 'warn', text: '連休同士の過度な近接回避', value: adjacentPairs === 0 ? '○' : `${adjacentPairs}箇所`, scoreDelta: adjacentPairs > 0 ? -adjacentPairs * 20 : 0 },
    ];
    if (ono) {
      const overlap = _restOverlap(assignments, shinoda.id, ono.id);
      items.push({ id: 'shinoda-overlap', tag: '高', status: overlap === 0 ? 'pass' : 'fail', text: '小野との公休被り', value: `${overlap}日`, scoreDelta: overlap > 0 ? -overlap * 30 : 0 });
    }
    staffChecks[shinoda.id] = { name: shinoda.name, section: '薬剤師', items };
  }

  // --- 徳永（パート薬剤師） ---
  if (tokunaga) {
    const workCount = work(tokunaga.id).length;
    const consec = _maxConsecutiveWork(assignments, tokunaga.id);
    const consecDispense = _maxConsecutiveWorkIncludingDispense(assignments, tokunaga.id, yearMonth, daysInMonth);
    const sundays = _countSundays(assignments, tokunaga.id);
    let storeViolations = 0;
    for (const a of work(tokunaga.id)) {
      const dow = new Date(a.date + 'T00:00:00').getDay();
      const onoRest = ono && _restDays(assignments, ono.id).some(r => r.date === a.date);
      if (dow === 0) { if (a.work_pattern !== PATTERNS.PART_SHIBUYA) storeViolations++; }
      else if (onoRest) { if (a.work_pattern !== PATTERNS.PART_EBISU) storeViolations++; }
      else { if (a.work_pattern !== PATTERNS.PART_SHIBUYA) storeViolations++; }
    }
    staffChecks[tokunaga.id] = {
      name: tokunaga.name, section: '薬剤師', items: [
        { id: 'tok-days', tag: '絶対', status: workCount >= 15 && workCount <= 22 ? 'pass' : 'fail', text: '勤務日数（基本17日/MAX22日）', value: `${workCount}日`, scoreDelta: 0 },
        { id: 'tok-sun', tag: '絶対', status: sundays <= 2 ? 'pass' : 'fail', text: '日曜出勤：2回まで', value: `${sundays}回`, scoreDelta: 0 },
        { id: 'tok-consec', tag: '絶対', status: consec <= 5 ? 'pass' : 'fail', text: '連勤：5連勤まで', value: `${consec}日`, scoreDelta: consec > 5 ? -50 * (consec - 5) : 0 },
        { id: 'tok-disp', tag: '絶対', status: consecDispense <= 5 ? 'pass' : 'fail', text: '「調剤」の希望休を含めた連続勤務日数：5連勤まで', value: `${consecDispense}日`, scoreDelta: consecDispense > 5 ? -50 * (consecDispense - 5) : 0 },
        { id: 'tok-store', tag: '絶対', status: storeViolations === 0 ? 'pass' : 'warn', text: '日曜は渋谷、それ以外は小野の出勤状況に合わせた店舗配置', value: storeViolations === 0 ? '○' : `${storeViolations}日逸脱`, scoreDelta: 0 },
      ]
    };
  }

  // --- 村上（穴埋め） ---
  if (murakami) {
    const mWork = work(murakami.id).length;
    staffChecks[murakami.id] = {
      name: murakami.name, section: '薬剤師', items: [
        { id: 'mura-days', tag: '中', status: mWork <= 3 ? 'pass' : 'warn', text: '出勤日数（極力少なく）', value: `${mWork}日`, scoreDelta: mWork > 0 ? -mWork * 10 : 0 },
      ]
    };
  }

  // --- 事務パート ---
  for (const staff of officeStaff) {
    const workCount = work(staff.id).length;
    const consec = _maxConsecutiveWork(assignments, staff.id);
    const cond = staff.work_conditions || {};
    const mainStore = (staff.store_priority?.ebisu ?? 99) <= 2 ? 'ebisu' : 'shibuya';
    const crossCount = _countCrossStore(assignments, staff.id, mainStore);
    const storeName = mainStore === 'ebisu' ? '恵比寿' : '渋谷';
    const pri = staff.store_priority || {};
    const items = [];

    // 勤務日数（調剤含む）
    const dispCount = _dispenseCount(staff.id);
    const totalWork = workCount + dispCount;
    if (cond.target_days_per_month) {
      const maxDays = cond.max_days_per_month || cond.target_days_per_month;
      const isBelowTarget = totalWork < cond.target_days_per_month;
      const baseStatus = isBelowTarget ? 'fail' : totalWork <= cond.target_days_per_month ? 'pass' : totalWork <= maxDays ? 'warn' : 'fail';
      const delta = isBelowTarget ? -(cond.target_days_per_month - totalWork) * 100 : (totalWork > maxDays ? -(totalWork - maxDays) * 5 : 0);
      items.push({ id: `${staff.id}-days`, tag: '絶対', status: baseStatus, text: `勤務日数（基本${cond.target_days_per_month}日/MAX${maxDays}日）`, value: `${totalWork}日`, scoreDelta: delta });
    } else {
      items.push({ id: `${staff.id}-days`, status: 'pass', text: '勤務日数', value: `${totalWork}日`, scoreDelta: 0 });
    }

    // 週2/3交互チェック
    if (cond.alternating_weeks) {
      const weeks = _getWeeklyBreakdown(assignments, staff.id);
      const totalWeeks = Math.ceil(daysInMonth / 7);
      let altOk = true;
      const ngWeeks = [];
      for (let w = 0; w < totalWeeks; w++) {
        const expected = cond.alternating_weeks[w % cond.alternating_weeks.length];
        const actual = weeks[w] || 0;
        if (actual > expected) { altOk = false; ngWeeks.push(`W${w + 1}`); }
      }
      const dispValue = altOk ? '○' : `NG: ${ngWeeks.join(',')}`;
      items.push({ id: `${staff.id}-alt`, tag: '高', status: altOk ? 'pass' : 'warn', text: `週${cond.alternating_weeks.join('/')}交互`, value: dispValue, scoreDelta: 0 });
    }

    const maxConsec = cond.max_consecutive_days || 5;
    items.push({ id: `${staff.id}-consec`, tag: '絶対', status: consec <= maxConsec ? 'pass' : 'fail', text: `連勤：${maxConsec}連勤まで`, value: `${consec}日`, scoreDelta: consec > maxConsec ? -50 * (consec - maxConsec) : 0 });
    items.push({ id: `${staff.id}-cross`, tag: '中', status: crossCount === 0 ? 'pass' : 'warn', text: `他店舗勤務（${storeName}メイン）`, value: `${crossCount}日`, scoreDelta: crossCount > 0 ? -crossCount * 15 : 0 });
    const priText = `恵:${pri.ebisu ?? '-'} 渋:${pri.shibuya ?? '-'}`;
    items.push({ id: `${staff.id}-pri`, status: 'pass', text: '配置優先順位', value: priText, scoreDelta: 0 });

    staffChecks[staff.id] = { name: staff.name, section: '事務パート', items };
  }

  // --- 追加のスコア用チェック（UIには直接表示しないがスコアに影響） ---
  const bonusItems = [];

  // 勤務偏り（事務パート）
  for (const s of officeStaff) {
    const days = work(s.id).map(a => new Date(a.date + 'T00:00:00').getDate());
    if (days.length >= 2) {
      const mean = days.reduce((a, b) => a + b, 0) / days.length;
      const variance = days.reduce((a, d) => a + (d - mean) ** 2, 0) / days.length;
      const evenness = Math.sqrt(variance);
      const idealSpread = daysInMonth / 3;
      if (evenness < idealSpread * 0.5) {
        bonusItems.push({ id: `${s.id}-spread`, scoreDelta: -10, label: `${s.name}勤務偏り（前半/後半集中）` });
      }
    }
  }

  // 2連休ボーナス（小野）
  if (ono) {
    const rests = rest(ono.id).map(a => a.date).sort();
    let pairs = 0;
    for (let i = 0; i < rests.length - 1; i++) {
      if ((new Date(rests[i + 1] + 'T00:00:00') - new Date(rests[i] + 'T00:00:00')) / 86400000 === 1) { pairs++; i++; }
    }
    if (pairs > 0) bonusItems.push({ id: 'ono-pair-bonus', scoreDelta: pairs * 5, label: `${ono.name}連休ペア +${pairs}個` });
  }

  return { globalItems, staffChecks, bonusItems };
}

// ============================================================
// スコアリング関数（runAllChecksの結果からスコアを算出）
// ============================================================
function scoreShifts(assignments, yearMonth) {
  const { globalItems, staffChecks, bonusItems } = runAllChecks(assignments, yearMonth);

  let score = 100;
  const breakdown = [];
  const addDelta = (category, label, delta) => {
    if (delta === 0) return;
    score += delta;
    breakdown.push({ category, label, delta });
  };

  // 全体チェックのスコア反映
  for (const item of globalItems) {
    addDelta(item.id, item.text, item.scoreDelta);
  }

  // スタッフ別チェックのスコア反映
  for (const [, check] of Object.entries(staffChecks)) {
    for (const item of check.items) {
      addDelta(item.id, `${check.name}: ${item.text}`, item.scoreDelta);
    }
  }

  // ボーナス/ペナルティ
  for (const item of bonusItems) {
    addDelta(item.id, item.label, item.scoreDelta);
  }

  return { score: Math.round(score), breakdown };
}

function generateShifts(yearMonth, manualOverrides, manualSet, randomize = false) {
  const [year, month] = yearMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysOff = state.monthlySettings[yearMonth] || 10;

  // スタッフ分類
  const activeStaff = state.staffList.filter(s => s.is_active);
  const murakami = activeStaff.find(s => s.staff_type === 'special');
  const employees = activeStaff.filter(s => s.staff_type === 'employee');
  const shinoda = employees.find(s => s.assigned_store === 'shibuya');
  const ono = employees.find(s => s.assigned_store === 'ebisu');
  const tokunaga = activeStaff.find(s => s.staff_type === 'part_time' && s.role === 'pharmacist');
  const officeStaff = activeStaff.filter(s => s.staff_type === 'part_time' && s.role === 'office');
  const externalStaff = activeStaff.filter(s => s.staff_type === 'external');

  // 日付リスト
  const dates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dt = new Date(year, month - 1, d);
    dates.push({ dateStr, dow: dt.getDay(), day: d });
  }

  // 希望休をスタッフID×日付でルックアップ
  const requestMap = {};
  state.requests.forEach(r => { requestMap[`${r.staff_id}_${r.date}`] = r; });

  // 結果格納
  const result = [];
  const warnings = [];

  // 各スタッフの勤務カウント追跡
  const workCounts = {}; // staff_id → { total, sundays, weekly: { weekNum: count }, consecutive }
  activeStaff.forEach(s => {
    const dispenseCount = state.requests.filter(r => r.staff_id === s.id && r.request_type === 'dispense').length;
    workCounts[s.id] = { total: dispenseCount, sundays: 0, weekly: {}, consecutiveDays: 0, lastWorkedDate: null };
  });

  // 社員の公休日を事前計算
  // ①小野を先に計算（日曜定休の制約が強い）
  // ②信太は小野の公休日を避けて配置（希望休重複は許容）
  const employeeRestDays = {};
  if (ono) employeeRestDays[ono.id] = computeRestDays(ono, dates, daysOff, requestMap, new Set(), randomize);
  if (shinoda) {
    const onoRestDays = ono ? employeeRestDays[ono.id] : new Set();
    employeeRestDays[shinoda.id] = computeRestDays(shinoda, dates, daysOff, requestMap, onoRestDays, randomize);
  }

  // パートの勤務追跡（週単位）
  function getWeekNum(dateStr) {
    const dt = new Date(dateStr + 'T00:00:00');
    const dayOfMonth = dt.getDate();
    return Math.floor((dayOfMonth - 1) / 7);
  }

  function canWork(staffId, dateStr) {
    // 手動オーバーライドがあればスキップ
    if (manualSet.has(`${staffId}_${dateStr}`)) return false;

    // 希望休/調剤チェック
    const req = requestMap[`${staffId}_${dateStr}`];
    if (req && (req.request_type === 'off' || req.request_type === 'dispense')) return false;

    // 連勤チェック（基本は最大5連勤、DB設定があれば上書き）
    const staff = state.staffList.find(s => s.id === staffId);
    let maxConsecutive = staff?.work_conditions?.max_consecutive_days || 5;

    // 週の勤務日数が固定されているパート（中村）は、連勤上限を週の最大日数に合わせることで週またぎの連勤を防止
    if (staff?.work_conditions?.alternating_weeks) {
      maxConsecutive = Math.min(maxConsecutive, Math.max(...staff.work_conditions.alternating_weeks));
    }

    // ==== 調剤を含んだ連勤の特別チェック ====
    // 過去方向の連続勤務（Oogi実働 + 調剤）カウント
    let pastStreak = 0;
    let futureStreak = 0;
    let includesDispense = false;

    let pd = new Date(dateStr + 'T00:00:00');
    pd.setDate(pd.getDate() - 1);
    while (true) {
      const pdStr = formatDate(pd);
      const pWork = result.find(a => a.staff_id === staffId && a.date === pdStr && a.work_pattern !== '');
      const pReq = requestMap[`${staffId}_${pdStr}`];
      const pDispense = pReq && pReq.request_type === 'dispense';

      if (pWork || pDispense) {
        pastStreak++;
        if (pDispense) includesDispense = true;
        pd.setDate(pd.getDate() - 1);
      } else {
        break;
      }
    }

    // 未来方向の連続「調剤」カウント（未来のOogiシフトは未確定なので調剤希望のみ）
    let fd = new Date(dateStr + 'T00:00:00');
    fd.setDate(fd.getDate() + 1);
    while (true) {
      const fdStr = formatDate(fd);
      const fReq = requestMap[`${staffId}_${fdStr}`];
      if (fReq && fReq.request_type === 'dispense') {
        futureStreak++;
        includesDispense = true;
        fd.setDate(fd.getDate() + 1);
      } else {
        break;
      }
    }

    if (includesDispense) {
      // 調剤を含む場合は、調剤日＋Oogi出勤日で最大5連勤（6連勤以上を作らない）に制限
      maxConsecutive = 5;
      if (pastStreak + 1 + futureStreak > maxConsecutive) {
        return false;
      }
    } else {
      // 通常の連勤チェック
      const wc = workCounts[staffId];
      if (wc.lastWorkedDate) {
        const last = new Date(wc.lastWorkedDate + 'T00:00:00');
        const curr = new Date(dateStr + 'T00:00:00');
        const diff = (curr - last) / (1000 * 60 * 60 * 24);
        // 前日が勤務日で連勤MAXに達している場合のみブロック
        if (diff === 1 && wc.consecutiveDays >= maxConsecutive) return false;
      }
    }

    return true;
  }

  function recordWork(staffId, dateStr) {
    const wc = workCounts[staffId];
    const weekNum = getWeekNum(dateStr);
    wc.total++;
    if (new Date(dateStr + 'T00:00:00').getDay() === 0) wc.sundays++;
    wc.weekly[weekNum] = (wc.weekly[weekNum] || 0) + 1;

    // 連勤計算
    if (wc.lastWorkedDate) {
      const last = new Date(wc.lastWorkedDate + 'T00:00:00');
      const curr = new Date(dateStr + 'T00:00:00');
      const diff = (curr - last) / (1000 * 60 * 60 * 24);
      if (diff === 1) {
        wc.consecutiveDays++;
      } else {
        wc.consecutiveDays = 1;
      }
    } else {
      wc.consecutiveDays = 1;
    }
    wc.lastWorkedDate = dateStr;
  }

  function addAssignment(staffId, dateStr, attendanceType, workPattern, isManual = false) {
    result.push({
      year_month: yearMonth,
      staff_id: staffId,
      date: dateStr,
      attendance_type: attendanceType,
      work_pattern: workPattern,
      is_manual_override: isManual,
    });
    if (workPattern && workPattern !== '' && attendanceType === '平日') {
      recordWork(staffId, dateStr);
    }
  }

  // パートの勤務条件チェック
  // isOverflow=true のとき: target超過してもmax_days_per_monthまで許容（不足時フォールバック用）
  function checkPartConditions(staff, dateStr, isOverflow = false) {
    const wc = workCounts[staff.id];
    const cond = staff.work_conditions || {};

    // 月のハード上限チェック（max_days_per_month）
    if (cond.max_days_per_month && wc.total >= cond.max_days_per_month) return false;

    // 月の基本上限チェック（target_days_per_month）
    // isOverflow=false のときはtargetで止める
    if (!isOverflow && cond.target_days_per_month && wc.total >= cond.target_days_per_month) return false;

    // 週2/3交互チェック（中村用）
    if (cond.alternating_weeks) {
      const weekNum = getWeekNum(dateStr);
      const weeklyCount = wc.weekly[weekNum] || 0;
      const weeklyMax = cond.alternating_weeks[weekNum % cond.alternating_weeks.length];
      if (weeklyCount >= weeklyMax) return false;
    }

    // 日曜制限（徳永用）
    if (cond.max_sunday_per_month) {
      const dow = new Date(dateStr + 'T00:00:00').getDay();
      if (dow === 0 && wc.sundays >= cond.max_sunday_per_month) return false;
    }

    return true;
  }

  // ◯開発カウント（月1-2回まで）
  let devCount = 0;

  // ============ メインループ ============
  for (const { dateStr, dow } of dates) {
    const isSunday = dow === 0;
    const isEbisuClosed = isSunday; // 恵比寿は日曜定休

    // 手動オーバーライドがある場合はそれを使う
    for (const manual of manualOverrides) {
      if (manual.date === dateStr) {
        addAssignment(manual.staff_id, dateStr, manual.attendance_type, manual.work_pattern, true);
      }
    }

    // 外部スタッフ（野口・福島）：常に平日・空欄
    for (const ext of externalStaff) {
      if (manualSet.has(`${ext.id}_${dateStr}`)) continue;
      addAssignment(ext.id, dateStr, '平日', '');
    }

    // ---- 社員配置 ----
    // 小野（恵比寿専属）
    if (ono && !manualSet.has(`${ono.id}_${dateStr}`)) {
      const isRest = employeeRestDays[ono.id]?.has(dateStr);
      if (isRest || isEbisuClosed) {
        addAssignment(ono.id, dateStr, '所定休日', '');
      } else {
        addAssignment(ono.id, dateStr, '平日', PATTERNS.EMPLOYEE_EBISU);
      }
    }

    // 信太（渋谷専属）- 一旦○渋谷で配置。◯開発判定は後で
    if (shinoda && !manualSet.has(`${shinoda.id}_${dateStr}`)) {
      const isRest = employeeRestDays[shinoda.id]?.has(dateStr);
      if (isRest) {
        addAssignment(shinoda.id, dateStr, '所定休日', '');
      } else {
        addAssignment(shinoda.id, dateStr, '平日', PATTERNS.EMPLOYEE_SHIBUYA);
      }
    }

    // ---- パート薬剤師（徳永）配置 ----
    // 1. 店舗の薬剤師不足（小野休み or 信太休み）があるか？ -> 優先カバー
    // 2. ペース配分が早すぎないか？ -> ペース通りなら出勤、早すぎたら休んで後半に温存
    // 3. 上限：基本は17日でストップだが、不足があれば上限22日までカバーに入る（村上出動を阻止）
    if (tokunaga && !manualSet.has(`${tokunaga.id}_${dateStr}`)) {
      let tokunagaPattern = PATTERNS.PART_SHIBUYA;
      let isShortage = false;
      const onoIsOff = ono && employeeRestDays[ono.id]?.has(dateStr);
      const shinodaIsOff = shinoda && employeeRestDays[shinoda.id]?.has(dateStr);

      // 日曜は恵比寿が定休なので、必ず渋谷（isEbisuClosedチェックを最優先）
      if (isEbisuClosed) {
        tokunagaPattern = PATTERNS.PART_SHIBUYA;
        // 信太が休みの場合は渋谷不足
        if (shinodaIsOff) isShortage = true;
      } else if (onoIsOff) {
        tokunagaPattern = PATTERNS.PART_EBISU;
        isShortage = true;
      } else if (shinodaIsOff) {
        tokunagaPattern = PATTERNS.PART_SHIBUYA;
        isShortage = true;
      }

      const wcTok = workCounts[tokunaga.id];
      const target = tokunaga.work_conditions?.target_days_per_month || 17;

      const currentDay = new Date(dateStr + 'T00:00:00').getDate();
      const progress = currentDay / daysInMonth;
      const ratio = target > 0 ? (wcTok.total / target) : 0;
      const ahead = ratio - progress;

      let shouldWork = false;

      // isOverflow=true を渡して、ハードリミット(22)まではブロックしないように判定
      if (!canWork(tokunaga.id, dateStr) || !checkPartConditions(tokunaga, dateStr, true)) {
        // 希望休、連勤MAX、または絶対上限(22)到達で完全ブロック
        shouldWork = false;
      } else if (isShortage) {
        // 薬剤師が不足している日は、基本目標(17)を超えていても絶対上限(22)までは出動（村上の代わり）
        shouldWork = true;
      } else {
        // 不足していない平常日
        if (wcTok.total >= target) {
          // すでに基本目標(17)を達成済みなら、不足日以外は休む
          shouldWork = false;
        } else if (ahead > 0.08) {
          // 出勤ペースが早すぎる（前半に固まっている）なら一旦休んで後半に備える
          shouldWork = false;
        } else {
          shouldWork = true;
        }
      }

      if (shouldWork) {
        addAssignment(tokunaga.id, dateStr, '平日', tokunagaPattern);
      } else {
        addAssignment(tokunaga.id, dateStr, '所定休日', '');
      }
    }

    // ---- ◯開発 判定 ----
    // 徳永が渋谷に入っていて、信太が○渋谷 → 信太を◯開発に変更
    // 月に1〜2回まで（0回でもOK）
    if (shinoda && tokunaga && devCount < 2) {
      const shinodaAssign = result.find(a => a.staff_id === shinoda.id && a.date === dateStr);
      const tokunagaAssign = result.find(a => a.staff_id === tokunaga.id && a.date === dateStr);
      if (shinodaAssign && !shinodaAssign.is_manual_override &&
        shinodaAssign.work_pattern === PATTERNS.EMPLOYEE_SHIBUYA &&
        tokunagaAssign && tokunagaAssign.work_pattern === PATTERNS.PART_SHIBUYA) {
        shinodaAssign.work_pattern = PATTERNS.DEV;
        devCount++;
      }
    }

    // ---- 事務パート配置 ----
    // 恵比寿チーム: 木庭・中村（基本この2人で回す）
    // 渋谷チーム:   諫早・本庄（基本この2人で回す）
    // チーム内で誰も入れない場合のみ他チームからフォールバック
    const ebisuTeam = officeStaff.filter(s => (s.store_priority?.ebisu ?? 99) <= 2);
    const shibuyaTeam = officeStaff.filter(s => (s.store_priority?.shibuya ?? 99) <= 2);

    const assignedOfficeToday = new Set();

    function tryAssignOffice(candidates, dateStr, pattern, isOverflow = false) {
      const store = pattern === PATTERNS.PART_EBISU ? 'ebisu' : 'shibuya';
      const currentDay = new Date(dateStr + 'T00:00:00').getDate();
      const progress = currentDay / daysInMonth; // 月の進捗率 (0〜1)

      // 優先度 + ペース配分でソート
      const sorted = [...candidates].sort((a, b) => {
        const getScore = (staff) => {
          const cond = staff.work_conditions || {};
          const target = cond.target_days_per_month || 0;
          const priority = staff.store_priority?.[store] ?? 99;
          const actual = workCounts[staff.id].total;

          if (target === 0) {
            // 目標なし（本庄さんなど）は穴埋め要員
            // レギュラーが全員目標達成済みの時だけ出番が来る
            return 50 - priority;
          }

          if (actual >= target) {
            // 目標達成済み → 穴埋めメンバーより下
            return 0 - priority;
          }

          // === 負債（debt）ベースの均等分散スコアリング ===
          // expected: この時点で本来こなすべき勤務日数
          // debt: 正=遅れている(出勤すべき), 負=進んでいる(休むべき)
          const expected = target * progress;
          const debt = expected - actual;

          // debtをメインスコア、priorityはタイブレーカー
          // debtが大きい（遅れている）スタッフほどスコアが高く、優先的に出勤
          // 例: 木庭(target17)がday1で出勤→debt下がる→中村(target10)のdebtが相対的に上→中村が選ばれる
          return debt * 100 + (10 - priority);
        };
        return getScore(b) - getScore(a);
      });

      for (const staff of sorted) {
        if (manualSet.has(`${staff.id}_${dateStr}`)) continue;
        if (assignedOfficeToday.has(staff.id)) continue;
        if (!canWork(staff.id, dateStr)) continue;
        if (!checkPartConditions(staff, dateStr, isOverflow)) continue;
        addAssignment(staff.id, dateStr, '平日', pattern);
        assignedOfficeToday.add(staff.id);
        return true;
      }
      return false;
    }

    // 恵比寿に事務1名配置（日曜除く）
    if (!isEbisuClosed) {
      // まず恵比寿チーム（木庭・中村）で試行（target上限）
      if (!tryAssignOffice(ebisuTeam, dateStr, PATTERNS.PART_EBISU)) {
        // チーム内target超→チーム内でmax上限まで許容
        if (!tryAssignOffice(ebisuTeam, dateStr, PATTERNS.PART_EBISU, true)) {
          // チーム内全滅→渋谷チームからフォールバック（overflow許容）
          tryAssignOffice(shibuyaTeam, dateStr, PATTERNS.PART_EBISU, true);
        }
      }
    }

    // 渋谷に事務1名配置
    {
      // まず渋谷チーム（諫早・本庄）で試行（target上限）
      if (!tryAssignOffice(shibuyaTeam, dateStr, PATTERNS.PART_SHIBUYA)) {
        // チーム内target超→チーム内でmax上限まで許容
        if (!tryAssignOffice(shibuyaTeam, dateStr, PATTERNS.PART_SHIBUYA, true)) {
          // チーム内全滅→恵比寿チームからフォールバック（overflow許容）
          tryAssignOffice(ebisuTeam, dateStr, PATTERNS.PART_SHIBUYA, true);
        }
      }
    }

    // 未配置の事務パートは休日
    for (const staff of officeStaff) {
      if (manualSet.has(`${staff.id}_${dateStr}`)) continue;
      if (assignedOfficeToday.has(staff.id)) continue;
      if (!result.find(a => a.staff_id === staff.id && a.date === dateStr)) {
        addAssignment(staff.id, dateStr, '所定休日', '');
      }
    }

    // ---- 充足チェック＆村上穴埋め ----
    // 村上は極力出勤させない。薬剤師不足時（希望休重複等）のみ出動。
    // 事務不足では出動しない。
    if (murakami && !manualSet.has(`${murakami.id}_${dateStr}`)) {
      const todayAssignments = result.filter(a => a.date === dateStr && a.work_pattern !== '');

      let ebisuPharm = 0, ebisuOffice = 0;
      let shibuyaPharm = 0, shibuyaOffice = 0;

      todayAssignments.forEach(a => {
        if (a.work_pattern === PATTERNS.EMPLOYEE_EBISU || a.work_pattern === PATTERNS.PART_EBISU) {
          const staff = state.staffList.find(s => s.id === a.staff_id);
          if (staff?.role === 'pharmacist') ebisuPharm++;
          else ebisuOffice++;
        }
        if ([PATTERNS.EMPLOYEE_SHIBUYA, PATTERNS.PART_SHIBUYA, PATTERNS.PM_PART_SHIBUYA].includes(a.work_pattern)) {
          const staff = state.staffList.find(s => s.id === a.staff_id);
          if (staff?.role === 'pharmacist') shibuyaPharm++;
          else shibuyaOffice++;
        }
      });

      let murakamiPattern = '';

      // 薬剤師不足チェックのみ（事務不足では出動しない）
      if (!isEbisuClosed && ebisuPharm < 1) {
        murakamiPattern = PATTERNS.EMPLOYEE_EBISU;
      }
      if (!murakamiPattern && shibuyaPharm < 1) {
        murakamiPattern = PATTERNS.EMPLOYEE_SHIBUYA;
      }

      if (murakamiPattern) {
        addAssignment(murakami.id, dateStr, '平日', murakamiPattern);
      } else {
        addAssignment(murakami.id, dateStr, '平日', '');
      }

      // 最終充足チェック → 警告
      if (!isEbisuClosed) {
        const finalEbisuPharm = ebisuPharm + (murakamiPattern === PATTERNS.EMPLOYEE_EBISU ? 1 : 0);
        if (finalEbisuPharm < 1) warnings.push(`${dateStr}: 恵比寿 薬剤師不足`);
        if (ebisuOffice < 1) warnings.push(`${dateStr}: 恵比寿 事務不足`);
      }
      const finalShibuyaPharm = shibuyaPharm + (murakamiPattern === PATTERNS.EMPLOYEE_SHIBUYA ? 1 : 0);
      if (finalShibuyaPharm < 1) warnings.push(`${dateStr}: 渋谷 薬剤師不足`);
      if (shibuyaOffice < 1) warnings.push(`${dateStr}: 渋谷 事務不足`);
    }
  }

  state.warnings = warnings;
  return result;
}

// 社員の公休日を計算
function computeRestDays(employee, dates, daysOff, requestMap, avoidDates = new Set(), randomize = false) {
  const restDays = new Set();
  const isEbisuEmployee = employee.assigned_store === 'ebisu';
  const isShibuyaEmployee = employee.assigned_store === 'shibuya';

  // 1. 希望休（off）を先に公休としてカウント
  for (const { dateStr } of dates) {
    const req = requestMap[`${employee.id}_${dateStr}`];
    if (req && req.request_type === 'off') {
      restDays.add(dateStr);
    }
  }

  // 2. 恵比寿社員は日曜を自動的に公休
  if (isEbisuEmployee) {
    for (const { dateStr, dow } of dates) {
      if (dow === 0 && !restDays.has(dateStr)) {
        restDays.add(dateStr);
      }
    }
  }

  // 3. 残りの公休を配置
  const remaining = daysOff - restDays.size;
  if (remaining <= 0) return restDays;

  // 他の社員の公休日を避ける候補
  const allCandidates = dates
    .filter(d => !restDays.has(d.dateStr) && d.dow !== 0)
    .map(d => d.dateStr);
  const preferredCandidates = allCandidates.filter(d => !avoidDates.has(d));
  const candidates = [...(preferredCandidates.length >= remaining ? preferredCandidates : allCandidates)];

  // ランダム化：候補をシャッフルして多様なパターンを生成
  if (randomize) {
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
  }

  if (isEbisuEmployee) {
    // === 小野専用ロジック ===
    // 日曜に隣接する形の2連休のみ許可（土日 or 日月）
    // その他は孤立配置（1日ずつバラす）
    let placed = 0;

    // 日曜隣接ペアを配置（土曜か月曜を追加）
    const sundays = dates.filter(d => d.dow === 0);
    for (const sun of sundays) {
      if (placed >= remaining) break;
      // 土曜（日曜の前日）
      const satDate = new Date(sun.dateStr + 'T00:00:00');
      satDate.setDate(satDate.getDate() - 1);
      const satStr = formatDate(satDate);
      // 月曜（日曜の翌日）
      const monDate = new Date(sun.dateStr + 'T00:00:00');
      monDate.setDate(monDate.getDate() + 1);
      const monStr = formatDate(monDate);

      // 土曜を優先、なければ月曜
      if (candidates.includes(satStr) && !restDays.has(satStr)) {
        restDays.add(satStr);
        placed++;
      } else if (candidates.includes(monStr) && !restDays.has(monStr)) {
        restDays.add(monStr);
        placed++;
      }
    }

    // 残りは孤立配置（連続にならないようにバラす）
    if (placed < remaining) {
      // 安全策：6連勤以上が発生しないように、公休の間隔を補正する
      const enforceGaps = () => {
        let maxWorkStreak = 0;
        let p = null;
        for (const d of dates) {
          if (restDays.has(d.dateStr)) { p = null; continue; }
          if (d.dow === 0 && isEbisuEmployee) continue;
          p = p ? p + 1 : 1;
          if (p >= 6 && placed < remaining) {
            // 6連勤目があれば休みにする
            if (!restDays.has(d.dateStr)) {
              restDays.add(d.dateStr);
              placed++;
              p = null;
            }
          }
        }
      };

      const singleCandidates = candidates.filter(d => {
        if (restDays.has(d)) return false;
        // 前後の日が既に公休でないか確認（孤立配置）
        const dt = new Date(d + 'T00:00:00');
        const prev = new Date(dt); prev.setDate(prev.getDate() - 1);
        const next = new Date(dt); next.setDate(next.getDate() + 1);
        return !restDays.has(formatDate(prev)) && !restDays.has(formatDate(next));
      });
      const pool = singleCandidates.length >= (remaining - placed) ? singleCandidates
        : candidates.filter(d => !restDays.has(d));
      const interval = Math.max(1, Math.floor(pool.length / (remaining - placed)));
      for (let i = Math.floor(interval / 2); i < pool.length && placed < remaining; i += interval) {
        restDays.add(pool[i]);
        placed++;
      }
      // 最後に6連勤潰しの補正をかける
      enforceGaps();
    }
  } else if (isShibuyaEmployee) {
    // === 信太専用ロジック ===
    // 「あると嬉しいが優先度は低い」という要望に応え、ペア目標数を試行ごとにランダム化。
    // スコアリングのペアボーナス(+5点)により、無理のない範囲でペアが多い試行が自然と選ばれる。
    const maxPairs = Math.min(2, Math.floor(remaining / 2));
    const pairsNeeded = randomize ? Math.floor(Math.random() * (maxPairs + 1)) : maxPairs;
    let placed = 0;

    // ペア候補を作成
    const pairCandidates = [];
    for (let i = 0; i < candidates.length - 1; i++) {
      const d1 = new Date(candidates[i] + 'T00:00:00');
      const d2 = new Date(candidates[i + 1] + 'T00:00:00');
      if ((d2 - d1) / (1000 * 60 * 60 * 24) === 1) {
        pairCandidates.push([candidates[i], candidates[i + 1]]);
      }
    }

    // ペアを均等分散で配置（ペア間に間隔を確保）
    const selectedPairs = [];
    const pairInterval = Math.max(1, Math.floor(pairCandidates.length / pairsNeeded));
    const usedDates = new Set();

    for (let i = Math.floor(pairInterval / 2); i < pairCandidates.length && placed < pairsNeeded; i += pairInterval) {
      const [d1, d2] = pairCandidates[i];
      if (usedDates.has(d1) || usedDates.has(d2)) continue;

      // 既存ペアとの隣接チェック
      const d1Date = new Date(d1 + 'T00:00:00');
      const d2Date = new Date(d2 + 'T00:00:00');
      const prevDay = new Date(d1Date); prevDay.setDate(prevDay.getDate() - 1);
      const nextDay = new Date(d2Date); nextDay.setDate(nextDay.getDate() + 1);
      if (restDays.has(formatDate(prevDay)) || restDays.has(formatDate(nextDay))) continue;

      restDays.add(d1);
      restDays.add(d2);
      usedDates.add(d1);
      usedDates.add(d2);
      selectedPairs.push([d1, d2]);
      placed++;
    }

    // ペアで足りない分は単日で補充（ペアに隣接しない場所）
    const singleRemaining = daysOff - restDays.size;
    if (singleRemaining > 0) {
      const singleCandidates = candidates.filter(d => {
        if (restDays.has(d)) return false;
        const dt = new Date(d + 'T00:00:00');
        const prev = new Date(dt); prev.setDate(prev.getDate() - 1);
        const next = new Date(dt); next.setDate(next.getDate() + 1);
        return !restDays.has(formatDate(prev)) && !restDays.has(formatDate(next));
      });
      const pool = singleCandidates.length >= singleRemaining ? singleCandidates
        : candidates.filter(d => !restDays.has(d));
      const interval = Math.max(1, Math.floor(pool.length / singleRemaining));
      let sp = 0;
      for (let i = Math.floor(interval / 2); i < pool.length && sp < singleRemaining; i += interval) {
        restDays.add(pool[i]);
        sp++;
      }
    }
  }

  return restDays;
}

// ============================================================
// DB保存
// ============================================================
async function saveAssignments(yearMonth, assignments) {
  // 既存データ削除
  const { error: delError } = await supabase
    .from('shift_assignments')
    .delete()
    .eq('year_month', yearMonth);
  if (delError) throw delError;

  // チャンクで挿入（Supabase制限対策）
  const chunkSize = 100;
  for (let i = 0; i < assignments.length; i += chunkSize) {
    const chunk = assignments.slice(i, i + chunkSize);
    const { error } = await supabase.from('shift_assignments').insert(chunk);
    if (error) throw error;
  }
}

// ============================================================
// ガントチャート描画
// ============================================================
function renderGantt() {
  const daysInMonth = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
  const today = new Date();
  const todayStr = formatDate(today);
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

  document.getElementById('gantt-placeholder').style.display = 'none';
  document.getElementById('gantt-table').style.display = 'table';

  // ヘッダー
  const thead = document.getElementById('gantt-head');
  let headHtml = '<tr><th class="staff-name">スタッフ</th><th class="gantt-summary-col">集計</th>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(state.currentYear, state.currentMonth, d);
    const dow = dt.getDay();
    const dateStr = formatDate(dt);
    const isHoliday = state.holidays[dateStr];
    const isSunday = dow === 0;
    const cls = [
      dateStr === todayStr && 'is-today',
      isSunday && 'is-sunday',
      dow === 6 && 'is-saturday',
      isHoliday && 'is-holiday',
    ].filter(Boolean).join(' ');
    const title = isHoliday ? ` title="${isHoliday}"` : '';
    headHtml += `<th class="${cls}"${title}>${d}<br><span style="font-size:0.55rem">${dayNames[dow]}</span></th>`;
  }
  thead.innerHTML = headHtml + '</tr>';

  // ボディ
  const tbody = document.getElementById('gantt-body');
  let bodyHtml = '';
  // display_order 順で表示
  const sortedStaff = [...state.staffList].filter(s => s.is_active).sort((a, b) => a.display_order - b.display_order);

  // 集計欄の色分け用定数
  const ym = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}`;
  const daysOff = state.monthlySettings[ym] || 10;


  // 薬剤師グループの最終インデックスを検出（roleがpharmacistの最後の行）
  let lastPharmacistIdx = -1;
  sortedStaff.forEach((s, i) => {
    if (s.role === 'pharmacist') lastPharmacistIdx = i;
  });

  for (let idx = 0; idx < sortedStaff.length; idx++) {
    const staff = sortedStaff[idx];
    // 薬剤師グループの最終行に境界線クラスを付与
    const trClass = (idx === lastPharmacistIdx) ? ' class="is-group-divider"' : '';
    bodyHtml += `<tr${trClass}><td class="staff-name">${escapeHtml(staff.name)}</td>`;
    // スタッフ名の右横に集計列
    const staffAssigns = state.assignments.filter(a => a.staff_id === staff.id);
    const workCount = staffAssigns.filter(a => a.work_pattern && a.work_pattern !== '').length;
    const restCount = staffAssigns.filter(a => !a.work_pattern || a.work_pattern === '').length;
    const sn = staff.name;

    // 表示値：信太・小野は公休数、その他は出勤数
    let summaryLabel;
    if (sn.includes('信太') || sn.includes('小野')) {
      summaryLabel = `休${restCount}`;
    } else if (staff.staff_type === 'external') {
      summaryLabel = '-';
    } else {
      summaryLabel = `${workCount}日`;
    }

    // 色分け：スタッフ別の集計値閾値で判定
    let cellColor = ''; // '' = 変更なし, 'warn' = 黄色, 'ng' = 赤

    if (sn.includes('村上') || sn.includes('本庄')) {
      // 村上・本庄：常に変更なし
      cellColor = '';
    } else if (sn.includes('小野') || sn.includes('信太')) {
      // 小野・信太：公休数が設定値と一致しなければ赤
      if (restCount !== daysOff) cellColor = 'ng';
    } else if (sn.includes('徳永') || sn.includes('木庭')) {
      // 徳永・木庭：≤17白, 18-22黄, ≥23赤
      if (workCount >= 23) cellColor = 'ng';
      else if (workCount >= 18) cellColor = 'warn';
    } else if (sn.includes('中村')) {
      // 中村：≤10白, ≥11赤
      if (workCount >= 11) cellColor = 'ng';
    } else if (sn.includes('諫早')) {
      // 諫早：≤13白, 14-17黄, ≥18赤
      if (workCount >= 18) cellColor = 'ng';
      else if (workCount >= 14) cellColor = 'warn';
    }

    let ngStyle = '';
    if (cellColor === 'ng') ngStyle = 'background:#fee2e2;color:#dc2626;';
    else if (cellColor === 'warn') ngStyle = 'background:#fef9c3;color:#a16207;';
    bodyHtml += `<td class="gantt-summary-col" style="text-align:center;font-weight:700;font-size:0.75rem;${ngStyle}">${summaryLabel}</td>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dt = new Date(state.currentYear, state.currentMonth, d);
      const isSunday = dt.getDay() === 0;
      const isEbisuClosed = isSunday;

      const assign = state.assignments.find(a => a.staff_id === staff.id && a.date === dateStr);
      const pattern = assign?.work_pattern || '';
      const attendance = assign?.attendance_type || '平日';
      const isManual = assign?.is_manual_override || false;

      // 希望休チェック → 種類別ストライプクラス付与
      const request = state.requests.find(r => r.staff_id === staff.id && r.date === dateStr);
      const STRIPE_MAP = { off: 'bg-stripe-off', am: 'bg-stripe-am', pm: 'bg-stripe-pm', dispense: 'bg-stripe-dispense', other: 'bg-stripe-other' };

      let cellContent = '';
      let cellClass = 'day-cell';

      // 希望があればストライプクラス付与
      if (request && STRIPE_MAP[request.request_type]) {
        cellClass += ` ${STRIPE_MAP[request.request_type]}`;
      }

      if (staff.staff_type === 'external') {
        // 外部スタッフ：クリック不可、空セル
        cellClass += ' is-external';
      }

      if (isManual) cellClass += ' is-manual';

      if (pattern && PATTERN_CSS[pattern]) {
        const cssClass = PATTERN_CSS[pattern];
        const label = PATTERN_LABEL[pattern] || pattern;
        const role = staff.role || '';
        cellContent = `<div class="pattern-marker ${cssClass}" data-role="${role}">${label}</div>`;
      } else if (pattern) {
        // 特殊パターン（りんご、出張等）
        cellContent = `<div class="pattern-marker pattern-marker--special">${escapeHtml(pattern.substring(0, 2))}</div>`;
      } else if (attendance === '所定休日' || attendance === '法定休日') {
        cellContent = `<div class="pattern-marker pattern-marker--off">休</div>`;
      }

      // ストライプがあればdata属性にリクエスト情報を埋め込む
      let requestAttrs = '';
      if (request && STRIPE_MAP[request.request_type]) {
        requestAttrs = ` data-request-type="${request.request_type}" data-request-note="${escapeHtml(request.note || '')}"`;
      }

      bodyHtml += `<td class="${cellClass}" data-staff="${staff.id}" data-date="${dateStr}"${requestAttrs}>${cellContent}</td>`;
    }
    bodyHtml += '</tr>';
  }
  tbody.innerHTML = bodyHtml;

  // フッター（充足集計）
  renderGanttFooter(daysInMonth, sortedStaff);

  // セルクリックイベント
  tbody.querySelectorAll('.day-cell').forEach(cell => {
    cell.addEventListener('click', (e) => {
      const staffId = cell.dataset.staff;
      const staff = state.staffList.find(s => s.id === staffId);
      if (staff?.staff_type === 'external') return;
      openCellEditor(cell, staff, cell.dataset.date);
    });
  });

  // ストライプセル：ホバーツールチップ
  const STRIPE_LABEL = {
    off: '休み希望',
    am: 'AM可（午前のみ出勤可）',
    pm: 'PM可（午後のみ出勤可）',
    dispense: '調剤（他薬局での調剤業務）',
    other: 'その他の希望',
  };
  const STRIPE_ICON = { off: '🔴', am: '🟢', pm: '🔵', dispense: '🟠', other: '🟡' };
  const tooltip = document.getElementById('stripe-tooltip');
  const tooltipType = document.getElementById('stripe-tooltip-type');
  const tooltipNote = document.getElementById('stripe-tooltip-note');

  tbody.querySelectorAll('[data-request-type]').forEach(cell => {
    cell.addEventListener('mouseenter', () => {
      const type = cell.dataset.requestType;
      const note = cell.dataset.requestNote || '';
      tooltipType.textContent = `${STRIPE_ICON[type] || ''} ${STRIPE_LABEL[type] || type}`;
      tooltipNote.textContent = note;
      tooltip.style.display = 'block';
    });
    cell.addEventListener('mousemove', (e) => {
      const x = e.clientX + 14;
      const y = e.clientY - 10;
      // 画面端に出ないよう調整
      const tw = tooltip.offsetWidth;
      const th = tooltip.offsetHeight;
      tooltip.style.left = (x + tw > window.innerWidth ? e.clientX - tw - 10 : x) + 'px';
      tooltip.style.top = (y + th > window.innerHeight ? e.clientY - th - 10 : y) + 'px';
    });
    cell.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
  });
}

function renderGanttFooter(daysInMonth, sortedStaff) {
  const tfoot = document.getElementById('gantt-foot');
  let ebisuRow = '<td class="staff-name" style="font-size:0.75rem;">恵比寿</td>';
  let shibuyaRow = '<td class="staff-name" style="font-size:0.75rem;">渋谷</td>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dt = new Date(state.currentYear, state.currentMonth, d);
    const isSunday = dt.getDay() === 0;

    const todayAssigns = state.assignments.filter(a => a.date === dateStr && a.work_pattern);
    let ep = 0, eo = 0, sp = 0, so = 0;

    todayAssigns.forEach(a => {
      const staff = state.staffList.find(s => s.id === a.staff_id);
      if (!staff) return;
      const isPharm = staff.role === 'pharmacist';
      if ([PATTERNS.EMPLOYEE_EBISU, PATTERNS.PART_EBISU].includes(a.work_pattern)) {
        if (isPharm) ep++; else eo++;
      }
      if ([PATTERNS.EMPLOYEE_SHIBUYA, PATTERNS.PART_SHIBUYA, PATTERNS.PM_PART_SHIBUYA].includes(a.work_pattern)) {
        if (isPharm) sp++; else so++;
      }
    });

    if (isSunday) {
      ebisuRow += '<td style="background:var(--color-surface-2);font-size:0.75rem;color:var(--color-text-muted);">休</td>';
    } else {
      // 恵比寿：薬1/事1が正常、それ以外（0またはは2以上）はNG
      const eOk = ep === 1 && eo === 1;
      const epNg = ep !== 1;
      const eoNg = eo !== 1;
      const eCellNg = !eOk ? ' cell-ng' : '';
      const epStr = epNg ? `<span class="count-ng">薬${ep}</span>` : `薬${ep}`;
      const eoStr = eoNg ? `<span class="count-ng">事${eo}</span>` : `事${eo}`;
      ebisuRow += `<td class="${eCellNg.trim()}">${epStr}/${eoStr}</td>`;
    }

    // 渋谷：薬1/事1のみOK（薬2・事2以上も過剰でNG）
    const sOk = sp === 1 && so === 1;
    const spNg = sp !== 1;
    const soNg = so !== 1;
    const sCellNg = !sOk ? ' cell-ng' : '';
    const spStr = spNg ? `<span class="count-ng">薬${sp}</span>` : `薬${sp}`;
    const soStr = soNg ? `<span class="count-ng">事${so}</span>` : `事${so}`;
    shibuyaRow += `<td class="${sCellNg.trim()}">${spStr}/${soStr}</td>`;
  }

  const eSummary = '<td class="gantt-summary-col"></td>';
  const sSummary = '<td class="gantt-summary-col"></td>';
  // staff-nameの直後に集計列の空セルを挿入
  ebisuRow = ebisuRow.replace(/(<td class="staff-name"[^>]*>[^<]*<\/td>)/, '$1' + eSummary);
  shibuyaRow = shibuyaRow.replace(/(<td class="staff-name"[^>]*>[^<]*<\/td>)/, '$1' + sSummary);
  tfoot.innerHTML = `<tr>${ebisuRow}</tr><tr>${shibuyaRow}</tr>`;
}

// ============================================================
// 警告表示
// ============================================================
function renderWarnings() {
  const panel = document.getElementById('warnings-panel');
  if (state.warnings.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  document.getElementById('warnings-count').textContent = `${state.warnings.length}件の警告`;
  document.getElementById('warnings-list').innerHTML = state.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('');
}

// ============================================================
// セル編集ドロップダウン
// ============================================================
function openCellEditor(cell, staff, dateStr) {
  const editor = document.getElementById('cell-editor');
  const patterns = getAvailablePatterns(staff);
  const currentAssign = state.assignments.find(a => a.staff_id === staff.id && a.date === dateStr);
  const currentPattern = currentAssign?.work_pattern || '';
  const currentAttendance = currentAssign?.attendance_type || '平日';

  const dt = new Date(dateStr + 'T00:00:00');
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  document.getElementById('cell-editor-title').textContent =
    `${staff.name} - ${dt.getMonth() + 1}/${dt.getDate()}（${dayNames[dt.getDay()]}）`;

  const optionsHtml = [];
  // 所定休日オプション
  optionsHtml.push(buildEditorOption('所定休日', '', currentAttendance === '所定休日' && currentPattern === ''));

  // 平日+空欄（勤務なし）
  optionsHtml.push(buildEditorOption('平日（勤務なし）', '__empty__', currentAttendance === '平日' && currentPattern === ''));

  // 各パターン
  for (const p of patterns) {
    if (p === '') continue;
    const isActive = currentPattern === p;
    optionsHtml.push(buildEditorOption(p, p, isActive));
  }

  document.getElementById('cell-editor-options').innerHTML = optionsHtml.join('');

  // 位置決め
  const rect = cell.getBoundingClientRect();
  editor.style.left = `${rect.left}px`;
  editor.style.top = `${rect.bottom + 4}px`;
  // 画面外にはみ出す場合の補正
  editor.style.display = 'block';
  const editorRect = editor.getBoundingClientRect();
  if (editorRect.right > window.innerWidth) {
    editor.style.left = `${window.innerWidth - editorRect.width - 8}px`;
  }
  if (editorRect.bottom > window.innerHeight) {
    editor.style.top = `${rect.top - editorRect.height - 4}px`;
  }

  // オプションクリック
  editor.querySelectorAll('.cell-editor__option').forEach(opt => {
    opt.addEventListener('click', async () => {
      const value = opt.dataset.value;
      let newAttendance, newPattern;
      if (value === '所定休日') {
        newAttendance = '所定休日';
        newPattern = '';
      } else if (value === '__empty__') {
        newAttendance = '平日';
        newPattern = '';
      } else {
        newAttendance = '平日';
        newPattern = value;
      }

      // ローカル更新
      const idx = state.assignments.findIndex(a => a.staff_id === staff.id && a.date === dateStr);
      if (idx >= 0) {
        state.assignments[idx].attendance_type = newAttendance;
        state.assignments[idx].work_pattern = newPattern;
        state.assignments[idx].is_manual_override = true;
      } else {
        state.assignments.push({
          year_month: `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}`,
          staff_id: staff.id,
          date: dateStr,
          attendance_type: newAttendance,
          work_pattern: newPattern,
          is_manual_override: true,
        });
      }

      // DB更新
      try {
        await supabase.from('shift_assignments')
          .upsert({
            year_month: `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}`,
            staff_id: staff.id,
            date: dateStr,
            attendance_type: newAttendance,
            work_pattern: newPattern,
            is_manual_override: true,
          }, { onConflict: 'staff_id,date' });
        showToast('更新しました', 'success');
      } catch (err) {
        console.error(err);
        showToast('更新に失敗', 'error');
      }

      editor.style.display = 'none';
      // 手動変更後にスコアを再計算して内訳も更新
      const yearMonthNow = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}`;
      const { score: newScore, breakdown: newBreakdown } = scoreShifts(state.assignments, yearMonthNow);
      state.lastScore = newScore;
      state.lastBreakdown = newBreakdown;
      renderGantt();
      renderConditionsCheck();
      pushHistory();
    });
  });
}

function buildEditorOption(label, value, isActive) {
  const dotColor = PATTERN_CSS[label]
    ? `background:${getComputedPatternColor(label)}`
    : (value === '所定休日' ? 'background:#dfe6e9' : 'background:transparent;border:1px solid #ccc');
  const displayLabel = label.replace(/^[○◯☆]/, '');
  return `<div class="cell-editor__option ${isActive ? 'is-active' : ''}" data-value="${escapeHtml(value || label)}">
    <span class="cell-editor__option-dot" style="${dotColor}"></span>
    ${escapeHtml(displayLabel)}
  </div>`;
}

function getComputedPatternColor(pattern) {
  const colors = {
    '○恵比寿': '#6c5ce7',
    '○渋谷': '#0984e3',
    '◯開発': '#fdcb6e',
    '☆恵比寿': '#a29bfe',
    '☆渋谷': '#74b9ff',
    '午後☆渋谷': '#74b9ff',
  };
  return colors[pattern] || '#ccc';
}

// ============================================================
// CSV出力（Shift-JIS）
// ============================================================
function handleCSVExport() {
  const yearMonth = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}`;
  const [year, month] = yearMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();

  // スタッフを employee_no 順にソート
  const sortedStaff = [...state.staffList]
    .filter(s => s.is_active)
    .sort((a, b) => (a.employee_no || '99').localeCompare(b.employee_no || '99'));

  // ヘッダー行
  const headers = ['従業員番号', '苗字', '名前', '日付', '勤怠区分', '勤務パターン',
    '開始時刻', '終了時刻', '休憩開始時刻1', '休憩終了時刻1',
    '休憩開始時刻2', '休憩終了時刻2', '休憩開始時刻3', '休憩終了時刻3'];

  const rows = [headers.join(',')];

  for (const staff of sortedStaff) {
    // 名前を姓名に分割
    const nameParts = staff.name.replace(/\s+/g, '　').split('　');
    const lastName = nameParts[0] || staff.name;
    const firstName = nameParts.slice(1).join('') || '';

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const assign = state.assignments.find(a => a.staff_id === staff.id && a.date === dateStr);
      const attendance = assign?.attendance_type || '平日';
      const pattern = assign?.work_pattern || '';

      // 日付フォーマット: YYYY/M/D
      const csvDate = `${year}/${month}/${d}`;
      const row = [
        staff.employee_no || '',
        lastName,
        firstName,
        csvDate,
        attendance,
        pattern,
        '', '', '', '', '', '', '', ''  // 時刻系は空欄
      ];
      rows.push(row.join(','));
    }
  }

  const csvContent = rows.join('\n');

  // Shift-JIS エンコード（TextEncoderを使えないのでUint8Arrayで手動変換）
  // ブラウザ側ではencoding.jsライブラリを使うか、UTF-8のままにするか
  // ここではシンプルにBlobでUTF-8出力し、ユーザーがExcelで開く際にShift-JISを選べるようにする
  // → 既存CSVがShift-JISなので、encoding-japanese ライブラリを使用
  downloadAsShiftJIS(csvContent, `シフト_${year}年${month}月.csv`);
}

async function downloadAsShiftJIS(text, filename) {
  // encoding-japanese CDN を動的ロード
  if (!window.Encoding) {
    await loadScript('https://cdn.jsdelivr.net/npm/encoding-japanese@2.2.0/encoding.min.js');
  }

  const unicodeArray = [];
  for (let i = 0; i < text.length; i++) {
    unicodeArray.push(text.charCodeAt(i));
  }
  const sjisArray = window.Encoding.convert(unicodeArray, {
    to: 'SJIS',
    from: 'UNICODE',
  });
  const uint8Array = new Uint8Array(sjisArray);
  const blob = new Blob([uint8Array], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSVを出力しました', 'success');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ============================================================
// ユーティリティ
// ============================================================
function formatDate(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ============================================================
// 過去勤務実績パネル
// ============================================================
async function loadHistoryData() {
  // 直近6ヶ月分の year_month リストを生成（今月含む）
  const months = [];
  for (let i = 5; i >= 0; i--) {
    let y = state.currentYear;
    let m = state.currentMonth - i;
    while (m < 0) { m += 12; y--; }
    while (m > 11) { m -= 12; y++; }
    months.push(`${y}-${String(m + 1).padStart(2, '0')}`);
  }

  const { data, error } = await supabase
    .from('shift_assignments')
    .select('year_month, staff_id, attendance_type, work_pattern')
    .in('year_month', months);
  if (error) { console.error(error); return { months, byStaffMonth: {} }; }

  // [staffId][yearMonth] = 出勤日数
  const byStaffMonth = {};
  (data || []).forEach(a => {
    if (!a.work_pattern || a.work_pattern === '') return; // 休日は除外
    if (!byStaffMonth[a.staff_id]) byStaffMonth[a.staff_id] = {};
    byStaffMonth[a.staff_id][a.year_month] = (byStaffMonth[a.staff_id][a.year_month] || 0) + 1;
  });

  return { months, byStaffMonth };
}

async function renderHistoryPanel() {
  const panel = document.getElementById('history-panel');
  const thead = document.getElementById('history-thead');
  const tbody = document.getElementById('history-tbody');
  const subtitle = document.getElementById('history-subtitle');
  const note = document.getElementById('history-note');
  if (!panel || !thead || !tbody) return;

  const { months, byStaffMonth } = await loadHistoryData();
  const currentYM = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}`;
  const activeStaff = state.staffList.filter(s => s.is_active);

  // どの月にもデータがなければパネルを隠す
  const hasAnyData = Object.keys(byStaffMonth).length > 0;
  if (!hasAnyData) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';

  subtitle.textContent = `直近 ${months.length} ヶ月`;

  // ヘッダー行
  let headHtml = '<tr><th class="history-name">スタッフ</th>';
  months.forEach(ym => {
    const [y, m] = ym.split('-').map(Number);
    const isCurrent = ym === currentYM;
    const cls = isCurrent ? ' is-current-month' : '';
    headHtml += `<th class="${cls}">${m}月${isCurrent ? '（今月）' : ''}</th>`;
  });
  headHtml += '<th class="is-avg">過去平均</th></tr>';
  thead.innerHTML = headHtml;

  // 各スタッフ行
  let bodyHtml = '';
  activeStaff.forEach(staff => {
    const staffData = byStaffMonth[staff.id] || {};

    // 今月以外の過去月の平均を計算
    const pastMonths = months.filter(ym => ym !== currentYM);
    const pastValues = pastMonths.map(ym => staffData[ym]).filter(v => v !== undefined);
    const avg = pastValues.length > 0
      ? Math.round(pastValues.reduce((s, v) => s + v, 0) / pastValues.length * 10) / 10
      : null;

    bodyHtml += `<tr><td class="history-name">${escapeHtml(staff.name)}</td>`;
    months.forEach(ym => {
      const isCurrent = ym === currentYM;
      const tdCls = isCurrent ? ' is-current-month' : '';
      const val = staffData[ym];

      if (val === undefined) {
        bodyHtml += `<td class="${tdCls}"><span class="history-cell history-cell--none">-</span></td>`;
        return;
      }

      // ヒートマップ判定（平均との差）
      let heatCls = 'history-cell--normal';
      if (avg !== null && !isCurrent) {
        const diff = val - avg;
        if (diff >= 2) heatCls = 'history-cell--high';
        else if (diff >= 1) heatCls = 'history-cell--above';
        else if (diff <= -2) heatCls = 'history-cell--low';
        else if (diff <= -1) heatCls = 'history-cell--below';
      }

      bodyHtml += `<td class="${tdCls}"><span class="history-cell ${heatCls}">${val}日</span></td>`;
    });

    // 平均列
    const avgText = avg !== null ? `${avg}日` : '-';
    bodyHtml += `<td class="is-avg"><span class="history-cell history-cell--normal">${avgText}</span></td>`;
    bodyHtml += '</tr>';
  });
  tbody.innerHTML = bodyHtml;

  note.textContent = '色：紫 = 平均より多い / 赤 = 平均より少ない (今月列は比較除外)';
}

// ============================================================
// 条件チェックパネル（runAllChecksの結果を描画するだけ）
// ============================================================
function renderConditionsCheck() {
  const panel = document.getElementById('conditions-panel');
  const grid = document.getElementById('conditions-grid');
  if (!panel || !grid) return;
  if (!state.assignments || state.assignments.length === 0) {
    panel.style.display = 'none';
    grid.innerHTML = '';
    return;
  }
  panel.style.display = 'block';
  grid.innerHTML = '';

  const yearMonth = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}`;
  const { globalItems, staffChecks } = runAllChecks(state.assignments, yearMonth);

  // 未達成サマリー収集用
  const summaryProblems = [];

  let currentSection = null;
  function createSection(icon, title) {
    const section = document.createElement('div');
    section.className = 'conditions-section';
    const titleEl = document.createElement('div');
    titleEl.className = 'conditions-section__title';
    titleEl.innerHTML = `<span class="conditions-section__title-icon">${icon}</span>${title}`;
    const sectionGrid = document.createElement('div');
    sectionGrid.className = 'conditions-section__grid';
    section.appendChild(titleEl);
    section.appendChild(sectionGrid);
    grid.appendChild(section);
    currentSection = sectionGrid;
  }

  // カード描画
  function appendCard(title, items) {
    const icons = { pass: '✅', fail: '❌', warn: '⚠️' };
    // 優先順位ソート（絶対 > 高 > 中 > 低 > なし）
    const rank = { '絶対': 1, '高': 2, '中': 3, '低': 4 };
    items.sort((a, b) => (rank[a.tag] || 99) - (rank[b.tag] || 99));

    const card = document.createElement('div');
    card.className = 'staff-conditions-card';
    const titleEl = document.createElement('div');
    titleEl.className = 'staff-conditions-card__title';
    titleEl.textContent = title;
    const ul = document.createElement('ul');
    ul.className = 'staff-conditions-card__list';
    for (const { status, text, value, tag } of items) {
      const li = document.createElement('li');
      li.className = `condition-item condition-item--${status}`;
      const tagMap = { '絶対': 'absolute', '高': 'high', '中': 'mid', '低': 'low' };
      const tagClass = tag ? (tagMap[tag] || tag.toLowerCase()) : '';
      const tagHtml = tag ? `<span class="condition-item__tag condition-item__tag--${tagClass}">${tag}</span>` : '';
      li.innerHTML = `
        <span class="condition-item__icon">${icons[status]}</span>
        ${tagHtml}
        <span class="condition-item__text">${text}</span>
        <span class="condition-item__value">${value}</span>
      `;
      ul.appendChild(li);
      if (status === 'fail' || status === 'warn') {
        summaryProblems.push({ staff: title, status, tag, text, value });
      }
    }
    card.appendChild(titleEl);
    card.appendChild(ul);
    (currentSection || grid).appendChild(card);
  }

  // ===== 全体チェック（店舗充足・希望休） =====
  appendCard('店舗充足', globalItems.filter(i => i.id.startsWith('G1')));
  appendCard('希望休', globalItems.filter(i => i.id === 'G2'));

  // ===== 薬剤師セクション =====
  const pharmStaff = Object.entries(staffChecks).filter(([, v]) => v.section === '薬剤師');
  if (pharmStaff.length > 0) {
    createSection('💊', '薬剤師');
    for (const [, check] of pharmStaff) {
      appendCard(check.name, check.items);
    }
  }

  // ===== 事務パートセクション =====
  const officeStaffChecks = Object.entries(staffChecks).filter(([, v]) => v.section === '事務パート');
  if (officeStaffChecks.length > 0) {
    createSection('📝', '事務パート');
    for (const [, check] of officeStaffChecks) {
      appendCard(check.name, check.items);
    }
  }

  lucide.createIcons();

  // ヘッダーバッジ更新
  const badge = document.getElementById('conditions-header-badge');
  if (badge) {
    const failCount = summaryProblems.filter(p => p.status === 'fail').length;
    const warnCount = summaryProblems.filter(p => p.status === 'warn').length;
    if (failCount === 0 && warnCount === 0) {
      badge.textContent = '✅ 全クリア';
      badge.className = 'conditions-header-badge conditions-header-badge--ok';
    } else {
      const parts = [];
      if (failCount > 0) parts.push(`❌ ${failCount}件`);
      if (warnCount > 0) parts.push(`⚠️ ${warnCount}件`);
      badge.textContent = parts.join('　');
      badge.className = 'conditions-header-badge conditions-header-badge--ng';
    }
  }
}

