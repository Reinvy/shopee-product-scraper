'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProductUrl, normalizeInput } = require('../src/url');

const FULL =
  'https://shopee.co.id/product/1516969716/41660748693?d_id=17c39&uls_trackid=5767d8im02g7&utm_content=PPEZDJ71VTZzsQ6NkgZVf2gMSu5';

test('parses full product URL with tracking query', () => {
  const parsed = parseProductUrl(FULL);
  assert.equal(parsed.shopId, '1516969716');
  assert.equal(parsed.itemId, '41660748693');
});

test('parses legacy -i.{shop}.{item} URL', () => {
  const parsed = parseProductUrl(
    'https://shopee.co.id/Iphone-IP-15-128-i.1516969716.41660748693?sp_atk=abc'
  );
  assert.equal(parsed.shopId, '1516969716');
  assert.equal(parsed.itemId, '41660748693');
});

test('rejects foreign hosts and garbage', () => {
  assert.equal(parseProductUrl('https://example.com/product/1/2'), null);
  assert.equal(parseProductUrl('not a url'), null);
  assert.equal(parseProductUrl('https://shopee.co.id/'), null);
});

test('normalizeInput rejects non-Shopee links with INVALID_URL', async () => {
  await assert.rejects(normalizeInput('https://example.com/foo'), (e) => e.code === 'INVALID_URL');
  await assert.rejects(normalizeInput(''), (e) => e.code === 'INVALID_URL');
});

test('normalizeInput canonicalizes a full product URL without network', async () => {
  const target = await normalizeInput(FULL);
  assert.deepEqual(target, {
    shopId: '1516969716',
    itemId: '41660748693',
    url: 'https://shopee.co.id/product/1516969716/41660748693',
  });
});
