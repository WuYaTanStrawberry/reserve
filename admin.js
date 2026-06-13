// 後台(GitHub Pages 版,呼叫 Apps Script)
const $ = (id) => document.getElementById(id);
let KEY = sessionStorage.getItem('adminKey') || '';

function banner(el, type, msg) { el.innerHTML = msg ? `<div class="banner ${type}">${msg}</div>` : ''; }
// 所有後台動作都帶 key
async function adminPost(action, extra) { return gasPost(Object.assign({ action, key: KEY }, extra || {})); }

// ---- 登入 ----
async function login() {
  const pw = $('pw').value;
  const { data } = await gasPost({ action: 'adminLogin', password: pw });
  if (data.ok) { KEY = pw; sessionStorage.setItem('adminKey', KEY); enterApp(); }
  else banner($('loginBanner'), 'err', '密碼錯誤');
}
function enterApp() {
  $('loginCard').style.display = 'none';
  $('app').style.display = 'block';
  loadBookings(); loadWeeks(); loadConfig();
}

// ---- 分頁 ----
document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab').forEach((t) => (t.style.display = 'none'));
    $('tab-' + btn.dataset.tab).style.display = 'block';
  });
});

// ---- 名單 ----
async function loadBookings() {
  const date = $('filterDate').value;
  const { ok, data } = await adminPost('bookings', date ? { date } : {});
  if (!ok) return;
  const list = data.bookings || [];
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
  document.querySelectorAll('[data-ci]').forEach((btn) => btn.addEventListener('click', async () => { await adminPost('checkin', { id: btn.dataset.ci }); loadBookings(); }));
  document.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('確定取消這筆預約?車位會立即釋出。')) return;
    await adminPost('delete', { id: btn.dataset.del }); loadBookings(); loadWeeks();
  }));
}

// ---- 週次 ----
async function loadWeeks() {
  const { ok, data } = await adminPost('weeks', { weeks: 10 });
  if (!ok) return;
  let html = '';
  data.weeks.forEach((w) => {
    html += `<div class="week-row">
      <div><strong>${w.monday} ~ ${w.sunday}</strong><div class="stat">該週預約 ${w.bookingCount} 筆</div></div>
      <label class="switch"><input type="checkbox" data-week="${w.weekKey}" ${w.open ? 'checked' : ''}><span class="track"></span></label>
    </div>`;
  });
  $('weekList').innerHTML = html;
  document.querySelectorAll('[data-week]').forEach((cb) => cb.addEventListener('change', async () => { await adminPost('setWeek', { weekKey: cb.dataset.week, open: cb.checked }); }));
}

// ---- 設定 ----
const WD = ['日', '一', '二', '三', '四', '五', '六'];
function renderClosedWeekdays(sel) {
  $('cfgClosed').innerHTML = WD.map((w, i) => `<label class="wd"><input type="checkbox" value="${i}" ${sel.includes(i) ? 'checked' : ''}>星期${w}</label>`).join('');
}
function readClosedWeekdays() { return Array.from($('cfgClosed').querySelectorAll('input:checked')).map((c) => Number(c.value)); }

async function loadConfig() {
  const { ok, data } = await adminPost('getConfig');
  if (!ok) return;
  $('cfgCapacity').value = data.capacity;
  $('cfgOpen').value = data.openHour;
  $('cfgClose').value = data.closeHour;
  $('cfgReminder').value = data.reminderHour;
  renderClosedWeekdays(data.closedWeekdays || []);
  $('lineEnabled').checked = !!data.line.enabled;
  $('lineUrl').value = data.line.publicBaseUrl || '';
  $('lineLiff').value = data.line.liffId || '';
  $('lineToken').placeholder = data.line.hasToken ? '已設定(留空表示不變更)' : '留空表示不變更';
}
async function saveConfig() {
  const body = { capacity: $('cfgCapacity').value, openHour: $('cfgOpen').value, closeHour: $('cfgClose').value, reminderHour: $('cfgReminder').value, closedWeekdays: readClosedWeekdays() };
  const np = $('cfgPw').value.trim();
  if (np) body.newPassword = np;
  const { ok, data } = await adminPost('setConfig', body);
  if (ok) {
    if (np) { KEY = np; sessionStorage.setItem('adminKey', KEY); $('cfgPw').value = ''; }
    banner($('cfgBanner'), 'ok', '已儲存'); loadConfig();
    setTimeout(() => banner($('cfgBanner'), '', ''), 2000);
  } else banner($('cfgBanner'), 'err', data.error || '儲存失敗');
}
async function saveLine() {
  const line = { enabled: $('lineEnabled').checked, publicBaseUrl: $('lineUrl').value.trim(), liffId: $('lineLiff').value.trim() };
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
$('logout').addEventListener('click', (e) => { e.preventDefault(); sessionStorage.removeItem('adminKey'); location.reload(); });

if (KEY) adminPost('getConfig').then(({ ok }) => { if (ok) enterApp(); });
