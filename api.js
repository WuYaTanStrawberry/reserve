// 與 Google Apps Script 後端溝通的小工具
// 注意:POST 用 text/plain 避免瀏覽器 CORS 預檢(GAS 對預檢支援不佳)
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || '';

// ---- 載入中遮罩(查詢/送出時顯示「處理中,請稍候…」)----
let _pending = 0;
function _overlayEl() {
  let el = document.getElementById('loadingOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loadingOverlay';
    el.innerHTML = '<div class="lo-box"><img class="lo-logo" src="logo.png" alt=""><div class="lo-txt">查詢中,請稍候…</div></div>';
    document.body.appendChild(el);
  }
  return el;
}
function showLoading() { _pending++; _overlayEl().classList.add('show'); }
function hideLoading() { _pending = Math.max(0, _pending - 1); if (_pending === 0) _overlayEl().classList.remove('show'); }

// opts.silent = true 時不顯示轉圈遮罩(供背景更新使用)
async function gasGet(params, opts) {
  const silent = opts && opts.silent;
  if (!silent) showLoading();
  try {
    const u = new URL(API_BASE);
    Object.keys(params).forEach((k) => u.searchParams.set(k, params[k]));
    const r = await fetch(u.toString());
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
  } catch (e) { return { ok: false, data: {} }; }
  finally { if (!silent) hideLoading(); }
}
async function gasPost(body, opts) {
  const silent = opts && opts.silent;
  if (!silent) showLoading();
  try {
    const r = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok && !data.error, data };
  } catch (e) { return { ok: false, data: {} }; }
  finally { if (!silent) hideLoading(); }
}
