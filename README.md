# FB Marketplace Tools (Firefox)

Ekstensi Firefox (Manifest V2) dengan dua alat untuk Facebook Marketplace:

1. **Posting Iklan** — isi form iklan baru dari template (judul, harga, kategori,
   kondisi, lokasi, deskripsi, foto dari URL), lalu tandai tombol Publish.
   **Semi-otomatis**: kamu tetap review & klik Publish sendiri.
2. **Auto Renew** — cek harian otomatis (alarm) + tombol manual; me-renew semua
   listing yang FB izinkan (tombol Renew muncul, umumnya ±7 hari setelah terbit).

## Fitur

- Template iklan tersimpan di `storage.local`, dikelola lewat popup
- Foto: unduh otomatis dari URL (via background fetch); kalau gagal, ekstensi
  menandai dan kamu upload manual
- Isi field pakai native setter + event `input`/`change` (FB pakai React)
- Renew: delay acak 4–15 detik antar item + batas listing per run (default 10)
- Riwayat run + statistik (total renew & total posting) di popup, badge di ikon

## Cara Install (temporary / developer)

1. Buka `about:debugging` → **This Firefox** → **Load Temporary Add-on…**
2. Pilih file `manifest.json`.
3. Pin ikon → popup → tab **Posting Iklan** (buat template → Post Sekarang)
   atau tab **Renew** (Renew Sekarang / cek harian).

## Cara Kerja

- `background.js` — alarm harian; koordinasi run; download foto (base64) untuk
  di-inject ke `<input type="file">`.
- `content.js` — di `/marketplace/you` (renew) dan `/marketplace/create` (post).
  Semua aksi dipicu lewat flag `pending` di storage.
- `popup.html/js` — UI dua tab, template CRUD, status & riwayat.

## Selector & Risiko

- **Tidak** memakai class obfuscated FB (`x1qhh9c…`). Yang dipakai:
  `a[href*="/marketplace/item/"]`, `[role="button"]`, `[role="combobox"]`,
  `[role="menuitem"]`, `[role="dialog"]`, `[role="option"]`, plus `aria-label` /
  `placeholder` (`title`, `price`, `category`, `condition`, `location`,
  `description`) dan teks `renew | perbarui | perpanjang`.
- Kalau form berubah, sesuaikan `findField`, `fillCombobox`, `findKebab`,
  `findRenewMenu` di `content.js`.
- Otomatisasi FB berisiko pembatasan akun. Delay acak & batas per run sengaja
  default moderat. **Jangan** dipakai untuk spam/mass-posting agresif.
- Ekstensi hanya jalan saat Firefox hidup & tab marketplace terbuka/dibuat.

## Struktur

```
fbm-auto-renew/
├── manifest.json
├── background.js   # alarm, koordinasi run, download foto
├── content.js      # renew + isi form posting
├── popup.html/js   # UI dua tab, template, status, riwayat
└── README.md
```

## Rilis

Unduh ZIP siap pakai di halaman [Releases](../../releases).
