// background.js — jadwal alarm harian + pengaturan satu "run" renewal.
// Alur: alarm/manual trigger -> tandai pending di storage -> reload/buka tab
// halaman "Your items" -> content script yang mendeteksi & klik tombol Renew.

const ALARM_NAME = 'fbm-daily-check';
const TARGET_URL = 'https://www.facebook.com/marketplace/you/';
const STALE_MS = 30 * 60 * 1000; // run dianggap mati jika >30 menit tak selesai

const DEFAULTS = {
  autoDaily: true,     // alarm harian aktif?
  maxPerRun: 10,       // batas listing yang diproses per run (anti-bot)
  minDelayMs: 4000,    // delay antar item (acak antara min..max)
  maxDelayMs: 15000
};

// ---------- lifecycle ----------
browser.runtime.onInstalled.addListener(ensureAlarm);
browser.runtime.onStartup.addListener(ensureAlarm);

async function ensureAlarm() {
  const { settings } = await browser.storage.local.get({ settings: null });
  if (!settings) await browser.storage.local.set({ settings: DEFAULTS });
  const s = settings || DEFAULTS;

  // reset alarm supaya selalu sinkron dengan setting terbaru
  await browser.alarms.clear(ALARM_NAME);
  if (s.autoDaily) {
    browser.alarms.create(ALARM_NAME, { periodInMinutes: 24 * 60 });
  }
}

// ---------- trigger ----------
async function startRun(source) {
  const { runState } = await browser.storage.local.get({ runState: null });
  if (runState && runState.running && Date.now() - runState.startedAt < STALE_MS) {
    return; // masih ada run aktif (atau baru saja), skip
  }

  await browser.storage.local.set({
    runState: {
      running: true,
      pending: true,           // content script memakai flag ini untuk mulai
      startedAt: Date.now(),
      source,
      renewed: 0,
      done: 0,
      total: 0
    }
  });

  // pakai tab marketplace yang sudah terbuka kalau ada, kalau tidak buka baru
  const tabs = await browser.tabs.query({ url: 'https://www.facebook.com/*' });
  const marketTab = tabs.find(t => (t.url || '').includes('/marketplace/you'));
  if (marketTab) {
    await browser.tabs.reload(marketTab.id); // reload -> content script jalan & lihat flag pending
    if (source === 'manual') await browser.tabs.update(marketTab.id, { active: true });
  } else {
    await browser.tabs.create({ url: TARGET_URL, active: source === 'manual' });
  }
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) startRun('alarm');
});

// ---------- pesan dari popup & content script ----------
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'trigger-renew') startRun('manual');
  else if (msg.type === 'renew-progress') onProgress(msg);
  else if (msg.type === 'renew-finished') onFinish(msg);
  else if (msg.type === 'settings-changed') ensureAlarm();
});

async function onProgress(msg) {
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

async function onFinish(msg) {
  const { runState } = await browser.storage.local.get({ runState: {} });
  const wraps = await browser.storage.local.get({ history: [], stats: {} });

  const entry = {
    at: Date.now(),
    source: runState.source || 'unknown',
    renewed: msg.renewed ?? 0,
    scanned: msg.done ?? 0
  };

  await browser.storage.local.set({
    history: [...wraps.history, entry].slice(-20),
    stats: {
      totalRenewed: (wraps.stats.totalRenewed || 0) + entry.renewed,
      lastRunAt: entry.at
    },
    runState: { running: false, finishedAt: entry.at, lastSummary: entry }
  });

  // kosongkan badge beberapa lama kemudian
  setTimeout(() => browser.browserAction.setBadgeText({ text: '' }), 60 * 1000);
}
