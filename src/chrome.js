'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const { ScrapeError } = require('./errors');

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const PROFILE_DIR = path.resolve(process.env.PROFILE_DIR || '.shopee-profile');

const BASE_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-blink-features=AutomationControlled',
  '--lang=id-ID',
  '--window-size=1366,900',
];

let browser = null;
let context = null;
let child = null;
let chromePid = null;
let launching = null;
let mode = null; // 'cdp' | 'persistent'

function chromeBinary() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (!found) {
    throw new ScrapeError(
      'NO_CHROME',
      'Google Chrome tidak ditemukan. Set CHROME_PATH ke binary Chrome.',
      500
    );
  }
  return found;
}

async function cdpAlive() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCdp(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdpAlive()) return true;
    await sleep(100);
  }
  return false;
}

function adopt(b, ctx, nextMode) {
  browser = b;
  context = ctx;
  mode = nextMode;
  b.on('disconnected', () => {
    if (browser === b) {
      browser = null;
      context = null;
      mode = null;
    }
  });
}

async function attachCdp() {
  const b = await chromium.connectOverCDP(CDP_URL);
  const ctx = b.contexts()[0];
  if (!ctx) {
    await b.close().catch(() => {});
    throw new ScrapeError('SCRAPE_FAILED', 'Chrome terhubung tetapi tidak punya browser context.', 502);
  }
  adopt(b, ctx, 'cdp');
}

async function launchFallback() {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: chromeBinary(),
    headless: false,
    ignoreDefaultArgs: ['--enable-automation'],
    args: BASE_ARGS,
    viewport: { width: 1366, height: 900 },
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
  });
  adopt(ctx.browser(), ctx, 'persistent');
}

async function startChrome() {
  const bin = chromeBinary();
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  child = spawn(
    bin,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      ...BASE_ARGS,
      'about:blank',
    ],
    { stdio: 'ignore', detached: false }
  );
  chromePid = child.pid || null;
  child.on('exit', () => {
    child = null;
    chromePid = null;
  });
  if (!(await waitForCdp())) {
    throw new ScrapeError(
      'NO_CHROME',
      `Chrome tidak merespons di port ${CDP_PORT}. Coba set CDP_PORT ke port lain.`,
      500
    );
  }
}

async function ensureBrowser() {
  if (browser?.isConnected() && context) return;
  if (launching) return launching;

  launching = (async () => {
    browser = null;
    context = null;
    if (await cdpAlive()) {
      await attachCdp();
      return;
    }
    await startChrome();
    try {
      await attachCdp();
    } catch (err) {
      try {
        await launchFallback();
      } catch (fallbackErr) {
        throw new ScrapeError(
          'NO_CHROME',
          `Gagal mengendalikan Chrome: ${err.message} / fallback: ${fallbackErr.message}`,
          500
        );
      }
    }
  })();

  try {
    await launching;
  } finally {
    launching = null;
  }
}

async function getPage() {
  await ensureBrowser();
  const pages = context.pages().filter((p) => !p.isClosed());
  const page = pages[0] || (await context.newPage());
  page.setDefaultTimeout(45000);
  return page;
}

async function sessionStatus() {
  if (!browser?.isConnected() || !context) return { browserOpen: false, loggedIn: false };
  try {
    const cookies = await context.cookies('https://shopee.co.id');
    const names = new Set(cookies.map((c) => c.name));
    return { browserOpen: true, loggedIn: names.has('SPC_U') || names.has('SPC_ST') };
  } catch {
    return { browserOpen: true, loggedIn: false };
  }
}

async function openShopeeLogin() {
  await ensureBrowser();
  const page = await getPage();
  await page.goto('https://shopee.co.id/', { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
}

async function shutdown() {
  // Only tear down a browser we own. A CDP attach to a Chrome we did not spawn
  // is left running so the human keeps their logged-in window.
  if (mode === 'persistent' && browser) {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
  }
  if (child && chromePid) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  browser = null;
  context = null;
  child = null;
  chromePid = null;
  mode = null;
}

module.exports = {
  CDP_PORT,
  PROFILE_DIR,
  chromeBinary,
  ensureBrowser,
  getPage,
  cdpAlive,
  sessionStatus,
  openShopeeLogin,
  shutdown,
};
