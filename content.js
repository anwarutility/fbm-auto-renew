// content.js — di halaman "Your items" (facebook.com/marketplace/you):
// 1. Cek flag pending di storage (ditulis background saat alarm/manual trigger)
// 2. Scroll & kumpulkan kartu listing
// 3. Per kartu: buka menu "..." -> cari menuitem "Renew" -> klik -> konfirmasi dialog
// Semua delay diacak + ada batas per run supaya polanya tidak seperti bot.

const RENEW_WORDS = ['renew', 'perbarui', 'perpanjang'];
const DEFAULTS = { maxPerRun: 10, minDelayMs: 4000, maxDelayMs: 15000 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => Math.floor(a + Math.random() * (b - a));

init().catch((e) => console.error('[fbm-renew] init error', e));

async function init() {
  if (!location.pathname.startsWith('/marketplace/you')) return;

  const { runState } = await browser.storage.local.get({ runState: null });
  if (!runState || !runState.running || !runState.pending) return;

  // tandai sudah diambil supaya tidak double-run
  await browser.storage.local.set({ runState: { ...runState, pending: false } });
  await run();
}

async function send(msg) {
  try { await browser.runtime.sendMessage(msg); } catch (e) { /* abaikan */ }
}

// ---------- util DOM ----------
function norm(el) {
  return ((el && el.textContent) || '').toLowerCase().trim();
}

function looksLikeRenew(el) {
  if (!el) return false;
  const hay = `${el.getAttribute('aria-label') || ''} ${norm(el)}`;
  return RENEW_WORDS.some((w) => hay.includes(w));
}

function click(el) {
  if (!el) return;
  // event mouse native agar React di Facebook mengenali klik
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
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
        view: window
      })
    );
  });
}

// ---------- kumpulkan kartu listing ----------
async function waitForItems() {
  // tunggu halaman initial load
  await waitFor(() => document.readyState === 'complete', 20000, 400);

  // scroll pelan supaya item bertanda konten virtual muncul semua
  let last = -1;
  for (let i = 0; i < 12; i++) {
    window.scrollBy(0, 900);
    await sleep(700);
    const n = document.querySelectorAll('a[href*="/marketplace/item/"]').length;
    if (n === last && n > 0) break;
    last = n;
  }
  window.scrollTo(0, 0);

  // dedup berdasarkan href
  const seen = new Set();
  const cards = [];
  document.querySelectorAll('a[href*="/marketplace/item/"]').forEach((a) => {
    const href = a.getAttribute('href');
    if (!seen.has(href)) {
      seen.add(href);
      cards.push(a);
    }
  });
  return cards;
}

// ---------- alur renew satu kartu ----------
function cardRoot(card) {
  // naik ke ancestor yang cukup luas: berisi tombol menu tapi hanya 1 listing
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

  // dialog konfirmasi (muncul di sebagian alur) -> klik tombol renew lagi
  const confirmBtn = await waitFor(findConfirmButton, 6000);
  if (confirmBtn) {
    click(confirmBtn);
    await sleep(rand(600, 1200));
  }
  pressEscape();
  return 'renewed';
}

// ---------- run utama ----------
async function run() {
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

    // jeda acak antar item — wajib, pola klik seragam mudah terdeteksi
    await sleep(rand(settings.minDelayMs || DEFAULTS.minDelayMs, settings.maxDelayMs || DEFAULTS.maxDelayMs));
  }

  await send({ type: 'renew-finished', renewed, done });
}
