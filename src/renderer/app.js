/* Study Graph — Cursor-style renderer. Shell (activity bar / sidebar tree /
   status bar / command palette) + hash-routed workspace views over window.api. */
const view = document.getElementById('view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const today = () => new Date().toISOString().slice(0, 10);

const MATERIAL_TYPES = ['lecture', 'assignment', 'exam-prep', 'paper', 'lab', 'cheatsheet', 'notes'];
const SECTION_SLOTS = [
  ['lecture', 'Lecture notes'],
  ['problemset', 'Problem set'],
  ['reference', 'Reference'],
  ['lab', 'Lab code'],
];
const EDGE_KINDS = ['prereq', 'related', 'cross_module', 'analogy', 'exam_cluster'];

function slotLabel(type) {
  return SECTION_SLOTS.find(([k]) => k === type)?.[1] || type;
}

function materialSlot(m) {
  if (['assignment', 'exam-prep', 'paper'].includes(m.type)) return 'problemset';
  if (['cheatsheet', 'notes'].includes(m.type)) return 'reference';
  if (SECTION_SLOTS.some(([k]) => k === m.type)) return m.type;
  return 'other';
}

function matChipHtml(m) {
  return `<span class="mat-chip" draggable="true" data-id="${m.id}" data-path="${esc(m.path)}"
    title="${esc(m.path)}">${esc(m.title)}</span>`;
}

function bindSectionBoard() {
  view.querySelectorAll('.mat-chip').forEach(chip => {
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/material-id', chip.dataset.id);
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    chip.addEventListener('dblclick', () =>
      openMaterial(Number(chip.dataset.id), chip.textContent, chip.dataset.path));
  });
  view.querySelectorAll('.slot-drop, .inbox-drop').forEach(zone => {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      const materialId = Number(e.dataTransfer.getData('text/material-id'));
      if (!materialId) return;
      const topicId = zone.dataset.topicId ? Number(zone.dataset.topicId) : null;
      const slot = zone.dataset.slot || 'other';
      try {
        const r = await api.materialsOrganize({ materialId, topicId, slot });
        if (r.renamed) toastStatus(`Renamed on disk → ${r.title}`);
        else toastStatus(topicId ? `Placed in ${slotLabel(slot)}` : 'Moved to inbox');
        route();
      } catch (err) {
        alert(err.message || String(err));
      }
    });
  });
}

// ---------- router ----------
const routes = {
  dashboard: renderDashboard,
  module: renderModule,       // #/module/<id>
  graph: renderGraph_,
  queue: renderQueue,
  schedule: renderSchedule,   // #/schedule/today | timeline | calendar | list
  today: renderSchedule,      // alias → today tab
  deadlines: renderSchedule,  // alias → list tab (or timeline from settings)
  settings: renderSettings,
};
let currentModuleId = null;
let scheduleTab = 'today';     // today | timeline | calendar | list
async function route() {
  const parts = location.hash.replace(/^#\//, '').split('/');
  let name = parts[0] || 'dashboard';
  const arg = parts[1];
  // schedule aliases
  if (name === 'today') { name = 'schedule'; scheduleTab = 'today'; }
  else if (name === 'deadlines') {
    name = 'schedule';
    if (arg && ['timeline', 'calendar', 'list'].includes(arg)) scheduleTab = arg;
    else {
      const persisted = await api.settingsGet('deadline_view');
      scheduleTab = persisted && ['timeline', 'calendar', 'list'].includes(persisted) ? persisted : 'timeline';
    }
  } else if (name === 'schedule') {
    scheduleTab = arg && ['today', 'timeline', 'calendar', 'list'].includes(arg) ? arg : 'today';
  }
  const fn = routes[name] || renderDashboard;
  const active = routes[name] ? name : 'dashboard';
  document.querySelectorAll('.act').forEach(a => {
    const v = a.dataset.view;
    const on = v === 'today' ? (name === 'schedule' && scheduleTab === 'today')
      : v === 'deadlines' ? (name === 'schedule' && scheduleTab !== 'today')
      : v === active || (name === 'module' && v === 'dashboard');
    a.classList.toggle('active', on);
  });
  if (name === 'module') currentModuleId = Number(arg);
  view.innerHTML = '<p class="muted">Loading…</p>';
  await fn(arg);
  refreshTree();
  refreshStatus();
}
window.addEventListener('hashchange', route);
document.querySelectorAll('.act').forEach(b =>
  b.addEventListener('click', () => location.hash = `#/${b.dataset.view}`));

// ---------- sidebar file tree ----------
const expanded = new Set();
async function refreshTree() {
  const tree = document.getElementById('tree');
  const mods = await api.modulesList();
  if (!mods.length) {
    tree.innerHTML = `<div class="tree-empty">Library not indexed yet.</div>
      <button class="primary tree-cta" id="tree-index">Index year_three</button>`;
    tree.querySelector('#tree-index')?.addEventListener('click', runIngest);
    return;
  }
  const parts = [];
  for (const m of mods) {
    const open = expanded.has(m.id);
    parts.push(`<div class="tree-mod ${m.id === currentModuleId ? 'sel' : ''}" data-id="${m.id}">
      <span class="twist">${open ? '▾' : '▸'}</span>
      <span class="dot" style="background:${esc(m.color)}"></span>
      <span>${esc(m.code)}</span><span class="count">${m.material_count}</span></div>`);
    if (open) {
      const mats = await api.materialsList(m.id);
      for (const f of mats.slice(0, 80)) {
        parts.push(`<div class="tree-file" data-path="${esc(f.path)}" data-id="${f.id}" title="${esc(f.title)}">${esc(f.title)}</div>`);
      }
      if (!mats.length) parts.push('<div class="tree-file muted">— empty —</div>');
    }
  }
  tree.innerHTML = parts.join('');
  tree.querySelectorAll('.tree-mod').forEach(el => {
    const id = Number(el.dataset.id);
    el.querySelector('.twist').addEventListener('click', (e) => {
      e.stopPropagation();
      expanded.has(id) ? expanded.delete(id) : expanded.add(id);
      refreshTree();
    });
    el.addEventListener('click', () => { location.hash = `#/module/${id}`; });
  });
  tree.querySelectorAll('.tree-file').forEach(el =>
    el.addEventListener('click', () =>
      openMaterial(Number(el.dataset.id), el.title, el.dataset.path)));
}
document.getElementById('reindex').addEventListener('click', runIngest);

async function runIngest(root) {
  const tree = document.getElementById('tree');
  tree.innerHTML = '<div class="tree-empty">Indexing…</div>';
  try {
    const r = await api.ingestRun(typeof root === 'string' ? root : undefined);
    await refreshTree();
    const bits = [`+${r.materials} files`, `+${r.topics} topics`];
    if (r.modules) bits.unshift(`+${r.modules} modules`);
    if (r.updated) bits.push(`${r.updated} changed`);
    if (r.removed) bits.push(`${r.removed} removed`);
    if (r.deadlines) bits.push(`${r.deadlines} exam deadline${r.deadlines > 1 ? 's' : ''} detected`);
    if (r.spineEdges) bits.push(`${r.spineEdges} spine links`);
    if (r.strategyParsed) bits.push('strategy.md parsed');
    toastStatus(`Indexed ${r.root.split('/').pop()}: ${bits.join(', ')}`);
    route();
  } catch (e) {
    tree.innerHTML = `<div class="tree-empty error">${esc(e.message)}</div>`;
  }
}

// ---------- material timer (time ledger) ----------
// Opening a material starts a timer; it only counts while the file preview
// window is focused — not while you're browsing the main app.
const TIMER_IDLE_MS = 15000;
let timer = null; // { materialId, title, mode, activeMs, lastTickMs, paused, tick }
let mainFocused = document.hasFocus();
let previewFocused = false;
let idleStopTimer = null;

function timerElapsedMs() {
  return TimerState.elapsedMs(timer);
}

function isTimerActive() {
  return TimerState.isTimerActive(timer, { previewFocused });
}

function clearIdleStop() {
  if (idleStopTimer) { clearTimeout(idleStopTimer); idleStopTimer = null; }
}

function scheduleIdleStop() {
  clearIdleStop();
  idleStopTimer = setTimeout(() => stopTimer(), TIMER_IDLE_MS);
}

function syncTimerActivity() {
  if (!timer) return;
  const active = TimerState.isTimerActive(timer, { previewFocused });
  timer = TimerState.applyActivitySync(timer, active) || timer;
  if (active) clearIdleStop();
  else if (timer.paused) scheduleIdleStop();
  renderTimerDisplay();
}

function renderTimerDisplay() {
  const el = document.getElementById('st-timer');
  if (!timer) { el.hidden = true; return; }
  el.hidden = false;
  const ms = timerElapsedMs();
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const paused = timer.paused
    ? (timer.mode === 'external'
      ? ' <span class="muted">paused (external app — no file focus tracking)</span>'
      : ' <span class="muted">paused</span>')
    : '';
  el.innerHTML = `⏱ ${min}:${String(sec).padStart(2, '0')} ${esc(timer.title.slice(0, 28))}${paused} <a href="#" id="st-timer-stop" style="color:var(--danger)">■ stop</a>`;
  el.querySelector('#st-timer-stop').onclick = (e) => { e.preventDefault(); stopTimer(); };
}

async function openMaterial(materialId, title, path) {
  let mode = 'none';
  if (path && !path.startsWith('http')) {
    const r = await api.materialsOpen(path);
    mode = r?.mode || 'external';
  }
  startTimer(materialId, title, mode);
}

async function startTimer(materialId, title, mode = 'none') {
  if (!materialId) return;
  await stopTimer(true);
  previewFocused = false;
  timer = {
    materialId,
    title,
    mode,
    activeMs: 0,
    lastTickMs: Date.now(),
    paused: true, // waits for file preview focus (or stays paused for external)
  };
  renderTimerDisplay();
  timer.tick = setInterval(renderTimerDisplay, 1000);
  syncTimerActivity();
}

async function stopTimer(silent = false) {
  if (!timer) return;
  clearInterval(timer.tick);
  clearIdleStop();
  if (!timer.paused) timer.activeMs += Date.now() - timer.lastTickMs;
  const minutes = Math.round(timer.activeMs / 60000);
  const { materialId, title, mode } = timer;
  timer = null;
  previewFocused = false;
  const el = document.getElementById('st-timer');
  el.hidden = true;
  if (mode === 'preview') await api.materialsClosePreview();
  if (minutes >= 1) {
    await api.sessionsCreate({ material_id: materialId, duration_min: minutes, source: 'timer' });
    if (!silent) toastStatus(`logged ${minutes}m on ${title.slice(0, 30)}`);
  } else if (!silent) {
    toastStatus('timer under a minute — not logged');
  }
}

window.addEventListener('focus', () => { mainFocused = true; if (timer?.mode !== 'preview') syncTimerActivity(); });
window.addEventListener('blur', () => { mainFocused = false; if (timer?.mode !== 'preview') syncTimerActivity(); });
document.addEventListener('visibilitychange', () => {
  mainFocused = !document.hidden && document.hasFocus();
  if (timer?.mode !== 'preview') syncTimerActivity();
});
api.onMaterialSessionEnd(() => stopTimer());
api.onPreviewFocus(() => { previewFocused = true; syncTimerActivity(); });
api.onPreviewBlur(() => { previewFocused = false; syncTimerActivity(); });

// ---------- status bar ----------
async function refreshStatus() {
  const stMod = document.getElementById('st-module');
  const stNext = document.getElementById('st-next');
  const mods = await api.modulesList();
  const cur = mods.find(m => m.id === currentModuleId);
  stMod.textContent = cur ? `${cur.code} ${cur.name}` : `${mods.length} modules`;
  const blocks = await api.blocksList(today());
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const next = blocks.find(b => b.status === 'planned' && b.end_min > nowMin);
  stNext.textContent = next ? `next: ${fmtMin(next.start_min)} ${next.topic_name}` : '';
}
let toastTimer;
function toastStatus(msg) {
  const el = document.getElementById('st-next');
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(refreshStatus, 6000);
}

// ---------- command palette (Cmd+K / Cmd+P) ----------
const palette = document.getElementById('palette');
const palInput = document.getElementById('palette-input');
const palList = document.getElementById('palette-list');
let palItems = [], palSel = 0;

async function paletteCommands() {
  const mods = await api.modulesList();
  const cmds = [
    { icon: '⟳', label: 'Index year_three (re-scan library)', run: () => runIngest() },
    { icon: '▸', label: "Today's schedule", run: () => { location.hash = '#/schedule/today'; } },
    { icon: '▤', label: 'Problem queue', run: () => { location.hash = '#/queue'; } },
    { icon: '◉', label: 'Open topic graph', run: () => { location.hash = '#/graph'; } },
    { icon: '◷', label: 'Show deadlines', run: () => { location.hash = '#/schedule/timeline'; } },
    { icon: '▽', label: 'Show weak topics', run: showWeakTopics },
    { icon: '⌂', label: 'Change library root…', run: async () => {
        const p = await api.ingestPickRoot(); if (p) runIngest(p); } },
  ];
  for (const m of mods) cmds.push({
    icon: '▦', label: `Open ${m.code} — ${m.name}`, run: () => { location.hash = `#/module/${m.id}`; } });
  return cmds;
}

async function openPalette() {
  palette.hidden = false;
  palInput.value = '';
  palSel = 0;
  palItems = await paletteCommands();
  renderPalette(palItems);
  palInput.focus();
}
function closePalette() { palette.hidden = true; }

function renderPalette(items) {
  palList.innerHTML = items.slice(0, 14).map((it, i) =>
    `<div class="pal-item ${i === palSel ? 'sel' : ''}" data-i="${i}">
      <span class="pal-icon">${it.icon}</span><span>${esc(it.label)}</span>
      ${it.hint ? `<span class="pal-hint">${esc(it.hint)}</span>` : ''}</div>`).join('')
    || '<div class="pal-item muted">No matches</div>';
  palList.querySelectorAll('.pal-item').forEach(el =>
    el.addEventListener('click', () => pick(Number(el.dataset.i))));
}
function pick(i) {
  const it = palItems[i];
  closePalette();
  if (it) it.run();
}
palInput.addEventListener('input', async () => {
  const q = palInput.value.trim().toLowerCase();
  const cmds = await paletteCommands();
  let items = cmds.filter(c => c.label.toLowerCase().includes(q));
  // also quick-open materials by name
  if (q.length >= 2) {
    const mats = await api.materialsSearch(q);
    items = items.concat(mats.slice(0, 8).map(m => ({
      icon: '≡', label: m.title, hint: 'open file',
      run: () => openMaterial(m.id, m.title, m.path),
    })));
  }
  palItems = items; palSel = 0;
  renderPalette(items);
});
palInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { palSel = Math.min(palSel + 1, Math.min(palItems.length, 14) - 1); renderPalette(palItems); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { palSel = Math.max(palSel - 1, 0); renderPalette(palItems); e.preventDefault(); }
  else if (e.key === 'Enter') pick(palSel);
  else if (e.key === 'Escape') closePalette();
});
palette.addEventListener('click', (e) => { if (e.target === palette) closePalette(); });
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'p')) { e.preventDefault(); openPalette(); }
});

async function showWeakTopics() {
  const topics = await api.topicsList();
  const mods = await api.modulesList();
  const weak = topics.filter(t => t.mastery < 0.5).sort((a, b) => a.mastery - b.mastery).slice(0, 20);
  view.innerHTML = `<h2>Weak topics (mastery &lt; 50%)</h2>
    <table><thead><tr><th>Topic</th><th>Module</th><th>Mastery</th></tr></thead><tbody>
    ${weak.map(t => `<tr><td><b>${esc(t.name)}</b></td>
      <td class="mono">${esc(mods.find(m => m.id === t.module_id)?.code || '')}</td>
      <td><span class="mbar"><div style="width:${t.mastery * 100}%"></div></span>
        <span class="muted"> ${(t.mastery * 100).toFixed(0)}%</span></td></tr>`).join('')
      || '<tr><td colspan="3" class="muted">Nothing under 50% — nice.</td></tr>'}
    </tbody></table>`;
}

// ---------- suggestion review dialog ----------
// items: [{label, detail}] — returns array of selected indexes, or null if dismissed.
function reviewDialog(title, items, acceptLabel = 'Add selected') {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.style.minWidth = '520px';
    dlg.innerHTML = `<h3>${esc(title)}</h3>
      <div style="max-height:340px; overflow-y:auto; margin-top:8px">
        ${items.map((it, i) => `
          <label style="display:flex; gap:9px; align-items:flex-start; padding:6px 4px;
                        border-bottom:1px solid var(--line); cursor:pointer; font-size:12.5px; color:var(--ink)">
            <input type="checkbox" data-i="${i}" checked style="margin-top:2px">
            <span><b>${esc(it.label)}</b>
              ${it.detail ? `<br><span class="muted">${esc(it.detail)}</span>` : ''}</span>
          </label>`).join('')}
      </div>
      <div class="row" style="justify-content:space-between; margin-top:14px">
        <div class="row">
          <button type="button" class="small" id="rv-all">All</button>
          <button type="button" class="small" id="rv-none">None</button>
        </div>
        <div class="row">
          <button type="button" id="rv-cancel">Dismiss</button>
          <button type="button" class="primary" id="rv-ok">${esc(acceptLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    const boxes = () => [...dlg.querySelectorAll('input[type="checkbox"]')];
    dlg.querySelector('#rv-all').addEventListener('click', () => boxes().forEach(b => b.checked = true));
    dlg.querySelector('#rv-none').addEventListener('click', () => boxes().forEach(b => b.checked = false));
    const finish = (val) => { dlg.close(); dlg.remove(); resolve(val); };
    dlg.querySelector('#rv-cancel').addEventListener('click', () => finish(null));
    dlg.querySelector('#rv-ok').addEventListener('click', () =>
      finish(boxes().filter(b => b.checked).map(b => Number(b.dataset.i))));
    dlg.addEventListener('cancel', () => finish(null)); // Esc key
    dlg.showModal();
  });
}

// ---------- tiny form dialog helper ----------
function formDialog(title, fields, submitLabel = 'Save') {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `<h3>${esc(title)}</h3><form method="dialog">
      ${fields.map(f => `<div class="row"><div class="field" style="flex:1">
        <label>${esc(f.label)}</label>
        ${f.type === 'select'
          ? `<select name="${f.name}">${f.options.map(o =>
              `<option value="${esc(o.value)}" ${String(o.value) === String(f.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
          : f.type === 'textarea'
          ? `<textarea name="${f.name}" rows="3">${esc(f.value ?? '')}</textarea>`
          : `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}"
               ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''}>`}
      </div></div>`).join('')}
      <div class="row" style="justify-content:flex-end; margin-top:16px">
        <button value="cancel">Cancel</button>
        <button value="ok" class="primary">${esc(submitLabel)}</button>
      </div></form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok') { dlg.remove(); return resolve(null); }
      const data = {};
      for (const f of fields) data[f.name] = dlg.querySelector(`[name="${f.name}"]`).value;
      dlg.remove(); resolve(data);
    });
    dlg.showModal();
  });
}

// ---------- Dashboard ----------
async function renderDashboard() {
  currentModuleId = null;
  const [mods, dls] = await Promise.all([api.modulesList(), api.deadlinesList()]);
  const now = Date.now();
  const soon = dls.filter(d => !d.done)
    .map(d => ({ ...d, days: Math.ceil((new Date(d.due_at).getTime() - now) / 86400000) }))
    .filter(d => d.days >= 0 && d.days <= 21)
    .sort((a, b) => a.days - b.days);
  view.innerHTML = `
    ${soon.length ? `<div class="panel exam-banner" style="border-color:var(--danger); margin-bottom:14px">
      <b style="color:var(--danger)">Exam countdown</b>
      <div class="row" style="flex-wrap:wrap; gap:8px; margin-top:8px">
        ${soon.map(d => `<span class="chip" style="border-color:var(--danger)">
          <span class="dot" style="background:${esc(d.module_color)}"></span>
          ${esc(d.module_code)} · ${esc(d.title)} · <b>${d.days}d</b></span>`).join('')}
      </div>
      <p class="muted" style="margin:8px 0 0">Problem queue prioritizes unsolved work in these modules for the next 14 days.</p>
    </div>` : ''}
    <div class="row" style="justify-content:space-between">
      <h2>Modules</h2>
      <div class="row">
        <button id="index-lib">⟳ Index library</button>
        <button class="primary" id="add-mod">+ New module</button>
      </div>
    </div>
    <div class="grid-cards" id="cards">
      ${mods.map(m => `
        <div class="card" data-id="${m.id}">
          <div class="code"><span class="dot" style="background:${esc(m.color)}"></span>${esc(m.code)}
            ${m.exam_pct ? `<span class="chip" style="float:right">exam ${m.exam_pct}%</span>` : ''}</div>
          <div class="name">${esc(m.name)}</div>
          <div class="stats">${m.topic_count} topics · ${m.material_count} materials
            ${m.open_deadlines ? ` · <b style="color:var(--danger)">${m.open_deadlines} due</b>` : ''}</div>
          ${m.target_hours ? `<div class="stats" style="margin-top:6px">
            <span class="mbar" style="width:120px"><div style="width:${Math.min(100, (m.spent_min / 60) / m.target_hours * 100)}%"></div></span>
            <span class="mono"> ${(m.spent_min / 60).toFixed(0)}h / ${m.target_hours}h</span></div>`
          : m.spent_min ? `<div class="stats mono" style="margin-top:6px">${(m.spent_min / 60).toFixed(1)}h logged</div>` : ''}
        </div>`).join('')}
    </div>
    ${mods.length === 0 ? `<div class="panel" style="margin-top:14px">
        <b>First launch?</b>
        <p class="muted" style="margin:6px 0">Index your library to create modules from
        <span class="mono">~/Desktop/year_three</span> automatically — including topics from
        filenames and study tips from Year3_Study_Strategy.md.</p>
        <button class="primary" id="onboard-index">Index year_three now</button>
      </div>` : ''}`;
  view.querySelectorAll('.card').forEach(c =>
    c.addEventListener('click', () => location.hash = `#/module/${c.dataset.id}`));
  view.querySelector('#index-lib').addEventListener('click', () => runIngest());
  view.querySelector('#onboard-index')?.addEventListener('click', () => runIngest());
  view.querySelector('#add-mod').addEventListener('click', async () => {
    const d = await formDialog('New module', [
      { name: 'code', label: 'Course code (e.g. COMP3121)' },
      { name: 'name', label: 'Course name' },
      { name: 'term', label: 'Term' },
      { name: 'color', label: 'Color', type: 'color', value: '#5b8cff' },
    ], 'Create');
    if (d && d.code.trim()) { await api.modulesCreate(d); route(); }
  });
}

// ---------- Module detail ----------
async function renderModule(idStr) {
  const id = Number(idStr);
  const [mods, topics, materials, notes] = await Promise.all([
    api.modulesList(), api.topicsList(id), api.materialsList(id), api.notesList(id)]);
  const mod = mods.find(m => m.id === id);
  if (!mod) { view.innerHTML = '<p class="error">Module not found.</p>'; return; }
  const tips = notes.filter(n => n.kind === 'tip');
  const assessment = notes.find(n => n.kind === 'assessment');

  view.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <h2><span class="dot" style="background:${esc(mod.color)}"></span>${esc(mod.code)} — ${esc(mod.name)}
        ${mod.exam_pct ? `<span class="chip">exam ${mod.exam_pct}%</span>` : ''}
        <span class="chip">${esc(mod.work || '')}</span>
        ${mod.target_hours ? `<span class="chip mono">${(mod.spent_min / 60).toFixed(0)}h / ${mod.target_hours}h</span>` : ''}</h2>
      <div class="row">
        <button id="set-budget" class="small">Hour budget…</button>
        <button id="del-mod" class="danger-ghost">Delete module</button>
      </div>
    </div>

    ${assessment || tips.length ? `<div class="panel">
      ${assessment ? `<div class="muted mono">${esc(assessment.content)}</div>` : ''}
      ${tips.length ? `<h3 style="margin-top:8px">Strategy (from strategy.md)</h3>
        <ul style="margin-left:18px">${tips.map(t => `<li class="muted">${esc(t.content)}</li>`).join('')}</ul>` : ''}
    </div>` : ''}

    <div class="row" style="margin:8px 0">
      <input id="search" placeholder="Search materials in this module…" style="width:280px">
    </div>

    <h3>Sections &amp; materials</h3>
    <p class="muted" style="margin:0 0 10px">Drag files into a section slot — the app renames them on disk
      (e.g. <span class="mono">support-vector-machine-lecture.pdf</span>). Double-click to open.</p>
    <div class="row" style="margin-bottom:10px">
      <button id="add-topic" class="primary small">+ Section</button>
      <button id="ai-topics" class="small">✨ Suggest sections (AI)</button>
      <button id="import-files" class="small">+ Import files</button>
      <button id="add-link" class="small">+ Add link</button>
      <span id="ai-topics-msg" class="muted"></span>
    </div>

    <div class="panel inbox-panel">
      <b>Inbox</b> <span class="muted">— not yet assigned to a section</span>
      <div class="inbox-drop slot-drop" data-slot="other">
        ${materials.filter(m => !m.topic_id).map(matChipHtml).join('')
          || '<span class="muted">Drop here to unassign · import or re-index to fill inbox</span>'}
      </div>
    </div>

    <div id="section-board">
      ${topics.length ? topics.map(t => {
        const secMats = materials.filter(m => m.topic_id === t.id);
        return `<div class="section-card panel" data-section="${t.id}">
          <div class="row" style="justify-content:space-between; align-items:flex-start; margin-bottom:8px">
            <div>
              <b>${esc(t.name)}</b>
              ${t.summary ? `<div class="muted" style="font-size:12px">${esc(t.summary)}</div>` : ''}
              <div style="margin-top:4px">
                <span class="mbar"><div style="width:${t.mastery * 100}%"></div></span>
                <span class="muted"> ${(t.mastery * 100).toFixed(0)}% readiness</span>
                ${t.problem_count ? `<span class="chip">${t.solved_count}/${t.problem_count} solved</span>` : ''}
              </div>
            </div>
            <div class="row" style="flex-wrap:nowrap">
              <button class="small probs" data-id="${t.id}">${t.problem_count ? 'Problems' : '+ problems'}</button>
              <button class="small edit-topic" data-id="${t.id}">Edit</button>
              <button class="small merge-topic" data-id="${t.id}">Merge</button>
              <button class="danger-ghost small del-topic" data-id="${t.id}">✕</button>
            </div>
          </div>
          <div class="slot-grid">
            ${SECTION_SLOTS.map(([slot, label]) => {
              const items = secMats.filter(m => materialSlot(m) === slot);
              return `<div class="slot-col">
                <div class="slot-head">${esc(label)}</div>
                <div class="slot-drop" data-topic-id="${t.id}" data-slot="${slot}">
                  ${items.map(matChipHtml).join('') || '<span class="muted slot-hint">drop here</span>'}
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('') : '<p class="muted">No sections yet — add one (e.g. Support Vector Machine) then drag materials from the inbox.</p>'}
    </div>`;

  view.querySelector('#del-mod').addEventListener('click', async () => {
    if (confirm(`Delete module ${mod.code} and everything in it?`)) {
      await api.modulesDelete(id); location.hash = '#/dashboard';
    }
  });

  view.querySelector('#search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    view.querySelectorAll('.mat-chip').forEach(chip => {
      chip.style.display = !q || chip.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
    view.querySelectorAll('.section-card').forEach(card => {
      const any = [...card.querySelectorAll('.mat-chip')].some(c => c.style.display !== 'none');
      card.style.display = !q || any ? '' : 'none';
    });
  });

  const topicFields = (t = {}) => [
    { name: 'name', label: 'Section name (e.g. Support Vector Machine)', value: t.name },
    { name: 'summary', label: 'Summary', type: 'textarea', value: t.summary },
  ];
  view.querySelector('#add-topic').addEventListener('click', async () => {
    const d = await formDialog('New section', topicFields());
    if (d && d.name.trim()) { await api.topicsCreate({ module_id: id, ...d }); route(); }
  });
  view.querySelectorAll('.edit-topic').forEach(b => b.addEventListener('click', async () => {
    const t = topics.find(x => x.id === Number(b.dataset.id));
    const d = await formDialog('Edit section', topicFields(t));
    if (d) { await api.topicsUpdate({ ...t, ...d }); route(); }
  }));
  view.querySelector('#set-budget').addEventListener('click', async () => {
    const d = await formDialog('Hour budget', [
      { name: 'target_hours', label: 'Target hours for this module (UK: credits × 10)',
        type: 'number', step: '5', min: 0, value: mod.target_hours ?? 100 },
    ]);
    if (d) { await api.modulesUpdate({ ...mod, target_hours: Number(d.target_hours) || null }); route(); }
  });
  // problems dialog: check off attempts/solutions per topic
  view.querySelectorAll('.probs').forEach(b => b.addEventListener('click', () =>
    problemsDialog(topics.find(x => x.id === Number(b.dataset.id)), materials)));
  async function problemsDialog(topic, materials) {
    const probs = await api.problemsList(topic.id);
    const probMats = materials.filter(m => ['problemset', 'assignment', 'exam-prep', 'lab'].includes(materialSlot(m)));
    const dlg = document.createElement('dialog');
    dlg.style.minWidth = '560px';
    const STATUSES = ['todo', 'attempted', 'solved', 'reviewed'];
    dlg.innerHTML = `<h3>Problems — ${esc(topic.name)}</h3>
      <p class="muted">Readiness = solved ÷ total (attempts count 30%). Tag problems from past papers,
        problem sheets and notebooks.</p>
      <div id="prob-list" style="max-height:300px; overflow-y:auto; margin-top:8px">
        ${probs.map(p => `<div class="row" style="border-bottom:1px solid var(--line); padding:5px 0" data-pid="${p.id}">
          <span style="flex:1">${esc(p.label)}
            ${p.material_title ? `<span class="chip">${esc(p.material_title.slice(0, 24))}</span>` : ''}</span>
          <select class="p-status">${STATUSES.map(s =>
            `<option ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <button class="danger-ghost small p-del">✕</button>
        </div>`).join('') || '<p class="muted">No problems tagged yet.</p>'}
      </div>
      <div class="row" style="margin-top:12px">
        <input id="p-new" placeholder="e.g. 2026 paper Q3 — reduction proof" style="flex:1">
        <select id="p-mat"><option value="">(no file)</option>
          ${probMats.map(m => `<option value="${m.id}">${esc(m.title.slice(0, 32))}</option>`).join('')}</select>
        <button class="primary small" id="p-add">Add</button>
      </div>
      <div class="row" style="justify-content:flex-end; margin-top:14px">
        <button id="p-close">Close</button>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelectorAll('[data-pid]').forEach(row => {
      const pid = Number(row.dataset.pid);
      const p = probs.find(x => x.id === pid);
      row.querySelector('.p-status').addEventListener('change', (e) =>
        api.problemsUpdate({ ...p, status: e.target.value }));
      row.querySelector('.p-del').addEventListener('click', async () => {
        await api.problemsDelete(pid); row.remove();
      });
    });
    dlg.querySelector('#p-add').addEventListener('click', async () => {
      const label = dlg.querySelector('#p-new').value.trim();
      if (!label) return;
      await api.problemsCreate({ topic_id: topic.id, label,
        material_id: Number(dlg.querySelector('#p-mat').value) || null });
      dlg.close(); dlg.remove();
      problemsDialog(topic, materials); // reopen with fresh list
    });
    dlg.querySelector('#p-close').addEventListener('click', () => { dlg.close(); dlg.remove(); route(); });
    dlg.addEventListener('cancel', () => { dlg.remove(); route(); });
    dlg.showModal();
  }
  view.querySelectorAll('.del-topic').forEach(b => b.addEventListener('click', async () => {
    if (confirm('Delete section? Materials move to inbox.')) {
      await api.topicsDelete(Number(b.dataset.id)); route();
    }
  }));
  view.querySelectorAll('.merge-topic').forEach(b => b.addEventListener('click', async () => {
    const keepId = Number(b.dataset.id);
    const keep = topics.find(t => t.id === keepId);
    const others = topics.filter(t => t.id !== keepId);
    if (!others.length) return alert('Need another topic to merge into this one.');
    const d = await formDialog(`Merge into "${keep.name}"`, [{
      name: 'mergeId', label: 'Duplicate topic to absorb (will be deleted)',
      type: 'select',
      options: others.map(t => ({ value: t.id, label: t.name })),
    }], 'Merge');
    if (!d) return;
    const mergeId = Number(d.mergeId);
    if (!mergeId || mergeId === keepId) return;
    const victim = topics.find(t => t.id === mergeId)?.name || 'topic';
    if (!confirm(`Merge "${victim}" into "${keep.name}"? Materials, problems and links move over.`)) return;
    await api.topicsMerge({ keepId, mergeId });
    route();
  }));

  view.querySelector('#ai-topics').addEventListener('click', async () => {
    const msg = view.querySelector('#ai-topics-msg');
    msg.textContent = 'Asking local model…';
    const r = await api.aiSuggestTopics(id);
    if (!r.ok) { msg.textContent = r.error; return; }
    msg.textContent = '';
    // skip suggestions that already exist as topics
    const fresh = r.topics.filter(s => !topics.some(t => t.name.toLowerCase() === s.name.toLowerCase()));
    if (!fresh.length) { msg.textContent = 'No new sections suggested.'; return; }
    const picked = await reviewDialog(`AI section suggestions for ${mod.code}`,
      fresh.map(s => ({ label: s.name, detail: s.summary || '' })), 'Add selected');
    if (!picked) return;
    for (const i of picked) {
      await api.topicsCreate({ module_id: id, name: fresh[i].name, summary: fresh[i].summary || '' });
    }
    if (picked.length) route();
  });

  const matFields = (m = {}) => [
    { name: 'title', label: 'Title', value: m.title },
    { name: 'type', label: 'Slot', type: 'select', value: materialSlot(m) || 'lecture',
      options: SECTION_SLOTS.map(([v, label]) => ({ value: v, label })) },
    { name: 'topic_id', label: 'Section', type: 'select', value: m.topic_id ?? '',
      options: [{ value: '', label: '(inbox)' }, ...topics.map(t => ({ value: t.id, label: t.name }))] },
    { name: 'due_at', label: 'Due date (assignments)', type: 'date', value: m.due_at ? m.due_at.slice(0, 10) : '' },
    { name: 'path', label: 'Path / URL', value: m.path },
  ];
  view.querySelector('#import-files').addEventListener('click', async () => {
    const paths = await api.materialsPickFiles();
    for (const p of paths) {
      await api.materialsCreate({ module_id: id, title: p.split('/').pop(), path: p, type: 'lecture' });
    }
    if (paths.length) route();
  });
  view.querySelector('#add-link').addEventListener('click', async () => {
    const d = await formDialog('Add material', matFields());
    if (d && d.title.trim()) {
      const payload = { module_id: id, ...d, topic_id: d.topic_id ? Number(d.topic_id) : null,
        due_at: d.due_at || null };
      if (d.topic_id && d.path) {
        await api.materialsCreate(payload);
        const mats = await api.materialsList(id);
        const created = mats[mats.length - 1];
        await api.materialsOrganize({ materialId: created.id, topicId: Number(d.topic_id), slot: d.type });
      } else {
        await api.materialsCreate(payload);
      }
      route();
    }
  });
  bindSectionBoard();
}

// ---------- Problem queue ----------
async function renderQueue() {
  const items = await api.problemsQueue(100);
  view.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <h2>Problem queue</h2>
      <span class="muted">${items.length} open · exam-soon modules first</span>
    </div>
    <p class="muted">Work through unsolved problems. Mark status from the topic's problem list, or open the source file.</p>
    <table><thead><tr><th>Problem</th><th>Topic</th><th>Module</th><th>Exam</th><th>Status</th><th></th></tr></thead>
    <tbody>
      ${items.map(p => `<tr>
        <td><b>${esc(p.label)}</b>
          ${p.material_title ? `<br><span class="muted">${esc(p.material_title.slice(0, 40))}</span>` : ''}</td>
        <td>${esc(p.topic_name)}</td>
        <td><span class="dot" style="background:${esc(p.module_color)}"></span>${esc(p.module_code)}</td>
        <td class="mono">${p.days_left != null ? (p.days_left <= 14
            ? `<span style="color:var(--danger)">${p.days_left}d</span>` : `${p.days_left}d`) : '—'}</td>
        <td><span class="chip">${esc(p.status)}</span></td>
        <td style="text-align:right; white-space:nowrap">
          <button class="small q-open" data-mid="${p.module_id}" data-tid="${p.topic_id}"
            data-mat="${p.material_id || ''}" data-path="${esc(p.material_path || '')}"
            data-title="${esc(p.material_title || p.label)}">Open</button>
          <button class="small q-mod" data-mid="${p.module_id}">Module</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No open problems — tag some from a topic\'s "+ problems" button.</td></tr>'}
    </tbody></table>`;
  view.querySelectorAll('.q-open').forEach(b => b.addEventListener('click', () => {
    const matId = Number(b.dataset.mat);
    if (matId) openMaterial(matId, b.dataset.title, b.dataset.path);
    else location.hash = `#/module/${b.dataset.mid}`;
  }));
  view.querySelectorAll('.q-mod').forEach(b =>
    b.addEventListener('click', () => { location.hash = `#/module/${b.dataset.mid}`; }));
}

// ---------- Graph ----------
// Not one big map: module scope by default, focus mode for 1-hop questions,
// sparse edges (prereq + related); cross-module stays a list until asked for.
let graphScope = null;      // module id | 'all'
let graphKinds = null;      // Set of visible edge kinds
let graphFocus = null;      // topic id in focus mode (1-hop subgraph)
async function renderGraph_() {
  const [mods, allTopics, allEdges] = await Promise.all([api.modulesList(), api.topicsList(), api.edgesList()]);
  const colors = new Map(mods.map(m => [m.id, m.color]));
  if (graphScope === null) {
    const saved = await api.settingsGet('graph_scope');
    graphScope = currentModuleId || (saved === 'all' ? 'all' : Number(saved) || mods[0]?.id || 'all');
  }
  if (graphKinds === null) {
    graphKinds = new Set(JSON.parse(await api.settingsGet('graph_kinds') || '["prereq","related"]'));
  }

  // --- apply scope / focus / kind filters ---
  const focusTopic = graphFocus && allTopics.find(t => t.id === graphFocus);
  let topics, edges;
  if (focusTopic) {
    // focus mode: the topic + 1-hop neighbors, ALL edge kinds (that's the point)
    const nbr = new Set([focusTopic.id]);
    for (const e of allEdges) {
      if (e.from_topic === focusTopic.id) nbr.add(e.to_topic);
      if (e.to_topic === focusTopic.id) nbr.add(e.from_topic);
    }
    topics = allTopics.filter(t => nbr.has(t.id));
    edges = allEdges.filter(e => e.from_topic === focusTopic.id || e.to_topic === focusTopic.id);
  } else {
    topics = graphScope === 'all' ? allTopics : allTopics.filter(t => t.module_id === graphScope);
    const ids = new Set(topics.map(t => t.id));
    edges = allEdges.filter(e => ids.has(e.from_topic) && ids.has(e.to_topic) && graphKinds.has(e.kind));
  }

  const KIND_LABELS = { prereq: 'prereq', related: 'related', cross_module: 'cross-module',
    analogy: 'analogy', exam_cluster: 'exam-cluster' };
  view.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <h2>Topic Graph</h2>
      <div class="row">
        <button id="add-edge" class="primary">+ Link topics</button>
        <button id="ai-edges">✨ Suggest links (AI)</button>
      </div>
    </div>
    <div class="row" style="margin-bottom:8px">
      <select id="g-scope" ${focusTopic ? 'disabled' : ''}>
        ${mods.map(m => `<option value="${m.id}" ${graphScope === m.id ? 'selected' : ''}>${esc(m.code)} — ${esc(m.name)}</option>`).join('')}
        <option value="all" ${graphScope === 'all' ? 'selected' : ''}>All modules (advanced)</option>
      </select>
      ${focusTopic
        ? `<span class="chip" style="background:#26263a; color:var(--ink-bright)">focus: ${esc(focusTopic.name)}</span>
           <button class="small" id="g-unfocus">✕ exit focus</button>
           <span class="muted">showing 1-hop neighbors, all edge kinds</span>`
        : ['prereq', 'related', 'cross_module', 'analogy', 'exam_cluster'].map(k =>
            `<label style="display:inline-flex; align-items:center; gap:4px; margin:0; font-size:12px; color:var(--muted); cursor:pointer">
              <input type="checkbox" class="g-kind" value="${k}" ${graphKinds.has(k) ? 'checked' : ''}>${KIND_LABELS[k]}</label>`).join('')}
    </div>
    <div class="legend">
      <span class="l-prereq">prereq</span><span class="l-related">related</span>
      <span class="l-cross">cross-module</span><span class="l-analogy">analogy</span>
      <span class="l-exam">exam-cluster</span>
      <span class="muted" style="margin-left:auto">node size = readiness · click node to focus · drag to move</span>
    </div>
    <svg id="graph-svg"></svg>
    <div id="topic-panel"></div>
    <p id="graph-msg" class="muted"></p>`;

  view.querySelector('#g-scope').addEventListener('change', async (e) => {
    graphScope = e.target.value === 'all' ? 'all' : Number(e.target.value);
    graphFocus = null;
    await api.settingsSet('graph_scope', String(graphScope));
    route();
  });
  view.querySelectorAll('.g-kind').forEach(cb => cb.addEventListener('change', async () => {
    cb.checked ? graphKinds.add(cb.value) : graphKinds.delete(cb.value);
    await api.settingsSet('graph_kinds', JSON.stringify([...graphKinds]));
    route();
  }));
  view.querySelector('#g-unfocus')?.addEventListener('click', () => { graphFocus = null; route(); });

  const svg = view.querySelector('#graph-svg');
  requestAnimationFrame(() => window.renderGraph(svg, topics, edges, colors, (t) => {
    if (graphFocus !== t.id) { graphFocus = t.id; route(); }
    showTopicPanel(t);
  }));
  if (focusTopic) showTopicPanel(focusTopic);
  if (!topics.length) view.querySelector('#graph-msg').textContent =
    'No topics in this scope yet — pick another module or index the library.';

  function showTopicPanel(t) {
    const mod = mods.find(m => m.id === t.module_id);
    // the panel always lists ALL links (incl. cross-module), even when not drawn
    const related = allEdges
      .filter(e => e.from_topic === t.id || e.to_topic === t.id)
      .map(e => {
        const otherName = e.from_topic === t.id ? e.to_name : e.from_name;
        const otherMod = mods.find(m => m.id === (e.from_topic === t.id ? e.to_module : e.from_module));
        const cross = otherMod && otherMod.id !== t.module_id;
        return `<li>${esc(e.kind)} → <b>${esc(otherName)}</b>
          ${cross ? `<span class="chip">${esc(otherMod.code)}</span>` : ''}
          ${e.note ? `<span class="muted"> — ${esc(e.note)}</span>` : ''}
          <button class="danger-ghost small del-edge" data-id="${e.id}">✕</button></li>`;
      });
    view.querySelector('#topic-panel').innerHTML = `
      <div class="panel">
        <b>${esc(t.name)}</b> <span class="chip mono">${esc(mod?.code || '')}</span>
        <span class="muted">mastery ${(t.mastery * 100).toFixed(0)}%</span>
        <p class="muted">${esc(t.summary)}</p>
        <ul style="margin:6px 0 0 18px">${related.join('') || '<li class="muted">No links yet.</li>'}</ul>
      </div>`;
    view.querySelectorAll('.del-edge').forEach(b => b.addEventListener('click', async () => {
      await api.edgesDelete(Number(b.dataset.id)); route();
    }));
  }

  const topicOptions = allTopics.map(t => ({
    value: t.id,
    label: `${mods.find(m => m.id === t.module_id)?.code || '?'} / ${t.name}`,
  }));
  view.querySelector('#add-edge').addEventListener('click', async () => {
    if (allTopics.length < 2) return alert('Create at least two topics first.');
    const d = await formDialog('Link topics', [
      { name: 'from_topic', label: 'From (prereq: the one to learn first)', type: 'select', options: topicOptions },
      { name: 'to_topic', label: 'To', type: 'select', options: topicOptions },
      { name: 'kind', label: 'Kind', type: 'select', options: EDGE_KINDS.map(k => ({ value: k, label: k })) },
      { name: 'note', label: 'Why are they linked? (optional)' },
    ], 'Link');
    if (d && d.from_topic !== d.to_topic) {
      await api.edgesCreate({ from_topic: Number(d.from_topic), to_topic: Number(d.to_topic),
        kind: d.kind, note: d.note });
      route();
    }
  });

  view.querySelector('#ai-edges').addEventListener('click', async () => {
    const msg = view.querySelector('#graph-msg');
    msg.textContent = 'Asking local model for link suggestions…';
    const r = await api.aiSuggestEdges();
    if (!r.ok) { msg.textContent = r.error; return; }
    msg.textContent = '';
    const nameOf = (id) => allTopics.find(t => t.id === id)?.name || `#${id}`;
    // strict edge policy: drop unknown topics, existing edges, AND symmetric
    // clutter (any A→B or B→A pair already linked in any kind)
    const linked = new Set(allEdges.flatMap(e => [`${e.from_topic}:${e.to_topic}`, `${e.to_topic}:${e.from_topic}`]));
    const seen = new Set();
    const valid = r.edges.filter(s => {
      if (!allTopics.some(t => t.id === s.from) || !allTopics.some(t => t.id === s.to) || s.from === s.to) return false;
      if (linked.has(`${s.from}:${s.to}`)) return false;
      if (seen.has(`${s.from}:${s.to}`) || seen.has(`${s.to}:${s.from}`)) return false;
      seen.add(`${s.from}:${s.to}`);
      return true;
    });
    if (!valid.length) { msg.textContent = 'No new links suggested.'; return; }
    const picked = await reviewDialog('AI link suggestions',
      valid.map(s => ({ label: `${nameOf(s.from)} → ${nameOf(s.to)}  [${s.kind}]`, detail: s.note || '' })),
      'Link selected');
    if (!picked) return;
    for (const i of picked) {
      const s = valid[i];
      await api.edgesCreate({ from_topic: s.from, to_topic: s.to, kind: s.kind, note: s.note || '' });
    }
    if (picked.length) route(); else msg.textContent = 'No links added.';
  });
}

// ---------- Schedule (today plan + deadlines) ----------
let calCursor = null;    // 'YYYY-MM' shown by the calendar

function schedTableOpen() {
  return `<table class="sched-table"><thead><tr>
    <th>Type</th><th>When</th><th>Module</th><th>Item</th><th>Detail</th><th>Status</th><th></th>
  </tr></thead><tbody>`;
}
function schedTableClose() { return '</tbody></table>'; }

function planRowHtml(b) {
  const faded = b.status !== 'planned' ? ' style="opacity:.45"' : '';
  const actions = b.status === 'planned'
    ? `<button class="small mark" data-id="${b.id}" data-s="done">Done</button>
       <button class="small mark" data-id="${b.id}" data-s="skipped">Skip</button>
       <button class="danger-ghost small del-block" data-id="${b.id}">✕</button>`
    : '';
  return `<tr class="sched-row sched-study"${faded}>
    <td><span class="chip">study</span></td>
    <td class="mono" style="white-space:nowrap">${fmtMin(b.start_min)}–${fmtMin(b.end_min)}</td>
    <td><span class="dot" style="background:${esc(b.module_color || '#999')}"></span>${esc(b.module_code || '')}</td>
    <td><b>${esc(b.topic_name || '(topic removed)')}</b>
      ${b.material_title ? `<span class="chip">${esc(b.material_title)}</span>` : ''}</td>
    <td class="muted">${esc(b.reason)}</td>
    <td><span class="chip">${esc(b.status)}</span></td>
    <td style="text-align:right; white-space:nowrap">${actions}</td>
  </tr>`;
}

function deadlineRowHtml(d, topics, { showCountdown = true } = {}) {
  const topic = topics.find(t => t.id === d.topic_id)?.name || 'whole module';
  const days = Math.ceil((new Date(d.due_at).getTime() - Date.now()) / 86400000);
  let when = esc(d.due_at.slice(0, 16).replace('T', ' '));
  if (showCountdown) {
    const tag = days < 0 ? `${Math.abs(days)}d overdue`
      : days === 0 ? 'today' : days <= 7 ? `${days}d` : `${days}d`;
    const cls = days < 0 || days <= 7 ? 'error' : days <= 21 ? '' : 'muted';
    when += ` <span class="${cls}" style="font-weight:700">(${tag})</span>`;
  }
  return `<tr class="sched-row sched-due" style="${d.done ? 'opacity:.45' : ''}">
    <td><span class="chip">due</span></td>
    <td class="mono" style="white-space:nowrap">${when}</td>
    <td><span class="dot" style="background:${esc(d.module_color)}"></span>${esc(d.module_code)}</td>
    <td><b>${esc(d.title)}</b></td>
    <td class="muted">weight ${d.weight} · ${esc(topic)}</td>
    <td><span class="chip">${d.done ? 'done' : 'open'}</span></td>
    <td style="text-align:right; white-space:nowrap">
      <button class="small toggle-dl" data-id="${d.id}">${d.done ? 'Reopen' : 'Done'}</button>
      <button class="danger-ghost small del-dl" data-id="${d.id}">✕</button>
    </td>
  </tr>`;
}

async function promptStudyBlock(date, topics, mods, materials) {
  if (!topics.length) return alert('Add topics in a module first.');
  const modCode = (id) => mods.find(m => m.id === id)?.code || '?';
  const topicOptions = [...topics]
    .sort((a, b) => modCode(a.module_id).localeCompare(modCode(b.module_id)) || a.name.localeCompare(b.name))
    .map(t => ({ value: t.id, label: `${modCode(t.module_id)} — ${t.name}` }));
  const matOptions = [{ value: '', label: '(none)' },
    ...materials.map(m => ({
      value: m.id,
      label: `${modCode(m.module_id)} · ${m.title}`,
    }))];
  const d = await formDialog('Add study block', [
    { name: 'start', label: 'Start', type: 'time', value: '18:00' },
    { name: 'end', label: 'End', type: 'time', value: '19:30' },
    { name: 'topic_id', label: 'Topic', type: 'select', options: topicOptions },
    { name: 'material_id', label: 'Material (optional)', type: 'select', options: matOptions },
    { name: 'reason', label: 'Note (optional)' },
  ], 'Add');
  if (!d) return;
  const start_min = toMin(d.start);
  const end_min = toMin(d.end);
  if (!d.start || !d.end || end_min <= start_min) return alert('End must be after start.');
  await api.blocksCreate({
    date,
    start_min,
    end_min,
    topic_id: Number(d.topic_id),
    material_id: d.material_id ? Number(d.material_id) : null,
    reason: d.reason.trim(),
  });
  route();
}

async function renderSchedule() {
  const date = today();
  const [blocks, dls, mods, topics, materials] = await Promise.all([
    api.blocksList(date),
    api.deadlinesList(),
    api.modulesList(),
    api.topicsList(),
    api.materialsList(),
  ]);

  const tabs = [
    ['today', 'Today plan'],
    ['timeline', 'Timeline'],
    ['calendar', 'Calendar'],
    ['list', 'Deadlines'],
  ];

  view.innerHTML = `
    <div class="row" style="justify-content:space-between; align-items:center">
      <h2>Schedule${scheduleTab === 'today' ? ` — <span class="mono">${date}</span>` : ''}</h2>
      <div class="row">
        <div class="seg" role="tablist">
          ${tabs.map(([v, label]) =>
            `<button class="seg-btn ${scheduleTab === v ? 'on' : ''}" data-tab="${v}">${label}</button>`).join('')}
        </div>
        ${scheduleTab === 'list' ? '<button id="add-dl" class="primary">+ Deadline</button>' : ''}
        ${scheduleTab === 'today' ? '<button id="add-block" class="primary">+ Study block</button>' : ''}
      </div>
    </div>
    <div id="sched-body"></div>`;

  view.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', async () => {
    scheduleTab = b.dataset.tab;
    if (scheduleTab !== 'today') await api.settingsSet('deadline_view', scheduleTab);
    location.hash = `#/schedule/${scheduleTab}`;
  }));

  const body = view.querySelector('#sched-body');

  if (scheduleTab === 'today') {
    const openDls = dls.filter(d => !d.done).sort((a, b) => a.due_at.localeCompare(b.due_at));
    const planRows = blocks.length
      ? blocks.map(planRowHtml).join('')
      : '<tr><td colspan="7" class="muted">No blocks yet — use + Study block to plan your day.</td></tr>';
    const dlRows = openDls.length
      ? `<tr class="sched-sep"><td colspan="7"><b>Upcoming deadlines</b></td></tr>`
        + openDls.map(d => deadlineRowHtml(d, topics)).join('')
      : '';

    body.innerHTML = schedTableOpen() + planRows + dlRows + schedTableClose();
    view.querySelector('#add-block')?.addEventListener('click', () =>
      promptStudyBlock(date, topics, mods, materials));
  } else if (scheduleTab === 'list') {
    const rows = dls.length
      ? dls.map(d => deadlineRowHtml(d, topics, { showCountdown: true })).join('')
      : '<tr><td colspan="7" class="muted">No deadlines.</td></tr>';
    body.innerHTML = schedTableOpen() + rows + schedTableClose();
  } else if (scheduleTab === 'timeline') {
    body.innerHTML = timelineHtml(dls);
  } else if (scheduleTab === 'calendar') {
    body.innerHTML = calendarHtml(dls);
    bindCalendarNav();
  }

  bindScheduleActions(dls, mods, topics);
  if (scheduleTab === 'timeline' || scheduleTab === 'calendar') bindDlTooltips(dls);

  // ----- Timeline -----
  function timelineHtml(dls) {
    const open = dls.filter(d => !d.done).sort((a, b) => a.due_at.localeCompare(b.due_at));
    if (!open.length) return '<p class="muted">No open deadlines — the timeline is clear.</p>';
    const now = Date.now();
    const DAY = 86400000;
    const t0 = Math.min(now, new Date(open[0].due_at).getTime()) - 2 * DAY;
    const t1 = new Date(open[open.length - 1].due_at).getTime() + 4 * DAY;
    const W = 920, H = 190, PAD = 40, AXIS_Y = 118;
    const x = (t) => PAD + (t - t0) / (t1 - t0) * (W - 2 * PAD);

    const ticks = [];
    const d0 = new Date(t0); d0.setDate(1); d0.setMonth(d0.getMonth() + 1);
    for (let d = d0; d.getTime() < t1; d.setMonth(d.getMonth() + 1)) {
      ticks.push({ t: d.getTime(), label: d.toLocaleString('en', { month: 'short' }) });
    }

    const placed = [];
    const dots = open.map((d, i) => {
      const t = new Date(d.due_at).getTime();
      const cx = x(t);
      let lane = 0;
      while (placed.some(p => Math.abs(p.cx - cx) < 22 && p.lane === lane)) lane++;
      placed.push({ cx, lane });
      const cy = AXIS_Y - 22 - lane * 30;
      const overdue = t < now;
      const days = Math.ceil((t - now) / DAY);
      return { d, i, cx, cy, overdue, days };
    });

    return `<div class="panel" style="overflow-x:auto">
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; min-width:700px; display:block">
        <line x1="${PAD}" y1="${AXIS_Y}" x2="${W - PAD}" y2="${AXIS_Y}" stroke="#3c3c48" stroke-width="1.5"/>
        ${ticks.map(tk => `
          <line x1="${x(tk.t)}" y1="${AXIS_Y - 4}" x2="${x(tk.t)}" y2="${AXIS_Y + 4}" stroke="#3c3c48"/>
          <text x="${x(tk.t)}" y="${AXIS_Y + 18}" text-anchor="middle" fill="#7d7d8a" font-size="10">${tk.label}</text>`).join('')}
        <line x1="${x(now)}" y1="26" x2="${x(now)}" y2="${AXIS_Y}" stroke="#5b8cff" stroke-width="1.5" stroke-dasharray="4 3"/>
        <text x="${x(now)}" y="16" text-anchor="middle" fill="#5b8cff" font-size="10" font-weight="700">today</text>
        ${dots.map(({ d, i, cx, cy, overdue, days }) => `
          <g class="dl-dot" data-i="${i}" style="cursor:pointer">
            <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${AXIS_Y}" stroke="${esc(d.module_color)}" stroke-width="1" opacity=".35"/>
            <circle cx="${cx}" cy="${cy}" r="${6 + Math.min(4, d.weight * 1.5)}"
              fill="${esc(d.module_color)}" stroke="#1a1a1e" stroke-width="2"
              ${overdue ? 'opacity=".45"' : ''}/>
            <text x="${cx}" y="${cy - 13}" text-anchor="middle" fill="#d6d6dd" font-size="9.5"
              font-family="var(--mono)">${esc(d.module_code)}</text>
            <text x="${cx}" y="${AXIS_Y + 32}" text-anchor="middle" font-size="9.5"
              fill="${overdue ? '#e5534b' : days <= 7 ? '#e5534b' : days <= 21 ? '#c98500' : '#7d7d8a'}"
              font-weight="700">${overdue ? 'overdue' : days === 0 ? 'today' : days + 'd'}</text>
          </g>`).join('')}
      </svg>
      <p class="muted" style="margin-top:6px">Dot size = weight · label = days left · hover a dot for details. Soonest is leftmost.</p>
    </div>
    <div id="dl-tip" class="dl-tip" hidden></div>`;
  }

  // ----- Calendar -----
  function calendarHtml(dls) {
    if (!calCursor) calCursor = today().slice(0, 7);
    const [Y, M] = calCursor.split('-').map(Number);
    const first = new Date(Y, M - 1, 1);
    const startDow = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(Y, M, 0).getDate();
    const byDay = new Map();
    for (const d of dls) {
      const key = d.due_at.slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(d);
    }
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push('<div class="cal-cell off"></div>');
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${Y}-${String(M).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const items = byDay.get(iso) || [];
      cells.push(`<div class="cal-cell ${iso === today() ? 'today' : ''}">
        <span class="cal-day">${day}</span>
        ${items.map(d => `<span class="cal-chip ${d.done ? 'done' : ''}" data-i="${dls.indexOf(d)}"
            title="${esc(d.title)}">
          <span class="dot" style="background:${esc(d.module_color)}"></span>${esc(d.title)}</span>`).join('')}
      </div>`);
    }
    const monthName = first.toLocaleString('en', { month: 'long', year: 'numeric' });
    return `<div class="panel">
      <div class="row" style="justify-content:space-between; margin-bottom:10px">
        <button class="small" id="cal-prev">←</button>
        <b>${monthName}</b>
        <div class="row">
          <button class="small" id="cal-today">Today</button>
          <button class="small" id="cal-next">→</button>
        </div>
      </div>
      <div class="cal-grid">
        ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="cal-head">${d}</div>`).join('')}
        ${cells.join('')}
      </div>
    </div>
    <div id="dl-tip" class="dl-tip" hidden></div>`;
  }

  function bindCalendarNav() {
    const shift = (n) => {
      const [Y, M] = calCursor.split('-').map(Number);
      const d = new Date(Y, M - 1 + n, 1);
      calCursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      route();
    };
    body.querySelector('#cal-prev').addEventListener('click', () => shift(-1));
    body.querySelector('#cal-next').addEventListener('click', () => shift(1));
    body.querySelector('#cal-today').addEventListener('click', () => { calCursor = today().slice(0, 7); route(); });
  }

  function bindDlTooltips(dls) {
    const tip = body.querySelector('#dl-tip');
    if (!tip) return;
    const show = (el, d) => {
      const days = Math.ceil((new Date(d.due_at).getTime() - Date.now()) / 86400000);
      tip.innerHTML = `<b>${esc(d.title)}</b><br>
        <span class="mono">${esc(d.due_at.slice(0, 16).replace('T', ' '))}</span> ·
        ${esc(d.module_code)} · weight ${d.weight}<br>
        <span class="${days < 0 ? 'error' : ''}">${days < 0 ? Math.abs(days) + ' days overdue' : days + ' days left'}</span>`;
      const r = el.getBoundingClientRect();
      tip.hidden = false;
      tip.style.left = Math.min(r.left, window.innerWidth - 240) + 'px';
      tip.style.top = (r.bottom + 8) + 'px';
    };
    body.querySelectorAll('.dl-dot, .cal-chip').forEach(el => {
      el.addEventListener('mouseenter', () => show(el, dls[Number(el.dataset.i)]));
      el.addEventListener('mouseleave', () => { tip.hidden = true; });
    });
  }

  function bindScheduleActions(dls, mods, topics) {
    body.querySelectorAll('.mark').forEach(b => b.addEventListener('click', async () => {
      await api.blocksSetStatus(Number(b.dataset.id), b.dataset.s);
      route();
    }));
    body.querySelectorAll('.del-block').forEach(b => b.addEventListener('click', async () => {
      if (confirm('Remove this study block?')) {
        await api.blocksDelete(Number(b.dataset.id));
        route();
      }
    }));
    body.querySelectorAll('.toggle-dl').forEach(b => b.addEventListener('click', async () => {
      const d = dls.find(x => x.id === Number(b.dataset.id));
      await api.deadlinesUpdate({ ...d, done: !d.done });
      route();
    }));
    body.querySelectorAll('.del-dl').forEach(b => b.addEventListener('click', async () => {
      if (confirm('Delete deadline?')) { await api.deadlinesDelete(Number(b.dataset.id)); route(); }
    }));
    const addBtn = view.querySelector('#add-dl');
    if (addBtn) addBtn.addEventListener('click', async () => {
      if (!mods.length) return alert('Create a module first.');
      const d = await formDialog('New deadline', [
        { name: 'title', label: 'Title (e.g. Assignment 2, Midterm)' },
        { name: 'module_id', label: 'Module', type: 'select',
          options: mods.map(m => ({ value: m.id, label: `${m.code} ${m.name}` })) },
        { name: 'topic_id', label: 'Topic (optional — else whole module is urgent)', type: 'select',
          options: [{ value: '', label: '(whole module)' },
            ...topics.map(t => ({ value: t.id, label: t.name }))] },
        { name: 'due_at', label: 'Due', type: 'datetime-local' },
        { name: 'weight', label: 'Weight (exam 3, assignment 2, quiz 1)', type: 'number', step: '0.5', min: 0.5, value: 1 },
      ], 'Add');
      if (d && d.title.trim() && d.due_at) {
        await api.deadlinesCreate({ ...d, module_id: Number(d.module_id),
          topic_id: d.topic_id ? Number(d.topic_id) : null, weight: Number(d.weight) });
        route();
      }
    });
  }
}

// ---------- Settings ----------
async function renderSettings() {
  const [model, aiStat, root] = await Promise.all([
    api.settingsGet('ollama_model'), api.aiStatus(), api.ingestDefaultRoot()]);
  view.innerHTML = `
    <h2>Settings</h2>
    <div class="panel">
      <h3 style="margin-top:0">Library root</h3>
      <p class="muted mono">${esc(root)}</p>
      <div class="row" style="margin-top:6px">
        <button id="pick-root">Change folder…</button>
        <button id="run-index" class="primary">Re-index now</button>
      </div>
    </div>
    <div class="panel">
      <h3 style="margin-top:0">Local AI (Ollama)</h3>
      <p class="muted">All study content stays on this machine. AI features call a local Ollama server only
        (127.0.0.1:11434) and are skipped when it isn't running.</p>
      <p style="margin:8px 0">Status: ${aiStat.ok
        ? `<b style="color:var(--ok)">connected</b> · models: ${aiStat.models.map(esc).join(', ') || 'none pulled'}`
        : `<b style="color:var(--danger)">offline</b> — install from ollama.com, then \`ollama pull llama3.2\``}</p>
      <div class="row">
        <div class="field"><label>Model name (blank = auto-use first available)</label>
          <input id="model" value="${esc(model || '')}" placeholder="auto" style="width:220px"></div>
        <button id="save-model" class="primary" style="align-self:flex-end">Save</button>
      </div>
    </div>`;
  view.querySelector('#save-model').addEventListener('click', async () => {
    await api.settingsSet('ollama_model', view.querySelector('#model').value.trim());
    route();
  });
  view.querySelector('#pick-root').addEventListener('click', async () => {
    const p = await api.ingestPickRoot();
    if (p) runIngest(p);
  });
  view.querySelector('#run-index').addEventListener('click', () => runIngest());
}

// ---------- boot ----------
(async function boot() {
  const badge = document.getElementById('st-ai');
  api.aiStatus().then(s => {
    badge.textContent = s.ok ? 'AI: local' : 'AI: offline';
    badge.classList.toggle('on', s.ok);
  });
  if (!location.hash) location.hash = '#/dashboard';
  route();
  setInterval(refreshStatus, 60000); // keep "next block" in the status bar fresh
})();
