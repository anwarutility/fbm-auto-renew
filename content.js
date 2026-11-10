// content.js — dua mode di halaman marketplace:
//  1. RENEW  : halaman /marketplace/you        -> klik tombol Renew bila FB izinkan
//  2. POST   : halaman /marketplace/create/... -> isi form dari template (semi-otomatis)
//
// Keduanya dipicu lewat flag `pending` di storage yang ditulis background.js
// (alarm harian untuk renew, tombol "Post Sekarang" untuk posting).

const RENEW_WORDS = ['renew', 'perbarui', 'perpanjang'];
const DEFAULTS = { maxPerRun: 10, minDelayMs: 4000, maxDelayMs: 15000 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => Math.floor(a + Math.random() * (b - a));

init().catch((e) => console.error('[fbm] init error', e));

async function init() {
  if (location.pathname.startsWith('/marketplace/you')) return initRenew();
  if (location.pathname.startsWith('/marketplace/create')) return initPost();
}

// ---------- util umum ----------
function norm(el) {
  return ((el && el.textContent) || '').toLowerCase().trim();
}

function click(el) {
  if (!el) return;
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach((type) => {
    el.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
    );
  });
  el.click();
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

// set nilai pada input React: native setter + event, bukan sekadar .value =
function setReactValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// cari field berdasarkan aria-label / placeholder (case-insensitive, contains)
function findField(label, tagName) {
  const wanted = (label || '').toLowerCase();
  const els = [...document.querySelectorAll(tagName || 'input, textarea, [role="combobox"]')];
  return els.find((el) => {
    const l = (el.getAttribute('aria-label') || '').toLowerCase();
    const p = (el.getAttribute('placeholder') || '').toLowerCase();
    return l.includes(wanted) || p.includes(wanted);
  });
}

// isi combobox pencarian (Category / Location / Condition): ketik -> pilih opsi
async function fillCombobox(label, value) {
  if (!value) return false;
  const el = findField(label, 'input[role="combobox"], input');
  if (!el) return false;

  el.focus();
  setReactValue(el, '');
  await sleep(250);
  setReactValue(el, value);
  await sleep(900);

  const option = [...document.querySelectorAll('[role="option"]')].find((o) =>
    norm(o).includes(value.toLowerCase())
  );
  if (option) { click(option); await sleep(600); return true; }

  // opsi tidak cocok -> kosongkan lagi supaya tidak nyangkut
  setReactValue(el, '');
  return false;
}

// isi field teks biasa (Title / Price / Description)
function fillText(label, value) {
  if (!value) return false;
  const el = findField(label);
  if (!el) return false;
  el.focus();
  setReactValue(el, String(value));
  return true;
}

// Condition: kalau bukan combobox, cari tombol/radio dengan teks yang cocok
async function fillCondition(value) {
  if (!value) return false;
  if (await fillCombobox('condition', value)) return true;

  const wanted = value.toLowerCase();
  const btn = [...document.querySelectorAll('[role="button"], [role="radio"]')].find(
    (el) => norm(el).includes(wanted) && el.offsetParent
  );
  if (btn) { click(btn); await sleep(500); return true; }
  return false;
}

// foto: unduh dari URL (via background) -> File -> inject ke input[type=file]
async function addPhotos(urls) {
  const input = document.querySelector('input[type="file"][accept*="image"]');
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
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(800);
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
    (b) => /publish|terbitkan|post|biting/i.test(norm(b)) && b.offsetParent
  );
  if (btn) {
    btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
    btn.style.outline = '3px solid #1877f2';
    btn.style.outlineOffset = '3px';
    return true;
  }
  return false;
}

async function fillListing(t) {
  const report = (status) => send({ type: 'post-progress', status });

  await waitFor(() => document.readyState === 'complete', 20000, 300);
  await report('Mengisi form...');

  const results = [];

  results.push(['title', fillText('title', t.title)]);
  results.push(['price', fillText('price', t.price)]);
  results.push(['description', fillText('description', t.description)]);

  if (t.category) results.push(['category', await fillCombobox('category', t.category)]);
  if (t.condition) results.push(['condition', await fillCondition(t.condition)]);
  if (t.location) results.push(['location', await fillCombobox('location', t.location)]);

  const photoUrls = splitPhotoUrls(t.photos);
  let photoResult = { ok: false, count: 0, manualNeeded: [] };
  if (photoUrls.length) {
    await report(`Mengunduh ${photoUrls.length} foto...`);
    photoResult = await addPhotos(photoUrls);
    results.push(['photos', photoResult.ok]);
  }

  const filled = results.filter(([, ok]) => ok).length;
  let status = `Terisi ${filled}/${results.length} field`;
  if (photoResult.ok) status += `, ${photoResult.count} foto terpasang`;
  if (photoResult.manualNeeded && photoResult.manualNeeded.length) {
    status += ` · ${photoResult.manualNeeded.length} foto gagal (upload manual)`;
  }

  const publishHighlighted = highlightPublish();
  status += publishHighlighted ? ' · tombol Publish ditandai' : ' · cari tombol Publish';

  await report(status);
  await send({ type: 'post-finished', filled, total: results.length, photoCount: photoResult.count });
}
