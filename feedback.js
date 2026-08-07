// 顧客回饋頁(合規漏斗:先收回饋,高分再引導 Google)
const box = document.getElementById('box');
const token = new URLSearchParams(location.search).get('token');
let reviewUrl = '';
let rating = 0;

const RATING_TEXT = ['', '很不滿意 😔', '不太滿意', '還可以', '滿意 😊', '非常滿意 🤩'];

function fbBanner(type, msg) {
  const el = document.getElementById('fbBanner');
  if (el) el.innerHTML = msg ? `<p class="banner ${type}">${msg}</p>` : '';
}
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
    stateBox('🔗', '連結不完整', '請從 LINE 的訊息重新點一次連結',
      '<a class="primary secondary" href="index.html">前往預約首頁</a>');
    return;
  }
  const cfgRes = await gasGet({ action: 'config' });
  reviewUrl = safeUrl((cfgRes.data && cfgRes.data.reviewUrl) || '');

  const res = await gasGet({ action: 'getBooking', token });
  if (res.offline || res.badResponse) {
    stateBox('📶', '暫時無法載入', netMsg(res, '載入'),
      '<button class="primary" id="retryBtn" type="button">重新載入</button>');
    return;
  }
  if (!res.ok || res.data.error) {
    stateBox('🔍', '這個連結已經失效', escHtml(res.data.error || '找不到對應的預約'),
      '<a class="primary secondary" href="index.html">前往預約首頁</a>');
    return;
  }
  render(res.data.booking);
}

function render(b) {
  box.innerHTML = `
    <h2 style="margin-bottom:4px">今天玩得還開心嗎?</h2>
    <p class="note" style="margin-top:0">嗨 ${escHtml(b.name)},謝謝你 ${escHtml(b.date)} 特地來一趟 🍓<br>只要 30 秒,你的一句話會讓我們變得更好</p>

    <span class="label" id="starsLabel" style="text-align:center">整體滿意度</span>
    <div class="stars" id="stars" role="radiogroup" aria-labelledby="starsLabel">
      ${[1, 2, 3, 4, 5].map((n) => `
        <button type="button" role="radio" aria-checked="false" tabindex="${n === 1 ? 0 : -1}"
                data-n="${n}" aria-label="${n} 分,${RATING_TEXT[n].replace(/[^一-龥]/g, '')}">★</button>`).join('')}
    </div>
    <p class="stars-label" id="starsText" aria-live="polite"></p>

    <label for="cmt">想對我們說的話 <span class="hint">(選填)</span></label>
    <textarea id="cmt" rows="4" maxlength="300"
      placeholder="草莓好不好吃?環境還喜歡嗎?有什麼可以更好的地方?"></textarea>

    <div id="fbBanner" role="alert" aria-live="assertive"></div>
    <button class="primary" id="submitFb" type="button">送出回饋</button>`;

  const btns = Array.from(box.querySelectorAll('#stars button'));
  btns.forEach((s, i) => {
    s.addEventListener('click', () => setRating(Number(s.dataset.n), btns));
    s.addEventListener('keydown', (e) => {
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = btns[(i + 1) % btns.length];
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = btns[(i - 1 + btns.length) % btns.length];
      if (!next) return;
      e.preventDefault();
      next.focus();
      setRating(Number(next.dataset.n), btns);
    });
  });
  document.getElementById('submitFb').addEventListener('click', submit);
}

function setRating(n, btns) {
  rating = n;
  btns.forEach((s, i) => {
    const on = i < n;
    s.classList.toggle('on', on);
    s.setAttribute('aria-checked', String(i + 1 === n));
    s.tabIndex = i + 1 === n ? 0 : -1;
  });
  document.getElementById('starsText').textContent = RATING_TEXT[n];
  fbBanner('', '');
}

async function submit() {
  if (!rating) { fbBanner('err', '請先點星星給個分數'); focusInto(document.getElementById('stars')); return; }
  const comment = document.getElementById('cmt').value.trim();
  const btn = document.getElementById('submitFb');
  btn.disabled = true;
  const resF = await gasPost({ action: 'submitFeedback', token, rating, comment }, { msg: '送出中…' });
  const { ok, data } = resF;
  btn.disabled = false;
  if (!ok) {
    fbBanner('err', netMsg(resF, '送出') || escHtml(data.error || '送出失敗,請稍後再試'));
    return;
  }
  thanks();
}

function thanks() {
  if (rating >= 3) {
    stateBox('🌟', '謝謝你的鼓勵!', '你的肯定是我們最大的動力 🍓',
      reviewUrl
        ? `<a class="primary" href="${escHtml(reviewUrl)}" target="_blank" rel="noopener">順手幫我們在 Google 留個評論 ⭐</a>
           <p class="note">只要 10 秒,會幫助更多人找到我們,真的非常感謝 🙏</p>`
        : '');
  } else {
    stateBox('🙏', '謝謝你願意告訴我們', '我們已經收到你的意見了',
      `<p class="banner info">你的每一句話我們都會認真看。若有需要,我們會盡快與你聯繫,謝謝你給我們變得更好的機會 🍓</p>`);
  }
}

document.addEventListener('click', (e) => { if (e.target.id === 'retryBtn') location.reload(); });
load();
