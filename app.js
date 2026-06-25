// 客人預約頁(GitHub Pages 版,呼叫 Apps Script)
const $ = (id) => document.getElementById(id);
let selectedHour = null;
let selectedLeft = 0;
let lineUserId = '';

function populateQty() {
  const sel = $('carQty');
  const max = Math.max(1, selectedLeft);
  sel.innerHTML = '';
  for (let i = 1; i <= max; i++) sel.innerHTML += `<option value="${i}">${i} 台</option>`;
}
function updateVehUI() {
  const isCar = document.querySelector('input[name=vehicle]:checked').value === 'car';
  $('carQtyWrap').style.display = isCar ? 'block' : 'none';
}

async function init() {
  const { data: config } = await gasGet({ action: 'config' });

  if (config.liffId && window.liff) {
    try {
      await liff.init({ liffId: config.liffId });
      if (liff.isLoggedIn()) {
        const prof = await liff.getProfile();
        lineUserId = prof.userId;
        if (prof.displayName && !$('name').value) $('name').value = prof.displayName;
      }
    } catch (e) { /* 非 LINE 環境,忽略 */ }
  }

  const dateEl = $('date');
  const t = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  dateEl.min = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  dateEl.addEventListener('change', loadDay);
  document.querySelectorAll('input[name=vehicle]').forEach((r) => r.addEventListener('change', updateVehUI));
}

function banner(el, type, msg) { el.innerHTML = msg ? `<div class="banner ${type}">${msg}</div>` : ''; }

async function loadDay() {
  selectedHour = null;
  $('formSection').style.display = 'none';
  const date = $('date').value;
  if (!date) return;
  const { data } = await gasGet({ action: 'availability', date });
  if (data.error) { banner($('dateBanner'), 'err', data.error); $('slotSection').style.display = 'none'; return; }
  if (data.past) { banner($('dateBanner'), 'err', '無法預約過去的日期'); $('slotSection').style.display = 'none'; return; }
  if (data.closedWeekday) { banner($('dateBanner'), 'warn', `星期${data.weekday}為公休日,暫不開放預約 🙏`); $('slotSection').style.display = 'none'; return; }
  if (!data.open) { banner($('dateBanner'), 'warn', `本週(含 ${date} 星期${data.weekday})目前尚未開放預約 🙏`); $('slotSection').style.display = 'none'; return; }
  banner($('dateBanner'), 'ok', `${date}(星期${data.weekday})已開放,每時段 ${data.capacity} 個汽車車位`);
  renderSlots(data.slots);
  $('slotSection').style.display = 'block';
}

function renderSlots(slots) {
  const box = $('slots');
  box.innerHTML = '';
  slots.forEach((s) => {
    const div = document.createElement('div');
    div.className = 'slot' + (s.full ? ' full' : '');
    div.innerHTML = `<div class="lbl">${s.label}</div><div class="left">${s.full ? '已額滿' : '剩 ' + s.left + ' 位'}</div>`;
    if (!s.full) {
      div.addEventListener('click', () => {
        document.querySelectorAll('.slot').forEach((el) => el.classList.remove('selected'));
        div.classList.add('selected');
        selectedHour = s.hour;
        selectedLeft = s.left;
        populateQty();
        updateVehUI();
        $('formSection').style.display = 'block';
        banner($('formBanner'), '', '');
      });
    }
    box.appendChild(div);
  });
}

async function submit() {
  const name = $('name').value.trim();
  const phone = $('phone').value.trim();
  const vehicle = document.querySelector('input[name=vehicle]:checked').value;
  const cars = vehicle === 'car' ? Number($('carQty').value || 1) : 0;
  const date = $('date').value;
  if (selectedHour == null) { banner($('formBanner'), 'err', '請先選擇時段'); return; }
  if (!name) { banner($('formBanner'), 'err', '請填寫姓名'); return; }
  if (!phone) { banner($('formBanner'), 'err', '請填寫電話'); return; }

  $('submitBtn').disabled = true;
  const { ok, data } = await gasPost({ action: 'book', name, phone, date, hour: selectedHour, vehicle, cars, lineUserId });
  $('submitBtn').disabled = false;
  if (!ok) { banner($('formBanner'), 'err', data.error || '預約失敗,請稍後再試'); loadDay(); return; }
  showSuccess(data.booking);
}

function showSuccess(b) {
  const veh = b.vehicle === 'car' ? `🚗 汽車 ${b.cars} 台` : '🏍️ 機車';
  document.querySelector('.wrap').innerHTML = `
    <div class="card success-box">
      <div class="big">✅</div>
      <h2>預約成功!</h2>
      <p class="muted">期待您的到來 🍓</p>
      <table style="margin-top:10px">
        <tr><th>姓名</th><td>${b.name}</td></tr>
        <tr><th>電話</th><td>${b.phone}</td></tr>
        <tr><th>日期</th><td>${b.date}(星期${b.weekday})</td></tr>
        <tr><th>時段</th><td>${b.hourLabel}</td></tr>
        <tr><th>車輛</th><td>${veh}</td></tr>
      </table>
      <div class="banner warn" style="margin-top:12px">⏰ 車位保留至預約時段開始後 <b>10 分鐘</b>,逾時將先開放給現場客人,敬請準時到達 🙏</div>
      <a class="primary" style="display:block;text-align:center;text-decoration:none;background:#fff;color:var(--berry);border:1.5px solid var(--berry)" href="cancel.html?token=${b.cancelToken}">查看 / 取消這筆預約</a>
      <p class="note">💡 想取消請保留上方連結;之後也可從這裡一鍵取消並釋出車位。</p>
      <button class="primary" onclick="location.reload()">再預約一筆</button>
    </div>`;
}

document.addEventListener('click', (e) => { if (e.target.id === 'submitBtn') submit(); });
init();
