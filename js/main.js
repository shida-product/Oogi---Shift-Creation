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
// スタッフカラーパレット（個人別色分け・カレンダー表示用）
// ============================================================
const STAFF_COLOR_PALETTE = [
  { bg: '#e0e7ff', text: '#4338ca' }, // indigo
  { bg: '#d1fae5', text: '#059669' }, // emerald
  { bg: '#fee2e2', text: '#dc2626' }, // rose
  { bg: '#fef3c7', text: '#d97706' }, // amber
  { bg: '#e0f2fe', text: '#0284c7' }, // sky
  { bg: '#ede9fe', text: '#7c3aed' }, // violet
  { bg: '#fce7f3', text: '#db2777' }, // pink
  { bg: '#ffedd5', text: '#ea580c' }, // orange
  { bg: '#cffafe', text: '#0e7490' }, // cyan
  { bg: '#ecfccb', text: '#4d7c0f' }, // lime
];

const STAFF_SPECIFIC_COLORS = {
  '村上': '#E73B3B',
  '信太': '#212121',
  '小野': '#F35F8C',
  '徳永': '#2ECC87',
  '木庭': '#47B2F7',
  '中村': '#FDC02D',
  '諫早': '#948078',
  '本庄': '#B38BDC'
};

function getStaffColor(staffId) {
  const staff = state.staffList.find(s => s.id === staffId);
  if (staff) {
    for (const [key, hex] of Object.entries(STAFF_SPECIFIC_COLORS)) {
      if (staff.name.includes(key)) {
        // バックグラウンドに指定色を使用し、文字色は白に統一
        return { bg: hex, text: '#ffffff' };
      }
    }
  }
  const idx = state.staffList.findIndex(s => s.id === staffId);
  return STAFF_COLOR_PALETTE[Math.max(0, idx) % STAFF_COLOR_PALETTE.length];
}

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

    let dates = dragCells.map(c => c.dataset.date);
    const staffId = dragStaffId;
    
    // 単回クリック時に、クリック要素がロングバーの一部の場合、同じグループ全体を選択する
    if (dragCells.length === 1) {
      const marker = dragCells[0].querySelector('.marker');
      if (marker) {
        dates = getGroupDates(staffId, dates[0]);
      }
    }
    
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
}

async function loadRequests() {
  // カレンダー表示時に月跨ぎのデータ（前月の余白や角丸の繋ぎ目判定）を正しく行うため、
  // 当月だけでなく前後1ヶ月分（合計3ヶ月分）をまとめて取得する
  const startDateObj = new Date(state.currentYear, state.currentMonth - 1, 1);
  const endDateObj = new Date(state.currentYear, state.currentMonth + 2, 0);
  const startDate = formatDate(startDateObj);
  const endDate = formatDate(endDateObj);

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
    // 1ヶ月分の予定を配列化して連続判定を行いやすくする
    const staffReqs = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      staffReqs.push({
        dateStr,
        req: state.requests.find(r => r.staff_id === staff.id && r.date === dateStr)
      });
    }

    let currentGroupId = null;
    let currentType = null;
    let currentNote = null;

    for (let d = 0; d < daysInMonth; d++) {
      const { dateStr, req } = staffReqs[d];
      let isBarStart = false, isBarMiddle = false, isBarEnd = false;
      let groupId = null;

      if (req) {
        if (currentType === req.request_type && currentNote === req.note) {
          // 前日と同じリクエストが継続
        } else {
          // 新しいグループの開始
          currentGroupId = req.id || dateStr;
          currentType = req.request_type;
          currentNote = req.note;
        }
        groupId = currentGroupId;

        // 前後の予定を取得して連続性を判定
        const nextReq = staffReqs[d + 1]?.req;
        const hasNext = nextReq && nextReq.request_type === currentType && nextReq.note === currentNote;
        const prevReq = staffReqs[d - 1]?.req;
        const hasPrev = prevReq && prevReq.request_type === currentType && prevReq.note === currentNote;

        if (!hasPrev && hasNext) isBarStart = true;
        if (hasPrev && hasNext) isBarMiddle = true;
        if (hasPrev && !hasNext) isBarEnd = true;
      } else {
        currentGroupId = null;
        currentType = null;
        currentNote = null;
      }

      let cell = '';
      if (req) {
        let cls, label;
        switch (req.request_type) {
          case 'off': cls = 'marker--off'; label = '休'; break;
          case 'am': cls = 'marker--am'; label = 'AM'; break;
          case 'pm': cls = 'marker--pm'; label = 'PM'; break;
          case 'dispense': cls = 'marker--dispense'; label = '調'; break;
          case 'ringo': cls = 'marker--ringo'; label = 'り'; break;
          default: cls = 'marker--other'; label = '他'; break;
        }
        
        // ロングバー用のクラスとデータ属性
        let extraCls = '';
        if (isBarStart) extraCls = ' is-bar-start';
        else if (isBarMiddle) extraCls = ' is-bar-middle';
        else if (isBarEnd) extraCls = ' is-bar-end';

        cell = `<div class="marker ${cls}${extraCls}" data-group-id="${groupId}" title="${escapeHtml(req.note || '')}">${label}</div>`;
      }
      bodyHtml += `<td class="day-cell" data-staff="${staff.id}" data-date="${dateStr}">${cell}</td>`;
    }
    bodyHtml += '</tr>';
  });
  tbody.innerHTML = bodyHtml;
}

// ============================================================
// カレンダーレーン割り当て（Google Calendar 方式）
// 各スタッフの連続ブロックに「行番号(レーン)」を固定で割り当てる。
// 開始日が先のブロックから順にグリーディに最初の空きレーンを確保し、
// その期間中は常に同じ行に表示されることを保証する。
// ============================================================
function buildCalendarLanes() {
  // 1. スタッフ×連続日付のセグメントを抽出（タイプ問わず連続していれば1セグメント）
  const segments = [];
  state.staffList.forEach(staff => {
    const dates = state.requests
      .filter(r => r.staff_id === staff.id)
      .map(r => r.date)
      .sort();
    if (dates.length === 0) return;

    let seg = { staffId: staff.id, start: dates[0], end: dates[0] };
    for (let i = 1; i < dates.length; i++) {
      const next = new Date(seg.end + 'T00:00:00');
      next.setDate(next.getDate() + 1);
      if (formatDate(next) === dates[i]) {
        seg.end = dates[i]; // 連続している → セグメント延長
      } else {
        segments.push({ ...seg });
        seg = { staffId: staff.id, start: dates[i], end: dates[i] };
      }
    }
    segments.push(seg);
  });

  // 2. 開始日昇順、同日なら終了日が遅い（長い）方を優先
  segments.sort((a, b) => {
    if (a.start !== b.start) return a.start.localeCompare(b.start);
    return b.end.localeCompare(a.end);
  });


  // 3. 空いている一番上のレーンを割り当て（グリーディ）
  const lanes = []; // lanes[i] = そのレーンが空く日（最後に使われたendDate）
  const segmentLanes = new Map(); // `${staffId}_${start}` -> laneIndex
  segments.forEach(seg => {
    let assignedLane = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] < seg.start) {
        assignedLane = i;
        break;
      }
    }
    if (assignedLane === -1) {
      assignedLane = lanes.length; // 空きがなければ新しいレーンを追加
    }
    lanes[assignedLane] = seg.end;
    segmentLanes.set(`${seg.staffId}_${seg.start}`, assignedLane);
  });

  // 4. dateStr → staffId → laneIndex のマッピングに変換
  const dateLaneMap = new Map();
  segments.forEach(seg => {
    const lane = segmentLanes.get(`${seg.staffId}_${seg.start}`);
    const d = new Date(seg.start + 'T00:00:00');
    const endD = new Date(seg.end + 'T00:00:00');
    while (d <= endD) {
      const ds = formatDate(d);
      if (!dateLaneMap.has(ds)) dateLaneMap.set(ds, new Map());
      dateLaneMap.get(ds).set(seg.staffId, lane);
      d.setDate(d.getDate() + 1);
    }
  });

  return dateLaneMap;
}

// ============================================================
// カレンダー描画（スマホ）- Google Calendar 風
// ============================================================
function renderCalendar() {
  const wrapper = document.querySelector('.calendar-wrapper');
  if (!wrapper) return;

  const laneMap = buildCalendarLanes();

  // 月の日付リストを生成（カレンダーは前後の月の余白日も含む）
  const todayStr = formatDate(new Date());
  
  // 今月の1日
  const firstDay = new Date(state.currentYear, state.currentMonth, 1);
  const lastDay = new Date(state.currentYear, state.currentMonth + 1, 0);
  
  // 開始曜日分戻る（日曜始まりならgetDay()分戻る）
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - startDate.getDay());
  
  // 終了曜日分進む（合計6週=42日分確保）
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 41);

  const grid = document.querySelector('.calendar-grid');
  let html = `<div class="calendar-grid__header is-sunday">日</div>
              <div class="calendar-grid__header">月</div>
              <div class="calendar-grid__header">火</div>
              <div class="calendar-grid__header">水</div>
              <div class="calendar-grid__header">木</div>
              <div class="calendar-grid__header">金</div>
              <div class="calendar-grid__header is-saturday">土</div>`;

  let dt = new Date(startDate);
  while (dt <= endDate) {
    const dateStr = formatDate(dt);
    const m = dt.getMonth();
    const d = dt.getDate();
    const dow = dt.getDay();

    const isCurrentMonth = (m === state.currentMonth);
    const isHoliday = !!state.holidays[dateStr];

    const classes = ['calendar-grid__cell'];
    if (!isCurrentMonth) classes.push('is-empty');
    if (dow === 0) classes.push('is-sunday');
    if (dow === 6) classes.push('is-saturday');
    if (isHoliday) classes.push('is-holiday');

    // 該当日のレーン情報とリクエストを取得
    const dayLaneMap = laneMap.get(dateStr) || new Map();
    const dayReqs = state.requests.filter(r => r.date === dateStr);
    const maxLane = dayReqs.length > 0
      ? Math.max(...dayReqs.map(r => dayLaneMap.get(r.staff_id) ?? 0))
      : -1;

    let eventsHtml = '';
    const prevDateObj = new Date(dt); prevDateObj.setDate(prevDateObj.getDate() - 1);
    const prevDateStr = formatDate(prevDateObj);
    const nextDateObj = new Date(dt); nextDateObj.setDate(nextDateObj.getDate() + 1);
    const nextDateStr = formatDate(nextDateObj);

    // 最大レーン番号までループ（空きレーンにはスペーサーを入れる）
    for (let currentLane = 0; currentLane <= maxLane; currentLane++) {
      const reqsInThisLane = dayReqs.filter(r => (dayLaneMap.get(r.staff_id) ?? 0) === currentLane);
      
      if (reqsInThisLane.length === 0) {
        // 誰もいない場合は透明スペーサーを配置し、高さを潰さないように &nbsp; を入れる
        eventsHtml += '<span class="cal-evt cal-evt--spacer">&nbsp;</span>';
        continue;
      }

      // 同じ人・同じレーンに複数の希望（AM・PMなど）がある場合はすべて描画する
      reqsInThisLane.forEach(r => {
        const { bg, text } = getStaffColor(r.staff_id);
        const fullName = r.staff?.name || '?';
        const lastName = fullName.split(/[\s　]+/)[0];

        let typeLabel = '';
        if (r.request_type === 'am') typeLabel = ' AM可';
        else if (r.request_type === 'pm') typeLabel = ' PM可';
        else if (r.request_type === 'dispense') typeLabel = ' 調剤';
        else if (r.request_type === 'ringo') typeLabel = ' りんご';
        else if (r.request_type === 'other') typeLabel = ' その他';

        // 前後日と繋がっているか判定し、バーの角丸・表示を調整
        const prevReq = state.requests.find(pr => pr.staff_id === r.staff_id && pr.date === prevDateStr && pr.request_type === r.request_type && pr.note === r.note);
        const nextReq = state.requests.find(nr => nr.staff_id === r.staff_id && nr.date === nextDateStr && nr.request_type === r.request_type && nr.note === r.note);

        let extraCls = '';
        if (!prevReq && nextReq) extraCls = ' is-bar-start';
        else if (prevReq && nextReq) extraCls = ' is-bar-middle';
        else if (prevReq && !nextReq) extraCls = ' is-bar-end';

        eventsHtml += `<span class="cal-evt${extraCls}" style="background:${bg};color:${text};">${escapeHtml(lastName + typeLabel)}</span>`;
      });
    }

    html += `<div class="${classes.join(' ')}" data-date="${dateStr}">
      <div class="cal-date"><span class="cal-date__num${dateStr === todayStr ? ' cal-date__num--today' : ''}">${d}</span></div>
      <div class="cal-events">${eventsHtml}</div>
    </div>`;
    dt.setDate(dt.getDate() + 1);
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.calendar-grid__cell').forEach(cell => {
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
        case 'ringo':    type = 'りんご';  evtCls = 'cal-evt--ringo';    break;
        default:         type = 'その他';  evtCls = 'cal-evt--other';    break;
      }
      const note = r.note
        ? `<span class="day-detail__note">${escapeHtml(r.note)}</span>`
        : '';
      bodyHtml += `<li class="day-detail__item day-detail__item--tappable" data-staff-id="${r.staff_id}" data-date="${dateStr}">
        <span class="day-detail__name">${escapeHtml(r.staff?.name || '?')}</span>
        <span class="cal-evt ${evtCls}" style="padding:3px 10px;border-radius:var(--radius-full);flex-shrink:0;">${type}</span>
        <i data-lucide="chevron-right" class="day-detail__chevron"></i>
        ${note}
      </li>`;
    });
    bodyHtml += '</ul>';
  }

  // 新規登録ボタン（常に表示、スタッフ未選択時はモーダル内で選択）
  bodyHtml += `<button class="btn btn--primary btn--sm" style="width:100%;margin-top:14px;" id="bottom-sheet-add">
    <i data-lucide="plus" style="width:14px;height:14px;"></i> 新規登録
  </button>`;

  document.getElementById('bottom-sheet-body').innerHTML = bodyHtml;
  document.getElementById('bottom-sheet-overlay').classList.add('active');
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // 既存イベントタップ → 編集モーダル（グループ全体を渡す）
  document.querySelectorAll('.day-detail__item--tappable').forEach(item => {
    item.addEventListener('click', () => {
      closeBottomSheet();
      const groupDates = getGroupDates(item.dataset.staffId, item.dataset.date);
      openModal(item.dataset.staffId, groupDates);
    });
  });

  // 新規登録ボタン → 登録モーダル（選択中スタッフ or 先頭スタッフ）
  document.getElementById('bottom-sheet-add').addEventListener('click', () => {
    closeBottomSheet();
    openModal(state.selectedStaffId || state.staffList[0]?.id, [dateStr]);
  });
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
    const { text } = getStaffColor(s.id);
    return `<button class="staff-chip${isActive ? ' is-active' : ''}" data-staff-id="${s.id}"><span class="staff-chip__dot" style="background:${text};"></span>${escapeHtml(s.name)}</button>`;
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
    const fullName = r.staff?.name || '不明';
    const lastName = fullName.split(/[\s　]+/)[0];
    
    let typeLabel, itemCls;
    if (r.request_type === 'am') { typeLabel = 'AM可'; itemCls = 'other-list__item--am'; }
    else if (r.request_type === 'pm') { typeLabel = 'PM可'; itemCls = 'other-list__item--pm'; }
    else if (r.request_type === 'dispense') { typeLabel = '調剤'; itemCls = 'other-list__item--dispense'; }
    else if (r.request_type === 'ringo') { typeLabel = 'りんご'; itemCls = 'other-list__item--ringo'; }
    else { typeLabel = 'その他'; itemCls = 'other-list__item--other'; }

    const noteHtml = r.note ? `<span class="other-list__note">${escapeHtml(r.note)}</span>` : '';

    html += `<div class="other-list__item other-list__item--clickable ${itemCls}" data-staff-id="${r.staff_id}" data-date="${r.date}" data-type="${r.request_type}">
      <span class="other-list__date">${dateLabel}</span>
      <span class="other-list__staff">${escapeHtml(lastName)} ${typeLabel}</span>
      ${noteHtml}
      <i data-lucide="pencil" class="other-list__edit-icon"></i>
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // 各アイテム操作（クリックでモーダル、ホバーでハイライト）
  container.querySelectorAll('.other-list__item--clickable').forEach(item => {
    item.addEventListener('click', () => {
      const groupDates = getGroupDates(item.dataset.staffId, item.dataset.date);
      openModal(item.dataset.staffId, groupDates);
    });

    item.addEventListener('mouseenter', () => {
      const groupDates = getGroupDates(item.dataset.staffId, item.dataset.date);
      const reqType = item.dataset.type;
      groupDates.forEach(d => {
        const cell = document.querySelector(`.day-cell[data-staff="${item.dataset.staffId}"][data-date="${d}"]`);
        if (cell) cell.classList.add(`is-hover-${reqType}`);
      });
    });

    item.addEventListener('mouseleave', () => {
      const groupDates = getGroupDates(item.dataset.staffId, item.dataset.date);
      const reqType = item.dataset.type;
      groupDates.forEach(d => {
        const cell = document.querySelector(`.day-cell[data-staff="${item.dataset.staffId}"][data-date="${d}"]`);
        if (cell) cell.classList.remove(`is-hover-${reqType}`);
      });
    });
  });
}

// ============================================================
// モーダル操作
// ============================================================
function updateDispenseVisibility(staffId) {
  const staff = state.staffList.find(s => s.id === staffId);
  const labelDispense = document.getElementById('label-dispense');
  if (labelDispense) {
    if (staff && staff.name.includes('徳永')) {
      labelDispense.style.display = 'inline-flex';
    } else {
      labelDispense.style.display = 'none';
      const radio = document.querySelector('input[name="request-type"][value="dispense"]');
      if (radio && radio.checked) {
        document.querySelector('input[name="request-type"][value="off"]').checked = true;
      }
    }
  }
  const labelRingo = document.getElementById('label-ringo');
  if (labelRingo) {
    if (staff && staff.name.includes('村上')) {
      labelRingo.style.display = 'inline-flex';
    } else {
      labelRingo.style.display = 'none';
      const radioRingo = document.querySelector('input[name="request-type"][value="ringo"]');
      if (radioRingo && radioRingo.checked) {
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

  // 日付の初期値をセット
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];
  const startInput = document.getElementById('modal-date-start');
  const endInput = document.getElementById('modal-date-end');
  startInput.value = startDate;
  endInput.value = endDate;

  // 複数日でも先頭日付に既存データがあれば編集モード
  const existing = state.requests.find(r => r.staff_id === staffId && r.date === dates[0]);
  state.editingRequest = existing || null;

  if (existing) {
    startInput.disabled = false;
    endInput.disabled = false;
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
    startInput.disabled = false;
    endInput.disabled = false;
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

  const startStr = document.getElementById('modal-date-start').value;
  const endStr = document.getElementById('modal-date-end').value;
  
  if (!startStr || !endStr) {
    alert('対象日を選択してください');
    return;
  }
  if (startStr > endStr) {
    alert('終了日は開始日以降の日付を選択してください');
    return;
  }

  const targetDates = [];
  const currDt = new Date(startStr + 'T00:00:00');
  const endDt = new Date(endStr + 'T00:00:00');
  
  while (currDt <= endDt) {
    targetDates.push(formatDate(currDt));
    currDt.setDate(currDt.getDate() + 1);
  }

  const toUpdate = [];
  const toInsert = [];

  for (const d of targetDates) {
    const existingReq = state.requests.find(r => r.staff_id === staffId && r.date === d);
    if (existingReq) {
      toUpdate.push(existingReq);
    } else {
      toInsert.push(d);
    }
  }

  // UPDATE処理（既存レコードがある日は上書き）
  for (const req of toUpdate) {
    const { error } = await supabase.from('shift_requests')
      .update({ request_type: type, note: note || null, updated_at: new Date().toISOString() })
      .eq('id', req.id);
    if (error) { console.error(error); alert('更新に失敗: ' + error.message); return; }
  }

  // INSERT処理（無い日は新規追加）
  if (toInsert.length > 0) {
    const rows = toInsert.map(d => ({
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

  const staffId = document.getElementById('modal-staff-select').value;
  const startStr = document.getElementById('modal-date-start').value;
  const endStr = document.getElementById('modal-date-end').value;

  // 対象日付の配列を生成
  const deleteDates = [];
  const cur = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  while (cur <= end) { deleteDates.push(formatDate(cur)); cur.setDate(cur.getDate() + 1); }

  const deleteIds = state.requests
    .filter(r => r.staff_id === staffId && deleteDates.includes(r.date))
    .map(r => r.id);

  if (deleteIds.length === 0) return;

  const label = deleteDates.length === 1 ? 'この希望を削除しますか？' : `${deleteDates.length}日分の希望をまとめて削除しますか？`;
  if (!confirm(label)) return;

  const { error } = await supabase.from('shift_requests').delete().in('id', deleteIds);
  if (error) { console.error(error); alert('削除に失敗'); return; }

  closeModal();
  await loadRequests();
}

// ============================================================
// グループ日付抽出ヘルパー
// 指定スタッフ・日付から同一条件（種類＋備考）で連続する日付の配列を返す
// ============================================================
function getGroupDates(staffId, dateStr) {
  const anchor = state.requests.find(r => r.staff_id === staffId && r.date === dateStr);
  if (!anchor) return [dateStr];

  const dates = [dateStr];
  // 前方に探索
  let d = new Date(dateStr + 'T00:00:00');
  while (true) {
    d.setDate(d.getDate() - 1);
    const ds = formatDate(d);
    const r = state.requests.find(r => r.staff_id === staffId && r.date === ds);
    if (r && r.request_type === anchor.request_type && r.note === anchor.note) {
      dates.unshift(ds);
    } else break;
  }
  // 後方に探索
  d = new Date(dateStr + 'T00:00:00');
  while (true) {
    d.setDate(d.getDate() + 1);
    const ds = formatDate(d);
    const r = state.requests.find(r => r.staff_id === staffId && r.date === ds);
    if (r && r.request_type === anchor.request_type && r.note === anchor.note) {
      dates.push(ds);
    } else break;
  }
  return dates;
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
