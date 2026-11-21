'use strict';

const path = require('node:path');
const express = require('express');
const { ScrapeError } = require('./src/errors');
const { sessionStatus, openShopeeLogin, shutdown } = require('./src/chrome');
const { scrapeProduct } = require('./src/scrape');

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/session', async (req, res) => {
  try {
    res.json(await sessionStatus());
  } catch (err) {
    console.error(err);
    res.json({ browserOpen: false, loggedIn: false });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    await openShopeeLogin();
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof ScrapeError) {
      return res.status(err.status).json({ ok: false, code: err.code, message: err.message });
    }
    console.error(err);
    res.status(500).json({ ok: false, code: 'UNKNOWN', message: 'Gagal membuka jendela Chrome.' });
  }
});

app.post('/api/scrape', async (req, res) => {
  try {
    const product = await scrapeProduct(req.body?.url || '');
    res.json({ ok: true, product });
  } catch (err) {
    if (err instanceof ScrapeError) {
      return res.status(err.status).json({ ok: false, code: err.code, message: err.message });
    }
    console.error(err);
    res.status(500).json({ ok: false, code: 'UNKNOWN', message: 'Terjadi kesalahan tak terduga.' });
  }
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err?.type === 'entity.parse.failed' || err?.status === 400) {
    return res.status(400).json({ ok: false, code: 'INVALID_URL', message: 'Body JSON tidak valid.' });
  }
  console.error(err);
  res.status(500).json({ ok: false, code: 'UNKNOWN', message: 'Terjadi kesalahan tak terduga.' });
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`Shopee scraper: http://127.0.0.1:${PORT}`);
});

async function stop() {
  server.close();
  await shutdown();
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
