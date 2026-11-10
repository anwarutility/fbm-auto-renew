// background.js — alarm harian (renew), koordinasi run, dan download foto
// untuk posting iklan.

const ALARM_NAME = 'fbm-daily-check';
const RENEW_URL = 'https://www.facebook.com/marketplace/you/';
const CREATE_URL = 'https://www.facebook.com/marketplace/create/item';
const STALE_MS = 30 * 60 * 1000;

const DEFAULTS = {
  autoDaily: true,     // alarm harian renew aktif?
  maxPerRun: 10,       // batas listing yang diproses per run (anti-bot)
  minDelayMs: 4000,    // delay antar item renew (acak antara min..max)
  maxDelayMs: 15000
};

// ---------- lifecycle ----------
browser.runtime.onInstalled.addListener(ensureAlarm);
browser.runtime.onStartup.addListener(ensureAlarm);

async function ensureAlarm() {
  const { settings } = await browser.storage.local.get({ settings: null });
  if (!settings) await browser.storage.local.set({ settings: DEFAULTS });
  const s = settings || DEFAULTS;

  await browser.alarms.clear(ALARM_NAME);
  if (s.autoDaily) {
    browser.alarms.create(ALARM_NAME, { periodInMinutes: 24 * 60 });
  }
}

// ---------- RENEW ----------
async function startRun(source) {
  const { runState } = await browser.storage.local.get({ runState: null });
  if (runState && runState.running && Date.now() - runState.startedAt < STALE_MS) return;

  await browser.storage.local.set({
    runState: {
      running: true,
      pending: true,
      startedAt: Date.now(),
      source,
      renewed: 0,
      done: 0,
      total: 0
    }
  });

  const tabs = await browser.tabs.query({ url: 'https://www.facebook.com/*' });
  const marketTab = tabs.find(t => (t.url || '').includes('/marketplace/you'));
  if (marketTab) {
    await browser.tabs.reload(marketTab.id);
    if (source === 'manual') await browser.tabs.update(marketTab.id, { active: true });
  } else {
    await browser.tabs.create({ url: RENEW_URL, active: source === 'manual' });
  }
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) startRun('alarm');
});

// ---------- POST ----------
async function startPost(template) {
  const { postState } = await browser.storage.local.get({ postState: null });
  if (postState && postState.running && Date.now() - postState.startedAt < STALE_MS) return;

  await browser.storage.local.set({
    postState: {
      running: true,
      pending: true,
      startedAt: Date.now(),
      template: template || {},
      status: 'Menyiapkan halaman create...'
    }
  });

  const tabs = await browser.tabs.query({ url: 'https://www.facebook.com/*' });
  const createTab = tabs.find(t => (t.url || '').includes('/marketplace/create'));
  if (createTab) {
    await browser.tabs.update(createTab.id, { url: CREATE_URL, active: true });
    await browser.tabs.reload(createTab.id);
  } else {
    await browser.tabs.create({ url: CREATE_URL, active: true });
  }
}

// ---------- download foto (dipanggil content script) ----------
async function downloadPhoto(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];

    let binary = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  } catch (e) {
    console.error('[fbm] download foto gagal:', url, e);
    return null;
  }
}

// ---------- pesan ----------
browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'trigger-renew') startRun('manual');
  else if (msg.type === 'trigger-post') startPost(msg.template);
  else if (msg.type === 'renew-progress') onRenewProgress(msg);
  else if (msg.type === 'renew-finished') onRenewFinished(msg);
  else if (msg.type === 'post-progress') onPostProgress(msg);
  else if (msg.type === 'post-finished') onPostFinished(msg);
  else if (msg.type === 'settings-changed') ensureAlarm();
  else if (msg.type === 'download-photo') {
    downloadPhoto(msg.url).then((dataUrl) => sendResponse({ ok: !!dataUrl, dataUrl }));
    return true; // respons async
  }
});

// ---------- handler renew ----------
async function onRenewProgress(msg) {
  const { runState } = await browser.storage.local.get({ runState: {} });
  if (!runState.running) return;
  Object.assign(runState, {
    renewed: msg.renewed ?? runState.renewed,
    done: msg.done ?? runState.done,
    total: msg.total ?? runState.total,
    currentStatus: msg.status ?? runState.currentStatus
  });
  await browser.storage.local.set({ runState });

  if (runState.renewed > 0) {
    browser.browserAction.setBadgeText({ text: String(runState.renewed) });
    browser.browserAction.setBadgeBackgroundColor({ color: '#2e7d32' });
  }
}

async function onRenewFinished(msg) {
  const { runState } = await browser.storage.local.get({ runState: {} });
  const wraps = await browser.storage.local.get({ history: [], stats: {} });

  const entry = {
    kind: 'renew',
    at: Date.now(),
    source: runState.source || 'unknown',
    renewed: msg.renewed ?? 0,
    scanned: msg.done ?? 0
  };

  await browser.storage.local.set({
    history: [...wraps.history, entry].slice(-30),
    stats: {
      totalRenewed: (wraps.stats.totalRenewed || 0) + entry.renewed,
      totalPosted: wraps.stats.totalPosted || 0,
      lastRunAt: entry.at
    },
    runState: { running: false, finishedAt: entry.at, lastSummary: entry }
  });

  setTimeout(() => browser.browserAction.setBadgeText({ text: '' }), 60 * 1000);
}

// ---------- handler post ----------
async function onPostProgress(msg) {
  const { postState } = await browser.storage.local.get({ postState: {} });
  if (!postState || !postState.running) return;
  postState.status = msg.status ?? postState.status;
  await browser.storage.local.set({ postState });
}

async function onPostFinished(msg) {
  const { postState } = await browser.storage.local.get({ postState: {} });
  const wraps = await browser.storage.local.get({ history: [], stats: {} });

  const entry = {
    kind: 'post',
    at: Date.now(),
    title: (postState.template && postState.template.title) || '(tanpa judul)',
    filled: msg.filled ?? 0,
    fields: msg.total ?? 0,
    photos: msg.photoCount ?? 0
  };

  await browser.storage.local.set({
    history: [...wraps.history, entry].slice(-30),
    stats: {
      totalRenewed: wraps.stats.totalRenewed || 0,
      totalPosted: (wraps.stats.totalPosted || 0) + 1,
      lastRunAt: entry.at
    },
    postState: { running: false, finishedAt: entry.at, lastSummary: entry }
  });

  setTimeout(() => browser.browserAction.setBadgeText({ text: '' }), 60 * 1000);
}
