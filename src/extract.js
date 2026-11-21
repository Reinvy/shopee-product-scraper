'use strict';

const { ScrapeError } = require('./errors');

const IMAGE_BASE = 'https://down-id.img.susercontent.com/file/';

function scale(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n / 1000) / 100 : null;
}

function formatter(currency) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  });
}

function normalizeImages(item) {
  const raw = [];
  if (typeof item.image === 'string') raw.push(item.image);
  if (Array.isArray(item.images)) raw.push(...item.images);

  const seen = new Set();
  const images = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    const src = entry.startsWith('http') ? entry : IMAGE_BASE + entry;
    if (seen.has(src)) continue;
    seen.add(src);
    images.push(src);
  }
  return images;
}

function extractProduct(payload, { url, shopId, itemId, breadcrumbs = [] } = {}) {
  const item = payload?.data?.item;
  if (!item || typeof item !== 'object') {
    throw new ScrapeError('NOT_FOUND', 'Data produk tidak ditemukan di respons Shopee.', 404);
  }
  const name = (item.title || item.name || '').trim();
  if (!name) {
    throw new ScrapeError('NOT_FOUND', 'Nama produk kosong di respons Shopee.', 404);
  }

  const currency = item.currency || 'IDR';
  const price = scale(item.price ?? item.price_min ?? item.price_max);
  const priceMin = scale(item.price_min);
  const priceMax = scale(item.price_max);
  const priceBeforeDiscount = scale(item.price_before_discount);

  const fmt = formatter(currency);
  let priceText = null;
  if (priceMin != null && priceMax != null && priceMin !== priceMax) {
    priceText = `${fmt.format(priceMin)} - ${fmt.format(priceMax)}`;
  } else if (price != null) {
    priceText = fmt.format(price);
  }

  const apiPath = (Array.isArray(item.categories) ? item.categories : [])
    .map((c) => (c && typeof c.display_name === 'string' ? c.display_name.trim() : ''))
    .filter(Boolean);
  const category = apiPath.length ? apiPath : Array.isArray(breadcrumbs) ? breadcrumbs : [];

  const cats = Array.isArray(item.categories) ? item.categories : [];
  const categoryId =
    item.catid ?? (cats.length ? cats[cats.length - 1]?.catid ?? null : null);

  return {
    name,
    images: normalizeImages(item),
    price,
    priceText,
    priceMin,
    priceMax,
    priceBeforeDiscount,
    currency,
    category,
    categoryId,
    shopId,
    itemId,
    url,
  };
}

async function extractDomProduct(page) {
  const dom = await page.evaluate(() => {
    const name = document.querySelector('h1')?.textContent?.trim() || '';
    const text = document.body.innerText || '';
    const priceText = (text.match(/Rp\s?[\d.]+/) || [])[0] || '';
    const images = [...document.images]
      .map((i) => i.src)
      .filter((s) => s.includes('susercontent.com/file/'));
    const category = [
      ...new Set(
        [...document.querySelectorAll('a[href*="-cat."]')]
          .map((a) => a.textContent.trim())
          .filter((t) => t && t.length < 60)
      ),
    ].slice(0, 4);
    return { name, priceText, images, category };
  });

  if (!dom.name || dom.images.length === 0) {
    throw new ScrapeError('NOT_FOUND', 'Produk tidak ditemukan atau tidak bisa dibaca dari halaman.', 404);
  }
  return dom;
}

module.exports = { extractProduct, extractDomProduct, IMAGE_BASE };
