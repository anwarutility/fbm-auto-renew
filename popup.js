// popup.js — dua tab: Posting Iklan (template -> isi form) & Renew (jadwal harian).

const $ = (id) => document.getElementById(id);
const fmtTime = (ts) =>
  ts ? new Date(ts).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '–';

let templates = [];
let selectedId = null;

// ---------- tab switching ----------
function showPane(which) {
  $('panePost').style.display = which === 'post' ? '' : 'none';
  $('paneRenew').style.display = which === 'renew' ? '' : 'none';
  $('tabPost').classList.toggle('active', which === 'post');
  $('tabRenew').classList.toggle('active', which === 'renew');
}
$('tabPost').addEventListener('click', () => showPane('post'));
$('tabRenew').addEventListener('click', () => showPane('renew'));

// ---------- template CRUD ----------
async function loadTemplates() {
  const { templates: t = [] } = await browser.storage.local.get({ templates: [] });
  templates = t;
  renderTemplateSelect();
  if (selectedId && !templates.find((x) => x.id === selectedId)) {
    selectedId = null;
  }
  if (!selectedId && templates.length) selectedId = templates[0].id;
  fillForm();
}

function renderTemplateSelect() {
  $('tplSelect').innerHTML = '';
  if (!templates.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(belum ada template)';
    $('tplSelect').appendChild(opt);
    return;
  }
  for (const t of templates) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.title || '(tanpa judul)';
    if (t.id === selectedId) opt.selected = true;
    $('tplSelect').appendChild(opt);
  }
}

function fillForm() {
  const t = templates.find((x) => x.id === selectedId) || {};
  $('f_title').value = t.title || '';
  $('f_price').value = t.price || '';
  $('f_category').value = t.category || '';
  $('f_condition').value = t.condition || '';
  $('f_location').value = t.location || '';
  $('f_desc').value = t.description || '';
  $('f_photos').value = (t.photos || []).join('\n');
}

function currentForm() {
  return {
    title: $('f_title').value.trim(),
    price: $('f_price').value.trim(),
    category: $('f_category').value.trim(),
    condition: $('f_condition').value.trim(),
    location: $('f_location').value.trim(),
    description: $('f_desc').value.trim(),
    photos: $('f_photos').value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
  };
}

$('tplSelect').addEventListener('change', () => {
  selectedId = $('tplSelect').value || null;
  fillForm();
});

$('tplNew').addEventListener('click', async () => {
  const t = {
    id: 't' + Date.now(),
    ...currentForm(),
    title: currentForm().title || 'Iklan baru',
    createdAt: Date.now()
  };
  templates.push(t);
  selectedId = t.id;
  await browser.storage.local.set({ templates });
  renderTemplateSelect();
  fillForm();
  $('postStatus').textContent = 'Template baru dibuat. Isi field lalu Simpan.';
});

$('tplSave').addEventListener('click', async () => {
  let t = templates.find((x) => x.id === selectedId);
  if (!t) {
    t = { id: 't' + Date.now(), createdAt: Date.now() };
    templates.push(t);
    selectedId = t.id;
  }
  Object.assign(t, currentForm());
  await browser.storage.local.set({ templates });
  renderTemplateSelect();
  fillForm();
  $('postStatus').textContent = 'Template tersimpan.';
});

$('tplDelete').addEventListener('click', async () => {
  if (!selectedId) return;
  templates = templates.filter((x) => x.id !== selectedId);
  selectedId = templates.length ? templates[0].id : null;
  await browser.storage.local.set({ templates });
  renderTemplateSelect();
  fillForm();
});

// ---------- aksi posting ----------
$('postBtn').addEventListener('click', async () => {
  const t = templates.find((x) => x.id === selectedId);
  if (!t || !t.title) {
    $('postStatus').textContent = 'Judul wajib diisi (buat/simpan template dulu).';
    return;
  }
  $('postBtn').disabled = true;
  $('postStatus').textContent = 'Membuka halaman create...';
  await browser.storage.local.set({ templates });
  await browser.runtime.sendMessage({ type: 'trigger-post', template: t });
  setTimeout(loadStatus, 1000);
});

// ---------- aksi renew ----------
$('startBtn').addEventListener('click', async () => {
  $('startBtn').disabled = true;
  $('status').textContent = 'Menjalankan...';
  await browser.runtime.sendMessage({ type: 'trigger-renew' });
  setTimeout(loadStatus, 800);
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

// ---------- status & riwayat ----------
async function loadSettings() {
  const { settings } = await browser.storage.local.get({ settings: null });
  const s = settings || {};
  $('autoDaily').checked = s.autoDaily !== false;
  $('maxPerRun').value = s.maxPerRun || 10;
}

async function loadStatus() {
  const { stats = {}, runState = {}, postState = {}, history = [] } =
    await browser.storage.local.get({ stats: {}, runState: {}, postState: {}, history: [] });

  $('lastRun').textContent = fmtTime(stats.lastRunAt);
  $('totalRenewed').textContent = stats.totalRenewed || 0;
  $('totalPosted').textContent = stats.totalPosted || 0;

  // renew status
  const renewRunning = runState.running && !runState.finishedAt;
  $('startBtn').disabled = renewRunning;
  if (renewRunning) {
    $('status').textContent =
      `Renewing... ${runState.renewed || 0}/${runState.total || '?'}` +
      (runState.currentStatus ? ` · ${runState.currentStatus}` : '');
  } else if (runState.lastSummary) {
    const s = runState.lastSummary;
    $('status').textContent =
      `Terakhir: ${s.renewed} di-renew dari ${s.scanned} dicek (${s.source === 'alarm' ? 'otomatis' : 'manual'})`;
  } else {
    $('status').textContent = 'Siap.';
  }

  // post status
  const postRunning = postState.running && !postState.finishedAt;
  $('postBtn').disabled = postRunning;
  if (postRunning) {
    $('postStatus').textContent = postState.status || 'Mengerjakan...';
  } else if (postState.lastSummary) {
    const s = postState.lastSummary;
    $('postStatus').textContent =
      `Terakhir: "${s.title}" — ${s.filled}/${s.fields} field, ${s.photos} foto. Review lalu klik Publish.`;
  }

  // riwayat gabungan
  $('history').innerHTML = '';
  for (const h of [...history].reverse()) {
    const li = document.createElement('li');
    if (h.kind === 'post') {
      li.textContent = `${fmtTime(h.at)} — POST "${h.title}" · ${h.filled}/${h.fields} field · ${h.photos} foto`;
    } else {
      li.textContent = `${fmtTime(h.at)} — renew ${h.renewed}/${h.scanned} (${h.source === 'alarm' ? 'auto' : 'manual'})`;
    }
    $('history').appendChild(li);
  }
}

loadSettings();
loadTemplates();
loadStatus();
setInterval(loadStatus, 1000);
