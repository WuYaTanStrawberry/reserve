// 與 Google Apps Script 後端溝通的小工具
// 注意:POST 用 text/plain 避免瀏覽器 CORS 預檢(GAS 對預檢支援不佳)
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || '';

// ---- 載入中遮罩;opts.msg 可指定當下在做什麼(查詢中/送出中…)----
let _pending = 0;
function _overlayEl() {
  let el = document.getElementById('loadingOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loadingOverlay';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="lo-box"><img class="lo-logo" src="logo-sm.png" alt="" width="88" height="66"><div class="lo-txt">查詢中,請稍候…</div></div>';
    document.body.appendChild(el);
  }
  return el;
}
let _watchdog = null;
function showLoading(msg) {
  _pending++;
  const el = _overlayEl();
  if (msg) el.querySelector('.lo-txt').textContent = msg;
  el.classList.add('show');
  // 保險:任何情況下都不讓遮罩鎖死畫面
  clearTimeout(_watchdog);
  _watchdog = setTimeout(() => { _pending = 0; forceHideLoading(); }, 30000);
}
function forceHideLoading() {
  const el = _overlayEl();
  el.classList.remove('show');
  el.querySelector('.lo-txt').textContent = '查詢中,請稍候…';
}
function hideLoading() {
  _pending = Math.max(0, _pending - 1);
  if (_pending === 0) { clearTimeout(_watchdog); forceHideLoading(); }
}

// 將任何字串視為純文字顯示(HTML 轉義,防 XSS)——所有頁面共用
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
// 網址白名單:只放行 http/https,擋掉 javascript:、data: 等危險 scheme(放進 href 前務必用這個)
function safeUrl(u) {
  const s = String(u == null ? '' : u).trim();
  try { const p = new URL(s).protocol; if (p === 'http:' || p === 'https:') return s; } catch (e) {}
  return '';
}

// opts.silent = true 不顯示遮罩(背景更新用);opts.msg 指定遮罩文字
// 回傳 offline:true 代表連線本身失敗(要與「後端回錯誤」分開處理,否則會顯示假訊息)
// 逾時保護:GAS 偶爾會整個不回應,沒有這層畫面會永遠卡在「查詢中」
function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, Object.assign({ signal: ctrl.signal }, options || {}))
    .finally(() => clearTimeout(timer));
}

// 查詢用:GAS 偶發會回非 JSON(轉址那一跳打嗝),自動重試一次再判定失敗
async function gasGet(params, opts) {
  const silent = opts && opts.silent;
  if (!silent) showLoading(opts && opts.msg);
  try {
    const u = new URL(API_BASE);
    Object.keys(params).forEach((k) => u.searchParams.set(k, params[k]));
    let threw = false, timedOut = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetchWithTimeout(u.toString(), { cache: 'no-store' }, 10000);
        const txt = await r.text();
        try { return { ok: r.ok, data: JSON.parse(txt) }; } catch (e) { threw = false; }
      } catch (e) {
        threw = true;
        // 逾時代表伺服器沒回應,重試只會讓使用者多等一倍 → 直接失敗
        if (e && e.name === 'AbortError') { timedOut = true; break; }
      }
      if (attempt === 0) await new Promise((res) => setTimeout(res, 500));
    }
    if (timedOut) return { ok: false, timeout: true, badResponse: true, data: {} };
    return threw ? { ok: false, offline: true, data: {} } : { ok: false, badResponse: true, data: {} };
  } finally { if (!silent) hideLoading(); }
}

// 空位查詢共用快取(60 秒):預約頁與改期頁共用同一份,重看同一天秒出
const AVAIL_TTL = 60 * 1000;
function availCacheKey(date) { return 'av:' + date; }
function readAvailCache(date) {
  try {
    const c = JSON.parse(sessionStorage.getItem(availCacheKey(date)) || 'null');
    return (c && Date.now() - c.t < AVAIL_TTL) ? c.data : null;
  } catch (e) { return null; }
}
function writeAvailCache(date, data) {
  try { sessionStorage.setItem(availCacheKey(date), JSON.stringify({ t: Date.now(), data })); } catch (e) {}
}
function clearAvailCache(date) { try { sessionStorage.removeItem(availCacheKey(date)); } catch (e) {} }
// 查空位:命中快取就直接回(不轉圈),否則向後端查並寫入快取
async function getAvailability(date, opts) {
  const hit = readAvailCache(date);
  if (hit) return { ok: true, cached: true, data: hit };
  const res = await gasGet({ action: 'availability', date }, opts);
  if (res.ok && res.data && typeof res.data.open !== 'undefined') writeAvailCache(date, res.data);
  return res;
}
async function gasPost(body, opts) {
  const silent = opts && opts.silent;
  if (!silent) showLoading(opts && opts.msg);
  try {
    // 送出類不自動重試(避免重複建立預約),但一樣要有逾時,否則會卡住畫面
    const r = await fetchWithTimeout(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    }, 25000);
    const txt = await r.text();
    let data;
    try { data = JSON.parse(txt); } catch (e) { return { ok: false, badResponse: true, data: {} }; }
    return { ok: r.ok && !data.error, data };
  } catch (e) { return { ok: false, offline: true, data: {} }; }
  finally { if (!silent) hideLoading(); }
}

// 依失敗種類給正確說明:分清「你的網路」與「後端忙線」,不要一律賴給使用者
// 回傳空字串代表這不是連線問題(請改用後端回的 error 訊息)
function netMsg(res, what) {
  what = what || '';
  const tail = what ? `,${what}沒有完成` : '';
  if (res && res.timeout) return `訂位系統太久沒有回應${tail}(跟你的網路無關),請再試一次 🙏`;
  if (res && res.offline) return `連不上訂位系統${tail}。請確認你的網路後再試一次 🙏`;
  if (res && res.badResponse) return `訂位系統剛才忙線${tail}(跟你的網路無關),請再試一次 🙏`;
  return '';
}

// 捲到元素並把焦點交過去(漸進揭露/結果畫面共用)
function focusInto(el, opts) {
  if (!el) return;
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  try { el.scrollIntoView({ behavior, block: (opts && opts.block) || 'start' }); } catch (e) { el.scrollIntoView(); }
  const t = (opts && opts.focus) || el;
  if (t) {
    if (!t.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) t.setAttribute('tabindex', '-1');
    setTimeout(() => { try { t.focus({ preventScroll: true }); } catch (e) {} }, 60);
  }
}
