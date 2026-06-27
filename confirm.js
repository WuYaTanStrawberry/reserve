// 前一天「我會到」確認頁
const box = document.getElementById('box');
const token = new URLSearchParams(location.search).get('token');

async function run() {
  if (!token) { box.innerHTML = '<div class="banner err">連結不正確</div>'; return; }
  const { ok, data } = await gasPost({ action: 'confirmBooking', token });
  if (!ok) { box.innerHTML = `<div class="banner warn">${data.error || '確認失敗'}</div>`; return; }
  const b = data.booking;
  box.innerHTML = `
    <div class="success-box">
      <div class="big">✅</div>
      <h2>已確認,明天見!</h2>
      <p class="muted">${b.date}(星期${b.weekday})${b.hourLabel}</p>
      <div class="banner ok" style="margin-top:10px">謝謝您的確認 🍓 期待您的到來!</div>
      <p class="note">⏰ 提醒:車位保留至預約時段開始後 10 分鐘,請準時抵達。</p>
      <a class="primary" style="display:block;text-align:center;text-decoration:none;background:#fff;color:var(--berry);border:1.5px solid var(--berry)" href="cancel.html?token=${token}">需要改期 / 取消?</a>
    </div>`;
}

run();
