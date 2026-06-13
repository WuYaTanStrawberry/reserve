// 客人自助取消頁(GitHub Pages 版)
const box = document.getElementById('box');
const token = new URLSearchParams(location.search).get('token');
function vehLabel(v) { return v === 'car' ? '🚗 汽車' : '🏍️ 機車'; }

async function load() {
  if (!token) { box.innerHTML = '<div class="banner err">連結不正確</div>'; return; }
  const { ok, data } = await gasGet({ action: 'getBooking', token });
  if (!ok || data.error) { box.innerHTML = `<div class="banner warn">${data.error || '找不到預約'}</div>`; return; }
  render(data.booking);
}

function render(b) {
  box.innerHTML = `
    <table>
      <tr><th>姓名</th><td>${b.name}</td></tr>
      <tr><th>電話</th><td>${b.phone}</td></tr>
      <tr><th>日期</th><td>${b.date}(星期${b.weekday})</td></tr>
      <tr><th>時段</th><td>${b.hourLabel}</td></tr>
      <tr><th>車輛</th><td>${vehLabel(b.vehicle)}</td></tr>
    </table>
    <div id="msg"></div>
    <button class="primary" id="cancelBtn" style="background:#fff;color:var(--berry-dark);border:1.5px solid var(--berry)">一鍵取消這筆預約</button>`;
  document.getElementById('cancelBtn').addEventListener('click', doCancel);
}

async function doCancel() {
  if (!confirm('確定要取消這筆預約嗎?取消後車位會立即釋出。')) return;
  const btn = document.getElementById('cancelBtn');
  btn.disabled = true;
  const { ok, data } = await gasPost({ action: 'cancel', token });
  if (!ok) { document.getElementById('msg').innerHTML = `<div class="banner err">${data.error || '取消失敗'}</div>`; btn.disabled = false; return; }
  box.innerHTML = `
    <div class="success-box">
      <div class="big">🅿️</div>
      <h2>已取消預約</h2>
      <p class="muted">車位已釋出,謝謝您的通知 🍓</p>
      <a class="primary" style="display:block;text-align:center;text-decoration:none" href="index.html">重新預約</a>
    </div>`;
}

load();
