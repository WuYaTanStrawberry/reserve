// 客人預約頁(GitHub Pages 版,呼叫 Apps Script)
const $ = (id) => document.getElementById(id);
let selectedHour = null;
let selectedLeft = 0;
let capacity = 9;
let openHour = 8;
let closeHour = 17;
let mode = 'book';        // 'book' 或 'waitlist'
let lineUserId = '';

function populateArrival() {
  const sel = $('arrival');
  const pad = (n) => String(n).padStart(2, '0');
  let html = '<option value="">還不確定</option>';
  for (let h = openHour; h < closeHour; h++) {
    html += `<option value="${pad(h)}:00">${pad(h)}:00</option>`;
    html += `<option value="${pad(h)}:30">${pad(h)}:30</option>`;
  }
  sel.innerHTML = html;
}

function populateQty() {
  const sel = $('carQty');
  const max = Math.max(1, mode === 'waitlist' ? capacity : selectedLeft);
  sel.innerHTML = '';
  for (let i = 1; i <= max; i++) sel.innerHTML += `<option value="${i}">${i} 台</option>`;
}
function updateVehUI() {
  const isCar = document.querySelector('input[name=vehicle]:checked').value === 'car';
  $('carQtyWrap').style.display = isCar ? 'block' : 'none';
}

async function init() {
  const { data: config } = await gasGet({ action: 'config' });
  capacity = config.capacity || 9;
  openHour = config.openHour != null ? config.openHour : 8;
  closeHour = config.closeHour != null ? config.closeHour : 17;

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
  const today = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  dateEl.min = today;
  dateEl.addEventListener('change', loadDay);
  document.querySelectorAll('input[name=vehicle]').forEach((r) => r.addEventListener('change', updateVehUI));

  // 候補通知連結會帶 ?date=,自動帶入並查詢
  const qd = new URLSearchParams(location.search).get('date');
  if (qd && /^\d{4}-\d{2}-\d{2}$/.test(qd) && qd >= today) { dateEl.value = qd; loadDay(); }
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
  capacity = data.capacity || capacity;
  if (data.hourly) {
    banner($('dateBanner'), 'ok', `${date}(星期${data.weekday})已開放,每時段 ${data.capacity} 個汽車車位`);
    $('slotLabel').textContent = '選擇時段(數字為剩餘汽車車位)';
    banner($('slotNote'), 'warn', '🍓 通常採草莓約 40~50 分鐘,一小時絕對夠用喔!');
    renderSlots(data.slots);
  } else {
    banner($('dateBanner'), 'ok', `${date}(星期${data.weekday})已開放・平日不限採草莓時間,整天最多 ${data.capacity} 個車位`);
    $('slotLabel').textContent = '本日預約(平日不限時)';
    banner($('slotNote'), '', '');
    renderDay(data.day);
  }
  $('slotSection').style.display = 'block';
}

function renderDay(day) {
  const box = $('slots');
  box.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'slot' + (day.full ? ' full waitlistable' : '');
  div.innerHTML = `<div class="lbl">本日 · 不限時</div><div class="left">${day.full ? '已額滿 · 可候補 →' : '剩 ' + day.left + ' 位'}</div>`;
  div.addEventListener('click', () => selectSlot(div, { hour: -1, left: day.left }, day.full ? 'waitlist' : 'book'));
  box.appendChild(div);
}

function selectSlot(div, s, m) {
  document.querySelectorAll('.slot').forEach((el) => el.classList.remove('selected'));
  div.classList.add('selected');
  selectedHour = s.hour;
  selectedLeft = s.left;
  mode = m;
  populateQty();
  updateVehUI();
  // 平日整天制且是「預約」(非候補)時,提供預計到達時間
  if (s.hour === -1 && m === 'book') { populateArrival(); $('arrivalWrap').style.display = 'block'; }
  else { $('arrivalWrap').style.display = 'none'; }
  if (m === 'waitlist') {
    banner($('modeNote'), 'warn', '此時段已額滿,你正在「加入候補」。有人取消釋出車位時,系統會用 LINE 通知你(需從 LINE 進來預約才收得到通知)。');
    $('submitBtn').textContent = '加入候補名單';
  } else {
    banner($('modeNote'), '', '');
    $('submitBtn').textContent = '送出預約';
  }
  $('formSection').style.display = 'block';
  banner($('formBanner'), '', '');
}

function renderSlots(slots) {
  const box = $('slots');
  box.innerHTML = '';
  slots.forEach((s) => {
    const div = document.createElement('div');
    div.className = 'slot' + (s.full ? ' full waitlistable' : '');
    div.innerHTML = `<div class="lbl">${s.label}</div><div class="left">${s.full ? '已額滿 · 可候補 →' : '剩 ' + s.left + ' 位'}</div>`;
    div.addEventListener('click', () => selectSlot(div, s, s.full ? 'waitlist' : 'book'));
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
  if (mode === 'waitlist') {
    const { ok, data } = await gasPost({ action: 'joinWaitlist', name, phone, date, hour: selectedHour, cars, lineUserId });
    $('submitBtn').disabled = false;
    if (!ok) { banner($('formBanner'), 'err', data.error || '加入候補失敗'); return; }
    showWaitlistSuccess(date);
  } else {
    const arrival = selectedHour === -1 ? ($('arrival').value || '') : '';
    const { ok, data } = await gasPost({ action: 'book', name, phone, date, hour: selectedHour, vehicle, cars, arrival, lineUserId });
    $('submitBtn').disabled = false;
    if (!ok) { banner($('formBanner'), 'err', data.error || '預約失敗,請稍後再試'); loadDay(); return; }
    showSuccess(data.booking);
  }
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
        ${b.arrival ? `<tr><th>預計到達</th><td>${b.arrival}</td></tr>` : ''}
        <tr><th>車輛</th><td>${veh}</td></tr>
      </table>
      <div class="banner warn" style="margin-top:12px">⏰ 車位保留至預約時段開始後 <b>10 分鐘</b>,逾時將先開放給現場客人,敬請準時到達 🙏</div>
      <a class="primary" style="display:block;text-align:center;text-decoration:none;background:#fff;color:var(--berry);border:1.5px solid var(--berry)" href="cancel.html?token=${b.cancelToken}">查看 / 改期 / 取消這筆預約</a>
      <p class="note">💡 想改時間或取消,從上方連結即可(可改期不必重訂)。</p>
      <button class="primary" onclick="location.reload()">再預約一筆</button>
    </div>`;
}

function showWaitlistSuccess(date) {
  document.querySelector('.wrap').innerHTML = `
    <div class="card success-box">
      <div class="big">📝</div>
      <h2>已加入候補!</h2>
      <p class="muted">${date} 該時段目前額滿</p>
      <div class="banner ok" style="margin-top:10px">有人取消、車位釋出時,我們會用 LINE 通知你,先搶先贏 🍓</div>
      <p class="note">提醒:從 LINE 進來預約才收得到候補通知;若用一般瀏覽器加入,請自行留意或回來查看。</p>
      <button class="primary" onclick="location.reload()">回預約首頁</button>
    </div>`;
}

document.addEventListener('click', (e) => { if (e.target.id === 'submitBtn') submit(); });
init();
