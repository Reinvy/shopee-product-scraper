'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  dot: $('statusDot'),
  status: $('statusText'),
  login: $('loginBtn'),
  form: $('scrapeForm'),
  input: $('urlInput'),
  submit: $('submitBtn'),
  loading: $('loading'),
  errorBox: $('errorBox'),
  errorCode: $('errorCode'),
  errorMessage: $('errorMessage'),
  result: $('result'),
  mainImage: $('mainImage'),
  thumbs: $('thumbs'),
  name: $('productName'),
  price: $('productPrice'),
  category: $('productCategory'),
  link: $('productLink'),
};

async function refreshSession() {
  try {
    const res = await fetch('/api/session');
    const s = await res.json();
    if (s.loggedIn) {
      els.dot.className = 'dot on';
      els.status.textContent = 'Sudah login';
    } else if (s.browserOpen) {
      els.dot.className = 'dot warn';
      els.status.textContent = 'Belum login';
    } else {
      els.dot.className = 'dot off';
      els.status.textContent = 'Browser belum dibuka';
    }
  } catch {
    els.dot.className = 'dot off';
    els.status.textContent = 'Server tidak merespons';
  }
}

function showError(code, message) {
  els.errorBox.hidden = false;
  els.errorCode.textContent = code || 'ERROR';
  els.errorMessage.textContent = message || '';
  els.login.classList.toggle('attention', code === 'LOGIN_REQUIRED');
}

function clearError() {
  els.errorBox.hidden = true;
  els.errorCode.textContent = '';
  els.errorMessage.textContent = '';
  els.login.classList.remove('attention');
}

function renderProduct(p) {
  els.result.hidden = false;
  els.name.textContent = p.name || '(tanpa nama)';
  els.price.textContent = p.priceText || (p.price != null ? String(p.price) : 'Harga tidak tersedia');
  const cats = Array.isArray(p.category) ? p.category : [];
  els.category.textContent = cats.length ? cats.join(' > ') : '';
  els.link.href = p.url || '#';

  const images = Array.isArray(p.images) ? p.images : [];
  els.mainImage.src = images[0] || '';
  els.mainImage.alt = p.name || 'Foto produk';

  els.thumbs.replaceChildren(
    ...images.slice(1, 5).map((src) => {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('click', () => {
        els.mainImage.src = src;
      });
      return img;
    })
  );
}

async function login() {
  els.login.disabled = true;
  try {
    const res = await fetch('/api/login', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.ok) showError(data.code, data.message);
  } catch {
    showError('UNKNOWN', 'Gagal menghubungi server.');
  } finally {
    els.login.disabled = false;
    refreshSession();
  }
}

async function submit(event) {
  event.preventDefault();
  const url = els.input.value.trim();
  if (!url) return;

  clearError();
  els.result.hidden = true;
  els.loading.textContent = 'Mengambil data…';
  els.loading.hidden = false;
  els.login.disabled = true;
  els.submit.disabled = true;
  els.input.disabled = true;
  const slowTimer = setTimeout(() => {
    if (!els.loading.hidden) {
      els.loading.textContent = 'Masih memproses… jika jendela Chrome meminta verifikasi, selesaikan captcha di sana.';
    }
  }, 8000);

  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      renderProduct(data.product);
    } else {
      showError(data.code, data.message);
    }
  } catch {
    showError('UNKNOWN', 'Gagal menghubungi server.');
  } finally {
    clearTimeout(slowTimer);
    els.loading.textContent = 'Mengambil data…';
    els.loading.hidden = true;
    els.login.disabled = false;
    els.submit.disabled = false;
    els.input.disabled = false;
    refreshSession();
  }
}

els.login.addEventListener('click', login);
els.form.addEventListener('submit', submit);

refreshSession();
setInterval(refreshSession, 2000);
