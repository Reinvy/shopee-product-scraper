# Shopee Product Scraper (Prototype)

Web app lokal: tempel link produk Shopee (short `https://id.shp.ee/...` atau full
`https://shopee.co.id/product/{shopId}/{itemId}`), lalu dapatkan **nama, foto, harga,
kategori**, dan link kembali ke produk.

## Kenapa harus login?

Sejak September 2026 Shopee hanya menyajikan harga/rating/terjual untuk sesi yang login,
dan request API anonim (termasuk browser headless baru) diarahkan ke
`/verify/traffic/error?type=4` atau dijawab `{"error":90309999}`.

Supaya tetap tanpa biaya, app ini memakai **Chrome asli dengan profil persisten** yang
Anda login sekali secara manual. Scrape berjalan di jendela Chrome itu dan menangkap
respons `get_pc` milik Shopee sendiri. Tidak ada login otomatis, tidak ada kredensial
yang disimpan selain cookie di folder profil Chrome lokal.

Drivernya **Patchright** — fork Playwright yang menghapus kebocoran `Runtime.enable` /
`Console.enable` yang dipakai Shopee untuk mendeteksi browser otomatis — dan Chrome
diluncurkan lewat `launchPersistentContext` dengan `channel: 'chrome'`, `viewport: null`,
tanpa emulasi locale/timezone.

## Prasyarat

- Node.js >= 20 (diuji di Node 24)
- Google Chrome terpasang (`/usr/bin/google-chrome`)
- Akun Shopee (untuk login sekali)
- Display X/Wayland aktif — Chrome dibuka sebagai jendela biasa (bukan headless)

## Setup

```bash
npm install
npm start
```

Buka <http://localhost:3001>.

## Cara pakai

1. Klik **Login Shopee**. Jendela Chrome terbuka di shopee.co.id.
2. Masuk ke akun Shopee di jendela itu (selesaikan captcha bila muncul). Cukup sekali;
   sesi tersimpan di `.shopee-profile/`.
3. Kembali ke UI, status berubah menjadi **Sudah login**.
4. Tempel link produk, klik **Ambil Data**.

## Batasan

- Satu request diproses pada satu waktu (antrean), jeda minimum 1,5 detik antar scrape.
- Harga dari Shopee disimpan ×100 000; app membaginya kembali (`7470000000` → `Rp 74.700`).
- Sesi bisa kedaluwarsa — login ulang lewat tombol yang sama.
- Kalau Shopee meminta verifikasi, selesaikan di jendela Chrome lalu coba lagi.
- Prototipe untuk pemakaian pribadi. Hormati Terms of Service Shopee; jangan pakai untuk
  scraping massal.

## Troubleshooting

| Gejala | Solusi |
| --- | --- |
| `LOGIN_REQUIRED` / `BLOCKED` dengan error `90309999` | Selesaikan login/captcha di jendela Chrome, lalu scrape lagi. |
| `NO_CHROME` | Set `CHROME_PATH=/path/ke/google-chrome` (Google Chrome, bukan Chromium). |
| Captcha masih muncul setelah login | Hentikan app, backup profil aktif, mulai lagi dengan profil baru, login sekali. Kalau masih muncul, laporkan URL `/verify` yang dituju. |
| Port 3001 sudah dipakai | Set `PORT=3002`. |
| Ingin profil lain | Set `PROFILE_DIR=/path/ke/profil`. |

Konfigurasi lewat environment variable: `PORT`, `CHROME_PATH`, `PROFILE_DIR`.

## Tes

```bash
npm test
```

Unit test menutup parsing URL dan ekstraksi payload `get_pc`; tidak menyentuh jaringan
maupun heuristik DOM.

## Struktur

- `server.js` — HTTP server + API (`/api/session`, `/api/login`, `/api/scrape`).
- `src/url.js` — normalisasi link pendek/penuh.
- `src/chrome.js` — launch Chrome via Patchright, profil persisten, cek cookie login.
- `src/scrape.js` — antrean, navigasi, intersepsi `get_pc`, klasifikasi error.
- `src/extract.js` — payload → produk; fallback DOM.
- `public/` — UI vanilla HTML/CSS/JS.
