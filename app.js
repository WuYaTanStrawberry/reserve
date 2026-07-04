// 客人預約頁(GitHub Pages 版,呼叫 Apps Script)
const $ = (id) => document.getElementById(id);
let selectedHour = null;
let selectedLeft = 0;
let capacity = 9;
let mode = 'book';        // 'book' 或 'waitlist'
let lineUserId = '';

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

// LIFF 改為背景初始化:不擋頁面載入,取得身分後自動帶入姓名
function initLiff(liffId) {
  if (!liffId || !window.liff || initLiff.done) return;
  initLiff.done = true;
  liff.init({ liffId }).then(async () => {
    if (liff.isLoggedIn()) {
      const prof = await liff.getProfile();
      lineUserId = prof.userId;
      if (prof.displayName && !$('name').value) $('name').value = prof.displayName;
    }
  }).catch(() => { /* 非 LINE 環境,忽略 */ });
}

async function init() {
  // 頁面立即可用:先套用上次快取的設定,再背景更新
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem('cfgCache') || 'null'); } catch (e) {}
  if (cached) { capacity = cached.capacity || 9; initLiff(cached.liffId); }

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

  // 取得最新設定(有快取時靜默進行,不轉圈)
  const { data: config } = await gasGet({ action: 'config' }, { silent: !!cached });
  if (config && config.capacity) {
    localStorage.setItem('cfgCache', JSON.stringify(config));
    capacity = config.capacity;
    initLiff(config.liffId);
  }
}

function banner(el, type, msg) { el.innerHTML = msg ? `<div class="banner ${type}">${msg}</div>` : ''; }

// 空位查詢快取 60 秒:重看同一天立即顯示,並在背景更新
const AV_TTL = 60 * 1000;
async function loadDay() {
  selectedHour = null;
  $('formSection').style.display = 'none';
  const date = $('date').value;
  if (!date) return;
  let cached = null;
  try { cached = JSON.parse(sessionStorage.getItem('av:' + date) || 'null'); } catch (e) {}
  if (cached && Date.now() - cached.t < AV_TTL) {
    renderAvailability(date, cached.data);
    refreshDay(date); // 背景拿最新,若客人尚未選時段會自動更新畫面
    return;
  }
  const { data } = await gasGet({ action: 'availability', date });
  if (!data.error) sessionStorage.setItem('av:' + date, JSON.stringify({ t: Date.now(), data }));
  renderAvailability(date, data);
}
async function refreshDay(date) {
  const { data } = await gasGet({ action: 'availability', date }, { silent: true });
  if (!data || data.error) return;
  sessionStorage.setItem('av:' + date, JSON.stringify({ t: Date.now(), data }));
  if ($('date').value === date && selectedHour == null) renderAvailability(date, data);
}
function renderAvailability(date, data) {
  if (data.error) { banner($('dateBanner'), 'err', data.error); $('slotSection').style.display = 'none'; return; }
  if (data.past) { banner($('dateBanner'), 'err', '無法預約過去的日期'); $('slotSection').style.display = 'none'; return; }
  if (data.closedWeekday) { banner($('dateBanner'), 'warn', `星期${data.weekday}為公休日,暫不開放預約 🙏`); $('slotSection').style.display = 'none'; return; }
  if (!data.open) { banner($('dateBanner'), 'warn', `本週(含 ${date} 星期${data.weekday})目前尚未開放預約 🙏`); $('slotSection').style.display = 'none'; return; }
  capacity = data.capacity || capacity;
  if (data.timeLimited) {
    banner($('dateBanner'), 'ok', `${date}(星期${data.weekday})已開放,每時段 ${data.capacity} 個汽車車位`);
    $('slotLabel').textContent = '選擇時段(數字為剩餘汽車車位)';
    banner($('slotNote'), 'warn', '🍓 通常採草莓約 40~50 分鐘,一小時絕對夠用喔!');
    renderSlots(data.slots, false);
  } else {
    banner($('dateBanner'), 'ok', `${date}(星期${data.weekday})已開放,每時段 ${data.capacity} 個汽車車位`);
    $('slotLabel').textContent = '選擇預計到達時段(數字為剩餘車位)';
    banner($('slotNote'), 'warn', '🍓 平日不限採果時間!選您「預計到達」的時段即可,想採多久都可以~');
    renderSlots(data.slots, true);
  }
  $('slotSection').style.display = 'block';
}

function selectSlot(div, s, m) {
  document.querySelectorAll('.slot').forEach((el) => el.classList.remove('selected'));
  div.classList.add('selected');
  selectedHour = s.hour;
  selectedLeft = s.left;
  mode = m;
  populateQty();
  updateVehUI();
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

function renderSlots(slots, arrivalStyle) {
  const box = $('slots');
  box.innerHTML = '';
  slots.forEach((s) => {
    const label = arrivalStyle ? `${String(s.hour).padStart(2, '0')}:00 到達` : s.label;
    const div = document.createElement('div');
    div.className = 'slot' + (s.full ? ' full waitlistable' : '');
    div.innerHTML = `<div class="lbl">${label}</div><div class="left">${s.full ? '已額滿 · 可候補 →' : '剩 ' + s.left + ' 位'}</div>`;
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
    const { ok, data } = await gasPost({ action: 'book', name, phone, date, hour: selectedHour, vehicle, cars, lineUserId });
    $('submitBtn').disabled = false;
    if (!ok) { banner($('formBanner'), 'err', data.error || '預約失敗,請稍後再試'); sessionStorage.removeItem('av:' + date); loadDay(); return; }
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
