'use strict';

const { ScrapeError } = require('./errors');

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

const SHOPEE_HOST = /(^|\.)shopee\.co\.id$/i;

function isShopeeHost(hostname) {
  return SHOPEE_HOST.test(hostname || '');
}

function isShortLink(raw) {
  try {
    return new URL(raw).hostname.endsWith('shp.ee');
  } catch {
    return false;
  }
}

function parseProductUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!isShopeeHost(u.hostname)) return null;

  const pathMatch = u.pathname.match(/\/product\/(\d+)\/(\d+)(?:\/|$)/);
  if (pathMatch) {
    return {
      shopId: pathMatch[1],
      itemId: pathMatch[2],
      url: `https://shopee.co.id/product/${pathMatch[1]}/${pathMatch[2]}`,
    };
  }

  const legacy = `${u.pathname}${u.search}`.match(/-i\.(\d+)\.(\d+)/);
  if (legacy) {
    return {
      shopId: legacy[1],
      itemId: legacy[2],
      url: `https://shopee.co.id/product/${legacy[1]}/${legacy[2]}`,
    };
  }

  return null;
}

async function resolveShortLink(raw, { maxHops = 5 } = {}) {
  let current;
  try {
    current = new URL(raw).toString();
  } catch {
    throw new ScrapeError('INVALID_URL', 'Link Shopee tidak valid: ' + raw);
  }

  for (let hop = 0; hop < maxHops; hop++) {
    let hostname;
    try {
      hostname = new URL(current).hostname;
    } catch {
      throw new ScrapeError('INVALID_URL', 'Link Shopee tidak valid: ' + raw);
    }
    if (!hostname.endsWith('shp.ee')) return current;

    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        headers: { 'user-agent': UA, accept: 'text/html,*/*' },
      });
    } catch {
      throw new ScrapeError('INVALID_URL', 'Link Shopee tidak bisa dibuka: ' + raw);
    }

    const location = res.headers.get('location');
    if (!location) return current;
    try {
      current = new URL(location, current).toString();
    } catch {
      throw new ScrapeError('INVALID_URL', 'Link Shopee tidak bisa dibuka: ' + raw);
    }
  }
  return current;
}

async function normalizeInput(raw) {
  const input = typeof raw === 'string' ? raw.trim() : '';
  if (!input) throw new ScrapeError('INVALID_URL', 'Masukkan link produk Shopee.');

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new ScrapeError('INVALID_URL', 'Link tidak valid: tempel URL lengkap, mis. https://id.shp.ee/xxxx atau https://shopee.co.id/product/1/2');
  }

  let candidate = parsed.toString();
  if (isShortLink(candidate)) {
    candidate = await resolveShortLink(candidate);
  }

  const product = parseProductUrl(candidate);
  if (!product) {
    throw new ScrapeError('INVALID_URL', 'Bukan link produk Shopee yang dikenali: ' + input);
  }
  return product;
}

module.exports = {
  UA,
  isShortLink,
  parseProductUrl,
  resolveShortLink,
  normalizeInput,
};
