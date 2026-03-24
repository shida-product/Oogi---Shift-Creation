/**
 * シフト希望 メイン画面ロジック
 * - ガントチャート（PC）：ドラッグ→モーダル確認→登録
 * - カレンダー（スマホ）
 * - 祝日表示
 * - その他リスト
 * - 最近の変更通知
 */

import { supabase } from './supabase-config.js';

// ============================================================
// 祝日データ（日本の祝日）
// ============================================================
function getHolidays(year) {
  // 固定祝日
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

  // 春分の日（概算）
  const shunbun = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  holidays[`${year}-03-${String(shunbun).padStart(2, '0')}`] = '春分の日';

  // 秋分の日（概算）
  const shubun = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  holidays[`${year}-09-${String(shubun).padStart(2, '0')}`] = '秋分の日';

  // ハッピーマンデー
  const happyMonday = (m, week) => {
    let d = new Date(year, m - 1, 1);
    let count = 0;
    while (count < week) {
      if (d.getDay() === 1) count++;
      if (count < week) d.setDate(d.getDate() + 1);
    }
    return d;
  };
  const hm = [
    [1, 2, '成人の日'], [7, 3, '海の日'], [9, 3, '敬老の日'], [10, 2, 'スポーツの日'],
  ];
  hm.forEach(([m, week, name]) => {
    const d = happyMonday(m, week);
    holidays[formatDate(d)] = name;
  });

  // 振替休日：祝日が日曜なら翌月曜
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
  requests: [],
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),
  selectedStaffId: localStorage.getItem('selectedStaffId') || '',
  holidays: {},
  editingDates: [],
  editingStaffId: null,
  editingRequest: null,
};

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  await loadStaffList();
  updateHolidays();
  renderMonth();
  await loadRequests();
});

function updateHolidays() {
  state.holidays = {
    ...getHolidays(state.currentYear),
    ...getHolidays(state.currentYear - 1),
    ...getHolidays(state.currentYear + 1),
  };
}

// ============================================================
// イベントバインド
// ============================================================
function bindEvents() {
  document.getElementById('prev-month').addEventListener('click', () => changeMonth(-1));
  document.getElementById('next-month').addEventListener('click', () => changeMonth(1));

  document.getElementById('staff-select').addEventListener('change', (e) => {
    state.selectedStaffId = e.target.value;
    localStorage.setItem('selectedStaffId', state.selectedStaffId);
    renderStaffChips();
    updateFabVisibility();
  });

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('modal-save').addEventListener('click', handleModalSave);
  document.getElementById('modal-delete').addEventListener('click', handleModalDelete);

  // ボトムシート
  document.getElementById('bottom-sheet-close').addEventListener('click', closeBottomSheet);
  document.getElementById('bottom-sheet-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeBottomSheet();
  });

  // FAB：今日の日付でモーダルを開く
  document.getElementById('fab-add').addEventListener('click', () => {
    openModal(state.selectedStaffId, [formatDate(new Date())]);
  });

  // 画面回転・リサイズ対応
  window.addEventListener('resize', updateFabVisibility);

  setupGanttDrag();
  setupGanttHover();
}

// ============================================================
// ガントチャート ドラッグ選択 → モーダル
// ============================================================
function setupGanttDrag() {
  const ganttTable = document.getElementById('gantt-table');
  const tbody = document.getElementById('gantt-body');
  let isDragging = false;
  let dragStaffId = null;
  let dragCells = [];
  let rowCells = [];
  let startIndex = -1;

  function clearHighlight() {
    ganttTable.querySelectorAll('.drag-highlight').forEach(c => c.classList.remove('drag-highlight'));
  }

  tbody.addEventListener('mousedown', (e) => {
    const cell = e.target.closest('.day-cell');
    if (!cell) return;
    e.preventDefault();
    isDragging = true;
    dragStaffId = cell.dataset.staff;
    
    // 行内のセル一覧と開始インデックスを記憶
    const tr = cell.closest('tr');
    rowCells = Array.from(tr.querySelectorAll('.day-cell'));
    startIndex = rowCells.indexOf(cell);

    dragCells = [cell];
    ganttTable.classList.add('is-dragging');
    clearHighlight();
    cell.classList.add('drag-highlight');
  });

  tbody.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const cell = e.target.closest('.day-cell');
    if (!cell || cell.dataset.staff !== dragStaffId) return;

    const currentIndex = rowCells.indexOf(cell);
    if (currentIndex === -1) return;

    // 開始セルと現在のセルの間の要素を取得（前／後どちらにドラッグしても対応）
    const minIdx = Math.min(startIndex, currentIndex);
    const maxIdx = Math.max(startIndex, currentIndex);

    // 範囲内のセルで配列を更新
    dragCells = rowCells.slice(minIdx, maxIdx + 1);

    // 一旦全クリアして再度ハイライト
    clearHighlight();
    dragCells.forEach(c => c.classList.add('drag-highlight'));
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    ganttTable.classList.remove('is-dragging');
    clearHighlight();
    if (dragCells.length === 0) return;

    const dates = dragCells.map(c => c.dataset.date);
    const staffId = dragStaffId;
    
    // 初期化
    dragCells = [];
    dragStaffId = null;
    rowCells = [];
    startIndex = -1;
    
    openModal(staffId, dates);
  });
}

// ============================================================
// ガントチャート ホバー（クロスハイライト）
// ============================================================
function setupGanttHover() {
  const ganttTable = document.getElementById('gantt-table');
  const tbody = document.getElementById('gantt-body');

  function clearCrossHighlight() {
    ganttTable.querySelectorAll('.cross-highlight').forEach(c => c.classList.remove('cross-highlight'));
  }

  tbody.addEventListener('mouseover', (e) => {
    if (ganttTable.classList.contains('is-dragging')) return;
    clearCrossHighlight();
    
    const cell = e.target.closest('td');
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

  tbody.addEventListener('mouseleave', () => {
    clearCrossHighlight();
  });
}

// ============================================================
// データ取得
// ============================================================
async function loadStaffList() {
  const { data, error } = await supabase
    .from('staff')
    .select('*')
    .eq('is_active', true)
    .order('display_order');
  if (error) { console.error(error); return; }
  state.staffList = data || [];
  renderStaffSelect();
}

async function loadRequests() {
  const startDate = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}-01`;
  const endDate = getLastDayOfMonth(state.currentYear, state.currentMonth);

  const { data, error } = await supabase
    .from('shift_requests')
    .select('*, staff:staff_id(name)')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date');
  if (error) { console.error(error); return; }

  state.requests = data || [];
  renderGantt();
  renderCalendar();
  renderOtherList();
}

// ============================================================
// 月の切り替え
// ============================================================
function changeMonth(delta) {
  closeBottomSheet();
  state.currentMonth += delta;
  if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
  else if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
  updateHolidays();
  renderMonth();
  loadRequests();
}

function renderMonth() {
  document.getElementById('month-label').textContent = `${state.currentYear}年 ${state.currentMonth + 1}月`;
}

// ============================================================
// スタッフ選択プルダウン（スマホ用ヘッダー）
// ============================================================
function renderStaffSelect() {
  const select = document.getElementById('staff-select');
  select.innerHTML = '<option value="">選択してください</option>';
  state.staffList.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    if (s.id === state.selectedStaffId) opt.selected = true;
    select.appendChild(opt);
  });
  renderStaffChips();
  updateFabVisibility();
}

// ============================================================
// ガントチャート描画（PC）
// ============================================================
function renderGantt() {
  const daysInMonth = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
  const today = new Date();
  const todayStr = formatDate(today);
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

  const thead = document.getElementById('gantt-head');
  let headHtml = '<tr><th class="staff-name">スタッフ</th>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(state.currentYear, state.currentMonth, d);
    const dow = dt.getDay();
    const dateStr = formatDate(dt);
    const isHoliday = state.holidays[dateStr];
    const cls = [
      dateStr === todayStr && 'is-today',
      dow === 0 && 'is-sunday',
      dow === 6 && 'is-saturday',
      isHoliday && 'is-holiday',
    ].filter(Boolean).join(' ');
    const title = isHoliday ? ` title="${isHoliday}"` : '';
    headHtml += `<th class="${cls}"${title} data-date="${dateStr}">${d}<br><span style="font-size:0.6rem">${dayNames[dow]}</span></th>`;
  }
  thead.innerHTML = headHtml + '</tr>';

  const tbody = document.getElementById('gantt-body');
  let bodyHtml = '';
  state.staffList.forEach(staff => {
    bodyHtml += `<tr><td class="staff-name">${escapeHtml(staff.name)}</td>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const req = state.requests.find(r => r.staff_id === staff.id && r.date === dateStr);
      let cell = '';
      if (req) {
        let cls, label;
        switch (req.request_type) {
          case 'off': cls = 'marker--off'; label = '休'; break;
          case 'am': cls = 'marker--am'; label = 'AM'; break;
          case 'pm': cls = 'marker--pm'; label = 'PM'; break;
          case 'dispense': cls = 'marker--dispense'; label = '調'; break;
          default: cls = 'marker--other'; label = '他'; break;
        }
        cell = `<div class="marker ${cls}" title="${escapeHtml(req.note || '')}">${label}</div>`;
      }
      bodyHtml += `<td class="day-cell" data-staff="${staff.id}" data-date="${dateStr}">${cell}</td>`;
    }
    bodyHtml += '</tr>';
  });
  tbody.innerHTML = bodyHtml;
}

// ============================================================
// カレンダー描画（スマホ）- Google Calendar 風
// ============================================================
function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  const daysInMonth = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
  const firstDow = new Date(state.currentYear, state.currentMonth, 1).getDay();
  const today = new Date();
  const todayStr = formatDate(today);
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

  let html = '';
  dayNames.forEach((name, i) => {
    const cls = i === 0 ? 'is-sunday' : i === 6 ? 'is-saturday' : '';
    html += `<div class="calendar-grid__header ${cls}">${name}</div>`;
  });

  for (let i = 0; i < firstDow; i++) html += '<div class="calendar-grid__cell is-empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(state.currentYear, state.currentMonth, d);
    const dateStr = formatDate(dt);
    const dow = dt.getDay();
    const isHoliday = state.holidays[dateStr];
    const classes = ['calendar-grid__cell'];
    if (dateStr === todayStr) classes.push('is-today');
    if (dow === 0) classes.push('is-sunday');
    if (dow === 6) classes.push('is-saturday');
    if (isHoliday) classes.push('is-holiday');

    const dayReqs = state.requests.filter(r => r.date === dateStr);
    let eventsHtml = '';
    dayReqs.slice(0, 3).forEach(r => {
      let cls = 'cal-evt--other';
      if      (r.request_type === 'off')      { cls = 'cal-evt--off';      }
      else if (r.request_type === 'am')       { cls = 'cal-evt--am';       }
      else if (r.request_type === 'pm')       { cls = 'cal-evt--pm';       }
      else if (r.request_type === 'dispense') { cls = 'cal-evt--dispense'; }
      eventsHtml += `<span class="cal-evt ${cls}">${escapeHtml(r.staff?.name || '?')}</span>`;
    });
    if (dayReqs.length > 3) {
      eventsHtml += `<span class="cal-evt cal-evt--more">+${dayReqs.length - 3}</span>`;
    }

    html += `<div class="${classes.join(' ')}" data-date="${dateStr}">
      <div class="cal-date"><span class="cal-date__num${dateStr === todayStr ? ' cal-date__num--today' : ''}">${d}</span></div>
      <div class="cal-events">${eventsHtml}</div>
    </div>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.calendar-grid__cell:not(.is-empty)').forEach(cell => {
    cell.addEventListener('click', () => showDayDetail(cell.dataset.date));
  });
}

function showDayDetail(dateStr) {
  const dayReqs = state.requests.filter(r => r.date === dateStr);
  const dt = new Date(dateStr + 'T00:00:00');
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const title = `${dt.getMonth() + 1}/${dt.getDate()}（${dayNames[dt.getDay()]}）`;
  const holiday = state.holidays[dateStr];

  // 選択セルをハイライト
  document.querySelectorAll('.calendar-grid__cell.is-selected').forEach(c => c.classList.remove('is-selected'));
  const selectedCell = document.querySelector(`.calendar-grid__cell[data-date="${dateStr}"]`);
  if (selectedCell) selectedCell.classList.add('is-selected');

  // タイトル（祝日ラベル付き）
  const titleEl = document.getElementById('bottom-sheet-title');
  titleEl.textContent = title;
  if (holiday) {
    const badge = document.createElement('span');
    badge.textContent = ` ${holiday}`;
    badge.style.cssText = 'font-size:var(--font-size-xs);color:var(--color-danger);font-weight:500;';
    titleEl.appendChild(badge);
  }

  // ボトムシートの中身
  let bodyHtml = '';
  if (dayReqs.length === 0) {
    bodyHtml = '<p style="font-size:var(--font-size-sm);color:var(--color-text-muted);padding:4px 0 8px;">この日の希望はありません</p>';
  } else {
    bodyHtml = '<ul class="day-detail__list">';
    dayReqs.forEach(r => {
      let type, evtCls;
      switch (r.request_type) {
        case 'off':      type = '休み希望'; evtCls = 'cal-evt--off';      break;
        case 'am':       type = 'AM可';    evtCls = 'cal-evt--am';       break;
        case 'pm':       type = 'PM可';    evtCls = 'cal-evt--pm';       break;
        case 'dispense': type = '調剤';    evtCls = 'cal-evt--dispense'; break;
        default:         type = 'その他';  evtCls = 'cal-evt--other';    break;
      }
      const note = r.note
        ? `<span style="font-size:var(--font-size-xs);color:var(--color-text-muted);display:block;margin-top:2px;">${escapeHtml(r.note)}</span>`
        : '';
      bodyHtml += `<li class="day-detail__item" style="flex-wrap:wrap;">
        <span style="font-weight:600;">${escapeHtml(r.staff?.name || '?')}</span>
        <span class="cal-evt ${evtCls}" style="padding:3px 10px;border-radius:var(--radius-full);">${type}</span>
        ${note}
      </li>`;
    });
    bodyHtml += '</ul>';
  }

  if (state.selectedStaffId) {
    bodyHtml += `<button class="btn btn--primary btn--sm" style="width:100%;margin-top:14px;" id="bottom-sheet-add">
      <i data-lucide="plus" style="width:14px;height:14px;"></i> 希望を登録
    </button>`;
  } else {
    bodyHtml += `<p style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-top:10px;text-align:center;">担当を選択すると登録できます</p>`;
  }

  document.getElementById('bottom-sheet-body').innerHTML = bodyHtml;
  document.getElementById('bottom-sheet-overlay').classList.add('active');
  if (typeof lucide !== 'undefined') lucide.createIcons();

  const addBtn = document.getElementById('bottom-sheet-add');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      closeBottomSheet();
      openModal(state.selectedStaffId, [dateStr]);
    });
  }
}

function closeBottomSheet() {
  const overlay = document.getElementById('bottom-sheet-overlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  document.getElementById('bottom-sheet-title').textContent = '';
  document.getElementById('bottom-sheet-body').innerHTML = '';
  document.querySelectorAll('.calendar-grid__cell.is-selected').forEach(c => c.classList.remove('is-selected'));
}

function renderStaffChips() {
  const container = document.getElementById('staff-chips');
  if (!container) return;
  container.innerHTML = state.staffList.map(s => {
    const isActive = s.id === state.selectedStaffId;
    return `<button class="staff-chip${isActive ? ' is-active' : ''}" data-staff-id="${s.id}">${escapeHtml(s.name)}</button>`;
  }).join('');
  container.querySelectorAll('.staff-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.selectedStaffId = chip.dataset.staffId;
      localStorage.setItem('selectedStaffId', state.selectedStaffId);
      document.getElementById('staff-select').value = state.selectedStaffId;
      updateDispenseVisibility(state.selectedStaffId);
      renderStaffChips();
      updateFabVisibility();
    });
  });
}

function updateFabVisibility() {
  const fab = document.getElementById('fab-add');
  if (!fab) return;
  const isMobile = window.innerWidth <= 768;
  fab.style.display = (state.selectedStaffId && isMobile) ? 'flex' : 'none';
}

// ============================================================
// その他リスト描画（画面下部）
// ============================================================
function renderOtherList() {
  const container = document.getElementById('other-list');
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const otherReqs = state.requests
    .filter(r => r.request_type !== 'off')
    .sort((a, b) => a.date.localeCompare(b.date));

  if (otherReqs.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = `<div class="other-list__title">条件付き・その他の希望 <span class="other-list__count">${otherReqs.length}件</span></div>`;
  html += '<div class="other-list__items">';
  otherReqs.forEach(r => {
    const dt = new Date(r.date + 'T00:00:00');
    const dateLabel = `${dt.getMonth() + 1}/${dt.getDate()}（${dayNames[dt.getDay()]}）`;
    const staffName = r.staff?.name || '不明';
    
    let typeLabel;
    if (r.request_type === 'am') typeLabel = 'AM可';
    else if (r.request_type === 'pm') typeLabel = 'PM可';
    else if (r.request_type === 'dispense') typeLabel = '調剤';
    else typeLabel = 'その他';

    html += `<div class="other-list__item">
      <span class="other-list__date">${dateLabel}</span>
      <span class="other-list__staff">${escapeHtml(staffName)}</span>
      <span class="other-list__type" style="font-size:0.75rem;font-weight:600;min-width:60px;">${typeLabel}</span>
      <span class="other-list__note">${escapeHtml(r.note || '')}</span>
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

// ============================================================
// モーダル操作
// ============================================================
function updateDispenseVisibility(staffId) {
  const staff = state.staffList.find(s => s.id === staffId);
  const labelDispense = document.getElementById('label-dispense');
  const legendDispense = document.getElementById('legend-dispense-item');
  if (labelDispense) {
    if (staff && staff.name === '徳永麻衣子') {
      labelDispense.style.display = 'inline-flex';
      if (legendDispense) legendDispense.style.display = 'inline-block';
    } else {
      labelDispense.style.display = 'none';
      if (legendDispense) legendDispense.style.display = 'none';
      const radio = document.querySelector('input[name="request-type"][value="dispense"]');
      if (radio && radio.checked) {
        document.querySelector('input[name="request-type"][value="off"]').checked = true;
      }
    }
  }
}

// 既存のbindEvents内
document.getElementById('modal-staff-select').addEventListener('change', (e) => {
  updateDispenseVisibility(e.target.value);
});

function openModal(staffId, dates) {
  state.editingStaffId = staffId;
  state.editingDates = dates;

  const staffSelect = document.getElementById('modal-staff-select');
  staffSelect.innerHTML = '';
  state.staffList.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    if (s.id === staffId) opt.selected = true;
    staffSelect.appendChild(opt);
  });

  updateDispenseVisibility(staffId);

  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  if (dates.length === 1) {
    const dt = new Date(dates[0] + 'T00:00:00');
    const holiday = state.holidays[dates[0]];
    document.getElementById('modal-title').textContent =
      `${dt.getMonth() + 1}/${dt.getDate()}（${dayNames[dt.getDay()]}）${holiday ? ' ' + holiday : ''}`;
  } else {
    const first = new Date(dates[0] + 'T00:00:00');
    const last = new Date(dates[dates.length - 1] + 'T00:00:00');
    document.getElementById('modal-title').textContent =
      `${first.getMonth() + 1}/${first.getDate()} 〜 ${last.getMonth() + 1}/${last.getDate()}（${dates.length}日間）`;
  }

  const datesInfo = document.getElementById('modal-dates-info');
  if (dates.length > 1) {
    datesInfo.textContent = '対象: ' + dates.map(d => {
      const dt = new Date(d + 'T00:00:00');
      return `${dt.getDate()}日`;
    }).join(', ');
    datesInfo.style.display = 'block';
  } else {
    datesInfo.style.display = 'none';
  }

  const existing = dates.length === 1
    ? state.requests.find(r => r.staff_id === staffId && r.date === dates[0])
    : null;
  state.editingRequest = existing || null;

  if (existing) {
    document.querySelector(`input[name="request-type"][value="${existing.request_type}"]`).checked = true;
    document.getElementById('modal-note').value = existing.note || '';
    document.getElementById('modal-delete').style.display = 'inline-flex';
    
    // 変更履歴の生成
    const historyList = document.getElementById('modal-history-list');
    historyList.innerHTML = '';
    if (existing.created_at) {
      historyList.innerHTML += `<li>${formatDateTime(existing.created_at)} に登録</li>`;
    }
    if (existing.updated_at && existing.updated_at !== existing.created_at) {
      historyList.innerHTML += `<li>${formatDateTime(existing.updated_at)} に更新</li>`;
    }
    document.getElementById('modal-history').style.display = 'block';
  } else {
    document.querySelector('input[name="request-type"][value="off"]').checked = true;
    document.getElementById('modal-note').value = '';
    document.getElementById('modal-delete').style.display = 'none';
    document.getElementById('modal-history').style.display = 'none';
  }

  document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  state.editingDates = [];
  state.editingStaffId = null;
  state.editingRequest = null;
}

async function handleModalSave() {
  const staffId = document.getElementById('modal-staff-select').value;
  const type = document.querySelector('input[name="request-type"]:checked').value;
  const note = document.getElementById('modal-note').value.trim();

  if (type === 'other' && !note) {
    alert('「その他」の場合は備考を入力してください');
    return;
  }

  if (state.editingRequest) {
    const { error } = await supabase
      .from('shift_requests')
      .update({ staff_id: staffId, request_type: type, note: note || null, updated_at: new Date().toISOString() })
      .eq('id', state.editingRequest.id);
    if (error) { console.error(error); alert('保存に失敗: ' + error.message); return; }
  } else {
    const newDates = state.editingDates.filter(d =>
      !state.requests.find(r => r.staff_id === staffId && r.date === d)
    );
    if (newDates.length === 0) {
      alert('選択した日付はすべて登録済みです');
      return;
    }
    const rows = newDates.map(d => ({
      staff_id: staffId, date: d, request_type: type,
      note: note || null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('shift_requests').insert(rows);
    if (error) { console.error(error); alert('登録に失敗: ' + error.message); return; }
  }

  closeModal();
  await loadRequests();
}

async function handleModalDelete() {
  if (!state.editingRequest) return;
  if (!confirm('この希望を削除しますか？')) return;

  const { error } = await supabase.from('shift_requests').delete().eq('id', state.editingRequest.id);
  if (error) { console.error(error); alert('削除に失敗'); return; }

  closeModal();
  await loadRequests();
}

function getLastDayOfMonth(year, month) {
  return formatDate(new Date(year, month + 1, 0));
}
function formatDate(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function formatDateTime(isoStr) {
  const dt = new Date(isoStr);
  return `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
