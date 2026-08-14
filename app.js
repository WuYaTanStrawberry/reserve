// 客人預約頁(GitHub Pages 版,呼叫 Apps Script)
const $ = (id) => document.getElementById(id);
let selectedHour = null;
let selectedLeft = 0;
let selectedFull = false;   // 選到的時段是否已額滿(機車不佔車位,額滿仍可直接預約)
let capacity = 9;
let mode = 'book';        // 'book' 或 'waitlist'
let lineUserId = '';
let curData = null;       // 目前這天的 availability
let curCfg = null;        // 公開設定(給 LINE 引導頁用)

const pad2 = (n) => String(n).padStart(2, '0');

function populateQty() {
  const sel = $('carQty');
  const max = Math.max(1, mode === 'waitlist' ? capacity : selectedLeft);
  sel.innerHTML = '';
  for (let i = 1; i <= max; i++) sel.innerHTML += `<option value="${i}">${i} 台</option>`;
}
function updateVehUI() {
  const isCar = document.querySelector('input[name=vehicle]:checked').value === 'car';
  $('carQtyWrap').hidden = !isCar;
}

let lineIdToken = '';     // LINE 發的身分憑證,送給後端驗證(前端自報的 userId 不被採信)
let lineReady = false;    // LIFF 已初始化完成
let isFriend = null;      // null=未知 / true=已加好友 / false=尚未加好友

// LIFF 背景初始化:不擋頁面載入
function initLiff(liffId) {
  if (!liffId || !window.liff || initLiff.done) return Promise.resolve();
  initLiff.done = true;
  return liff.init({ liffId }).then(async () => {
    lineReady = true;
    if (liff.isLoggedIn()) {
      const prof = await liff.getProfile();
      lineUserId = prof.userId;
      lineIdToken = liff.getIDToken() || '';
      if (prof.displayName && !$('name').value) $('name').value = prof.displayName;
      // 有沒有加官方帳號好友,跟「有沒有 LINE 身分」是兩回事
      try { const f = await liff.getFriendship(); isFriend = !!(f && f.friendFlag); }
      catch (e) { isFriend = null; }
    }
  }).catch(() => { /* 非 LINE 環境 */ });
}

// 需要 LINE 才能預約時,擋在最前面並給出路(加好友 / 打電話)
function renderLineGate(cfg) {
  const add = cfg.lineAddUrl || 'https://lin.ee/St0DnWH';
  const tel = (cfg.contactPhone || '').trim();
  const notFriend = lineReady && lineUserId && isFriend === false;
  document.querySelector('.wrap').innerHTML = `
    <div class="card">
      <div class="success-box">
        <span class="big">💚</span>
        <h2>${notFriend ? '再一步就完成了' : '請從 LINE 預約'}</h2>
        <p>${notFriend
          ? '你已經在 LINE 裡了,只要加入我們的官方帳號好友就能訂位。'
          : '我們的訂位只開放給 LINE 官方帳號的好友,這樣才能在預約成功、前一天提醒時通知你 🍓'}</p>
      </div>
      <a class="primary" href="${escHtml(safeUrl(add))}">加入好友並開始預約</a>
      <p class="note">加入後,請從官方帳號下方的<b>圖文選單</b>點「立即訂位」。</p>
      ${tel ? `<hr class="sep">
        <p class="banner info" style="margin-bottom:8px">不方便使用 LINE 嗎?直接打電話給我們也可以 👇</p>
        <a class="primary secondary" href="tel:${escHtml(tel.replace(/[^0-9+]/g, ''))}">📞 ${escHtml(tel)}</a>` : ''}
    </div>`;
}

async function init() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem('cfgCache') || 'null'); } catch (e) {}
  if (cached) { capacity = cached.capacity || 9; initLiff(cached.liffId); initTurnstile(cached.turnstileSiteKey); }

  const dateEl = $('date');
  const t = new Date();
  const today = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  dateEl.min = today;
  dateEl.addEventListener('change', loadDay);
  document.querySelectorAll('input[name=vehicle]').forEach((r) => r.addEventListener('change', () => {
    syncMode(); updateVehUI(); populateQty();
  }));
  $('bookForm').addEventListener('submit', (e) => { e.preventDefault(); submit(); });

  const qd = new URLSearchParams(location.search).get('date');
  if (qd && /^\d{4}-\d{2}-\d{2}$/.test(qd) && qd >= today) { dateEl.value = qd; loadDay(); }

  const { data: config } = await gasGet({ action: 'config' }, { silent: !!cached });
  if (config && config.capacity) {
    localStorage.setItem('cfgCache', JSON.stringify(config));
    capacity = config.capacity;
    curCfg = config;
    // 要擋非 LINE 客人時必須等 LIFF 問完,否則會在還不知道身分時就誤擋
    if (config.requireLine) await initLiff(config.liffId);
    else initLiff(config.liffId);
    initTurnstile(config.turnstileSiteKey);
    // isFriend 為 null 代表問不到(舊版 LINE 等),此時不擋——寧可放行也不要誤擋真客人,
    // 反正後端還會再用 LINE 官方 API 確認一次是不是好友
    if (config.requireLine && !(lineUserId && isFriend !== false)) { renderLineGate(config); return; }
  }
}

function banner(el, type, msg) { el.innerHTML = msg ? `<p class="banner ${type}">${msg}</p>` : ''; }

// 時段是否已經過去:後端有標記就用它,沒有就用裝置時間自己算(兩層都擋)
function localToday() {
  const t = new Date();
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
}
function slotIsPast(date, s) {
  if (s.past) return true;
  if (s.hour < 0 || date !== localToday()) return false;
  const now = new Date();
  return s.hour * 60 < now.getHours() * 60 + now.getMinutes();   // 開始時間過了就不給選
}

// ---- 空位查詢(共用 60 秒快取,重看同一天秒出) ----
const dropCache = (date) => clearAvailCache(date);

async function loadDay() {
  selectedHour = null;
  $('formSection').hidden = true;
  const date = $('date').value;
  if (!date) return;

  const cached = readAvailCache(date);
  if (cached) {
    renderAvailability(date, cached);
    refreshDay(date);
    return;
  }
  const res = await getAvailability(date, { msg: '查詢空位…' });
  if (!applyResult(date, res)) return;
  renderAvailability(date, res.data);
}
async function refreshDay(date) {
  const res = await gasGet({ action: 'availability', date }, { silent: true });
  if (!res.ok || !res.data || typeof res.data.open === 'undefined') return;
  writeAvailCache(date, res.data);
  if ($('date').value === date && selectedHour == null) renderAvailability(date, res.data);
}
// 連線失敗時不要顯示「尚未開放」這種假訊息,也不要寫進快取
function applyResult(date, res) {
  if (res.offline || res.badResponse || !res.data || (typeof res.data.open === 'undefined' && !res.data.error)) {
    banner($('dateBanner'), 'err', (res.offline
      ? '連不上訂位系統,請確認你的網路後再試一次 🙏'
      : '訂位系統剛才忙線,沒查到空位(跟你的網路無關)。再按一次通常就好了 🙏')
      + ' <button type="button" class="btn-sm" id="retryDay" style="margin-top:8px">重新查詢</button>');
    $('slotSection').hidden = true;
    return false;
  }
  if (!res.data.error) writeAvailCache(date, res.data);
  return true;
}

function renderAvailability(date, data) {
  curData = data;
  if (data.error) { banner($('dateBanner'), 'err', escHtml(data.error)); $('slotSection').hidden = true; return; }
  if (data.past) { banner($('dateBanner'), 'err', '這天已經過了,請選今天以後的日期'); $('slotSection').hidden = true; return; }
  if (data.closedWeekday) { banner($('dateBanner'), 'warn', `星期${escHtml(data.weekday)}為公休日,換一天好嗎? 🙏`); $('slotSection').hidden = true; return; }
  if (!data.open) { banner($('dateBanner'), 'warn', `${escHtml(date)}(星期${escHtml(data.weekday)})這一週還沒開放預約 🙏 請改選其他日期,或關注我們的 LINE 公告`); $('slotSection').hidden = true; return; }

  capacity = data.capacity || capacity;
  // 今天已經結束的時段不顯示(後端也會擋)
  const usable = (data.slots || []).filter((s) => !slotIsPast(date, s));
  if (!usable.length) {
    banner($('dateBanner'), 'warn', `${escHtml(date)} 今天的時段都已經結束了,請改選明天以後的日期 🙏`);
    $('slotSection').hidden = true;
    return;
  }
  const total = usable.reduce((s, x) => s + x.left, 0);
  banner($('dateBanner'), 'ok', `${escHtml(date)}(星期${escHtml(data.weekday)})可預約・今日還有 <b>${total}</b> 個車位`);

  if (data.timeLimited) {
    $('slotLabel').textContent = '選擇時段';
    banner($('slotNote'), 'info', '🍓 假日採果一小時。多數人 40~50 分鐘就採滿,一小時很夠用!');
  } else {
    $('slotLabel').textContent = '選擇預計到達的時間';
    banner($('slotNote'), 'info', '🍓 平日<b>不限採果時間</b>!選你大概幾點會到就好,想採多久都可以~');
  }
  renderSlots(usable, !data.timeLimited);
  $('slotSection').hidden = false;
  $('slotSection').classList.add('reveal');
}

function renderSlots(slots, arrivalStyle) {
  const box = $('slots');
  box.innerHTML = '';
  const cap = capacity || 9;

  slots.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.tabIndex = i === 0 ? 0 : -1;

    const start = `${pad2(s.hour)}:00`;
    const sub = arrivalStyle ? '到達' : `～${pad2(s.hour + 1)}:00`;
    let state = '';
    if (s.full) { state = '額滿·可候補'; b.classList.add('full', 'waitlistable'); }
    else if (s.left <= Math.max(2, Math.round(cap * 0.25))) { state = `剩 ${s.left} 位`; b.classList.add('low'); }
    else { state = `剩 ${s.left} 位`; }

    b.innerHTML = `<span class="lbl">${start}</span><span class="sub">${sub}</span><span class="left">${state}</span>`;
    b.setAttribute('aria-label',
      arrivalStyle ? `${start} 到達,${s.full ? '已額滿,可加入候補' : `剩 ${s.left} 個車位`}`
                   : `${start} 到 ${pad2(s.hour + 1)}:00,${s.full ? '已額滿,可加入候補' : `剩 ${s.left} 個車位`}`);

    b.addEventListener('click', () => selectSlot(b, s));
    b.addEventListener('keydown', (e) => onSlotKey(e, i));
    box.appendChild(b);
  });
}

// 方向鍵在時段之間移動(radiogroup 標準行為)
function onSlotKey(e, i) {
  const items = Array.from($('slots').querySelectorAll('.slot'));
  let next = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = items[(i + 1) % items.length];
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
  else if (e.key === 'Home') next = items[0];
  else if (e.key === 'End') next = items[items.length - 1];
  if (!next) return;
  e.preventDefault();
  items.forEach((x) => (x.tabIndex = -1));
  next.tabIndex = 0;
  next.focus();
}

// 依「時段是否額滿 + 車輛種類」決定要預約還是候補;機車不佔車位,額滿也能直接預約
function syncMode() {
  const isCar = document.querySelector('input[name=vehicle]:checked').value === 'car';
  mode = (selectedFull && isCar) ? 'waitlist' : 'book';
  if (mode === 'waitlist') {
    banner($('modeNote'), 'warn', '此時段的汽車車位已滿,你正在<b>加入候補</b>。有人取消釋出車位時,系統會用 LINE 通知你(需從 LINE 進來預約才收得到)。');
    $('submitBtn').textContent = '加入候補名單';
  } else if (selectedFull) {
    banner($('modeNote'), 'ok', '🏍️ 機車不佔停車格,雖然汽車車位已滿,還是可以直接預約!');
    $('submitBtn').textContent = '送出預約';
  } else {
    banner($('modeNote'), '', '');
    $('submitBtn').textContent = '送出預約';
  }
}

function selectSlot(el, s) {
  const items = Array.from($('slots').querySelectorAll('.slot'));
  items.forEach((x) => { x.classList.remove('selected'); x.setAttribute('aria-checked', 'false'); x.tabIndex = -1; });
  el.classList.add('selected');
  el.setAttribute('aria-checked', 'true');
  el.tabIndex = 0;

  selectedHour = s.hour;
  selectedLeft = s.left;
  selectedFull = !!s.full;
  syncMode();
  populateQty();
  updateVehUI();
  $('formSection').hidden = false;
  $('formSection').classList.remove('reveal');
  void $('formSection').offsetWidth;
  $('formSection').classList.add('reveal');
  banner($('formBanner'), '', '');
  focusInto($('formSection'), { focus: $('name').value ? $('phone') : $('name') });
}

// ---- Cloudflare Turnstile 人機驗證 ----
// 後台沒填金鑰時,整段完全不會啟動,畫面上什麼都不會多出來。
let tsWidgetId = null;
function initTurnstile(siteKey) {
  if (!siteKey || tsWidgetId !== null || document.getElementById('tsScript')) return;
  const box = $('tsBox');
  if (!box) return;
  box.hidden = false;
  const s = document.createElement('script');
  s.id = 'tsScript';
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.async = true; s.defer = true;
  s.onload = () => {
    try {
      tsWidgetId = window.turnstile.render('#tsWidget', { sitekey: siteKey, size: 'flexible' });
    } catch (e) { box.hidden = true; }      // 渲染失敗就當作沒這回事,不要卡住客人
  };
  s.onerror = () => { box.hidden = true; };
  document.head.appendChild(s);
}
function tsToken() {
  try { return (window.turnstile && tsWidgetId !== null) ? window.turnstile.getResponse(tsWidgetId) || '' : ''; }
  catch (e) { return ''; }
}
// 驗證碼是一次性的,送出後(不論成功失敗)都要重置,否則第二次會被判定重複使用
function tsReset() {
  try { if (window.turnstile && tsWidgetId !== null) window.turnstile.reset(tsWidgetId); } catch (e) {}
}

async function submit() {
  const name = $('name').value.trim();
  const phone = $('phone').value.trim();
  const vehicle = document.querySelector('input[name=vehicle]:checked').value;
  const cars = vehicle === 'car' ? Number($('carQty').value || 1) : 0;
  const date = $('date').value;
  const hp = $('hp_field') ? $('hp_field').value : '';
  const cfToken = tsToken();

  if (selectedHour == null) { banner($('formBanner'), 'err', '請先選擇時段'); focusInto($('slotSection')); return; }
  if (!name) { banner($('formBanner'), 'err', '請填寫姓名,我們現場才找得到你'); $('name').focus(); return; }
  if (!phone) { banner($('formBanner'), 'err', '請填寫電話,有狀況我們才聯絡得上'); $('phone').focus(); return; }
  // 電話打錯一碼就聯絡不到人,所以在送出前先擋;送出的也是去掉符號的純數字
  const phoneDigits = phone.replace(/\D/g, '');
  if (!/^0\d{9}$/.test(phoneDigits)) {
    banner($('formBanner'), 'err', `電話號碼要 <b>10 碼</b>喔(例:0912345678)。你目前輸入了 ${phoneDigits.length} 碼,請再確認一次 🙏`);
    $('phone').focus(); $('phone').select();
    return;
  }

  const btn = $('submitBtn');
  btn.disabled = true;
  const msg = mode === 'waitlist' ? '加入候補中…' : '送出預約中…';

  if (mode === 'waitlist') {
    const { ok, data, offline, badResponse } = await gasPost({ action: 'joinWaitlist', name, phone: phoneDigits, date, hour: selectedHour, cars, lineUserId, lineIdToken, hp, cfToken }, { msg });
    btn.disabled = false;
    if (!ok) {
      banner($('formBanner'), 'err', offline ? '連不上訂位系統,沒送出去。請確認你的網路後再按一次 🙏'
        : badResponse ? '訂位系統剛才忙線,沒送出去(跟你的網路無關),請再按一次 🙏'
        : escHtml(data.error || '加入候補失敗'));
      if (data.needLine) { renderLineGate(curCfg || {}); return; }
      focusInto($('formBanner'), { block: 'center' });
      tsReset();
      return;
    }
    dropCache(date);
    showWaitlistSuccess(date);
  } else {
    const { ok, data, offline, badResponse } = await gasPost({ action: 'book', name, phone: phoneDigits, date, hour: selectedHour, vehicle, cars, lineUserId, lineIdToken, hp, cfToken }, { msg });
    btn.disabled = false;
    if (!ok) {
      // 保留表單與錯誤訊息(不可呼叫 loadDay,那會把整個表單連同訊息一起隱藏)
      banner($('formBanner'), 'err', offline ? '連不上訂位系統,沒送出去。請確認你的網路後再按一次 🙏'
        : badResponse ? '訂位系統剛才忙線,沒送出去(跟你的網路無關),請再按一次 🙏'
        : escHtml(data.error || '預約失敗,請稍後再試'));
      if (data.needLine) { renderLineGate(curCfg || {}); return; }
      focusInto($('formBanner'), { block: 'center' });
      tsReset();
      dropCache(date);
      refreshDay(date);          // 背景更新車位數,不動使用者填好的內容
      return;
    }
    dropCache(date);
    showSuccess(data.booking);
  }
}

function resultShell(html) {
  document.querySelector('.wrap').innerHTML = `<div class="card">${html}</div>`;
  window.scrollTo({ top: 0, behavior: 'auto' });
  focusInto(document.querySelector('.card h2'));
}

function showSuccess(b) {
  const veh = b.vehicle === 'car' ? `🚗 汽車 ${b.cars} 台` : '🏍️ 機車';
  resultShell(`
    <div class="success-box">
      <span class="big">🍓</span>
      <h2>預約成功!</h2>
      <p>期待與你在草莓園見面</p>
    </div>
    <div class="detail">
      <div><span class="k">日期</span><span class="v hero">${escHtml(b.date)}(${escHtml(b.weekday)})</span></div>
      <div><span class="k">時段</span><span class="v hero">${escHtml(b.hourLabel)}</span></div>
      <div><span class="k">姓名</span><span class="v">${escHtml(b.name)}</span></div>
      <div><span class="k">電話</span><span class="v">${escHtml(b.phone)}</span></div>
      <div><span class="k">車輛</span><span class="v">${veh}</span></div>
    </div>
    <p class="banner warn">⏰ 車位保留至時段開始後 <b>10 分鐘</b>,逾時將先開放給現場客人,請準時抵達 🙏</p>
    <a class="primary secondary" href="cancel.html?token=${encodeURIComponent(b.cancelToken)}">查看 / 改期 / 取消這筆預約</a>
    <p class="note">💡 把這一頁或 LINE 通知留著,之後要改時間或取消都從這裡進來,不用重訂。</p>
    <button class="btn-sm" id="reloadBtn" style="width:100%;margin-top:12px">再預約一筆</button>`);
}

function showWaitlistSuccess(date) {
  resultShell(`
    <div class="success-box">
      <span class="big">📝</span>
      <h2>已加入候補!</h2>
      <p>${escHtml(date)} 這個時段目前額滿</p>
    </div>
    <p class="banner ok">有人取消、車位釋出時,我們會用 LINE 通知你,先搶先贏 🍓</p>
    <p class="note">提醒:從 LINE 進來預約才收得到候補通知;若用一般瀏覽器加入,請自行留意或回來查看。</p>
    <button class="primary secondary" id="reloadBtn">回預約首頁</button>`);
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'reloadBtn') location.reload();
  if (e.target.id === 'retryDay') { dropCache($('date').value); loadDay(); }
});
init();
