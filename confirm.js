// 前一天「我會到」確認頁(多數人已在 LINE 對話內完成,這頁是備援)
const box = document.getElementById('box');
const token = new URLSearchParams(location.search).get('token');

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

async function run() {
  if (!token) {
    stateBox('🔗', '連結不完整', '請從 LINE 的提醒訊息重新點一次',
      '<a class="primary secondary" href="index.html">前往預約首頁</a>');
    return;
  }
  const resC = await gasPost({ action: 'confirmBooking', token }, { msg: '確認中…' });
  const { ok, data } = resC;
  if (resC.offline || resC.badResponse) {
    stateBox('📶', '暫時無法確認', netMsg(resC, '確認'),
      '<button class="primary" id="retryBtn" type="button">再試一次</button>');
    return;
  }
  if (!ok) {
    stateBox('🔍', '找不到這筆預約', escHtml(data.error || '可能已經取消或改期了'),
      '<a class="primary secondary" href="index.html">重新預約</a>');
    return;
  }
  const b = data.booking;
  box.innerHTML = `
    <div class="success-box">
      <span class="big">✅</span>
      <h2>收到!明天見</h2>
      <p>謝謝你特地回覆 🍓</p>
    </div>
    <div class="detail">
      <div><span class="k">日期</span><span class="v hero">${escHtml(b.date)}(${escHtml(b.weekday)})</span></div>
      <div><span class="k">時段</span><span class="v hero">${escHtml(b.hourLabel)}</span></div>
      <div><span class="k">姓名</span><span class="v">${escHtml(b.name)}</span></div>
    </div>
    <p class="banner warn">⏰ 車位保留至時段開始後 <b>10 分鐘</b>,逾時將先開放給現場客人,請準時抵達 🙏</p>
    <a class="primary secondary" href="cancel.html?token=${encodeURIComponent(token)}">臨時要改期 / 取消?</a>`;
  window.scrollTo({ top: 0, behavior: 'auto' });
  focusInto(box.querySelector('h2'));
}

document.addEventListener('click', (e) => { if (e.target.id === 'retryBtn') location.reload(); });
run();
