// 與 Google Apps Script 後端溝通的小工具
// 注意:POST 用 text/plain 避免瀏覽器 CORS 預檢(GAS 對預檢支援不佳)
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || '';

async function gasGet(params) {
  const u = new URL(API_BASE);
  Object.keys(params).forEach((k) => u.searchParams.set(k, params[k]));
  const r = await fetch(u.toString());
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}
async function gasPost(body) {
  const r = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok && !data.error, data };
}
