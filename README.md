# FB Marketplace Auto Renew (Firefox)

Ekstensi starter Firefox (Manifest V2) untuk me-renew listing Facebook Marketplace
pada GUI saat **FB mengizinkan** pembaharuan (tombol Renew muncul, umumnya ±7 hari
setelah terbit, bisa beberapa kali per listing).

## Fitur

- **Cek harian otomatis** via `alarms` API — sekali sehari membuka/merefresh halaman
  "Your items" (`facebook.com/marketplace/you`) dan me-renew semua listing yang FB izinkan.
- **Tombol "Renew Sekarang"** manual dari popup.
- Delay acak antar item (4–15 detik) + batas listing per run (default 10) supaya
  polanya tidak seperti bot.
- Riwayat run + statistik total renew di popup, badge angka di ikon ekstensi.

## Cara Install (temporary / developer)

1. Buka `about:debugging` → **This Firefox** → **Load Temporary Add-on…**
2. Pilih file `manifest.json` di folder ekstensi.
3. Pin ikonnya, buka popup → klik **Renew Sekarang** dengan halaman marketplacemu terbuka.

Sumber daya Firefox: developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions

## Cara Kerja

1. `background.js` — alarm sekali sehari. Saat nyala: set flag `pending`
   di `storage.local`, lalu reload/buka tab `marketplace/you`.
2. `content.js` — di halaman "Your items", bila flag `pending` ada:
   - kumpulkan kartu listing (`a[href*="/marketplace/item/"]`) dengan scroll bertahap
   - per kartu: buka menu "..." → cari `[role="menuitem"]` bertuliskan
     `Renew / Perbarui / Perpanjang` → klik → konfirmasi dialog bila muncul
   - kirim progress & hasil ke background
3. `popup.html/js` — tampilan status, riwayat, pengaturan (`autoDaily`, `maxPerRun`).

## Yang Peka Terhadap Perubahan DOM (rawan rusak)

Facebook memakai class obfuscated (`x1qhh9c…`) yang berubah-ubah. Ekstensi ini
sengaja **tidak** memakai class tersebut; selector yang dipakai:

- `a[href*="/marketplace/item/"]` — kartu listing
- `[role="button"]`, `[role="combobox"]`, `[role="menuitem"]`, `[role="dialog"]`
- teks/`aria-label`: `renew | perbarui | perpanjang`, `more | options | opsi | tindakan`

Kalau suatu hari renew gagal terdeteksi, cek dulu di halaman: apakah struktur
role/menu berubah, dan sesuaikan fungsi `findKebab` / `findRenewMenu` di `content.js`.

## Batasan

- Jalan **saat Firefox hidup** — alarm yang terlewat (laptop mati) menyusul saat browser dibuka.
- Pengisian tombol renew hanya mungkin bila FB memang menampilkan tombol Renew.
- Bukan pengganti "Delete & Relist" (strategi lain, mekanisme & risiko beda).
- Otomatisasi ada risiko pembatasan akun — batas `maxPerRun` dan delay acak
  sengaja default moderat, bukan hiasan.

## Struktur

```
fbm-auto-renew/
├── manifest.json
├── background.js   # alarm + koordinasi run
├── content.js      # deteksi & klik tombol Renew
├── popup.html/js   # UI status, riwayat, pengaturan
└── README.md
```
