// 後台(GitHub Pages 版,呼叫 Apps Script)
const $ = (id) => document.getElementById(id);
let KEY = localStorage.getItem('adminKey') || '';
let uiReady = false;

function banner(el, type, msg) { el.innerHTML = msg ? `<div class="banner ${type}">${msg}</div>` : ''; }
function todayStr() { const t = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`; }
async function adminPost(action, extra) { return gasPost(Object.assign({ action, key: KEY }, extra || {})); }

// ---- 登入 / 進入(只用一支 adminInit,加快速度)----
async function login() {
  KEY = $('pw').value;
  banner($('loginBanner'), 'warn', '登入中…');
  const r = await enterApp();
  if (r.ok) { localStorage.setItem('adminKey', KEY); banner($('loginBanner'), '', ''); }
  else { KEY = ''; banner($('loginBanner'), 'err', r.error || '密碼錯誤'); }
}
async function enterApp() {
  const { ok, data } = await adminPost('adminInit');
  if (!ok) return { ok: false, error: data.error };
  setupAdminUI();
  $('loginCard').style.display = 'none';
  $('app').style.display = 'block';
  applyConfig(data.config);
  renderWeeks(data.weeks);
  renderTodayStats(data.bookings);
  $('filterDate').value = data.today;
  renderBookings(data.bookings);
  return { ok: true };
}
function setupAdminUI() {
  if (uiReady) return;
  uiReady = true;
  const t = new Date(); const pad = (n) => String(n).padStart(2, '0');
  $('nbDate').min = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  document.querySelectorAll('input[name=nbVehicle]').forEach((r) => r.addEventListener('change', updateNbVeh));
}

// ---- 今日統計 ----
function renderTodayStats(list) {
  const cars = list.reduce((s, b) => s + (b.cars || 0), 0);
  const cin = list.filter((b) => b.status === 'checkedin').length;
  $('todayStats').innerHTML = `
    <div class="statcard"><div class="num">${list.length}</div><div class="lbl">今日預約</div></div>
    <div class="statcard ok"><div class="num">${cin}</div><div class="lbl">已報到</div></div>
    <div class="statcard"><div class="num">${list.length - cin}</div><div class="lbl">未報到</div></div>
    <div class="statcard"><div class="num">${cars}</div><div class="lbl">汽車總數</div></div>`;
}
async function loadTodayStats() {
  const { ok, data } = await adminPost('bookings', { date: todayStr() });
  if (ok) renderTodayStats(data.bookings || []);
}

function updateNbVeh() {
  const isCar = document.querySelector('input[name=nbVehicle]:checked').value === 'car';
  $('nbQtyWrap').style.display = isCar ? 'block' : 'none';
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
  const btn = $('nbSubmit'); btn.disabled = true;
  const { ok, data } = await adminPost('adminBook', { date, hour, vehicle, cars, name, phone });
  btn.disabled = false;
  if (!ok) { banner($('nbBanner'), 'err', data.error || '新增失敗'); return; }
  banner($('nbBanner'), 'ok', '已新增 ✅' + (data.notified ? ',確認通知已發到你的 LINE 📱' : ''));
  $('nbName').value = ''; $('nbPhone').value = '';
  loadBookings(); loadWeeks(); loadTodayStats();
  setTimeout(() => banner($('nbBanner'), '', ''), 3000);
}

// ---- 分頁 ----
document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab').forEach((t) => (t.style.display = 'none'));
    $('tab-' + btn.dataset.tab).style.display = 'block';
    if (btn.dataset.tab === 'waitlist') loadWaitlistAdmin();
    if (btn.dataset.tab === 'feedback') loadFeedbackAdmin();
  });
});

// ---- 顧客回饋 ----
async function loadFeedbackAdmin() {
  const { ok, data } = await adminPost('feedback');
  if (!ok) return;
  const list = data.feedback || [];
  $('feedbackStat').textContent = list.length ? `共 ${data.count} 則,平均 ${data.avg} 星` : '';
  if (!list.length) { $('feedbackList').innerHTML = '<p class="muted">目前沒有回饋</p>'; return; }
  $('feedbackList').innerHTML = list.map((f) => {
    const stars = '★'.repeat(f.rating) + '☆'.repeat(5 - f.rating);
    return `<div class="fb-row">
      <div class="fb-stars">${stars} <span class="fb-meta">${f.name}${f.hasLine ? ' 📱' : ''}・${f.date}(星期${f.weekday})・<a href="tel:${f.phone}">${f.phone}</a></span></div>
      ${f.comment ? `<div class="fb-comment">${f.comment.replace(/</g, '&lt;')}</div>` : '<div class="fb-comment muted">(未留言)</div>'}
      <button class="btn-sm danger" data-fb="${f.id}" style="margin-top:6px">刪除</button>
    </div>`;
  }).join('');
  document.querySelectorAll('[data-fb]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('刪除這則回饋?')) return;
    await adminPost('feedbackDelete', { id: btn.dataset.fb });
    loadFeedbackAdmin();
  }));
}

// ---- 候補名單 ----
async function loadWaitlistAdmin() {
  const { ok, data } = await adminPost('waitlist');
  if (!ok) return;
  const list = data.waitlist || [];
  if (!list.length) { $('waitlistList').innerHTML = '<p class="muted">目前沒有候補</p>'; return; }
  let html = `<table><thead><tr><th>日期</th><th>時段</th><th>姓名</th><th>電話</th><th>台數</th><th></th></tr></thead><tbody>`;
  list.forEach((w) => {
    html += `<tr>
      <td>${w.date}<br><span class="muted">星期${w.weekday}</span></td>
      <td>${w.hourLabel}</td>
      <td>${w.name}${w.hasLine ? ' 📱' : ''}</td>
      <td><a href="tel:${w.phone}">${w.phone}</a></td>
      <td>${w.cars}</td>
      <td><button class="btn-sm danger" data-wd="${w.id}">移除</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  $('waitlistList').innerHTML = html;
  document.querySelectorAll('[data-wd]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('移除這筆候補?')) return;
    await adminPost('waitlistDelete', { id: btn.dataset.wd });
    loadWaitlistAdmin();
  }));
}

// ---- 名單 ----
function renderBookings(list) {
  const carCount = list.reduce((s, b) => s + (b.cars || 0), 0);
  const motoCount = list.filter((b) => b.vehicle === 'motor').length;
  $('bookingStat').textContent = `共 ${list.length} 筆(汽車 ${carCount} 台、機車 ${motoCount})`;
  if (!list.length) { $('bookingList').innerHTML = '<p class="muted">目前沒有預約</p>'; return; }
  let html = `<table><thead><tr><th>日期</th><th>時段</th><th>姓名</th><th>電話</th><th>車輛</th><th>報到</th><th></th></tr></thead><tbody>`;
  list.forEach((b) => {
    const veh = b.vehicle === 'car' ? `<span class="tag car">汽車 ×${b.cars}</span>` : '<span class="tag motor">機車</span>';
    const done = b.status === 'checkedin';
    const line = b.hasLine ? ' 📱' : '';
    html += `<tr class="${done ? 'checkedin' : ''}">
      <td>${b.date}<br><span class="muted">星期${b.weekday}</span></td>
      <td>${b.hourLabel}</td>
      <td>${b.name}${line}</td>
      <td><a href="tel:${b.phone}">${b.phone}</a></td>
      <td>${veh}</td>
      <td><button class="btn-sm ${done ? 'ok' : ''}" data-ci="${b.id}">${done ? '✓ 已報到' : '報到'}</button></td>
      <td><button class="btn-sm danger" data-del="${b.id}">取消</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  $('bookingList').innerHTML = html;
  document.querySelectorAll('[data-ci]').forEach((btn) => btn.addEventListener('click', async () => { await adminPost('checkin', { id: btn.dataset.ci }); loadBookings(); loadTodayStats(); }));
  document.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('確定取消這筆預約?車位會立即釋出。')) return;
    await adminPost('delete', { id: btn.dataset.del }); loadBookings(); loadWeeks(); loadTodayStats();
  }));
}
async function loadBookings() {
  const date = $('filterDate').value;
  const { ok, data } = await adminPost('bookings', date ? { date } : {});
  if (ok) renderBookings(data.bookings || []);
}

// ---- 週次 ----
function renderWeeks(weeks) {
  let html = '';
  weeks.forEach((w) => {
    html += `<div class="week-row">
      <div><strong>${w.monday} ~ ${w.sunday}</strong><div class="stat">該週預約 ${w.bookingCount} 筆</div></div>
      <label class="switch"><input type="checkbox" data-week="${w.weekKey}" ${w.open ? 'checked' : ''}><span class="track"></span></label>
    </div>`;
  });
  $('weekList').innerHTML = html;
  document.querySelectorAll('[data-week]').forEach((cb) => cb.addEventListener('change', async () => { await adminPost('setWeek', { weekKey: cb.dataset.week, open: cb.checked }); }));
}
async function loadWeeks() {
  const { ok, data } = await adminPost('weeks', { weeks: 10 });
  if (ok) renderWeeks(data.weeks);
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
  const { ok, data } = await adminPost('audience', extra);
  if (!ok) { banner($('audResult'), 'err', data.error || '產生失敗'); return; }
  if (!data.count) {
    $('audResult').innerHTML = `<div class="banner warn">這個範圍內沒有「已報到且從 LINE 預約」的客人(已報到共 ${data.checkedinTotal} 筆,但都沒有 LINE 身分)。</div>`;
    return;
  }
  const txt = data.userIds.join('\n');
  $('audResult').innerHTML = `
    <div class="banner ok">可推播名單:${data.count} 人(此範圍已報到共 ${data.checkedinTotal} 筆)</div>
    <button class="primary" id="audDl">⬇️ 下載 userId.txt</button>
    <p class="note">下載後到 LINE 官方帳號後台 →「受眾」→ 新增受眾 →「用戶 ID 上傳」上傳這個檔即可。注意:LINE 規定受眾需累積到一定人數才能群發。</p>
    <textarea readonly style="width:100%;height:120px;margin-top:6px;border:1px solid var(--line);border-radius:10px;padding:10px">${txt}</textarea>`;
  $('audDl').addEventListener('click', () => downloadText('audience_checkedin.txt', txt));
}

// ---- 設定 ----
const WD = ['日', '一', '二', '三', '四', '五', '六'];
function renderClosedWeekdays(sel) {
  $('cfgClosed').innerHTML = WD.map((w, i) => `<label class="wd"><input type="checkbox" value="${i}" ${sel.includes(i) ? 'checked' : ''}>星期${w}</label>`).join('');
}
function readClosedWeekdays() { return Array.from($('cfgClosed').querySelectorAll('input:checked')).map((c) => Number(c.value)); }

function applyConfig(data) {
  $('cfgCapacity').value = data.capacity;
  $('cfgOpen').value = data.openHour;
  $('cfgClose').value = data.closeHour;
  $('cfgReminder').value = data.reminderHour;
  $('cfgReviewUrl').value = data.reviewUrl || '';
  renderClosedWeekdays(data.closedWeekdays || []);
  $('lineEnabled').checked = !!data.line.enabled;
  $('lineUrl').value = data.line.publicBaseUrl || '';
  $('lineLiff').value = data.line.liffId || '';
  $('lineOwner').value = data.line.ownerUserId || '';
  $('lineToken').placeholder = data.line.hasToken ? '已設定(留空表示不變更)' : '留空表示不變更';
  buildNewBookingForm(data);
}
async function loadConfig() {
  const { ok, data } = await adminPost('getConfig');
  if (ok) applyConfig(data);
}
async function saveConfig() {
  const body = { capacity: $('cfgCapacity').value, openHour: $('cfgOpen').value, closeHour: $('cfgClose').value, reminderHour: $('cfgReminder').value, reviewUrl: $('cfgReviewUrl').value, closedWeekdays: readClosedWeekdays() };
  const np = $('cfgPw').value.trim();
  if (np) body.newPassword = np;
  const { ok, data } = await adminPost('setConfig', body);
  if (ok) {
    if (np) { KEY = np; localStorage.setItem('adminKey', KEY); $('cfgPw').value = ''; }
    banner($('cfgBanner'), 'ok', '已儲存'); loadConfig();
    setTimeout(() => banner($('cfgBanner'), '', ''), 2000);
  } else banner($('cfgBanner'), 'err', data.error || '儲存失敗');
}
async function saveLine() {
  const line = { enabled: $('lineEnabled').checked, publicBaseUrl: $('lineUrl').value.trim(), liffId: $('lineLiff').value.trim(), ownerUserId: $('lineOwner').value.trim() };
  const tok = $('lineToken').value.trim();
  if (tok) line.channelAccessToken = tok;
  const { ok, data } = await adminPost('setConfig', { line });
  if (ok) { $('lineToken').value = ''; banner($('lineBanner'), 'ok', '已儲存 LINE 設定'); loadConfig(); setTimeout(() => banner($('lineBanner'), '', ''), 2500); }
  else banner($('lineBanner'), 'err', data.error || '儲存失敗');
}
async function testLine() {
  const userId = $('testUid').value.trim();
  if (!userId) { banner($('testBanner'), 'err', '請填入你的 LINE userId'); return; }
  const btn = $('testLine'); btn.disabled = true;
  banner($('testBanner'), 'warn', '發送中…');
  const { ok, data } = await adminPost('testLine', { userId });
  btn.disabled = false;
  banner($('testBanner'), ok ? 'ok' : 'err', ok ? '已送出!請看你的 LINE 📱' : (data.error || '發送失敗'));
}

// ---- 事件 ----
$('loginBtn').addEventListener('click', login);
$('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
$('filterDate').addEventListener('change', loadBookings);
$('clearFilter').addEventListener('click', () => { $('filterDate').value = ''; loadBookings(); });
$('saveCfg').addEventListener('click', saveConfig);
$('saveLine').addEventListener('click', saveLine);
$('testLine').addEventListener('click', testLine);
$('nbSubmit').addEventListener('click', newBooking);
$('audGen').addEventListener('click', genAudience);
$('logout').addEventListener('click', (e) => { e.preventDefault(); localStorage.removeItem('adminKey'); location.reload(); });

if (KEY) enterApp(); // 已記住登入 → 直接進(一支 adminInit)
