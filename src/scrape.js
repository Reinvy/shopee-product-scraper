'use strict';

const { ScrapeError } = require('./errors');
const { normalizeInput } = require('./url');
const { ensureBrowser, getPage, sessionStatus, openShopeeLogin } = require('./chrome');
const { extractProduct, extractDomProduct } = require('./extract');

const MIN_GAP_MS = 1500;
const PDP_TIMEOUT_MS = 30000;
const NAV_TIMEOUT_MS = 45000;

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

async function fetchPdpInPage(page, { shopId, itemId }) {
  try {
    return await page.evaluate(
      async ({ shopId: sid, itemId: iid }) => {
        const r = await fetch(
          `https://shopee.co.id/api/v4/pdp/get_pc?item_id=${iid}&shop_id=${sid}&detail_level=0`,
          { headers: { 'x-api-source': 'pc' }, credentials: 'include' }
        );
        return r.json();
      },
      { shopId, itemId }
    );
  } catch {
    return null;
  }
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

  const pdpPromise = page
    .waitForResponse(
      (r) =>
        r.url().includes('/api/v4/pdp/get_pc') && r.url().includes('item_id=' + target.itemId),
      { timeout: PDP_TIMEOUT_MS }
    )
    .catch(() => null);

  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  } catch {
    // A verify redirect can abort navigation; the URL check below classifies it.
  }

  if (page.url().includes('/verify/')) {
    throw new ScrapeError(
      'BLOCKED',
      'Shopee meminta verifikasi. Selesaikan captcha/login di jendela Chrome, lalu coba lagi.',
      502
    );
  }

  const resp = await pdpPromise;
  let payload = null;
  if (resp) {
    try {
      payload = await resp.json();
    } catch {
      payload = null;
    }
  }
  if (!payload) {
    payload = await fetchPdpInPage(page, target);
  }

  const hasItem = Boolean(payload?.data?.item);
  if (payload?.error === 90309999 || (!hasItem && page.url().includes('/verify/'))) {
    const after = await sessionStatus();
    if (after.loggedIn) {
      throw new ScrapeError(
        'BLOCKED',
        'Shopee menolak permintaan (anti-bot). Selesaikan verifikasi di jendela Chrome, lalu coba lagi.',
        502
      );
    }
    throw new ScrapeError(
      'LOGIN_REQUIRED',
      'Sesi Shopee sudah tidak valid. Masuk kembali lewat tombol Login Shopee.',
      401
    );
  }

  if (hasItem) {
    const breadcrumbs = await page
      .$$eval('a[href*="-cat."]', (els) =>
        [...new Set(els.map((e) => e.textContent.trim()).filter((t) => t && t.length < 60))].slice(0, 4)
      )
      .catch(() => []);
    return extractProduct(payload, { ...target, breadcrumbs });
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
}

module.exports = { scrapeProduct, MIN_GAP_MS };
