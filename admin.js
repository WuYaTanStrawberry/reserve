// 後台(GitHub Pages 版,呼叫 Cloudflare Worker)
// 防點擊劫持:後台不允許被別的網站嵌在 iframe 裡(meta CSP 沒辦法設 frame-ancestors)
if (window.top !== window.self) {
  document.documentElement.textContent = '此頁面不允許被嵌入其他網站。';
  throw new Error('framed');
}
const $ = (id) => document.getElementById(id);
// 存的是「登入憑證」不是密碼:就算手機被別人拿去看,也拿不到你的密碼,而且可以隨時登出作廢
let KEY = localStorage.getItem('adminKey') || '';
let uiReady = false;
let currentBookings = [];   // 目前畫面上的名單(供樂觀更新用)
let currentFeedback = [];   // 目前畫面上的回饋(同上)

function banner(el, type, msg) { el.innerHTML = msg ? `<p class="banner ${type}">${msg}</p>` : ''; }
const esc = (s) => escHtml(s);
function todayStr() { const t = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`; }
async function adminPost(action, extra, opts) { return gasPost(Object.assign({ action, key: KEY }, extra || {}), opts); }

// ---- 登入 / 進入 ----
async function login() {
  KEY = $('pw').value;                       // 密碼只在這一刻用一次,換到憑證後就丟掉
  banner($('loginBanner'), 'info', '登入中…');
  const r = await enterApp();
  $('pw').value = '';
  if (r.ok) banner($('loginBanner'), '', '');
  else { KEY = ''; banner($('loginBanner'), 'err', r.error || '密碼錯誤'); $('pw').focus(); }
}
function renderInit(data) {
  setupAdminUI();
  $('loginCard').hidden = true;
  $('app').hidden = false;
  applyConfig(data.config);
  renderWeeks(data.weeks);
  renderTodayStats(data.bookings);
  renderTomorrow(data.tomorrow);
  $('filterDate').value = data.today;
  renderBookings(data.bookings);
  loadCalendar(null, { silent: true });
  calAutoRefresh(true);
}
async function enterApp() {
  let cached = null;
  try { cached = JSON.parse(sessionStorage.getItem('adminInitCache') || 'null'); } catch (e) {}
  if (cached) renderInit(cached);
  const { ok, data } = await adminPost('adminInit', {}, { silent: !!cached, msg: '載入中…' });
  if (!ok) {
    if (cached) {
      sessionStorage.removeItem('adminInitCache');
      $('app').hidden = true;
      $('loginCard').hidden = false;
    }
    return { ok: false, error: data.error };
  }
  // 後端發了憑證就改用憑證,密碼不會被寫進瀏覽器
  if (data.sessionToken) { KEY = data.sessionToken; localStorage.setItem('adminKey', KEY); }
  delete data.sessionToken;
  sessionStorage.setItem('adminInitCache', JSON.stringify(data));
  renderInit(data);
  return { ok: true };
}
function setupAdminUI() {
  if (uiReady) return;
  uiReady = true;
  const t = new Date(); const pad = (n) => String(n).padStart(2, '0');
  $('nbDate').min = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  $('nbDate').addEventListener('change', loadNbAvailability);
  document.querySelectorAll('input[name=nbVehicle]').forEach((r) => r.addEventListener('change', updateNbVeh));
}

// ---- 今日 / 明日 ----
function renderTodayStats(list) {
  const cars = list.reduce((s, b) => s + (b.cars || 0), 0);
  const cin = list.filter((b) => b.status === 'checkedin').length;
  $('todayStats').innerHTML = `
    <div class="statcard"><div class="num">${list.length}</div><div class="lbl">今日預約</div></div>
    <div class="statcard ok"><div class="num">${cin}</div><div class="lbl">已報到</div></div>
    <div class="statcard"><div class="num">${list.length - cin}</div><div class="lbl">未報到</div></div>
    <div class="statcard"><div class="num">${cars}</div><div class="lbl">汽車</div></div>`;
}
function renderTomorrow(t) {
  if (!t || !t.total) { $('tomorrowStat').innerHTML = ''; return; }
  const wait = t.total - t.confirmed;
  $('tomorrowStat').innerHTML =
    `<p class="banner ${wait > 0 ? 'warn' : 'ok'}">📅 明日(${esc(t.date)} 星期${esc(t.weekday)})${t.total} 筆・已確認 ${t.confirmed}・待確認 ${wait}</p>`;
}
async function loadTodayStats() {
  const { ok, data } = await adminPost('bookings', { date: todayStr() }, { silent: true });
  if (ok) renderTodayStats(data.bookings || []);
}

// ---- 分頁 ----
document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab').forEach((t) => (t.hidden = true));
    $('tab-' + btn.dataset.tab).hidden = false;
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (btn.dataset.tab === 'calendar') { loadCalendar(); calAutoRefresh(true); } else calAutoRefresh(false);
    if (btn.dataset.tab === 'waitlist') loadWaitlistAdmin();
    if (btn.dataset.tab === 'feedback') loadFeedbackAdmin();
  });
});

// ---- 週曆總覽(取代「客人取消要通知我」:自己一眼看完整週) ----
let calMonday = null;        // 目前顯示的那一週(週一)
let calData = null;
let calTimer = null;
let calPickedCell = null;

function mondayOfLocal(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const w = d.getDay();
  d.setDate(d.getDate() + (w === 0 ? -6 : 1 - w));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function shiftDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const mmdd = (s) => s.slice(5).replace('-', '/');

async function loadCalendar(monday, opts) {
  calMonday = monday || calMonday || mondayOfLocal(todayStr());
  const { ok, data } = await adminPost('weekView', { date: calMonday }, opts || { msg: '載入週曆…' });
  if (!ok) { banner($('calBanner'), 'err', esc(data.error || '載入失敗')); return; }
  calData = data;
  renderCalendar(data);
}
function renderCalendar(d) {
  $('calRange').textContent = `${mmdd(d.monday)} – ${mmdd(d.sunday)}`;
  banner($('calBanner'), d.open ? '' : 'warn', d.open ? '' : '這一週<b>尚未開放</b>客人預約(你仍可從「新增預約」手動登記)');

  // 每格佔用台數
  const used = {};
  d.bookings.forEach((b) => {
    if (b.vehicle !== 'car') return;
    used[b.date + '|' + b.hour] = (used[b.date + '|' + b.hour] || 0) + (b.cars || 0);
  });
  const motos = {};
  d.bookings.forEach((b) => {
    if (b.vehicle === 'car') return;
    motos[b.date + '|' + b.hour] = (motos[b.date + '|' + b.hour] || 0) + 1;
  });

  const cap = d.capacity || 9;
  let html = '<div class="cal-row cal-head"><div class="cal-time"></div>'
    + d.days.map((x) => `<div class="cal-day${x.isToday ? ' is-today' : ''}${x.past ? ' is-past' : ''}">
        <b>${esc(x.weekday)}</b><span>${mmdd(x.date)}</span></div>`).join('')
    + '</div>';

  d.hours.forEach((h) => {
    html += `<div class="cal-row"><div class="cal-time">${String(h).padStart(2, '0')}</div>`;
    d.days.forEach((x) => {
      const key = x.date + '|' + h;
      const n = used[key] || 0;
      const m = motos[key] || 0;
      if (x.closed) { html += '<div class="cal-cell is-closed" title="公休">—</div>'; return; }
      const lv = n <= 0 ? 0 : (n >= cap ? 3 : (n >= cap * 0.7 ? 2 : 1));
      // 只有機車的時段不佔車位,顯示 0 會被誤讀成「沒人」——留空白讓 🏍 自己說話
      const label = n >= cap ? '滿' : (n > 0 ? String(n) : (m > 0 ? '' : '·'));
      html += `<button type="button" class="cal-cell lv${lv}${x.past ? ' is-past' : ''}"
        data-cell="${esc(key)}" aria-label="${esc(x.date)} ${h}點,汽車 ${n} 台${m ? `,機車 ${m}` : ''}">
        ${label}${m ? '<i class="moto">🏍</i>' : ''}</button>`;
    });
    html += '</div>';
  });
  $('calGrid').innerHTML = html;
  document.querySelectorAll('[data-cell]').forEach((c) =>
    c.addEventListener('click', () => showCell(c.dataset.cell)));
  if (calPickedCell) showCell(calPickedCell, true);
}
function showCell(key, keepScroll) {
  calPickedCell = key;
  document.querySelectorAll('[data-cell]').forEach((c) => c.classList.toggle('picked', c.dataset.cell === key));
  const [date, hourStr] = key.split('|');
  const hour = Number(hourStr);
  const list = (calData.bookings || []).filter((b) => b.date === date && b.hour === hour);
  const day = calData.days.find((x) => x.date === date) || {};
  const cars = list.filter((b) => b.vehicle === 'car').reduce((s, b) => s + (b.cars || 0), 0);
  const head = `<div class="cal-detail-head">${esc(date)}(${esc(day.weekday || '')})・${String(hour).padStart(2, '0')}:00
      <span class="stat">汽車 ${cars}/${calData.capacity} 台・${list.length} 組</span></div>`;
  $('calDetail').innerHTML = head + (list.length
    ? `<div class="blist">${list.map(bookingRow).join('')}</div>`
    : '<p class="note" style="text-align:center;padding:16px 0">這個時段還沒有人預約 🍓</p>');
  if (list.length) bindRowActions();
  if (!keepScroll) focusInto($('calDetail'), { block: 'nearest' });
}
// 「及時」:停在週曆分頁時每 45 秒靜默更新一次,離開分頁就停掉
function calAutoRefresh(on) {
  clearInterval(calTimer);
  calTimer = on ? setInterval(() => {
    if (document.hidden || $('tab-calendar').hidden) return;
    loadCalendar(calMonday, { silent: true });
  }, 45000) : null;
}

// ---- 預約名單(列卡,手機單手可用) ----
function bookingRow(b) {
  const done = b.status === 'checkedin';
  const veh = b.vehicle === 'car' ? `<span class="tag car">汽車 ×${b.cars}</span>` : '<span class="tag motor">機車</span>';
  const chips = (b.tags || '').split(/[,、\s]+/).filter(Boolean).map((t) => `<span class="ctag">${esc(t)}</span>`).join('');
  return `
  <div class="brow${done ? ' is-checkedin' : ''}" data-id="${esc(b.id)}">
    <div class="b-name">
      ${pickMode ? `<label class="pickbox"><input type="checkbox" data-pick="${esc(b.id)}"><span class="sr-only">選取 ${esc(b.name)} 的預約</span></label>` : ''}
      ${esc(b.name)}
      ${b.hasLine ? '<span class="visits" title="從 LINE 預約">📱</span>' : ''}
      ${b.confirmed ? '<span class="tag done">已回覆會到</span>' : ''}
      ${b.visits > 0 ? `<span class="visits">熟客 ${b.visits} 次</span>` : ''}
    </div>
    <div class="b-when">${esc(b.date)}(${esc(b.weekday)})・${esc(b.hourLabel)} ${veh}</div>
    <div class="b-act">
      <button class="btn-sm btn-checkin${done ? ' done' : ''}" data-ci="${esc(b.id)}" type="button">${done ? '✓ 已報到' : '報到'}</button>
    </div>
    <div class="b-foot">
      <a class="b-phone" href="tel:${esc(b.phone)}">📞 ${esc(b.phone)}</a>
      ${chips}
      ${b.note ? '<span class="visits" title="有備註">📝</span>' : ''}
      <span class="b-spacer"></span>
      <button class="btn-xs editc" type="button" data-phone="${esc(b.phone)}" data-name="${esc(b.name)}" data-tags="${esc(b.tags)}" data-note="${esc(b.note)}">✎ 標籤</button>
      <button class="btn-xs" data-del="${esc(b.id)}" type="button" style="color:var(--danger-ink);border-color:var(--danger-line)">取消預約</button>
    </div>
  </div>`;
}
function renderBookings(list) {
  currentBookings = list.slice();
  renderBookingStat();
  if (!list.length) {
    $('bookingList').innerHTML = '<p class="note" style="text-align:center;padding:24px 0">這個日期還沒有預約 🍓</p>';
    return;
  }
  $('bookingList').innerHTML = `<div class="blist">${list.map(bookingRow).join('')}</div>`;
  bindRowActions();
}
function bindRowActions() {
  document.querySelectorAll('.editc').forEach((btn) => btn.addEventListener('click', () =>
    openCustomerModal(btn.dataset.phone, btn.dataset.name, btn.dataset.tags, btn.dataset.note)));
  document.querySelectorAll('[data-ci]').forEach((btn) => btn.addEventListener('click', () => toggleCheckin(btn)));
  document.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', () => removeBooking(btn)));
  document.querySelectorAll('[data-pick]').forEach((cb) => cb.addEventListener('change', renderBulkBar));
}

// ---- 多選 + 批次取消(被灌假預約時一筆一筆按不完) ----
let pickMode = false;
const pickedIds = () => Array.from(document.querySelectorAll('[data-pick]:checked')).map((c) => c.dataset.pick);
function togglePickMode() {
  pickMode = !pickMode;
  $('pickBtn').textContent = pickMode ? '✕ 結束多選' : '☑️ 多選';
  $('bulkBar').hidden = !pickMode;
  renderBookings(currentBookings);
  renderBulkBar();
}
function renderBulkBar() {
  if (!pickMode) { $('bulkBar').hidden = true; return; }
  const n = pickedIds().length;
  $('bulkBar').hidden = false;
  $('bulkBar').innerHTML = `
    <div class="banner ${n ? 'warn' : 'info'}" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="flex:1;min-width:120px">已選 <b>${n}</b> 筆</span>
      <button class="btn-sm" id="pickAll" type="button">${n === currentBookings.length && n ? '全部取消選取' : '全選'}</button>
      <button class="btn-sm danger" id="bulkGo" type="button" ${n ? '' : 'disabled'}>取消選取的 ${n} 筆</button>
    </div>`;
  $('pickAll').addEventListener('click', () => {
    const all = pickedIds().length === currentBookings.length;
    document.querySelectorAll('[data-pick]').forEach((c) => { c.checked = !all; });
    renderBulkBar();
  });
  if (n) $('bulkGo').addEventListener('click', confirmBulkCancel);
}
function confirmBulkCancel() {
  const ids = pickedIds();
  $('bulkBar').innerHTML = `
    <div class="banner err" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="flex:1;min-width:150px">確定要取消這 <b>${ids.length}</b> 筆預約嗎?車位會立刻釋出,無法復原。</span>
      <button class="btn-sm" id="bulkNo" type="button">不要</button>
      <button class="btn-sm danger" id="bulkYes" type="button">確定取消 ${ids.length} 筆</button>
    </div>`;
  $('bulkNo').addEventListener('click', renderBulkBar);
  $('bulkYes').addEventListener('click', async () => {
    $('bulkYes').disabled = true;
    const res = await adminPost('bulkCancel', { ids }, { msg: `取消 ${ids.length} 筆…` });
    if (!res.ok) {
      $('bulkBar').innerHTML = `<p class="banner err">取消失敗:${esc(netMsg(res) || res.data.error || '後端沒有回應成功')}</p>`;
      return;
    }
    pickMode = false;
    $('pickBtn').textContent = '☑️ 多選';
    await loadBookings();
    loadWeeks(); loadTodayStats();
    $('bulkBar').hidden = false;
    $('bulkBar').innerHTML = `<p class="banner ok">已取消 ${res.data.cancelled} 筆 ✅</p>`;
    setTimeout(() => { $('bulkBar').hidden = true; }, 4000);
  });
}

// ---- 匯出名單 CSV(取代以前打開 Google 試算表看名單的習慣) ----
async function exportCsv() {
  const withCancelled = confirm('要一起匯出「已取消」的預約嗎?\n\n按「確定」= 全部都匯出\n按「取消」= 只匯出有效預約');
  const res = await adminPost('exportCsv', { all: withCancelled }, { msg: '整理名單…' });
  if (!res.ok) { banner($('bulkBar'), 'err', esc(netMsg(res) || res.data.error || '匯出失敗')); $('bulkBar').hidden = false; return; }
  const blob = new Blob([res.data.csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `舞夜天草莓園_預約名單_${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  $('bulkBar').hidden = false;
  $('bulkBar').innerHTML = `<p class="banner ok">已下載 ${res.data.rows} 筆 ✅ 用 Excel 或 Google 試算表打開即可</p>`;
  setTimeout(() => { $('bulkBar').hidden = true; }, 5000);
}
// 報到:先在畫面上立刻反映,再靜默同步(不再全螢幕鎖住)
async function toggleCheckin(btn) {
  const id = btn.dataset.ci;
  const b = currentBookings.find((x) => x.id === id);
  if (!b) return;
  const wasDone = b.status === 'checkedin';
  b.status = wasDone ? 'booked' : 'checkedin';
  const row = btn.closest('.brow');
  row.classList.toggle('is-checkedin', !wasDone);
  btn.classList.toggle('done', !wasDone);
  btn.textContent = wasDone ? '報到' : '✓ 已報到';
  renderTodayStats(currentBookings);

  const { ok } = await adminPost('checkin', { id }, { silent: true });
  if (!ok) {
    b.status = wasDone ? 'checkedin' : 'booked';
    row.classList.toggle('is-checkedin', wasDone);
    btn.classList.toggle('done', wasDone);
    btn.textContent = wasDone ? '✓ 已報到' : '報到';
    renderTodayStats(currentBookings);
    row.insertAdjacentHTML('beforeend', '<p class="banner err" style="grid-column:1/-1">報到沒有存成功,請再按一次</p>');
  }
}
async function removeBooking(btn) {
  const row = btn.closest('.brow');
  if (row.querySelector('.confirm-del')) return;
  row.insertAdjacentHTML('beforeend', `
    <div class="confirm-del banner err" style="grid-column:1/-1;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="flex:1;min-width:120px">確定取消?車位會立刻釋出</span>
      <button class="btn-sm" type="button" data-no="1">不要</button>
      <button class="btn-sm danger" type="button" data-yes="1">確定取消</button>
    </div>`);
  const panel = row.querySelector('.confirm-del');
  panel.querySelector('[data-no]').addEventListener('click', () => panel.remove());
  panel.querySelector('[data-yes]').addEventListener('click', async () => {
    const id = btn.dataset.del;
    const item = currentBookings.find((b) => b.id === id);
    const idx = currentBookings.indexOf(item);
    const marker = document.createComment('bk-' + id);
    row.parentNode.insertBefore(marker, row);
    row.remove();
    currentBookings = currentBookings.filter((b) => b.id !== id);
    renderTodayStats(currentBookings);
    renderBookingStat();
    if (!currentBookings.length) {
      $('bookingList').innerHTML = '<p class="note" style="text-align:center;padding:24px 0">這個日期還沒有預約 🍓</p>';
    }
    const resD = await adminPost('delete', { id }, { silent: true });
    const { ok, data } = resD;
    if (ok) { marker.remove(); loadWeeks(); return; }
    // 失敗:把列放回原位並保留說明
    if (!marker.parentNode) { loadBookings(); return; }
    panel.innerHTML = `<span>取消失敗:${esc(netMsg(resD) || data.error || '後端沒有回應成功')}</span>`;
    marker.parentNode.insertBefore(row, marker);
    marker.remove();
    if (item) { currentBookings.splice(idx < 0 ? 0 : idx, 0, item); renderTodayStats(currentBookings); renderBookingStat(); }
  });
}
function renderBookingStat() {
  const list = currentBookings;
  const carCount = list.reduce((s, b) => s + (b.cars || 0), 0);
  const motoCount = list.filter((b) => b.vehicle === 'motor').length;
  $('bookingStat').textContent = list.length ? `共 ${list.length} 筆・汽車 ${carCount} 台・機車 ${motoCount}` : '';
}
async function loadBookings() {
  const date = $('filterDate').value;
  const { ok, data } = await adminPost('bookings', date ? { date } : {}, { msg: '載入名單…' });
  if (ok) renderBookings(data.bookings || []);
}

// ---- 候補名單 ----
async function loadWaitlistAdmin() {
  const { ok, data } = await adminPost('waitlist', {}, { msg: '載入候補…' });
  if (!ok) return;
  const list = data.waitlist || [];
  if (!list.length) { $('waitlistList').innerHTML = '<p class="note" style="text-align:center;padding:24px 0">目前沒有候補 🍓</p>'; return; }
  $('waitlistList').innerHTML = `<div class="blist">${list.map((w) => `
    <div class="brow">
      <div class="b-name">${esc(w.name)}${w.hasLine ? '<span class="visits" title="從 LINE 預約">📱</span>' : ''}</div>
      <div class="b-when">${esc(w.date)}(${esc(w.weekday)})・${esc(w.hourLabel)} <span class="tag car">汽車 ×${w.cars}</span></div>
      <div class="b-act"><button class="btn-sm danger" data-wd="${esc(w.id)}" type="button">移除</button></div>
      <div class="b-foot"><a class="b-phone" href="tel:${esc(w.phone)}">📞 ${esc(w.phone)}</a></div>
    </div>`).join('')}</div>`;
  document.querySelectorAll('[data-wd]').forEach((btn) => btn.addEventListener('click', async () => {
    const row = btn.closest('.brow');
    const marker = document.createComment('wl');
    row.parentNode.insertBefore(marker, row);
    row.remove();                                   // 按下立刻消失
    const resW = await adminPost('waitlistDelete', { id: btn.dataset.wd }, { silent: true });
    const { ok, data } = resW;
    if (ok) { marker.remove(); return; }
    if (marker.parentNode) marker.parentNode.insertBefore(row, marker);
    marker.remove();
    row.insertAdjacentHTML('beforeend',
      `<p class="banner err" style="grid-column:1/-1">移除失敗:${esc(netMsg(resW) || data.error || '後端沒有回應成功')}</p>`);
  }));
}

// ---- 顧客回饋 ----
async function loadFeedbackAdmin() {
  const { ok, data } = await adminPost('feedback', {}, { msg: '載入回饋…' });
  if (!ok) return;
  const list = data.feedback || [];
  currentFeedback = list.slice();
  renderFeedbackStat();
  if (!list.length) { $('feedbackList').innerHTML = '<p class="note" style="text-align:center;padding:24px 0">目前沒有回饋 🍓</p>'; return; }
  $('feedbackList').innerHTML = list.map((f) => {
    const stars = '★'.repeat(f.rating) + '☆'.repeat(5 - f.rating);
    const low = f.rating <= 2;
    return `<div class="fb-row${low ? ' lowscore' : ''}">
      <div class="fb-stars">${stars}${low ? ' <span class="tag" style="background:var(--danger-bg);color:var(--danger-ink)">需要關心</span>' : ''}</div>
      <div class="fb-meta">${esc(f.name)}${f.hasLine ? ' 📱' : ''}・${esc(f.date)}(星期${esc(f.weekday)})</div>
      ${f.comment ? `<div class="fb-comment">${esc(f.comment)}</div>` : '<div class="fb-comment muted">(未留言)</div>'}
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
        <a class="b-phone" href="tel:${esc(f.phone)}">📞 ${esc(f.phone)}</a>
        <span class="b-spacer"></span>
        <button class="btn-xs" data-fb="${esc(f.id)}" type="button">刪除</button>
      </div>
    </div>`;
  }).join('');
  document.querySelectorAll('[data-fb]').forEach((btn) => btn.addEventListener('click', () => confirmDeleteFeedback(btn)));
}

// 刪除回饋:二次確認 → 按下立刻消失,同步在背景做;失敗才把列還原並說明原因
function confirmDeleteFeedback(btn) {
  const row = btn.closest('.fb-row');
  if (row.querySelector('.confirm-del')) return;
  row.insertAdjacentHTML('beforeend', `
    <div class="confirm-del banner err" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="flex:1;min-width:120px">確定刪除這則回饋?刪了就找不回來</span>
      <button class="btn-sm" type="button" data-no="1">不要</button>
      <button class="btn-sm danger" type="button" data-yes="1">確定刪除</button>
    </div>`);
  const panel = row.querySelector('.confirm-del');
  panel.querySelector('[data-no]').addEventListener('click', () => panel.remove());
  panel.querySelector('[data-yes]').addEventListener('click', async () => {
    const id = btn.dataset.fb;
    const item = currentFeedback.find((f) => f.id === id);
    const idx = currentFeedback.indexOf(item);
    const marker = document.createComment('fb-' + id);   // 記住位置,萬一要還原
    row.parentNode.insertBefore(marker, row);
    row.remove();
    currentFeedback = currentFeedback.filter((f) => f.id !== id);
    renderFeedbackStat();
    if (!currentFeedback.length) {
      $('feedbackList').innerHTML = '<p class="note" style="text-align:center;padding:24px 0">目前沒有回饋 🍓</p>';
    }

    const resFb = await adminPost('feedbackDelete', { id }, { silent: true });
    const { ok, data } = resFb;
    if (ok) { marker.remove(); return; }
    // 失敗:把列放回原位並保留說明(不重新載入,否則訊息會被洗掉)
    if (!marker.parentNode) { loadFeedbackAdmin(); return; }
    panel.innerHTML = `<span>刪除失敗:${esc(netMsg(resFb) || data.error || '後端沒有回應成功')}</span>`;
    marker.parentNode.insertBefore(row, marker);
    marker.remove();
    if (item) { currentFeedback.splice(idx < 0 ? 0 : idx, 0, item); renderFeedbackStat(); }
  });
}
function renderFeedbackStat() {
  const n = currentFeedback.length;
  const avg = n ? Math.round(currentFeedback.reduce((s, f) => s + (f.rating || 0), 0) / n * 10) / 10 : 0;
  $('feedbackStat').textContent = n ? `共 ${n} 則・平均 ${avg} 星` : '';
}

// ---- 新增預約 ----
function updateNbVeh() {
  const isCar = document.querySelector('input[name=nbVehicle]:checked').value === 'car';
  $('nbQtyWrap').hidden = !isCar;
}
function buildNewBookingForm(cfg) {
  const pad = (n) => String(n).padStart(2, '0');
  let h = '';
  for (let x = cfg.openHour; x < cfg.closeHour; x++) h += `<option value="${x}">${pad(x)}:00-${pad(x + 1)}:00</option>`;
  $('nbHour').innerHTML = h;
  let c = '';
  for (let i = 1; i <= cfg.capacity; i++) c += `<option value="${i}">${i} 台</option>`;
  $('nbCars').innerHTML = c;
}
async function loadNbAvailability() {
  const date = $('nbDate').value;
  if (!date) return;
  const resA = await gasGet({ action: 'availability', date }, { msg: '查空位…' });
  const { data } = resA;
  if (resA.offline || resA.badResponse) { banner($('nbAvail'), 'err', netMsg(resA, '查詢')); return; }
  if (data.error) { banner($('nbAvail'), 'err', esc(data.error)); return; }
  const hints = [];
  if (data.closedWeekday) hints.push('公休日(手動仍可登記)');
  else if (!data.open) hints.push('該週未開放(手動仍可登記)');
  const arrivalStyle = !data.timeLimited;
  // 後台可為現場客補登今天已過的時段,但標示出來避免誤選
  $('nbHour').innerHTML = data.slots.map((s) =>
    `<option value="${s.hour}">${arrivalStyle ? String(s.hour).padStart(2, '0') + ':00 到達' : s.label}(${s.past ? '已過' : (s.full ? '已滿' : '剩 ' + s.left + ' 位')})</option>`).join('');
  const total = data.slots.filter((s) => !s.past).reduce((sum, s) => sum + s.left, 0);
  banner($('nbAvail'), total > 0 ? 'ok' : 'warn',
    `${esc(data.date)}(星期${esc(data.weekday)})${data.timeLimited ? '・假日一小時制' : '・平日不限時'}・全日剩 <b>${total}</b> 位${hints.length ? '・' + hints.join('') : ''}`);
}
async function newBooking() {
  const date = $('nbDate').value;
  const hour = $('nbHour').value;
  const vehicle = document.querySelector('input[name=nbVehicle]:checked').value;
  const cars = vehicle === 'car' ? Number($('nbCars').value || 1) : 0;
  const name = $('nbName').value.trim();
  const phone = $('nbPhone').value.trim();
  if (!date) { banner($('nbBanner'), 'err', '請選擇日期'); return; }
  if (!name) { banner($('nbBanner'), 'err', '請填寫姓名'); return; }
  if (!phone) { banner($('nbBanner'), 'err', '請填寫電話'); return; }
  const phoneDigits = phone.replace(/\D/g, '');
  if (!/^0\d{9}$/.test(phoneDigits)) {
    banner($('nbBanner'), 'err', `電話要 10 碼(例:0912345678),目前是 ${phoneDigits.length} 碼`);
    $('nbPhone').focus(); return;
  }
  const btn = $('nbSubmit'); btn.disabled = true;
  const { ok, data } = await adminPost('adminBook', { date, hour, vehicle, cars, name, phone: phoneDigits }, { msg: '新增中…' });
  btn.disabled = false;
  if (!ok) { banner($('nbBanner'), 'err', esc(data.error || '新增失敗')); return; }
  banner($('nbBanner'), 'ok', `已新增 ${esc(name)} 的預約 ✅${data.notified ? ',確認通知已發到你的 LINE 📱' : ''}`);
  $('nbName').value = ''; $('nbPhone').value = '';
  loadBookings(); loadWeeks(); loadTodayStats(); loadNbAvailability();
  setTimeout(() => banner($('nbBanner'), '', ''), 4000);
}

// ---- 開放週次 ----
function renderWeeks(weeks) {
  $('weekList').innerHTML = weeks.map((w) => `
    <div class="week-row${w.open ? ' is-open' : ''}">
      <div>
        <strong>${esc(w.monday)} ~ ${esc(w.sunday)}</strong>
        <div class="stat">該週預約 ${w.bookingCount} 筆</div>
      </div>
      <label class="switch">
        <span class="sr-only">開放 ${esc(w.monday)} 那一週</span>
        <input type="checkbox" data-week="${esc(w.weekKey)}" ${w.open ? 'checked' : ''}>
        <span class="track"></span>
      </label>
    </div>`).join('');
  document.querySelectorAll('[data-week]').forEach((cb) => cb.addEventListener('change', async () => {
    const row = cb.closest('.week-row');
    cb.disabled = true;
    const { ok } = await adminPost('setWeek', { weekKey: cb.dataset.week, open: cb.checked }, { silent: true });
    cb.disabled = false;
    if (!ok) {
      cb.checked = !cb.checked;
      row.insertAdjacentHTML('beforeend', '<p class="banner err" style="width:100%">沒有存成功,請再試一次</p>');
      return;
    }
    row.classList.toggle('is-open', cb.checked);
    row.classList.add('saved');
    setTimeout(() => row.classList.remove('saved'), 600);
  }));
}
async function loadWeeks() {
  const { ok, data } = await adminPost('weeks', { weeks: 10 }, { silent: true });
  if (ok) renderWeeks(data.weeks);
}

// ---- 顧客標籤 ----
let custPhone = '';
let lastFocus = null;
function openCustomerModal(phone, name, tags, note) {
  custPhone = phone;
  lastFocus = document.activeElement;
  $('custWho').textContent = `${name}・${phone}`;
  $('custTags').value = tags || '';
  $('custNote').value = note || '';
  banner($('custBanner'), '', '');
  $('custModal').hidden = false;
  setTimeout(() => $('custTags').focus(), 50);
}
function closeCustomerModal() {
  $('custModal').hidden = true;
  if (lastFocus) try { lastFocus.focus(); } catch (e) {}
}
async function saveCustomer() {
  const { ok, data } = await adminPost('setCustomer',
    { phone: custPhone, tags: $('custTags').value.trim(), note: $('custNote').value.trim() }, { msg: '儲存中…' });
  if (!ok) { banner($('custBanner'), 'err', esc(data.error || '儲存失敗')); return; }
  closeCustomerModal();
  loadBookings();
}

// ---- 受眾匯出 ----
function downloadText(name, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function genAudience() {
  const extra = {};
  if ($('audFrom').value) extra.from = $('audFrom').value;
  if ($('audTo').value) extra.to = $('audTo').value;
  if ($('audTag').value.trim()) extra.tag = $('audTag').value.trim();
  const { ok, data } = await adminPost('audience', extra, { msg: '產生名單…' });
  if (!ok) { banner($('audResult'), 'err', esc(data.error || '產生失敗')); return; }
  if (!data.count) {
    banner($('audResult'), 'warn', `這個範圍沒有「已報到且從 LINE 預約」的客人(已報到共 ${data.checkedinTotal} 筆,但都沒有 LINE 身分)。`);
    return;
  }
  const txt = data.userIds.join('\n');
  $('audResult').innerHTML = `
    <p class="banner ok">可推播名單:<b>${data.count}</b> 人(此範圍已報到共 ${data.checkedinTotal} 筆)</p>
    <button class="primary" id="audDl" type="button">⬇️ 下載 userId.txt</button>
    <p class="note">下載後到 LINE 官方帳號後台 →「受眾」→ 新增受眾 →「用戶 ID 上傳」上傳這個檔即可。注意:LINE 規定受眾需累積到一定人數才能群發。</p>`;
  $('audDl').addEventListener('click', () => downloadText('audience_checkedin.txt', txt));
}

// ---- 設定 ----
const WD = ['日', '一', '二', '三', '四', '五', '六'];
function renderClosedWeekdays(sel) {
  $('cfgClosed').innerHTML = WD.map((w, i) =>
    `<label class="wd"><input type="checkbox" value="${i}" ${sel.includes(i) ? 'checked' : ''}>星期${w}</label>`).join('');
}
function readClosedWeekdays() { return Array.from($('cfgClosed').querySelectorAll('input:checked')).map((c) => Number(c.value)); }

function applyConfig(data) {
  $('cfgCapacity').value = data.capacity;
  $('cfgOpen').value = data.openHour;
  $('cfgClose').value = data.closeHour;
  $('cfgReminder').value = data.reminderHour;
  $('cfgReviewUrl').value = data.reviewUrl || '';
  $('cfgHolidays').value = (data.holidays || []).join('\n');
  renderClosedWeekdays(data.closedWeekdays || []);
  $('lineEnabled').checked = !!data.line.enabled;
  $('lineUrl').value = data.line.publicBaseUrl || '';
  $('lineLiff').value = data.line.liffId || '';
  $('lineOwner').value = data.line.ownerUserId || '';
  $('lineToken').placeholder = data.line.hasToken ? '已設定(留空表示不變更)' : '留空表示不變更';
  $('lineSecret').placeholder = data.line.hasChannelSecret ? '已設定(留空表示不變更)' : '留空表示不變更';
  $('secretWarn').hidden = !!data.line.hasChannelSecret;
  const tsReady = !!(data.line.turnstileSiteKey && data.line.hasTurnstileSecret);
  $('tsSite').value = data.line.turnstileSiteKey || '';
  $('tsSecret').placeholder = data.line.hasTurnstileSecret ? '已設定(留空表示不變更)' : '留空表示不變更';
  $('tsOn').hidden = !tsReady;
  $('tsWarn').hidden = tsReady;
  buildNewBookingForm(data);
}
async function loadConfig() {
  const { ok, data } = await adminPost('getConfig', {}, { silent: true });
  if (ok) applyConfig(data);
}
async function saveConfig() {
  const body = {
    capacity: $('cfgCapacity').value, openHour: $('cfgOpen').value, closeHour: $('cfgClose').value,
    reminderHour: $('cfgReminder').value, reviewUrl: $('cfgReviewUrl').value,
    holidays: $('cfgHolidays').value.split(/\s+/).map((s) => s.trim()).filter(Boolean),
    closedWeekdays: readClosedWeekdays(),
  };
  const np = $('cfgPw').value.trim();
  if (np) {
    const cur = $('cfgPwCur').value;
    if (!cur) { banner($('cfgBanner'), 'err', '要變更密碼,請先在「目前密碼」欄填入現在的密碼'); $('cfgPwCur').focus(); return; }
    body.newPassword = np;
    body.currentPassword = cur;
  }
  const { ok, data } = await adminPost('setConfig', body, { msg: '儲存中…' });
  if (ok) {
    // 改密碼會把所有裝置踢出去,後端順手發新憑證給「這一台」
    if (np) {
      $('cfgPw').value = ''; $('cfgPwCur').value = '';
      if (data.sessionToken) { KEY = data.sessionToken; localStorage.setItem('adminKey', KEY); }
    }
    banner($('cfgBanner'), 'ok', np ? '已儲存 ✅ 其他裝置需要用新密碼重新登入' : '已儲存 ✅'); loadConfig();
    setTimeout(() => banner($('cfgBanner'), '', ''), 3500);
  } else banner($('cfgBanner'), 'err', esc(data.error || '儲存失敗'));
}
async function saveLine() {
  const line = {
    enabled: $('lineEnabled').checked, publicBaseUrl: $('lineUrl').value.trim(),
    liffId: $('lineLiff').value.trim(), ownerUserId: $('lineOwner').value.trim(),
  };
  const tok = $('lineToken').value.trim();
  if (tok) line.channelAccessToken = tok;
  const sec = $('lineSecret').value.trim();
  if (sec) line.channelSecret = sec;
  const { ok, data } = await adminPost('setConfig', { line }, { msg: '儲存中…' });
  if (ok) {
    $('lineToken').value = ''; $('lineSecret').value = '';
    banner($('lineBanner'), 'ok', '已儲存 LINE 設定 ✅'); loadConfig();
    setTimeout(() => banner($('lineBanner'), '', ''), 2500);
  } else banner($('lineBanner'), 'err', esc(data.error || '儲存失敗'));
}
// ---- 人機驗證 Turnstile ----
async function saveTurnstile() {
  const siteKey = $('tsSite').value.trim();
  const secret = $('tsSecret').value.trim();
  if (!siteKey) { banner($('tsBanner'), 'err', '請填入網站金鑰 Site Key'); return; }
  const { ok, data } = await adminPost('setConfig', { turnstile: { siteKey, secret } }, { msg: '儲存中…' });
  if (!ok) { banner($('tsBanner'), 'err', esc(data.error || '儲存失敗')); return; }
  $('tsSecret').value = '';
  banner($('tsBanner'), 'ok', '已儲存 ✅ 請務必從 LINE 實際訂一筆確認');
  loadConfig();
  setTimeout(() => banner($('tsBanner'), '', ''), 5000);
}
async function clearTurnstile() {
  const { ok, data } = await adminPost('setConfig', { turnstile: { clear: true } }, { msg: '停用中…' });
  if (!ok) { banner($('tsBanner'), 'err', esc(data.error || '停用失敗')); return; }
  $('tsSite').value = ''; $('tsSecret').value = '';
  banner($('tsBanner'), 'ok', '已停用人機驗證');
  loadConfig();
}

async function testLine() {
  const userId = $('testUid').value.trim();
  if (!userId) { banner($('testBanner'), 'err', '請填入你的 LINE userId'); return; }
  const btn = $('testLine'); btn.disabled = true;
  const { ok, data } = await adminPost('testLine', { userId }, { msg: '發送中…' });
  btn.disabled = false;
  banner($('testBanner'), ok ? 'ok' : 'err', ok ? '已送出!請看你的 LINE 📱' : esc(data.error || '發送失敗'));
}

// ---- 事件 ----
$('loginForm').addEventListener('submit', (e) => { e.preventDefault(); login(); });
$('filterDate').addEventListener('change', loadBookings);
$('todayBtn').addEventListener('click', () => { $('filterDate').value = todayStr(); loadBookings(); });
$('clearFilter').addEventListener('click', () => { $('filterDate').value = ''; loadBookings(); });
$('refreshBtn').addEventListener('click', () => { loadBookings(); loadTodayStats(); });
$('exportBtn').addEventListener('click', exportCsv);
$('calPrev').addEventListener('click', () => loadCalendar(shiftDays(calMonday, -7)));
$('calNext').addEventListener('click', () => loadCalendar(shiftDays(calMonday, 7)));
$('calToday').addEventListener('click', () => loadCalendar(mondayOfLocal(todayStr())));
$('pickBtn').addEventListener('click', togglePickMode);
$('saveCfg').addEventListener('click', saveConfig);
$('saveLine').addEventListener('click', saveLine);
$('testLine').addEventListener('click', testLine);
$('saveTs').addEventListener('click', saveTurnstile);
$('clearTs').addEventListener('click', clearTurnstile);
$('nbSubmit').addEventListener('click', newBooking);
$('audGen').addEventListener('click', genAudience);
$('custSave').addEventListener('click', saveCustomer);
$('custCancel').addEventListener('click', closeCustomerModal);
$('custModal').addEventListener('click', (e) => { if (e.target.id === 'custModal') closeCustomerModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('custModal').hidden) closeCustomerModal(); });
$('logout').addEventListener('click', async (e) => {
  e.preventDefault();
  await adminPost('logout', {}, { silent: true });   // 讓這張憑證在後端立刻失效
  localStorage.removeItem('adminKey'); sessionStorage.removeItem('adminInitCache');
  location.reload();
});

if (KEY) enterApp();
