'use strict';

const path = require('node:path');
const { chromium } = require('patchright');
const { ScrapeError } = require('./errors');

const PROFILE_DIR = path.resolve(process.env.PROFILE_DIR || '.shopee-profile');

let context = null;
let launching = null;

async function launch() {
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      viewport: null,
      args: ['--no-first-run', '--no-default-browser-check', '--window-size=1366,900'],
      ...(process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : { channel: 'chrome' }),
    });
  } catch (err) {
    throw new ScrapeError(
      'NO_CHROME',
      `Gagal membuka Google Chrome: ${err.message}. Tutup Chrome lain yang memakai profil ini, pasang Google Chrome, atau set CHROME_PATH ke Google Chrome.`,
      500
    );
  }
  context = ctx;
  ctx.on('close', () => {
    if (context === ctx) context = null;
  });
}

async function ensureBrowser() {
  if (context) return;
  if (launching) return launching;
  launching = launch().finally(() => {
    launching = null;
  });
  return launching;
}

async function getPage() {
  await ensureBrowser();
  const pages = context.pages().filter((p) => !p.isClosed());
  const page = pages[0] || (await context.newPage());
  page.setDefaultTimeout(45000);
  return page;
}

async function sessionStatus() {
  if (!context) return { browserOpen: false, loggedIn: false };
  try {
    const cookies = await context.cookies('https://shopee.co.id');
    const user = cookies.find((c) => c.name === 'SPC_U' && c.value);
    const loggedIn = Boolean(
      user && (user.expires === -1 || user.expires * 1000 > Date.now())
    );
    return { browserOpen: true, loggedIn };
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
  if (launching) {
    try {
      await launching;
    } catch {
      /* ignore */
    }
  }
  const ctx = context;
  context = null;
  launching = null;
  if (ctx) {
    try {
      await ctx.close();
    } catch {
      /* ignore */
    }
  }
}

module.exports = { ensureBrowser, getPage, sessionStatus, openShopeeLogin, shutdown };
