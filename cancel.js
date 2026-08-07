// 客人自助頁(查看 / 改期 / 取消)
const box = document.getElementById('box');
const token = new URLSearchParams(location.search).get('token');
let booking = null;
let capacity = 9;
const pad2 = (n) => String(n).padStart(2, '0');
const WD = '日一二三四五六';

function vehLabel(b) { return b.vehicle === 'car' ? `🚗 汽車 ${b.cars} 台` : '🏍️ 機車'; }
function stateBox(icon, title, desc, actionsHtml) {
  box.innerHTML = `
    <div class="success-box">
      <span class="big">${icon}</span>
      <h2>${title}</h2>
      ${desc ? `<p>${desc}</p>` : ''}
    </div>
    ${actionsHtml || ''}`;
  window.scrollTo({ top: 0, behavior: 'auto' });
  focusInto(box.querySelector('h2'));
}

async function load() {
  if (!token) {
    stateBox('🔗', '連結不完整', '請從 LINE 的預約通知重新點一次連結',
      '<a class="primary secondary" href="index.html">前往預約首頁</a>');
    return;
  }
  const res = await gasGet({ action: 'getBooking', token });
  if (res.offline || res.badResponse) {
    stateBox('📶', '暫時查不到', netMsg(res, '查詢'),
      '<button class="primary" id="retryBtn" type="button">重新載入</button>');
    return;
  }
  if (!res.ok || res.data.error) {
    stateBox('🔍', '找不到這筆預約', escHtml(res.data.error || '可能已經取消或改期了'),
      '<a class="primary secondary" href="index.html">重新預約</a>');
    return;
  }
  booking = res.data.booking;
  render();
  gasGet({ action: 'config' }, { silent: true }).then((c) => {   // 背景取得車位上限,不擋畫面
    if (c.data && c.data.capacity) { capacity = c.data.capacity; buildCarsSelect(); }
  });
}

function render() {
  const b = booking;
  box.innerHTML = `
    <h2 style="margin-bottom:4px">你的預約</h2>
    <p class="note" style="margin-top:0">要改時間或取消,都可以在這一頁完成</p>
    <div class="detail">
      <div><span class="k">日期</span><span class="v hero">${escHtml(b.date)}(${escHtml(b.weekday)})</span></div>
      <div><span class="k">時段</span><span class="v hero">${escHtml(b.hourLabel)}</span></div>
      <div><span class="k">姓名</span><span class="v">${escHtml(b.name)}</span></div>
      <div><span class="k">電話</span><span class="v">${escHtml(b.phone)}</span></div>
      <div><span class="k">車輛</span><span class="v">${vehLabel(b)}</span></div>
    </div>
    <div id="msg" role="status" aria-live="polite"></div>

    <button class="primary secondary" id="rebookBtn" type="button" aria-expanded="false" aria-controls="rebookPanel">
      🔁 修改預約(時間 / 車輛數)
    </button>
    <div id="rebookPanel" hidden>
      ${b.vehicle === 'car' ? `
        <label for="rbCars">開幾台車來?</label>
        <select id="rbCars"></select>` : ''}
      <label for="rbDate">要改時間的話,選新的日期</label>
      <input type="date" id="rbDate">
      <div id="rbBanner" role="status" aria-live="polite"></div>
      <div class="slots" id="rbSlots" role="radiogroup" aria-label="選擇新的時段"></div>
      <div id="rbAction" aria-live="polite"></div>
    </div>

    <button class="btn-text-danger" id="cancelBtn" type="button">我不能來了,取消這筆預約</button>`;

  document.getElementById('rebookBtn').addEventListener('click', toggleRebook);
  document.getElementById('cancelBtn').addEventListener('click', askCancel);
  if (b.vehicle === 'car') buildCarsSelect();
}

// 台數選單:先用「全站上限」填滿,實際能不能放得下由時段格與後端把關
function buildCarsSelect() {
  const sel = document.getElementById('rbCars');
  if (!sel) return;
  const max = Math.max(booking.cars || 1, capacity || 9);
  sel.innerHTML = '';
  for (let i = 1; i <= max; i++) sel.innerHTML += `<option value="${i}">${i} 台</option>`;
  sel.value = String(booking.cars || 1);
  sel.addEventListener('change', onCarsChange);
}
function selectedCars() {
  const sel = document.getElementById('rbCars');
  return sel ? Number(sel.value || booking.cars || 1) : (booking.cars || 1);
}
function onCarsChange() {
  const d = document.getElementById('rbDate');
  if (d && d.value) loadRbSlots();   // 台數變了 → 重算哪些時段放得下
  renderRbAction();
}

// 待確認的變更(選了時段還不會送出,要按「確定更改」)
let pending = null;   // { date, hour, label }

function renderRbAction() {
  const box2 = document.getElementById('rbAction');
  if (!box2) return;
  const newCars = booking.vehicle === 'car' ? selectedCars() : 0;
  const carsChanged = newCars !== (booking.cars || 0);
  const timeChanged = !!pending && !(pending.date === booking.date && pending.hour === booking.hour);
  if (!carsChanged && !timeChanged) { box2.innerHTML = ''; return; }

  const parts = [];
  if (timeChanged) parts.push(`<div><span class="k">時間</span><span class="v hero">${escHtml(pending.label)}</span></div>`);
  if (carsChanged) parts.push(`<div><span class="k">車輛</span><span class="v hero">🚗 汽車 ${newCars} 台</span></div>`);
  box2.innerHTML = `
    <div class="detail" style="background:var(--berry-tint);border-color:var(--berry)">
      <div><span class="k">要改成</span><span class="v" style="color:var(--muted);font-weight:600">請確認以下內容</span></div>
      ${parts.join('')}
    </div>
    <button class="primary" id="rbConfirm" type="button">確定更改</button>
    <button class="btn-sm" id="rbReset" type="button" style="width:100%;margin-top:8px">取消,不改了</button>`;
  document.getElementById('rbConfirm').addEventListener('click', () => {
    const d = timeChanged ? pending.date : booking.date;
    const h = timeChanged ? pending.hour : booking.hour;
    doRebook(d, h, booking.vehicle === 'car' ? newCars : null);
  });
  document.getElementById('rbReset').addEventListener('click', resetPending);
  focusInto(box2, { block: 'center', focus: document.getElementById('rbConfirm') });
}
function resetPending() {
  pending = null;
  const sel = document.getElementById('rbCars');
  if (sel) sel.value = String(booking.cars || 1);
  const d = document.getElementById('rbDate');
  if (d && d.value) loadRbSlots(); else document.getElementById('rbSlots').innerHTML = '';
  renderRbAction();
}

function toggleRebook() {
  const p = document.getElementById('rebookPanel');
  const btn = document.getElementById('rebookBtn');
  const open = !p.hidden;
  p.hidden = open;
  btn.setAttribute('aria-expanded', String(!open));
  btn.textContent = open ? '🔁 改到其他時間' : '✕ 不改了';
  if (open) return;

  p.classList.add('reveal');
  const d = document.getElementById('rbDate');
  if (!d.min) {
    const t = new Date();
    d.min = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
    d.addEventListener('change', loadRbSlots);
  }
  // 先在背景把「原本這天」的空位抓好,客人選同一天時就不用等
  if (booking && booking.date >= d.min) getAvailability(booking.date, { silent: true });
  focusInto(p, { focus: d });
}

async function loadRbSlots() {
  const date = document.getElementById('rbDate').value;
  const slotsBox = document.getElementById('rbSlots');
  const bn = document.getElementById('rbBanner');
  slotsBox.innerHTML = ''; bn.innerHTML = '';
  if (!date) return;

  const res = await getAvailability(date, { msg: '查詢空位…' });   // 命中 60 秒快取就秒出
  if (res.offline || res.badResponse) {
    bn.innerHTML = `<p class="banner err">${netMsg(res, '查詢')} <button type="button" class="btn-sm" id="rbRetry" style="margin-top:8px">重新查詢</button></p>`;
    const rb = document.getElementById('rbRetry');
    if (rb) rb.addEventListener('click', () => { clearAvailCache(date); loadRbSlots(); });
    return;
  }
  const data = res.data;
  if (data.error) { bn.innerHTML = `<p class="banner err">${escHtml(data.error)}</p>`; return; }
  if (data.past) { bn.innerHTML = '<p class="banner err">不能改到已經過去的日期</p>'; return; }
  if (data.closedWeekday) { bn.innerHTML = `<p class="banner warn">星期${escHtml(data.weekday)}為公休日,換一天好嗎?</p>`; return; }
  if (!data.open) { bn.innerHTML = '<p class="banner warn">這一週還沒開放預約,請改選其他日期</p>'; return; }
  const usable = (data.slots || []).filter((s) => {
    if (s.past) return false;
    if (date !== new Date().toLocaleDateString('sv-SE')) return true;   // sv-SE = YYYY-MM-DD
    const now = new Date();
    return s.hour * 60 >= now.getHours() * 60 + now.getMinutes();       // 開始時間過了就不給選
  });
  if (!usable.length) { bn.innerHTML = '<p class="banner warn">今天的時段都已經結束了,請改選明天以後的日期</p>'; return; }
  if (!data.timeLimited) bn.innerHTML = '<p class="banner info">🍓 平日不限採果時間,選你大概幾點會到就好</p>';

  const need = booking.vehicle === 'car' ? selectedCars() : 0;
  const cap = data.capacity || capacity || 9;
  const carsChanged = need !== (booking.cars || 0);
  usable.forEach((s) => {
    const start = `${pad2(s.hour)}:00`;
    const sub = data.timeLimited ? `～${pad2(s.hour + 1)}:00` : '到達';
    const isCurrent = (date === booking.date && s.hour === booking.hour);
    // 原本的時段:自己佔的車位不該算成別人的,所以要加回來
    const room = s.left + (isCurrent ? (booking.cars || 0) : 0);
    const enough = booking.vehicle !== 'car' || room >= need;
    const ok = enough && (!isCurrent || carsChanged);   // 同時段只有在台數有變時才能按

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot' + (isCurrent && !carsChanged ? ' current' : (!enough ? ' full' : (room - need <= Math.max(2, Math.round(cap * 0.25)) ? ' low' : '')));
    b.disabled = !ok;
    b.setAttribute('role', 'radio');
    const isPicked = !!pending && pending.date === date && pending.hour === s.hour;
    b.setAttribute('aria-checked', String(isPicked));
    if (isPicked) b.classList.add('selected');
    const state = isCurrent && !carsChanged ? '目前時段' : (enough ? `剩 ${room} 位` : '放不下');
    b.innerHTML = `<span class="lbl">${start}</span><span class="sub">${sub}</span><span class="left">${state}</span>`;
    b.setAttribute('aria-label', `${start}${data.timeLimited ? ` 到 ${pad2(s.hour + 1)}:00` : ' 到達'},${state}`);
    // 只做「選取」,不直接送出 —— 要再按「確定更改」
    if (ok) b.addEventListener('click', () => {
      pending = { date, hour: s.hour, label: `${escHtml(date)}(${escHtml(data.weekday)}) ${start}${data.timeLimited ? `～${pad2(s.hour + 1)}:00` : ' 到達'}` };
      slotsBox.querySelectorAll('.slot').forEach((x) => { x.classList.remove('selected'); x.setAttribute('aria-checked', 'false'); });
      b.classList.add('selected'); b.setAttribute('aria-checked', 'true');
      renderRbAction();
    });
    slotsBox.appendChild(b);
  });
}

function askCancel() {
  const btn = document.getElementById('cancelBtn');
  btn.hidden = true;
  const panel = document.createElement('div');
  panel.className = 'card reveal';
  panel.style.cssText = 'border-color:var(--danger-line);background:var(--danger-bg);margin-top:12px';
  panel.innerHTML = `
    <h3 style="margin:0 0 4px;color:var(--danger-ink)">確定要取消嗎?</h3>
    <p class="note" style="margin-top:0;color:var(--danger-ink)">取消後這個車位會立刻釋出給其他客人,無法復原。如果只是時間不方便,改期就好 🙏</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      <button class="btn-sm" id="keepBtn" type="button" style="flex:1;min-width:130px">先不要,我要改期</button>
      <button class="btn-sm danger" id="reallyCancel" type="button" style="flex:1;min-width:130px">確定取消預約</button>
    </div>`;
  box.appendChild(panel);
  focusInto(panel, { focus: panel.querySelector('#keepBtn') });
  panel.querySelector('#keepBtn').addEventListener('click', () => {
    panel.remove(); btn.hidden = false;
    const p = document.getElementById('rebookPanel');
    if (p && p.hidden) toggleRebook();
  });
  panel.querySelector('#reallyCancel').addEventListener('click', () => doCancel(panel));
}

async function doRebook(date, hour, cars) {
  const sameSlot = (date === booking.date && hour === booking.hour);
  const body = { action: 'reschedule', token, date, hour };
  if (cars != null) body.cars = cars;
  const res2 = await gasPost(body, { msg: sameSlot ? '更新中…' : '改期中…' });
  const { ok, data } = res2;
  if (!ok) {
    const target = document.getElementById('rbAction') || document.getElementById('rbBanner');
    if (target) target.insertAdjacentHTML('afterbegin',
      `<p class="banner err">${netMsg(res2, sameSlot ? '更新' : '改期') || escHtml(data.error || '更新失敗')}</p>`);
    return;
  }
  clearAvailCache(booking.date); clearAvailCache(date);   // 車位數變了,舊快取要作廢
  pending = null;
  booking = data.booking;
  render();
  document.getElementById('msg').innerHTML = sameSlot
    ? `<p class="banner ok">✅ 已更新為 <b>${escHtml(vehLabel(booking))}</b>,時間不變:${escHtml(booking.date)}(${escHtml(booking.weekday)})${escHtml(booking.hourLabel)}</p>`
    : `<p class="banner ok">✅ 已改到 <b>${escHtml(booking.date)}(${escHtml(booking.weekday)})${escHtml(booking.hourLabel)}</b>・${escHtml(vehLabel(booking))},我們那天見!</p>`;
  focusInto(document.getElementById('msg'), { block: 'center' });
}

async function doCancel(panel) {
  const res3 = await gasPost({ action: 'cancel', token }, { msg: '取消中…' });
  const { ok, data } = res3;
  if (!ok) {
    panel.insertAdjacentHTML('beforeend',
      `<p class="banner err">${netMsg(res3, '取消') || escHtml(data.error || '取消失敗')}</p>`);
    return;
  }
  stateBox('🅿️', '已取消預約', '車位已經釋出,謝謝你特地通知我們 🍓',
    '<a class="primary" href="index.html">重新預約</a>');
}

document.addEventListener('click', (e) => { if (e.target.id === 'retryBtn') location.reload(); });
load();
