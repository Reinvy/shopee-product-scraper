'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { waitForPdp, waitForVerification, readPdpPayload } = require('../src/scrape');

test('waitForPdp reports the captcha before an old anti-bot response', async () => {
  const page = {
    isClosed: () => false,
    url: () => 'https://shopee.co.id/verify/captcha?anti_bot_tracking_id=x',
  };
  const state = await waitForPdp(page, [{}], 0, 1000);
  assert.equal(state.type, 'verify');
});

test('waitForVerification waits until the captcha URL clears', async () => {
  let calls = 0;
  const page = {
    isClosed: () => false,
    url: () =>
      ++calls < 3
        ? 'https://shopee.co.id/verify/captcha?anti_bot_tracking_id=x'
        : 'https://shopee.co.id/product/1568183210/28542751379',
    bringToFront: async () => {},
  };
  const url = await waitForVerification(page, { timeoutMs: 1000, pollMs: 1 });
  assert.equal(url, 'https://shopee.co.id/product/1568183210/28542751379');
});

test('waitForVerification times out with BLOCKED', async () => {
  const page = {
    isClosed: () => false,
    url: () => 'https://shopee.co.id/verify/captcha?anti_bot_tracking_id=x',
    bringToFront: async () => {},
  };
  await assert.rejects(
    waitForVerification(page, { timeoutMs: 5, pollMs: 1 }),
    (e) => e.code === 'BLOCKED'
  );
});

test('readPdpPayload prefers a successful get_pc payload over 90309999', async () => {
  const responses = [
    { json: async () => ({ error: 90309999 }) },
    { json: async () => ({ data: { item: { title: 'Produk' } } }) },
  ];
  const { payload, error } = await readPdpPayload(responses);
  assert.equal(error, null);
  assert.equal(payload.data.item.title, 'Produk');
});
