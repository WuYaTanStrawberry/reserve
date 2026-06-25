// 客人自助頁(查看 / 改期 / 取消)
const box = document.getElementById('box');
const token = new URLSearchParams(location.search).get('token');
let booking = null;
function vehLabel(b) { return b.vehicle === 'car' ? `🚗 汽車 ${b.cars} 台` : '🏍️ 機車'; }

async function load() {
  if (!token) { box.innerHTML = '<div class="banner err">連結不正確</div>'; return; }
  const { ok, data } = await gasGet({ action: 'getBooking', token });
  if (!ok || data.error) { box.innerHTML = `<div class="banner warn">${data.error || '找不到預約'}</div>`; return; }
  booking = data.booking;
  render();
}

function render() {
  const b = booking;
  box.innerHTML = `
    <table>
      <tr><th>姓名</th><td>${b.name}</td></tr>
      <tr><th>電話</th><td>${b.phone}</td></tr>
      <tr><th>日期</th><td>${b.date}(星期${b.weekday})</td></tr>
      <tr><th>時段</th><td>${b.hourLabel}</td></tr>
      <tr><th>車輛</th><td>${vehLabel(b)}</td></tr>
    </table>
    <div id="msg"></div>
    <button class="primary" id="rebookBtn">🔁 改期(換日期 / 時段)</button>
    <div id="rebookPanel" style="display:none;margin-top:10px">
      <label for="rbDate">選擇新日期</label>
      <input type="date" id="rbDate">
      <div id="rbBanner"></div>
      <div class="slots" id="rbSlots"></div>
    </div>
    <button class="primary" id="cancelBtn" style="background:#fff;color:var(--berry-dark);border:1.5px solid var(--berry);margin-top:10px">取消這筆預約</button>`;
  document.getElementById('rebookBtn').addEventListener('click', toggleRebook);
  document.getElementById('cancelBtn').addEventListener('click', doCancel);
}

function toggleRebook() {
  const p = document.getElementById('rebookPanel');
  const showing = p.style.display !== 'none';
  p.style.display = showing ? 'none' : 'block';
  const d = document.getElementById('rbDate');
  if (!showing && !d.min) {
    const t = new Date(); const pad = (n) => String(n).padStart(2, '0');
    d.min = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
    d.addEventListener('change', loadRbSlots);
  }
}

async function loadRbSlots() {
  const date = document.getElementById('rbDate').value;
  const slotsBox = document.getElementById('rbSlots');
  const bn = document.getElementById('rbBanner');
  slotsBox.innerHTML = ''; bn.innerHTML = '';
  if (!date) return;
  const { data } = await gasGet({ action: 'availability', date });
  if (data.error) { bn.innerHTML = `<div class="banner err">${data.error}</div>`; return; }
  if (data.past) { bn.innerHTML = '<div class="banner err">無法改到過去的日期</div>'; return; }
  if (data.closedWeekday) { bn.innerHTML = `<div class="banner warn">星期${data.weekday}為公休日</div>`; return; }
  if (!data.open) { bn.innerHTML = '<div class="banner warn">該週尚未開放預約</div>'; return; }
  const need = booking.cars || 1;
  data.slots.forEach((s) => {
    const isCurrent = (date === booking.date && s.hour === booking.hour);
    const enough = booking.vehicle !== 'car' || s.left >= need;
    const ok = enough && !isCurrent;
    const div = document.createElement('div');
    div.className = 'slot' + (ok ? '' : ' full');
    div.innerHTML = `<div class="lbl">${s.label}</div><div class="left">${isCurrent ? '目前時段' : (enough ? '剩 ' + s.left + ' 位' : '車位不足')}</div>`;
    if (ok) div.addEventListener('click', () => doRebook(date, s.hour));
    slotsBox.appendChild(div);
  });
}

async function doRebook(date, hour) {
  const pad = (n) => String(n).padStart(2, '0');
  if (!confirm(`確定改到 ${date}(星期${'日一二三四五六'[new Date(date).getDay()]})${pad(hour)}:00-${pad(hour + 1)}:00 嗎?`)) return;
  const { ok, data } = await gasPost({ action: 'reschedule', token, date, hour });
  if (!ok) { document.getElementById('rbBanner').innerHTML = `<div class="banner err">${data.error || '改期失敗'}</div>`; return; }
  booking = data.booking;
  render();
  document.getElementById('msg').innerHTML = '<div class="banner ok">✅ 已改期!新的日期 / 時段如上。</div>';
}

async function doCancel() {
  if (!confirm('確定要取消這筆預約嗎?取消後車位會立即釋出。')) return;
  const { ok, data } = await gasPost({ action: 'cancel', token });
  if (!ok) { document.getElementById('msg').innerHTML = `<div class="banner err">${data.error || '取消失敗'}</div>`; return; }
  box.innerHTML = `
    <div class="success-box">
      <div class="big">🅿️</div>
      <h2>已取消預約</h2>
      <p class="muted">車位已釋出,謝謝您的通知 🍓</p>
      <a class="primary" style="display:block;text-align:center;text-decoration:none" href="index.html">重新預約</a>
    </div>`;
}

load();
