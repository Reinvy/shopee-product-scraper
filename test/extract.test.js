'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractProduct } = require('../src/extract');

const fixture = require('./fixtures/get_pc.json');

const TARGET = {
  url: 'https://shopee.co.id/product/1516969716/41660748693',
  shopId: '1516969716',
  itemId: '41660748693',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('extracts name, images, price and category from get_pc payload', () => {
  const product = extractProduct(fixture, TARGET);
  assert.equal(product.name, 'Iphone IP 15 128 BNIB Garansi Resmi Indo');
  assert.equal(product.images.length, 2);
  assert.equal(product.images[0], 'https://down-id.img.susercontent.com/file/id-11134207-7r98o-abc123');
  assert.equal(product.price, 74700);
  assert.equal(product.priceText.replace(/\s/g, ''), 'Rp74.700');
  assert.deepEqual(product.category, ['Elektronik', 'Handphone & Tablet']);
  assert.equal(product.categoryId, 11042724);
  assert.equal(product.url, TARGET.url);
  assert.equal(product.shopId, TARGET.shopId);
  assert.equal(product.itemId, TARGET.itemId);
});

test('throws NOT_FOUND when data.item is missing', () => {
  assert.throws(
    () => extractProduct({ error: 0, data: {} }, TARGET),
    (e) => e.code === 'NOT_FOUND'
  );
});

test('formats a price range with both amounts', () => {
  const payload = clone(fixture);
  delete payload.data.item.price;
  payload.data.item.price_min = 1000000000;
  payload.data.item.price_max = 2000000000;
  const product = extractProduct(payload, TARGET);
  assert.ok(product.priceText.includes('Rp'), 'has currency');
  const compact = product.priceText.replace(/\s/g, '');
  assert.ok(compact.includes('Rp10.000'), product.priceText);
  assert.ok(compact.includes('Rp20.000'), product.priceText);
});

test('falls back to breadcrumbs when display_name is empty', () => {
  const payload = clone(fixture);
  payload.data.item.categories = [{ catid: 1, display_name: '' }, { catid: 2 }];
  const product = extractProduct(payload, { ...TARGET, breadcrumbs: ['A', 'B'] });
  assert.deepEqual(product.category, ['A', 'B']);
});
