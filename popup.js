// popup.js — tampilkan status, riwayat, tombol manual, dan pengaturan.

const fmtTime = (ts) =>
  ts ? new Date(ts).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '–';

const $ = (id) => document.getElementById(id);

async function loadSettings() {
  const { settings } = await browser.storage.local.get({ settings: null });
  const s = settings || {};
  $('autoDaily').checked = s.autoDaily !== false;
  $('maxPerRun').value = s.maxPerRun || 10;
}

async function loadStats() {
  const { stats = {}, runState = {}, history = [] } = await browser.storage.local.get({
    stats: {},
    runState: {},
    history: []
  });

  $('lastRun').textContent = fmtTime(stats.lastRunAt);
  $('totalRenewed').textContent = stats.totalRenewed || 0;

  const running = runState.running && !runState.finishedAt;
  $('startBtn').disabled = running;
  if (running) {
    $('status').textContent =
      `Renewing... ${runState.renewed || 0}/${runState.total || '?'} kendaraan` +
      (runState.currentStatus ? ` · ${runState.currentStatus}` : '');
  } else if (runState.lastSummary) {
    const s = runState.lastSummary;
    $('status').textContent = `Terakhir: ${s.renewed} di-renew dari ${s.scanned} dicek (${s.source === 'alarm' ? 'otomatis' : 'manual'})`;
  } else {
    $('status').textContent = 'Siap.';
  }

  $('history').innerHTML = '';
  for (const h of [...history].reverse()) {
    const li = document.createElement('li');
    li.textContent = `${fmtTime(h.at)} — ${h.renewed} renew / ${h.scanned} cek (${h.source === 'alarm' ? 'auto' : 'manual'})`;
    $('history').appendChild(li);
  }
}

$('startBtn').addEventListener('click', async () => {
  $('startBtn').disabled = true;
  $('status').textContent = 'Menjalankan...';
  await browser.runtime.sendMessage({ type: 'trigger-renew' });
  setTimeout(loadStats, 800);
});

$('autoDaily').addEventListener('change', saveSettings);
$('maxPerRun').addEventListener('change', saveSettings);

async function saveSettings() {
  await browser.storage.local.set({
    settings: {
      autoDaily: $('autoDaily').checked,
      maxPerRun: Math.max(1, Math.min(50, parseInt($('maxPerRun').value, 10) || 10)),
      minDelayMs: 4000,
      maxDelayMs: 15000
    }
  });
  await browser.runtime.sendMessage({ type: 'settings-changed' });
}

loadSettings();
loadStats();
setInterval(loadStats, 1000); // status live selama popup terbuka
