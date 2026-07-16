// 顧客回饋頁(合規漏斗:先收回饋,高分再引導 Google)
const box = document.getElementById('box');
const token = new URLSearchParams(location.search).get('token');
let reviewUrl = '';
let rating = 0;

function fbBanner(type, msg) { const el = document.getElementById('fbBanner'); if (el) el.innerHTML = msg ? `<div class="banner ${type}">${msg}</div>` : ''; }

async function load() {
  if (!token) { box.innerHTML = '<div class="banner err">連結不正確</div>'; return; }
  const cfg = (await gasGet({ action: 'config' })).data;
  reviewUrl = cfg.reviewUrl || '';
  const r = await gasGet({ action: 'getBooking', token });
  if (!r.ok || r.data.error) { box.innerHTML = `<div class="banner warn">${r.data.error || '連結無效'}</div>`; return; }
  render(r.data.booking);
}

function render(b) {
  box.innerHTML = `
    <p>嗨 ${escHtml(b.name)},謝謝您 ${b.date} 的光臨 🍓</p>
    <label>整體滿意度(點星星)</label>
    <div class="stars" id="stars">${[1, 2, 3, 4, 5].map((n) => `<span data-n="${n}">☆</span>`).join('')}</div>
    <label for="cmt">想對我們說的話(選填)</label>
    <textarea id="cmt" rows="4" placeholder="有什麼建議,或喜歡的地方,都歡迎告訴我們"></textarea>
    <div id="fbBanner"></div>
    <button class="primary" id="submitFb">送出回饋</button>`;
  const stars = box.querySelectorAll('#stars span');
  stars.forEach((s) => s.addEventListener('click', () => {
    rating = Number(s.dataset.n);
    stars.forEach((x, i) => (x.textContent = i < rating ? '★' : '☆'));
  }));
  document.getElementById('submitFb').addEventListener('click', submit);
}

async function submit() {
  if (!rating) { fbBanner('err', '請先點星星評分'); return; }
  const comment = document.getElementById('cmt').value.trim();
  const btn = document.getElementById('submitFb');
  btn.disabled = true;
  const { ok, data } = await gasPost({ action: 'submitFeedback', token, rating, comment });
  if (!ok) { btn.disabled = false; fbBanner('err', data.error || '送出失敗,請稍後再試'); return; }
  thanks();
}

function thanks() {
  if (rating >= 3) {
    const link = safeUrl(reviewUrl); // 只允許 http/https,並在放進 href 前轉義
    box.innerHTML = `
      <div class="success-box">
        <div class="big">🌟</div>
        <h2>謝謝您的肯定!</h2>
        <p class="muted">您的鼓勵是我們最大的動力 🍓</p>
        ${link ? `<a class="primary" style="display:block;text-align:center;text-decoration:none" href="${escHtml(link)}" target="_blank" rel="noopener">順手到 Google 給我們一顆星 ⭐</a>` : ''}
      </div>`;
  } else {
    box.innerHTML = `
      <div class="success-box">
        <div class="big">🙏</div>
        <h2>謝謝您誠實的回饋</h2>
        <p class="muted">我們已經收到您的意見,會認真檢討改進;若需要,我們會盡快與您聯繫,謝謝您給我們變得更好的機會 🍓</p>
      </div>`;
  }
}

load();
