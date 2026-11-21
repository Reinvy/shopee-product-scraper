'use strict';

const { ScrapeError } = require('./errors');
const { normalizeInput, isShopeeHost, isVerifyUrl } = require('./url');
const { ensureBrowser, getPage, sessionStatus, openShopeeLogin } = require('./chrome');
const { extractProduct, extractDomProduct } = require('./extract');

const MIN_GAP_MS = 1500;
const PDP_TIMEOUT_MS = 30000;
const NAV_TIMEOUT_MS = 45000;
const VERIFY_TIMEOUT_MS = 180000; // 3 minutes for the human
const VERIFY_POLL_MS = 500;
const POST_VERIFY_SETTLE_MS = 1500;

let chain = Promise.resolve();
let lastRun = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pace() {
  if (lastRun) {
    const wait = MIN_GAP_MS - (Date.now() - lastRun);
    if (wait > 0) await sleep(wait);
  }
  lastRun = Date.now();
}

function scrapeProduct(input) {
  const run = chain.then(() => runScrape(input), () => runScrape(input));
  chain = run.catch(() => {});
  return run;
}

function isProductPage(raw, target) {
  try {
    const u = new URL(raw);
    if (!isShopeeHost(u.hostname)) return false;
    const parts = u.pathname.split('/').filter(Boolean);
    const at = parts.indexOf('product');
    if (at !== -1 && parts[at + 1] === target.shopId && parts[at + 2] === target.itemId) {
      return true;
    }
    const legacy = new RegExp(`-i\\.${target.shopId}\\.${target.itemId}$`);
    return parts.some((p) => legacy.test(p));
  } catch {
    return false;
  }
}

function capturePdpResponses(page, target) {
  const responses = [];
  const onResponse = (response) => {
    let u;
    try {
      u = new URL(response.url());
    } catch {
      return;
    }
    if (!u.pathname.endsWith('/api/v4/pdp/get_pc')) return;
    if (u.searchParams.get('item_id') !== target.itemId) return;
    if (responses.length < 10) responses.push(response);
  };
  page.on('response', onResponse);
  return { responses, stop: () => page.off('response', onResponse) };
}

async function waitForVerification(page, { timeoutMs = VERIFY_TIMEOUT_MS, pollMs = VERIFY_POLL_MS } = {}) {
  await page.bringToFront().catch(() => {});
  if (!page.isClosed()) console.log('[scrape] Shopee meminta verifikasi:', page.url());
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new ScrapeError(
        'BLOCKED',
        'Jendela Chrome ditutup saat mengambil data. Buka lagi lewat tombol Login Shopee.',
        502
      );
    }
    if (!isVerifyUrl(page.url())) return page.url();
    await sleep(pollMs);
  }
  throw new ScrapeError(
    'BLOCKED',
    'Verifikasi Shopee belum selesai dalam 3 menit. Selesaikan captcha di jendela Chrome, lalu klik Ambil Data lagi. Jika captcha terus muncul, keluar dari akun Shopee lalu masuk kembali lewat tombol Login Shopee.',
    502
  );
}

async function waitForPdp(page, responses, sinceIndex, timeoutMs = PDP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new ScrapeError(
        'BLOCKED',
        'Jendela Chrome ditutup saat mengambil data. Buka lagi lewat tombol Login Shopee.',
        502
      );
    }
    if (isVerifyUrl(page.url())) return { type: 'verify' };
    if (responses.length > sinceIndex) return { type: 'response' };
    await sleep(250);
  }
  return { type: 'timeout' };
}

async function readPdpPayload(responses, since = 0) {
  let firstError = null;
  for (let i = responses.length - 1; i >= 0; i--) {
    try {
      const payload = await responses[i].json();
      if (payload?.data?.item) return { payload, error: null };
      if (payload?.error && !firstError && i >= since) firstError = payload;
    } catch {
      // Response body no longer available; ignore and keep scanning.
    }
  }
  return { payload: null, error: firstError };
}

async function runScrape(input) {
  await pace();

  await ensureBrowser();
  const status = await sessionStatus();
  if (!status.loggedIn) {
    await openShopeeLogin();
    throw new ScrapeError(
      'LOGIN_REQUIRED',
      'Sesi Shopee belum login. Jendela Chrome sudah dibuka — masuk ke Shopee, lalu coba lagi.',
      401
    );
  }

  const target = await normalizeInput(input);
  const page = await getPage();
  await page.bringToFront().catch(() => {});

  const capture = capturePdpResponses(page, target);
  try {
    const gotoProduct = async () => {
      try {
        await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      } catch {
        // A verify redirect can abort navigation; the URL check classifies it.
      }
    };

    await gotoProduct();

    let since = 0;
    let verifyRounds = 0;
    let reloads = 0;
    let verifyDeadline = 0;

    for (;;) {
      const state = await waitForPdp(page, capture.responses, since);

      if (state.type === 'verify') {
        if (++verifyRounds > 2) {
          throw new ScrapeError(
            'BLOCKED',
            'Shopee terus meminta verifikasi. Selesaikan captcha di jendela Chrome; jika berulang, keluar dari akun Shopee lalu masuk kembali lewat tombol Login Shopee.',
            502
          );
        }
        if (!verifyDeadline) verifyDeadline = Date.now() + VERIFY_TIMEOUT_MS;
        const beforeVerify = capture.responses.length;
        await waitForVerification(page, {
          timeoutMs: Math.max(1, verifyDeadline - Date.now()),
        });
        await sleep(POST_VERIFY_SETTLE_MS);
        since = beforeVerify;
        if (isVerifyUrl(page.url())) continue;
        if (!isProductPage(page.url(), target)) await gotoProduct();
        continue;
      }

      if (state.type === 'response') {
        const { payload, error } = await readPdpPayload(capture.responses, since);
        if (payload?.data?.item) {
          const breadcrumbs = await page
            .$$eval('a[href*="-cat."]', (els) =>
              [...new Set(els.map((e) => e.textContent.trim()).filter((t) => t && t.length < 60))].slice(0, 4)
            )
            .catch(() => []);
          return extractProduct(payload, { ...target, breadcrumbs });
        }
        if (error?.error === 90309999) {
          const after = await sessionStatus();
          if (after.loggedIn) {
            throw new ScrapeError(
              'BLOCKED',
              'Shopee menolak request API (90309999) meski halaman produk terbuka. Coba Ambil Data sekali lagi; jika tetap, keluar dari akun Shopee lalu masuk kembali lewat tombol Login Shopee.',
              502
            );
          }
          throw new ScrapeError(
            'LOGIN_REQUIRED',
            'Sesi Shopee sudah tidak valid. Masuk kembali lewat tombol Login Shopee.',
            401
          );
        }
        if (reloads++ >= 1) break;
        since = capture.responses.length;
        await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => {});
        continue;
      }

      if (reloads++ >= 1) break;
      if (isVerifyUrl(page.url())) continue;
      since = capture.responses.length;
      await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => {});
    }

    if (isVerifyUrl(page.url())) {
      throw new ScrapeError(
        'BLOCKED',
        'Shopee masih meminta verifikasi. Selesaikan captcha di jendela Chrome, lalu coba lagi.',
        502
      );
    }
    if (!isProductPage(page.url(), target)) {
      throw new ScrapeError(
        'BLOCKED',
        'Shopee mengalihkan ke halaman lain dan data produk tidak ditemukan. Selesaikan verifikasi di jendela Chrome, lalu coba lagi.',
        502
      );
    }

    const dom = await extractDomProduct(page);
    return {
      name: dom.name,
      images: dom.images,
      price: null,
      priceText: dom.priceText || null,
      priceMin: null,
      priceMax: null,
      priceBeforeDiscount: null,
      currency: 'IDR',
      category: dom.category || [],
      categoryId: null,
      shopId: target.shopId,
      itemId: target.itemId,
      url: target.url,
    };
  } finally {
    capture.stop();
  }
}

module.exports = { scrapeProduct, MIN_GAP_MS, waitForPdp, waitForVerification, readPdpPayload };
