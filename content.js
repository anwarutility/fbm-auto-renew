// content.js — dua mode di halaman marketplace:
//  1. RENEW  : halaman /marketplace/you        -> klik tombol Renew bila FB izinkan
//  2. POST   : halaman /marketplace/create/... -> isi form dari template (semi-otomatis)
//
// Keduanya dipicu lewat flag `pending` di storage yang ditulis background.js
// atau via pesan langsung 'run-post-fill'.

const RENEW_WORDS = ['renew', 'perbarui', 'perpanjang'];
const DEFAULTS = { maxPerRun: 10, minDelayMs: 4000, maxDelayMs: 15000 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => Math.floor(a + Math.random() * (b - a));

// Listener pesan langsung (jika tab sudah terbuka)
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'run-post-fill' && msg.template) {
    fillListing(msg.template);
  }
});

init().catch((e) => console.error('[fbm] init error', e));

async function init() {
  if (location.pathname.startsWith('/marketplace/you')) return initRenew();
  if (location.pathname.startsWith('/marketplace/create')) return initPost();
}

// ---------- util umum ----------
function norm(el) {
  return ((el && (el.innerText || el.textContent)) || '').toLowerCase().trim();
}

function click(el) {
  if (!el) return;
  try { el.focus(); } catch (e) {}
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
    el.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
    );
  });
}

async function waitFor(fn, timeout = 6000, step = 300) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const v = fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

function pressEscape() {
  ['keydown', 'keyup'].forEach((type) => {
    document.body.dispatchEvent(
      new KeyboardEvent(type, {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, view: window
      })
    );
  });
}

// ============================================================
// BAGIAN 1 — RENEW
// ============================================================
async function initRenew() {
  const { runState } = await browser.storage.local.get({ runState: null });
  if (!runState || !runState.running || !runState.pending) return;

  await browser.storage.local.set({ runState: { ...runState, pending: false } });
  await runRenew();
}

async function send(msg) {
  try { await browser.runtime.sendMessage(msg); } catch (e) { /* abaikan */ }
}

function looksLikeRenew(el) {
  if (!el) return false;
  const hay = `${el.getAttribute('aria-label') || ''} ${norm(el)}`;
  return RENEW_WORDS.some((w) => hay.includes(w));
}

async function waitForItems() {
  await waitFor(() => document.readyState === 'complete', 20000, 400);

  let last = -1;
  for (let i = 0; i < 12; i++) {
    window.scrollBy(0, 900);
    await sleep(700);
    const n = document.querySelectorAll('a[href*="/marketplace/item/"]').length;
    if (n === last && n > 0) break;
    last = n;
  }
  window.scrollTo(0, 0);

  const seen = new Set();
  const cards = [];
  document.querySelectorAll('a[href*="/marketplace/item/"]').forEach((a) => {
    const href = a.getAttribute('href');
    if (!seen.has(href)) { seen.add(href); cards.push(a); }
  });
  return cards;
}

function cardRoot(card) {
  let el = card;
  for (let i = 0; i < 6 && el.parentElement; i++) {
    el = el.parentElement;
    const btns = el.querySelectorAll('[role="button"], [role="combobox"]');
    const itemLinks = el.querySelectorAll('a[href*="/marketplace/item/"]');
    if (btns.length >= 2 && itemLinks.length === 1) return el;
  }
  return card.parentElement;
}

function findKebab(root, card) {
  const candidates = [
    ...root.querySelectorAll('[role="button"], [role="combobox"], div[tabindex="0"]')
  ].filter(
    (el) =>
      el !== card &&
      !card.contains(el) &&
      !el.contains(card) &&
      !el.querySelector('a[href*="/marketplace/item/"]')
  );
  const byLabel = candidates.find((el) =>
    /more|option|opsi|action|tindakan|menu/i.test(el.getAttribute('aria-label') || '')
  );
  return byLabel || candidates[candidates.length - 1] || null;
}

const findRenewMenu = () =>
  [...document.querySelectorAll('[role="menuitem"]')].find(looksLikeRenew) || null;

function findConfirmButton() {
  const dialogs = document.querySelectorAll('[role="dialog"]');
  for (const d of dialogs) {
    const btns = [...d.querySelectorAll('[role="button"]')];
    const renew = btns.find(looksLikeRenew);
    const cancel = btns.find((b) => /batal|cancel/i.test(norm(b)));
    if (renew && renew !== cancel) return renew;
  }
  return null;
}

async function tryRenew(card) {
  const root = cardRoot(card);
  if (!root) return 'no-root';

  const kebab = findKebab(root, card);
  if (!kebab) { pressEscape(); return 'no-kebab'; }

  click(kebab);
  const item = await waitFor(findRenewMenu, 6000);
  if (!item) { pressEscape(); return 'no-renew-option'; }

  click(item);
  await sleep(rand(800, 1600));

  const confirmBtn = await waitFor(findConfirmButton, 6000);
  if (confirmBtn) {
    click(confirmBtn);
    await sleep(rand(600, 1200));
  }
  pressEscape();
  return 'renewed';
}

async function runRenew() {
  const { settings } = await browser.storage.local.get({ settings: DEFAULTS });
  const maxPerRun = settings.maxPerRun || DEFAULTS.maxPerRun;

  const cards = await waitForItems();
  await send({
    type: 'renew-progress',
    total: cards.length,
    status: `Ditemukan ${cards.length} listing`
  });

  let renewed = 0;
  let done = 0;
  for (const card of cards) {
    if (done >= maxPerRun) break;
    done++;

    const result = await tryRenew(card);
    const isRenewed = result === 'renewed';
    if (isRenewed) renewed++;

    await send({
      type: 'renew-progress',
      done,
      total: cards.length,
      renewed,
      status: isRenewed ? 'Renew berhasil, jeda...' : `Lewati (${result})`
    });

    await sleep(rand(settings.minDelayMs || DEFAULTS.minDelayMs, settings.maxDelayMs || DEFAULTS.maxDelayMs));
  }

  await send({ type: 'renew-finished', renewed, done });
}

// ============================================================
// BAGIAN 2 — POSTING IKLAN (semi-otomatis: isi form, TIDAK publish)
// ============================================================
async function initPost() {
  const { postState } = await browser.storage.local.get({ postState: null });
  if (!postState || !postState.running || !postState.pending) return;

  await browser.storage.local.set({ postState: { ...postState, pending: false } });
  await fillListing(postState.template || {});
}

// set nilai pada input React: native setter + dispatch events
function setReactValue(el, value) {
  if (!el) return;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function matchText(text, aliases) {
  if (!text) return false;
  const s = text.toLowerCase().trim();
  return aliases.some((a) => s.includes(a.toLowerCase()));
}

// cari field teks biasa (Title / Price / Description)
function findField(aliases, tagName) {
  const aliasList = Array.isArray(aliases) ? aliases : [aliases];
  const candidates = [...document.querySelectorAll(tagName || 'input:not([type="hidden"]), textarea, [contenteditable="true"]')];

  for (const el of candidates) {
    if (
      matchText(el.getAttribute('aria-label'), aliasList) ||
      matchText(el.getAttribute('placeholder'), aliasList) ||
      matchText(el.getAttribute('name'), aliasList)
    ) {
      return el;
    }
  }

  for (const el of candidates) {
    const lbl = el.closest('label');
    if (lbl) {
      if (
        matchText(lbl.getAttribute('aria-label'), aliasList) ||
        matchText(lbl.textContent, aliasList)
      ) {
        return el;
      }
    }
  }

  for (const el of candidates) {
    const id = el.getAttribute('aria-labelledby');
    if (id) {
      const refEl = document.getElementById(id);
      if (refEl && matchText(refEl.textContent, aliasList)) {
        return el;
      }
    }
  }

  for (const el of candidates) {
    const parent = el.parentElement;
    if (parent && parent.children.length <= 5) {
      if (matchText(parent.textContent, aliasList)) {
        return el;
      }
    }
  }

  return null;
}

// Deteksi tombol pemicu Kategori atau Kondisi
function findTriggerButton(aliases) {
  const aliasList = Array.isArray(aliases) ? aliases : [aliases];

  // 1. Prioritaskan elemen dengan role combobox atau button yang memiliki aria-label
  const ariaCandidates = [...document.querySelectorAll('[role="combobox"], [role="button"], label')];
  for (const el of ariaCandidates) {
    const aria = el.getAttribute('aria-label') || '';
    if (matchText(aria, aliasList) && el.offsetParent) {
      return el;
    }
  }

  // 2. Cari label yang memuat teks alias dan cari kontrol interaktif di dalamnya
  const labels = [...document.querySelectorAll('label, div')].filter(el => {
    if (!el.offsetParent) return false;
    // Hindari elemen kontainer seluruh halaman
    if (el.children.length > 8) return false;
    const txt = el.innerText || '';
    return aliasList.some(a => txt.toLowerCase().includes(a.toLowerCase()));
  });

  for (const lbl of labels) {
    const btn = lbl.querySelector('[role="combobox"], [role="button"], div[tabindex="0"], svg');
    if (btn && btn.offsetParent) return btn.closest('[role="combobox"], [role="button"], label') || btn;
    if (lbl.getAttribute('role') === 'button' || lbl.getAttribute('role') === 'combobox') return lbl;
    if (lbl.tagName === 'LABEL') return lbl;
  }

  return null;
}

// Buka dan pilih opsi dari popover/dialog Facebook
async function selectFromPopup(triggerEl, targetValue) {
  if (!triggerEl || !targetValue) return false;

  triggerEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await sleep(300);
  click(triggerEl);
  await sleep(800);

  const targetNorm = targetValue.toLowerCase().trim();
  const keywords = targetNorm.split(/[\s,&/-]+/).filter(w => w.length >= 3);

  // Fungsi pencari opsi di popover / dialog / menu
  const findOption = () => {
    const candidates = [
      ...document.querySelectorAll(
        '[role="option"], [role="menuitem"], [role="listbox"] [role="button"], [role="dialog"] [role="button"], [role="listbox"] span, [role="dialog"] span, [role="menu"] span, div[tabindex="0"]'
      )
    ].filter(el => el.offsetParent && !triggerEl.contains(el));

    // 1. Cek exact match / includes penuh
    const exact = candidates.find(el => {
      const t = norm(el);
      return t === targetNorm || t.includes(targetNorm);
    });
    if (exact) return exact;

    // 2. Cek kecocokan kata kunci
    for (const kw of keywords) {
      const kwMatch = candidates.find(el => norm(el).includes(kw));
      if (kwMatch) return kwMatch;
    }

    return null;
  };

  let option = await waitFor(findOption, 5000, 300);

  // Jika belum muncul, coba tekan Space atau ArrowDown pada trigger
  if (!option) {
    triggerEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    await sleep(500);
    option = findOption();
  }

  if (option) {
    option.scrollIntoView({ block: 'nearest' });
    await sleep(200);
    click(option);
    await sleep(600);
    return true;
  }

  pressEscape();
  return false;
}

// Kategori di Facebook Marketplace
async function fillCategory(value) {
  if (!value) return false;
  const aliases = ['kategori', 'category'];

  const trigger = await waitFor(() => findTriggerButton(aliases), 8000, 400);
  if (trigger) {
    const ok = await selectFromPopup(trigger, value);
    if (ok) return true;
  }

  // Fallback: cari input pencarian combobox
  const inputEl = findField(aliases, 'input');
  if (inputEl) {
    inputEl.focus();
    click(inputEl);
    setReactValue(inputEl, value);
    await sleep(800);
    const opt = await waitFor(() => {
      return [...document.querySelectorAll('[role="option"], [role="menuitem"]')].find(o => norm(o).includes(value.toLowerCase()));
    }, 3000, 300);
    if (opt) {
      click(opt);
      await sleep(500);
      return true;
    }
  }

  return false;
}

// Kondisi di Facebook Marketplace
async function fillCondition(value) {
  if (!value) return false;
  const aliases = ['kondisi', 'condition'];

  const trigger = await waitFor(() => findTriggerButton(aliases), 8000, 400);
  if (trigger) {
    const ok = await selectFromPopup(trigger, value);
    if (ok) return true;
  }

  // Fallback tombol langsung
  const wanted = value.toLowerCase();
  const btn = [...document.querySelectorAll('[role="button"], [role="radio"], [role="option"]')].find(
    (el) => norm(el).includes(wanted) && el.offsetParent
  );
  if (btn) {
    click(btn);
    await sleep(500);
    return true;
  }
  return false;
}

// Lokasi di Facebook Marketplace
async function fillLocation(value) {
  if (!value) return false;
  const aliases = ['lokasi', 'location', 'kota', 'city'];
  const el = await waitFor(() => findField(aliases, 'input'), 6000, 300);
  if (!el) return false;

  el.focus();
  click(el);
  await sleep(200);
  setReactValue(el, '');
  await sleep(200);
  setReactValue(el, value);
  await sleep(1000);

  const option = await waitFor(() => {
    return [...document.querySelectorAll('[role="option"], [role="listbox"] span')].find((o) =>
      norm(o).includes(value.toLowerCase())
    );
  }, 4000, 300);

  if (option) {
    click(option);
    await sleep(500);
    return true;
  }
  return false;
}

// Field teks biasa (Title / Price / Description)
async function fillText(aliases, value) {
  if (!value) return false;
  const el = await waitFor(() => findField(aliases, 'input:not([type="hidden"]), textarea, [contenteditable="true"]'), 6000, 300);
  if (!el) return false;

  el.focus();
  if (el.isContentEditable) {
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    setReactValue(el, String(value));
  }
  await sleep(250);
  return true;
}

// Foto: unduh via background -> inject file
async function addPhotos(urls) {
  const input = await waitFor(() => document.querySelector('input[type="file"][accept*="image"]'), 8000, 400);
  const manualNeeded = [];
  const files = [];

  for (const url of urls) {
    if (!url) continue;
    try {
      const resp = await browser.runtime.sendMessage({ type: 'download-photo', url });
      if (!resp || !resp.ok || !resp.dataUrl) { manualNeeded.push(url); continue; }
      const blob = await (await fetch(resp.dataUrl)).blob();
      files.push(new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' }));
    } catch (e) {
      manualNeeded.push(url);
    }
  }

  if (files.length && input) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await sleep(1000);
    return { ok: true, count: files.length, manualNeeded };
  }
  return { ok: false, count: 0, manualNeeded };
}

function splitPhotoUrls(raw) {
  return (raw || '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function highlightPublish() {
  const btn = [...document.querySelectorAll('[role="button"], button')].find(
    (b) => /publish|terbitkan|selanjutnya|next|post|biting/i.test(norm(b)) && b.offsetParent
  );
  if (btn) {
    btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
    btn.style.outline = '4px solid #1877f2';
    btn.style.outlineOffset = '3px';
    return true;
  }
  return false;
}

async function fillListing(t) {
  const report = (status) => send({ type: 'post-progress', status });
  let filled = 0;
  let totalCount = 0;
  let photoCount = 0;

  try {
    await report('Menunggu form Marketplace siap...');
    await waitFor(() => {
      const inputs = document.querySelectorAll('input:not([type="hidden"]), textarea, [contenteditable="true"]');
      return inputs.length >= 2;
    }, 20000, 500);

    await sleep(1200);
    await report('Mengisi data iklan...');

    const results = [];

    // 1. Judul
    results.push(['title', await fillText(['judul', 'title', 'apa yang anda jual', 'what are you selling'], t.title)]);
    await sleep(400);

    // 2. Harga
    results.push(['price', await fillText(['harga', 'price'], t.price)]);
    await sleep(400);

    // 3. Kategori (jika dipilih)
    if (t.category) {
      await report(`Memilih kategori: ${t.category}...`);
      const catOk = await fillCategory(t.category);
      results.push(['category', catOk]);
      await sleep(600);
    }

    // 4. Kondisi (jika dipilih)
    if (t.condition) {
      await report(`Memilih kondisi: ${t.condition}...`);
      const condOk = await fillCondition(t.condition);
      results.push(['condition', condOk]);
      await sleep(600);
    }

    // 5. Deskripsi
    results.push(['description', await fillText(['keterangan', 'deskripsi', 'description'], t.description)]);
    await sleep(400);

    // 6. Lokasi (jika diisi)
    if (t.location) {
      await report(`Mengisi lokasi: ${t.location}...`);
      const locOk = await fillLocation(t.location);
      results.push(['location', locOk]);
      await sleep(400);
    }

    // 7. Foto (jika ada)
    const photoUrls = splitPhotoUrls(t.photos);
    let photoResult = { ok: false, count: 0, manualNeeded: [] };
    if (photoUrls.length) {
      await report(`Mengunduh ${photoUrls.length} foto...`);
      photoResult = await addPhotos(photoUrls);
      results.push(['photos', photoResult.ok]);
    }

    filled = results.filter(([, ok]) => ok).length;
    totalCount = results.length;
    photoCount = photoResult.count;

    let status = `Terisi ${filled}/${totalCount} field`;
    if (photoResult.ok) status += `, ${photoResult.count} foto terpasang`;
    if (photoResult.manualNeeded && photoResult.manualNeeded.length) {
      status += ` · ${photoResult.manualNeeded.length} foto gagal (upload manual)`;
    }

    const publishHighlighted = highlightPublish();
    status += publishHighlighted ? ' · tombol Publish ditandai' : ' · cari tombol Publish';

    await report(status);
  } catch (err) {
    console.error('[fbm] fillListing error', err);
    await report('Selesai dengan catatan: ' + (err.message || 'cek form'));
  } finally {
    await send({ type: 'post-finished', filled, total: totalCount, photoCount });
  }
}
