/* Study Graph — Cursor-style renderer. Shell (activity bar / sidebar tree /
   status bar / command palette) + hash-routed workspace views over window.api. */
const view = document.getElementById('view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const today = () => new Date().toISOString().slice(0, 10);

function fmtAgo(iso) {
  if (!iso) return '';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function fmtClock(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const MATERIAL_TYPES = ['lecture', 'assignment', 'exam-prep', 'paper', 'lab', 'cheatsheet', 'notes', 'overview'];
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
  // overview = "about this module" files: reference material, never study content
  if (['cheatsheet', 'notes', 'overview'].includes(m.type)) return 'reference';
  if (SECTION_SLOTS.some(([k]) => k === m.type)) return m.type;
  return 'other';
}

const SLOT_COLORS = {
  lecture: '#085041',
  problemset: '#3C3489',
  reference: '#444441',
  lab: '#712B13',
  other: '#8A8983',
};

/** Map module color / code → calm tag class (2–3 ramps max in a view). */
function tagClassForModule(modOrCode, color) {
  const code = (typeof modOrCode === 'string' ? modOrCode : modOrCode?.code || '').toUpperCase();
  const c = (color || (typeof modOrCode === 'object' ? modOrCode?.color : '') || '').toLowerCase();
  if (code.includes('3009') || c === '#085041') return 'tag-teal';
  if (code.includes('3007') || c === '#3c3489') return 'tag-purple';
  if (code.includes('3077') || c === '#712b13') return 'tag-coral';
  if (code.includes('3003') || code.includes('3004') || c === '#72243e') return 'tag-pink';
  if (c === '#791f1f') return 'tag-red';
  if (c === '#27500a') return 'tag-green';
  return 'tag-gray';
}

function matChipHtml(m) {
  const hint = m.last_page ? `page ${m.last_page}`
    : m.last_scroll ? `scrolled ${m.last_scroll}px` : '';
  const slot = materialSlot(m);
  return `<div class="mat-card" draggable="true" data-id="${m.id}" data-path="${esc(m.path)}"
    data-title="${esc(m.title)}" title="${esc(m.path)}${hint ? ` · ${hint}` : ''}">
    <div class="mat-card-bar" style="background:${SLOT_COLORS[slot] || SLOT_COLORS.other}"></div>
    <div class="mat-card-body">
      <div class="mat-card-title">${esc(m.title)}</div>
      <div class="mat-card-meta muted">
        ${hint ? `<span>${esc(hint)}</span>` : '<span>Double-click to open</span>'}
        ${m.note_count ? `<button class="mat-notes" data-id="${m.id}" data-title="${esc(m.title)}"
          title="Review this file's notes graph">✎ ${m.note_count}</button>` : ''}
      </div>
    </div>
  </div>`;
}

function bindSectionBoard() {
  view.querySelectorAll('.mat-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/material-id', card.dataset.id);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dblclick', () =>
      openMaterial(Number(card.dataset.id), card.dataset.title, card.dataset.path));
  });
  view.querySelectorAll('.mat-notes').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    notesDialog(Number(b.dataset.id), b.dataset.title);
  }));
  view.querySelectorAll('.slot-drop, .inbox-drop').forEach(zone => {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('over');
    });
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
  cards: renderCards,         // spaced-repetition flashcards
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
  if (materialId) api.materialsTouchOpen(materialId);
  let mode = 'none';
  if (path && !path.startsWith('http')) {
    const r = await api.materialsOpen({ path, materialId });
    mode = r?.mode || 'external';
  }
  startTimer(materialId, title, mode);
}

async function startTimer(materialId, title, mode = 'none') {
  if (!materialId) return;
  await stopTimer(true);
  previewFocused = false;
  pomoLastElapsed = 0; // new timer counts from zero — resync the pomodoro feed
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

// ---------- pomodoro coach ----------
// Rides on the material timer: only ACTIVE study time advances the work phase,
// breaks run on the wall clock. Completed pomodoros are logged for count/streak.
let pomo = null;            // Pomodoro state (null = disabled in settings)
let pomoLastElapsed = 0;    // last timerElapsedMs() seen, to feed active-time deltas
let pomoTick = null;
let pomoStats = { count: 0, streak: 0 };

async function initPomodoro() {
  if (pomoTick) { clearInterval(pomoTick); pomoTick = null; }
  pomo = null;
  if ((await api.settingsGet('pomodoro_enabled')) === '1') {
    const cfg = JSON.parse(await api.settingsGet('pomodoro_cfg') || '{}');
    pomo = Pomodoro.createPomodoro(cfg);
    pomoLastElapsed = timer ? timerElapsedMs() : 0;
    pomoStats = await api.pomoStats();
    pomoTick = setInterval(pomodoroHeartbeat, 1000);
  }
  renderPomodoroDisplay();
}

function notifyUser(title, body) {
  // Main decides whether an OS notification is warranted (only when the window
  // is unfocused, and only if enabled in Settings); the toast always shows.
  api.notifyShow({ title, body }).catch(() => {});
  toastStatus(title);
}

async function pomodoroHeartbeat() {
  if (!pomo) return;
  if (timer) {
    const el = timerElapsedMs();
    const delta = el - pomoLastElapsed;
    pomoLastElapsed = el;
    if (delta > 0) {
      const r = Pomodoro.applyWork(pomo, delta);
      pomo = r.pomo;
      if (r.events.includes('work-complete')) {
        await api.pomoLog({ material_id: timer?.materialId || null, work_min: pomo.cfg.workMin });
        pomoStats = await api.pomoStats();
        const long = pomo.phase === 'long_break';
        notifyUser(
          `Pomodoro ${pomoStats.count} done 🍅`,
          long ? `Take a long ${pomo.cfg.longBreakMin}-minute break — you earned it.`
               : `Take a ${pomo.cfg.shortBreakMin}-minute break, then come back.`);
      }
    }
  }
  const t = Pomodoro.tick(pomo);
  pomo = t.pomo;
  if (t.events.includes('break-complete')) {
    notifyUser('Break over', 'Back to focused work — open your next material.');
  }
  renderPomodoroDisplay();
}

function renderPomodoroDisplay() {
  const el = document.getElementById('st-pomo');
  if (!pomo) { el.hidden = true; return; }
  el.hidden = false;
  const ms = Pomodoro.phaseRemainingMs(pomo);
  const mm = Math.floor(ms / 60000);
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const streak = pomoStats.streak > 1 ? ` · streak ${pomoStats.streak}d` : '';
  if (pomo.phase === 'work') {
    const counting = timer && !timer.paused;
    el.innerHTML = `🍅 ${mm}:${ss} to break${counting ? '' : ' <span class="muted">(waiting for focus)</span>'} · ${pomoStats.count} today${streak}`;
  } else {
    el.innerHTML = `☕ break ${mm}:${ss} <a href="#" id="st-pomo-skip">skip</a> · ${pomoStats.count} today${streak}`;
    el.querySelector('#st-pomo-skip').onclick = (e) => {
      e.preventDefault();
      pomo = Pomodoro.skipBreak(pomo);
      renderPomodoroDisplay();
    };
  }
}

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

// ---------- reading notes dialog (review the concept graph without reopening the file) ----------
async function notesDialog(materialId, title) {
  let graph = await api.notesListReading(materialId);
  let selected = [];
  const dlg = document.createElement('dialog');
  dlg.className = 'notes-dialog';
  dlg.innerHTML = `<h3 style="margin-bottom:2px">Notes — ${esc(title)}</h3>
    <p class="muted" id="nd-hint" style="margin:0 0 8px">Click two notes to link them. New notes go to this file's graph.</p>
    <div class="nd-body">
      <svg id="nd-graph"></svg>
      <div id="nd-list" class="nd-list"></div>
    </div>
    <div class="row" style="margin-top:10px">
      <input id="nd-input" placeholder="Add a concept…" style="flex:1">
      <button class="primary small" id="nd-add">Add</button>
      <button class="small" id="nd-ai" title="Local AI proposes links between your concepts — you accept or reject each">✨ Suggest links</button>
      <button class="small" id="nd-close" style="margin-left:auto">Close</button>
    </div>`;
  document.body.appendChild(dlg);

  const redraw = () => {
    const svg = dlg.querySelector('#nd-graph');
    if (window.renderNotesGraph) {
      window.renderNotesGraph(svg, graph.notes, graph.links, {
        selectedIds: selected,
        onNodeClick: (n) => toggle(n.id),
      });
    }
    dlg.querySelector('#nd-list').innerHTML = graph.notes.map(n => `
      <div class="nd-item ${selected.includes(n.id) ? 'selected' : ''}" data-id="${n.id}">
        <b>${esc(n.label)}</b>
        <button class="danger-ghost small nd-del" data-id="${n.id}">✕</button>
        <div class="muted" style="font-size:11px">${n.page ? `p.${n.page} · ` : ''}${esc((n.created_at || '').slice(0, 10))}</div>
        ${n.body ? `<div class="muted" style="font-size:12px">${esc(n.body)}</div>` : ''}
      </div>`).join('')
      || '<p class="muted" style="padding:6px">No notes for this file yet — open it and capture concepts while reading, or add one below.</p>';
    dlg.querySelectorAll('.nd-item').forEach(el => el.addEventListener('click', (e) => {
      if (e.target.classList.contains('nd-del')) return;
      toggle(Number(el.dataset.id));
    }));
    dlg.querySelectorAll('.nd-del').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      graph = await api.notesDeleteReading({ id: Number(b.dataset.id), materialId });
      selected = [];
      redraw();
    }));
    dlg.querySelector('#nd-hint').textContent = selected.length === 1
      ? 'Now click a second note to link it.'
      : 'Click two notes to link them. New notes go to this file\'s graph.';
  };
  const toggle = async (id) => {
    if (selected.includes(id)) selected = selected.filter(x => x !== id);
    else if (selected.length === 1) {
      graph = await api.notesLinkReading({ fromId: selected[0], toId: id, materialId });
      selected = [];
    } else selected = [id];
    redraw();
  };
  const add = async () => {
    const label = dlg.querySelector('#nd-input').value.trim();
    if (!label) return;
    graph = await api.notesCreateReading({ material_id: materialId, label });
    dlg.querySelector('#nd-input').value = '';
    selected = [];
    redraw();
  };
  dlg.querySelector('#nd-add').addEventListener('click', add);
  dlg.querySelector('#nd-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });
  dlg.querySelector('#nd-ai').addEventListener('click', async () => {
    const hint = dlg.querySelector('#nd-hint');
    hint.textContent = 'Asking local model for link suggestions…';
    const r = await api.aiSuggestNoteLinks(materialId);
    if (!r.ok) { hint.textContent = r.error; return; }
    hint.textContent = '';
    if (!r.links.length) { hint.textContent = 'No new links suggested.'; return; }
    const byId = new Map(graph.notes.map(n => [n.id, n.label]));
    const picked = await reviewDialog('AI link suggestions',
      r.links.map(s => ({ label: `${byId.get(s.from)} ↔ ${byId.get(s.to)}`, detail: s.why || '' })),
      'Link selected');
    if (!picked) return;
    const pickedSet = new Set(picked);
    for (let i = 0; i < r.links.length; i++) {
      const s = r.links[i];
      const accepted = pickedSet.has(i);
      api.aiFeedback({ kind: 'note-link', accepted,
        payload: { a: byId.get(s.from), b: byId.get(s.to) } });
      if (accepted) graph = await api.notesLinkReading({ fromId: s.from, toId: s.to, materialId });
    }
    selected = [];
    redraw();
  });
  const finish = () => { dlg.close(); dlg.remove(); route(); };
  dlg.querySelector('#nd-close').addEventListener('click', finish);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(); });
  dlg.showModal();
  redraw();
}

// ---------- Dashboard (study companion home) ----------
async function renderDashboard() {
  currentModuleId = null;
  const date = today();
  let resume = [];
  let studyLog = [];
  const [mods, dls] = await Promise.all([api.modulesList(), api.deadlinesList()]);
  try {
    [resume, studyLog] = await Promise.all([api.studyResume(6), api.studyTodayLog(date)]);
  } catch {
    // Main process not restarted since study companion IPC was added — dashboard still loads.
  }
  const now = Date.now();
  const soon = dls.filter(d => !d.done)
    .map(d => ({ ...d, days: Math.ceil((new Date(d.due_at).getTime() - now) / 86400000) }))
    .filter(d => d.days >= 0 && d.days <= 21)
    .sort((a, b) => a.days - b.days);
  const todayMin = studyLog.reduce((n, e) => n + (e.duration_min || 0), 0);

  view.innerHTML = `
    ${soon.length ? `<div class="panel exam-banner" style="margin-bottom:14px">
      <b>Exam countdown</b>
      <div class="row" style="flex-wrap:wrap; gap:8px; margin-top:8px">
        ${soon.map(d => `<span class="tag tag-red">
          <span class="dot" style="background:${esc(d.module_color)}"></span>
          ${esc(d.module_code)} · ${esc(d.title)} · <b>${d.days}d</b></span>`).join('')}
      </div>
    </div>` : ''}

    <div class="row" style="justify-content:space-between; align-items:baseline">
      <h2>Study companion</h2>
      <span class="muted">Today · <b class="mono">${(todayMin / 60).toFixed(1)}h</b> logged</span>
    </div>
    <p id="study-restart-hint" class="muted" style="display:none; margin:0 0 10px; color:var(--danger)">
      Restart the app (Cmd+Q, then <span class="mono">npm start</span>) to enable today's log and resume.
    </p>

    <h3 style="margin-top:14px">Continue where you left off
      <span class="muted" style="font-weight:400; font-size:12px"> · last ${resume.length || 0} opened</span></h3>
    ${resume.length ? `<div class="resume-grid">
      ${resume.map(r => `<div class="panel resume-card">
        <div class="row" style="justify-content:space-between; align-items:flex-start">
          <div style="min-width:0; flex:1">
            <div><span class="dot" style="background:${esc(r.module_color)}"></span>
              <span class="muted">${esc(r.module_code)}</span>
              ${r.section_name ? ` · <b>${esc(r.section_name)}</b>` : ''}</div>
            <div style="margin-top:4px"><b>${esc(r.title)}</b></div>
            <div class="muted" style="font-size:11.5px; margin-top:4px">
              ${slotLabel(r.slot)} · opened ${fmtAgo(r.last_opened_at)}
              ${r.last_page ? ` · <b>page ${r.last_page}</b>` : ''}
              ${r.last_scroll ? (r.last_page ? ` · scroll ${r.last_scroll}px` : ` · scrolled ${r.last_scroll}px`) : ''}
              ${r.total_min ? ` · ${(r.total_min / 60).toFixed(1)}h total` : ''}
              ${r.problem_count ? ` · ${r.solved_count}/${r.problem_count} problems` : ''}
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end">
            <button class="primary small resume-open" data-id="${r.id}" data-title="${esc(r.title)}"
              data-path="${esc(r.path || '')}">Continue</button>
            ${r.note_count ? `<button class="small resume-notes" data-id="${r.id}"
              data-title="${esc(r.title)}">✎ ${r.note_count} note${r.note_count > 1 ? 's' : ''}</button>` : ''}
          </div>
        </div>
      </div>`).join('')}
    </div>` : `<p class="muted">Open a material from any module — it will show up here so you can pick up after a break.</p>`}

    <h3 style="margin-top:18px">Today's study — <span class="mono">${date}</span></h3>
    ${studyLog.length ? `<table class="study-log-table"><thead><tr>
      <th>When</th><th>Module</th><th>Section</th><th>Material</th><th>Time</th><th></th>
    </tr></thead><tbody>
      ${studyLog.map(e => `<tr>
        <td class="mono">${fmtClock(e.started_at)}</td>
        <td><span class="dot" style="background:${esc(e.module_color)}"></span>${esc(e.module_code)}</td>
        <td class="muted">${esc(e.section_name || '—')}</td>
        <td>${esc(e.material_title || '—')}</td>
        <td class="mono">${e.duration_min}m</td>
        <td style="text-align:right">
          ${e.material_id ? `<button class="small log-open" data-id="${e.material_id}"
            data-title="${esc(e.material_title)}" data-path="${esc(e.path || '')}">Open</button>` : ''}
        </td>
      </tr>`).join('')}
    </tbody></table>` : `<p class="muted">Nothing logged yet today — open a file to study; time counts while the preview is focused.</p>`}

    <div class="row" style="justify-content:space-between; margin-top:22px">
      <h3>Modules</h3>
      <div class="row">
        <button id="index-lib">⟳ Index library</button>
        <button class="primary" id="add-mod">+ New module</button>
      </div>
    </div>
    <div class="grid-cards" id="cards">
      ${mods.map(m => `
        <div class="card" data-id="${m.id}">
          <div class="code"><span class="dot" style="background:${esc(m.color)}"></span>${esc(m.code)}
            <span class="tag ${tagClassForModule(m)}" style="float:right; font-weight:600">${esc(m.name.split(' ')[0])}</span>
            ${m.exam_pct ? `<span class="chip" style="float:right; margin-right:6px">exam ${m.exam_pct}%</span>` : ''}</div>
          <div class="name">${esc(m.name)}</div>
          <div class="stats">${m.topic_count} sections · ${m.material_count} materials
            ${m.open_deadlines ? ` · <b class="tag tag-red" style="font-weight:700">${m.open_deadlines} due</b>` : ''}</div>
          ${m.target_hours ? `<div class="stats" style="margin-top:6px">
            <span class="mbar" style="width:120px"><div style="width:${Math.min(100, (m.spent_min / 60) / m.target_hours * 100)}%"></div></span>
            <span class="mono"> ${(m.spent_min / 60).toFixed(0)}h / ${m.target_hours}h</span></div>`
          : m.spent_min ? `<div class="stats mono" style="margin-top:6px">${(m.spent_min / 60).toFixed(1)}h logged</div>` : ''}
        </div>`).join('')}
    </div>
    ${mods.length === 0 ? `<div class="panel" style="margin-top:14px">
        <b>First launch?</b>
        <p class="muted" style="margin:6px 0">Index your library to create modules from
        <span class="mono">~/Desktop/year_three</span> automatically.</p>
        <button class="primary" id="onboard-index">Index year_three now</button>
      </div>` : ''}`;

  view.querySelectorAll('.resume-open, .log-open').forEach(b =>
    b.addEventListener('click', () => openMaterial(Number(b.dataset.id), b.dataset.title, b.dataset.path)));
  view.querySelectorAll('.resume-notes').forEach(b =>
    b.addEventListener('click', () => notesDialog(Number(b.dataset.id), b.dataset.title)));
  if (!resume.length && !studyLog.length) {
    try {
      await api.studyTodayLog(date);
    } catch {
      const hint = view.querySelector('#study-restart-hint');
      if (hint) hint.style.display = 'block';
    }
  }
  view.querySelectorAll('.card').forEach(c =>
    c.addEventListener('click', () => location.hash = `#/module/${c.dataset.id}`));
  view.querySelector('#index-lib')?.addEventListener('click', () => runIngest());
  view.querySelector('#onboard-index')?.addEventListener('click', () => runIngest());
  view.querySelector('#add-mod')?.addEventListener('click', async () => {
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
    <p class="muted" style="margin:0 0 10px">Trello-style board — drag file cards into a column. Files rename on disk
      (e.g. <span class="mono">support-vector-machine-lecture.pdf</span>). Double-click to open.</p>
    <div class="row" style="margin-bottom:10px">
      <button id="add-topic" class="primary small">+ Section</button>
      <button id="ai-topics" class="small">✨ Suggest sections (AI)</button>
      <button id="ai-types" class="small" title="Reads each file's text and checks its type — catches 'about this module' files filed as lectures">✨ Check file types (AI)</button>
      <button id="import-files" class="small">+ Import files</button>
      <button id="add-link" class="small">+ Add link</button>
      <span id="ai-topics-msg" class="muted"></span>
    </div>

    <div class="section-board-wrap inbox-panel" data-section="inbox">
      <div class="section-board-head">
        <div>
          <b>Inbox</b>
          <span class="muted" style="font-size:12px; margin-left:6px">unassigned files</span>
        </div>
        <span class="kanban-count">${materials.filter(m => !m.topic_id).length}</span>
      </div>
      <div class="slot-grid section-kanban">
        <div class="slot-col kanban-col">
          <div class="slot-head kanban-col-head" style="border-top-color:${SLOT_COLORS.other}">
            <span>Unsorted</span>
            <span class="kanban-count">${materials.filter(m => !m.topic_id).length}</span>
          </div>
          <div class="inbox-drop slot-drop kanban-drop" data-slot="other">
            ${materials.filter(m => !m.topic_id).map(matChipHtml).join('')
              || '<span class="muted slot-hint">Drop here to unassign · import or re-index to fill</span>'}
          </div>
        </div>
      </div>
    </div>

    <div id="section-board">
      ${topics.length ? topics.map(t => {
        const secMats = materials.filter(m => m.topic_id === t.id);
        return `<div class="section-board-wrap section-card" data-section="${t.id}">
          <div class="section-board-head">
            <div>
              <b>${esc(t.name)}</b>
              ${t.summary ? `<div class="muted" style="font-size:12px; margin-top:2px">${esc(t.summary)}</div>` : ''}
              <div style="margin-top:6px" title="readiness = the higher of: problems ${((t.mastery_problems ?? 0) * 100).toFixed(0)}% (solved ÷ total, attempts 30%) and study time ${((t.mastery_exposure ?? 0) * 100).toFixed(0)}% (5h caps at 60%)">
                <span class="mbar"><div style="width:${t.mastery * 100}%"></div></span>
                <span class="muted"> ${(t.mastery * 100).toFixed(0)}% readiness</span>
                ${t.mastery > 0 ? `<span class="muted" style="font-size:11px">· from ${
                  (t.mastery_problems ?? 0) >= (t.mastery_exposure ?? 0) ? 'problems' : 'study time'}</span>` : ''}
                ${t.problem_count ? `<span class="chip">${t.solved_count}/${t.problem_count} solved</span>` : ''}
                ${t.exposure_min ? `<span class="chip mono">${(t.exposure_min / 60).toFixed(1)}h</span>` : ''}
              </div>
            </div>
            <div class="row" style="flex-wrap:nowrap">
              <button class="small probs" data-id="${t.id}">${t.problem_count ? 'Problems' : '+ problems'}</button>
              <button class="small edit-topic" data-id="${t.id}">Edit</button>
              <button class="small merge-topic" data-id="${t.id}">Merge</button>
              <button class="danger-ghost small del-topic" data-id="${t.id}">✕</button>
            </div>
          </div>
          <div class="slot-grid section-kanban">
            ${SECTION_SLOTS.map(([slot, label]) => {
              const items = secMats.filter(m => materialSlot(m) === slot);
              return `<div class="slot-col kanban-col">
                <div class="slot-head kanban-col-head" style="border-top-color:${SLOT_COLORS[slot]}">
                  <span>${esc(label)}</span>
                  <span class="kanban-count">${items.length}</span>
                </div>
                <div class="slot-drop kanban-drop" data-topic-id="${t.id}" data-slot="${slot}">
                  ${items.map(matChipHtml).join('') || '<span class="muted slot-hint">Drop files here</span>'}
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
    view.querySelectorAll('.mat-card').forEach(card => {
      const title = (card.dataset.title || card.textContent || '').toLowerCase();
      card.style.display = !q || title.includes(q) ? '' : 'none';
    });
    view.querySelectorAll('.section-card, .section-board-wrap[data-section="inbox"]').forEach(board => {
      const any = [...board.querySelectorAll('.mat-card')].some(c => c.style.display !== 'none');
      board.style.display = !q || any ? '' : 'none';
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
      <p class="muted">Readiness = the higher of problem competence (solved ÷ total, attempts count 30%)
        and study time (5h caps at 60%). Tag problems from past papers, problem sheets and notebooks.</p>
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

  view.querySelector('#ai-types').addEventListener('click', async () => {
    const msg = view.querySelector('#ai-topics-msg');
    msg.textContent = 'Reading files and asking the local model…';
    const offProgress = api.onAiClassifyProgress(({ done, total }) => {
      msg.textContent = `Reading files and asking the local model… ${done}/${total}`;
    });
    const r = await api.aiClassifyModule(id);
    offProgress();
    if (!r.ok) { msg.textContent = r.error; return; }
    msg.textContent = '';
    const changes = r.items.filter(it => it.to !== it.from && it.textStatus !== 'error');
    const failed = r.items.filter(it => it.textStatus === 'error').length;
    if (!changes.length) {
      msg.textContent = `All file types look right (${r.items.length} checked${failed ? `, ${failed} unreadable` : ''}).`;
      return;
    }
    const picked = await reviewDialog(`AI type check — ${mod.code}`,
      changes.map(it => ({
        label: `${it.title}: ${it.from} → ${it.to}`,
        detail: `${it.reason}${it.textStatus !== 'text' ? ` · ⚠ filename only (${it.textStatus})` : ''}`
          + ` · confidence ${Math.round((it.confidence || 0) * 100)}%`,
      })), 'Apply selected');
    if (!picked) return;
    const pickedSet = new Set(picked);
    for (let i = 0; i < changes.length; i++) {
      const it = changes[i];
      const accepted = pickedSet.has(i);
      // log the decision — future prompts imitate it, and it's fine-tune data
      api.aiFeedback({ kind: 'material-type', accepted,
        payload: { title: it.title, from: it.from, to: it.to } });
      if (accepted) {
        const mat = materials.find(m => m.id === it.id);
        if (mat) await api.materialsUpdate({ ...mat, type: it.to });
      }
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

// ---------- Flashcards (SM-2 spaced repetition) ----------
let cardsTopicFilter = 0; // 0 = all topics in the browser table
async function renderCards() {
  const [due, topics, mods, allCards] = await Promise.all([
    api.cardsDue(50), api.topicsList(), api.modulesList(),
    api.cardsList(cardsTopicFilter || undefined)]);
  const modColor = new Map(mods.map(m => [m.id, m.color]));
  const cur = due[0];

  const fmtDue = (iso) => {
    const d = Math.round((new Date(iso) - Date.now()) / 86400000);
    return d <= 0 ? '<span style="color:var(--danger)">due</span>' : `${d}d`;
  };

  view.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <h2>Flashcards</h2>
      <span class="muted">${due.length} due · ${allCards.length} card${allCards.length === 1 ? '' : 's'}${cardsTopicFilter ? ' in topic' : ''}</span>
    </div>
    <div class="panel card-review">
      ${cur ? `
        <p class="muted" style="margin-top:0">
          <span class="dot" style="background:${esc(modColor.get(cur.module_id) || '#888')}"></span>
          ${esc(cur.module_code)} · ${esc(cur.topic_name)}
          · ${cur.reps === 0 ? 'new card' : `seen ${cur.reps}×`}</p>
        <div class="card-face" id="card-front">${esc(cur.front)}</div>
        <div class="card-face card-back" id="card-back" hidden>${esc(cur.back)}</div>
        <div class="row" id="card-actions" style="margin-top:12px">
          <button class="primary" id="card-reveal">Show answer</button>
        </div>
        <div class="row card-ratings" id="card-ratings" hidden style="margin-top:12px">
          ${[['Again', 0, 'var(--danger)'], ['Hard', 1, 'var(--warn, #b58900)'],
             ['Good', 2, 'var(--ok)'], ['Easy', 3, 'var(--accent, var(--ok))']].map(([label, r, color]) => `
            <button class="rate" data-rating="${r}" style="border-color:${color}">
              ${label} <span class="muted">${Srs.previewInterval(cur, r)}</span></button>`).join('')}
        </div>`
      : `<p class="muted" style="margin:0">🎉 No cards due. ${allCards.length
          ? 'Come back when the next review is scheduled.'
          : 'Add your first card below — front is the question, back is the answer.'}</p>`}
    </div>

    <div class="panel">
      <h3 style="margin-top:0">Add a card</h3>
      <div class="row">
        <div class="field"><label>Topic</label>
          <select id="nc-topic">${topics.map(t =>
            `<option value="${t.id}">${esc(mods.find(m => m.id === t.module_id)?.code || '')} — ${esc(t.name)}</option>`).join('')}</select></div>
        <div class="field" style="flex:1"><label>Front (question)</label>
          <input id="nc-front" placeholder="What does SVD factor a matrix into?"></div>
        <div class="field" style="flex:1"><label>Back (answer)</label>
          <input id="nc-back" placeholder="U Σ Vᵀ"></div>
        <button class="primary" id="nc-add" style="align-self:flex-end">Add</button>
      </div>
    </div>

    <div class="row" style="justify-content:space-between; margin-top:6px">
      <h3 style="margin:0">Browse</h3>
      <select id="cards-filter">
        <option value="0">All topics</option>
        ${topics.map(t => `<option value="${t.id}" ${t.id === cardsTopicFilter ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
      </select>
    </div>
    <table><thead><tr><th>Front</th><th>Back</th><th>Topic</th><th>Due</th><th>Reps</th><th></th></tr></thead>
    <tbody>
      ${allCards.map(c => `<tr class="${c.suspended ? 'muted' : ''}">
        <td>${esc(c.front.slice(0, 60))}</td>
        <td class="muted">${esc(c.back.slice(0, 40))}</td>
        <td><span class="dot" style="background:${esc(c.module_color)}"></span>${esc(c.topic_name)}</td>
        <td class="mono">${c.suspended ? 'paused' : fmtDue(c.due_at)}</td>
        <td class="mono">${c.reps}${c.lapses ? ` <span style="color:var(--danger)">(${c.lapses}✗)</span>` : ''}</td>
        <td style="text-align:right; white-space:nowrap">
          <button class="small c-sus" data-id="${c.id}">${c.suspended ? 'Resume' : 'Pause'}</button>
          <button class="small c-del" data-id="${c.id}">✕</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No cards yet.</td></tr>'}
    </tbody></table>`;

  // review flow: reveal → rate → re-render pulls the next due card
  view.querySelector('#card-reveal')?.addEventListener('click', () => {
    view.querySelector('#card-back').hidden = false;
    view.querySelector('#card-actions').hidden = true;
    view.querySelector('#card-ratings').hidden = false;
  });
  view.querySelectorAll('.rate').forEach(b => b.addEventListener('click', async () => {
    await api.cardsReview({ id: cur.id, rating: Number(b.dataset.rating) });
    route();
  }));

  view.querySelector('#nc-add').addEventListener('click', async () => {
    const front = view.querySelector('#nc-front').value.trim();
    if (!front) return alert('The front (question) cannot be empty');
    await api.cardsCreate({
      topic_id: Number(view.querySelector('#nc-topic').value),
      front,
      back: view.querySelector('#nc-back').value.trim(),
    });
    toastStatus('card added — due now');
    route();
  });

  view.querySelector('#cards-filter').addEventListener('change', (e) => {
    cardsTopicFilter = Number(e.target.value);
    route();
  });
  view.querySelectorAll('.c-del').forEach(b => b.addEventListener('click', async () => {
    await api.cardsDelete(Number(b.dataset.id));
    route();
  }));
  view.querySelectorAll('.c-sus').forEach(b => b.addEventListener('click', async () => {
    const c = allCards.find(x => x.id === Number(b.dataset.id));
    await api.cardsUpdate({ ...c, suspended: c.suspended ? 0 : 1 });
    route();
  }));
}

// ---------- Graph ----------
// Not one big map: module scope by default, focus mode for 1-hop questions,
// sparse edges (prereq + related); cross-module stays a list until asked for.
let graphScope = null;      // module id | 'all'
let graphKinds = null;      // Set of visible edge kinds
let graphFocus = null;      // topic id in focus mode (1-hop subgraph)
async function renderGraph_() {
  const [mods, allTopics, allEdges] = await Promise.all([
    api.modulesList(), api.topicsList(), api.edgesList()]);
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
        ? `<span class="tag tag-teal">focus: ${esc(focusTopic.name)}</span>
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

const KANBAN_COLS = [
  ['planned', 'To do', 'var(--c-teal)'],
  ['done', 'Done', 'var(--c-green)'],
  ['skipped', 'Skipped', 'var(--c-gray)'],
];

function blockCardHtml(b) {
  const dur = b.end_min - b.start_min;
  const actions = b.status === 'planned'
    ? `<button class="small mark" data-id="${b.id}" data-s="done">Done</button>
       <button class="small mark" data-id="${b.id}" data-s="skipped">Skip</button>
       <button class="small edit-block" data-id="${b.id}">Edit</button>`
    : b.status === 'done'
      ? `<button class="small reopen-block" data-id="${b.id}">Reopen</button>
         <button class="small dup-block" data-id="${b.id}">+ Again</button>`
      : `<button class="small reopen-block" data-id="${b.id}">Reopen</button>`;
  return `<div class="block-card" draggable="true" data-id="${b.id}" data-status="${esc(b.status)}">
    <div class="block-card-bar" style="background:${esc(b.module_color || '#666')}"></div>
    <div class="block-card-body">
      <div class="block-card-time mono">${fmtMin(b.start_min)}–${fmtMin(b.end_min)}
        <span class="muted"> · ${dur}m</span></div>
      <div class="block-card-mod">${esc(b.module_code || '—')}</div>
      <div class="block-card-title">${esc(b.topic_name || '(topic removed)')}</div>
      ${b.material_title ? `<span class="chip block-card-mat">${esc(b.material_title)}</span>` : ''}
      ${b.reason ? `<div class="block-card-note">${esc(b.reason)}</div>` : ''}
      <div class="block-card-foot">
        ${b.material_path ? `<button class="small open-block-mat" data-id="${b.material_id}"
          data-title="${esc(b.material_title)}" data-path="${esc(b.material_path)}">Open</button>` : ''}
        <div class="block-card-actions">${actions}
          <button class="danger-ghost small del-block" data-id="${b.id}"
            data-logged="${b.status === 'done' ? '1' : '0'}">✕</button>
        </div>
      </div>
    </div>
  </div>`;
}

function todayKanbanHtml(blocks, date) {
  const byStatus = (s) => blocks.filter(b => b.status === s);
  return `<div class="kanban-board">
    ${KANBAN_COLS.map(([status, label, color]) => {
      const items = byStatus(status);
      return `<div class="kanban-col">
        <div class="kanban-col-head" style="border-top-color:${color}">
          <span>${label}</span><span class="kanban-count">${items.length}</span>
        </div>
        <div class="kanban-drop" data-status="${status}" data-date="${esc(date)}">
          ${items.length ? items.map(blockCardHtml).join('')
            : '<span class="kanban-empty muted">Drop cards here</span>'}
        </div>
        ${status === 'planned' ? '<button class="kanban-add" type="button">+ Add block</button>' : ''}
      </div>`;
    }).join('')}
  </div>`;
}

function kanbanDragAfter(container, y) {
  const cards = [...container.querySelectorAll('.block-card:not(.dragging)')];
  return cards.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

function bindKanbanBoard(blocks, date, topics, mods, materials) {
  let dragId = null;
  view.querySelectorAll('.block-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      dragId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/block-id', dragId);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      dragId = null;
      view.querySelectorAll('.kanban-drop.over').forEach(z => z.classList.remove('over'));
    });
  });

  view.querySelectorAll('.kanban-drop').forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('over');
      const id = dragId || e.dataTransfer.getData('text/block-id');
      if (!id) return;
      const card = zone.querySelector(`.block-card[data-id="${id}"]`)
        || view.querySelector(`.block-card[data-id="${id}"]`);
      if (!card) return;
      const after = kanbanDragAfter(zone, e.clientY);
      zone.querySelectorAll('.kanban-empty').forEach(el => el.remove());
      if (after) zone.insertBefore(card, after);
      else zone.appendChild(card);
    });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('over');
    });
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      const id = Number(dragId || e.dataTransfer.getData('text/block-id'));
      if (!id) return;
      const newStatus = zone.dataset.status;
      const block = blocks.find(b => b.id === id);
      const orderedIds = [...zone.querySelectorAll('.block-card')].map(c => Number(c.dataset.id));
      if (block && block.status !== newStatus) await api.blocksSetStatus(id, newStatus);
      await api.blocksReorder({ date: zone.dataset.date, status: newStatus, orderedIds });
      route();
    });
  });

  view.querySelectorAll('.kanban-add').forEach(btn =>
    btn.addEventListener('click', () => promptStudyBlock(date, topics, mods, materials)));
}

function planRowHtml(b) {
  const faded = b.status !== 'planned' ? ' style="opacity:.65"' : '';
  const actions = b.status === 'planned'
    ? `<button class="small mark" data-id="${b.id}" data-s="done">Done</button>
       <button class="small mark" data-id="${b.id}" data-s="skipped">Skip</button>
       <button class="small edit-block" data-id="${b.id}">Edit</button>
       <button class="danger-ghost small del-block" data-id="${b.id}" data-logged="0">✕</button>`
    : `<button class="small reopen-block" data-id="${b.id}">Reopen</button>
       <button class="small dup-block" data-id="${b.id}">+ Again</button>
       <button class="danger-ghost small del-block" data-id="${b.id}" data-logged="${b.status === 'done' ? '1' : '0'}">✕</button>`;
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

function blockFormFields(topics, mods, materials, b = {}) {
  const modCode = (id) => mods.find(m => m.id === id)?.code || '?';
  const topicOptions = [...topics]
    .sort((a, b2) => modCode(a.module_id).localeCompare(modCode(b2.module_id)) || a.name.localeCompare(b2.name))
    .map(t => ({ value: t.id, label: `${modCode(t.module_id)} — ${t.name}` }));
  const matOptions = [{ value: '', label: '(none)' },
    ...materials.map(m => ({
      value: m.id,
      label: `${modCode(m.module_id)} · ${m.title}`,
    }))];
  return [
    { name: 'start', label: 'Start', type: 'time', value: b.start_min != null ? fmtMin(b.start_min) : '18:00' },
    { name: 'end', label: 'End', type: 'time', value: b.end_min != null ? fmtMin(b.end_min) : '19:30' },
    { name: 'topic_id', label: 'Topic', type: 'select', options: topicOptions, value: b.topic_id },
    { name: 'material_id', label: 'Material (optional)', type: 'select', options: matOptions, value: b.material_id ?? '' },
    { name: 'reason', label: 'Note (optional)', value: b.reason },
  ];
}

async function promptStudyBlock(date, topics, mods, materials) {
  if (!topics.length) return alert('Add topics in a module first.');
  const d = await formDialog('Add study block', blockFormFields(topics, mods, materials), 'Add');
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

async function editStudyBlock(b, topics, mods, materials) {
  const d = await formDialog('Edit study block', blockFormFields(topics, mods, materials, b), 'Save');
  if (!d) return;
  const start_min = toMin(d.start);
  const end_min = toMin(d.end);
  if (!d.start || !d.end || end_min <= start_min) return alert('End must be after start.');
  await api.blocksUpdate({
    id: b.id,
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
    const dlSection = openDls.length
      ? `<div class="today-deadlines panel" style="padding:12px 14px">
          <h3>Upcoming deadlines</h3>
          ${schedTableOpen()}${openDls.map(d => deadlineRowHtml(d, topics)).join('')}${schedTableClose()}
        </div>`
      : '';

    body.innerHTML = `${blocks.length ? '' : '<p class="muted" style="margin-top:6px">Plan your day — drag cards between columns or add a block below.</p>'}
      ${todayKanbanHtml(blocks, date)}${dlSection}`;

    bindKanbanBoard(blocks, date, topics, mods, materials);
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
        <line x1="${PAD}" y1="${AXIS_Y}" x2="${W - PAD}" y2="${AXIS_Y}" stroke="var(--border)" stroke-width="1.5"/>
        ${ticks.map(tk => `
          <line x1="${x(tk.t)}" y1="${AXIS_Y - 4}" x2="${x(tk.t)}" y2="${AXIS_Y + 4}" stroke="var(--border)"/>
          <text x="${x(tk.t)}" y="${AXIS_Y + 18}" text-anchor="middle" fill="var(--text-muted)" font-size="10">${tk.label}</text>`).join('')}
        <line x1="${x(now)}" y1="26" x2="${x(now)}" y2="${AXIS_Y}" stroke="var(--c-teal)" stroke-width="1.5" stroke-dasharray="4 3"/>
        <text x="${x(now)}" y="16" text-anchor="middle" fill="var(--c-teal)" font-size="10" font-weight="700">today</text>
        ${dots.map(({ d, i, cx, cy, overdue, days }) => `
          <g class="dl-dot" data-i="${i}" style="cursor:pointer">
            <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${AXIS_Y}" stroke="${esc(d.module_color)}" stroke-width="1" opacity=".35"/>
            <circle cx="${cx}" cy="${cy}" r="${6 + Math.min(4, d.weight * 1.5)}"
              fill="${esc(d.module_color)}" stroke="var(--surface-1)" stroke-width="2"
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
    body.querySelectorAll('.open-block-mat').forEach(b => b.addEventListener('click', () =>
      openMaterial(Number(b.dataset.id), b.dataset.title, b.dataset.path)));
    body.querySelectorAll('.mark').forEach(b => b.addEventListener('click', async () => {
      await api.blocksSetStatus(Number(b.dataset.id), b.dataset.s);
      route();
    }));
    body.querySelectorAll('.edit-block').forEach(b => b.addEventListener('click', () => {
      const block = blocks.find(x => x.id === Number(b.dataset.id));
      if (block) editStudyBlock(block, topics, mods, materials);
    }));
    body.querySelectorAll('.reopen-block').forEach(b => b.addEventListener('click', async () => {
      await api.blocksSetStatus(Number(b.dataset.id), 'planned');
      route();
    }));
    body.querySelectorAll('.dup-block').forEach(b => b.addEventListener('click', async () => {
      await api.blocksDuplicate(Number(b.dataset.id));
      route();
    }));
    body.querySelectorAll('.del-block').forEach(b => b.addEventListener('click', async () => {
      const logged = b.dataset.logged === '1';
      const msg = logged
        ? 'Remove this block? Logged study time for it will be removed from today\'s log.'
        : 'Remove this study block?';
      if (confirm(msg)) {
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
  const [model, aiStat, root, pomoEnabled, pomoCfgRaw, appInfo, remindRaw] = await Promise.all([
    api.settingsGet('ollama_model'), api.aiStatus(), api.ingestDefaultRoot(),
    api.settingsGet('pomodoro_enabled'), api.settingsGet('pomodoro_cfg'), api.appInfo(),
    api.settingsGet('reminders.prefs')]);
  const pomoCfg = { ...Pomodoro.DEFAULTS, ...JSON.parse(pomoCfgRaw || '{}') };
  const remind = Reminders.normalizePrefs(remindRaw);
  const remindRow = (id, label, hint) => `
    <label style="display:flex; align-items:center; gap:6px; margin:4px 0 4px 20px; cursor:pointer">
      <input type="checkbox" id="rm-${id}" ${remind[id] ? 'checked' : ''}> ${label}
      <span class="muted">— ${hint}</span></label>`;
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
        : `<b style="color:var(--danger)">offline</b> — install from ollama.com, then \`ollama pull qwen2.5\``}</p>
      <div class="row">
        <div class="field"><label>Model name (blank = auto-use first available)</label>
          <input id="model" value="${esc(model || '')}" placeholder="auto" style="width:220px"></div>
        <button id="save-model" class="primary" style="align-self:flex-end">Save</button>
      </div>
    </div>
    <div class="panel">
      <h3 style="margin-top:0">Pomodoro coach</h3>
      <p class="muted">Counts only focused study time (the file timer must be running). After each work
        interval you get a break reminder; every ${pomoCfg.cyclesPerLong}th break is the long one.</p>
      <label style="display:flex; align-items:center; gap:6px; margin:8px 0; cursor:pointer">
        <input type="checkbox" id="pomo-on" ${pomoEnabled === '1' ? 'checked' : ''}> Enable pomodoro coach</label>
      <div class="row">
        <div class="field"><label>Work (min)</label>
          <input id="pomo-work" type="number" min="5" max="120" value="${pomoCfg.workMin}" style="width:80px"></div>
        <div class="field"><label>Short break</label>
          <input id="pomo-short" type="number" min="1" max="30" value="${pomoCfg.shortBreakMin}" style="width:80px"></div>
        <div class="field"><label>Long break</label>
          <input id="pomo-long" type="number" min="5" max="60" value="${pomoCfg.longBreakMin}" style="width:80px"></div>
        <div class="field"><label>Cycles per long</label>
          <input id="pomo-cycles" type="number" min="2" max="8" value="${pomoCfg.cyclesPerLong}" style="width:80px"></div>
        <button id="save-pomo" class="primary" style="align-self:flex-end">Save</button>
      </div>
    </div>
    <div class="panel">
      <h3 style="margin-top:0">Notifications</h3>
      <p class="muted">Reminders about your own study data, nothing else — no news, no promotions.
        Each fires at most once (per day where daily), and only while the app is running.</p>
      <label style="display:flex; align-items:center; gap:6px; margin:8px 0; cursor:pointer">
        <input type="checkbox" id="rm-enabled" ${remind.enabled ? 'checked' : ''}>
        <b>Enable notifications</b></label>
      ${remindRow('deadlines', 'Deadlines', 'a heads-up 3 days out, 1 day out, and on the day')}
      ${remindRow('reviews', 'Flashcards due', 'one morning reminder when reviews are waiting')}
      ${remindRow('blocks', 'Study blocks', 'a nudge just before a planned block starts')}
      ${remindRow('pomodoro', 'Pomodoro', 'work done / break over, only when the window is in the background')}
      ${remindRow('streak', 'Streak protection', 'one evening nudge before a study streak breaks')}
      <div class="row" style="margin-top:8px">
        <button id="save-remind" class="primary">Save</button>
      </div>
    </div>
    <div class="panel">
      <h3 style="margin-top:0">Data &amp; backups</h3>
      <p class="muted">Everything lives in one local database file. The app keeps a rotating daily
        backup automatically, and copies the file aside before any schema upgrade. Export gives you
        an off-machine copy; Restore replaces all current data with an exported backup.</p>
      <div class="row" style="margin-top:6px">
        <button id="db-export">Export backup…</button>
        <button id="db-import" class="danger-ghost">Restore from backup…</button>
      </div>
    </div>
    <div class="panel">
      <h3 style="margin-top:0">Troubleshooting</h3>
      <p class="muted">Crashes and unexpected errors are recorded to a local log file (never uploaded).</p>
      <button id="open-log">Open log file</button>
      <p class="muted" style="margin-top:12px">Study Graph Assistant v${esc(appInfo.version)}
        · Electron ${esc(appInfo.electron)}</p>
    </div>`;
  view.querySelector('#save-pomo').addEventListener('click', async () => {
    const num = (id, fallback) => Number(view.querySelector(id).value) || fallback;
    await api.settingsSet('pomodoro_enabled', view.querySelector('#pomo-on').checked ? '1' : '0');
    await api.settingsSet('pomodoro_cfg', JSON.stringify({
      workMin: num('#pomo-work', 25),
      shortBreakMin: num('#pomo-short', 5),
      longBreakMin: num('#pomo-long', 15),
      cyclesPerLong: num('#pomo-cycles', 4),
    }));
    await initPomodoro();
    toastStatus('pomodoro settings saved');
  });
  view.querySelector('#save-remind').addEventListener('click', async () => {
    const on = (id) => view.querySelector(`#rm-${id}`).checked;
    await api.settingsSet('reminders.prefs', JSON.stringify({
      enabled: on('enabled'),
      deadlines: on('deadlines'),
      reviews: on('reviews'),
      blocks: on('blocks'),
      pomodoro: on('pomodoro'),
      streak: on('streak'),
    }));
    toastStatus('notification settings saved');
  });
  view.querySelector('#save-model').addEventListener('click', async () => {
    await api.settingsSet('ollama_model', view.querySelector('#model').value.trim());
    route();
  });
  view.querySelector('#pick-root').addEventListener('click', async () => {
    const p = await api.ingestPickRoot();
    if (p) runIngest(p);
  });
  view.querySelector('#run-index').addEventListener('click', () => runIngest());
  view.querySelector('#open-log').addEventListener('click', () => api.logReveal());
  view.querySelector('#db-export').addEventListener('click', async () => {
    const r = await api.dbExport();
    if (r.ok) toastStatus(`backup saved to ${r.path}`);
    else if (r.error !== 'canceled') toastStatus(`export failed: ${r.error}`);
  });
  view.querySelector('#db-import').addEventListener('click', async () => {
    if (!confirm('Restore from a backup?\n\nThis REPLACES all current data with the '
      + 'backup’s contents. The current database is kept aside as a safety copy.')) return;
    const r = await api.dbImport();
    // on success the window reloads by itself; only failures need a message
    if (!r.ok && r.error !== 'canceled') toastStatus(`restore failed: ${r.error}`);
  });
}

// ---------- boot ----------
// Flight recorder: any uncaught renderer exception is sent to the main-process
// log file, so a blank view on someone else's machine still leaves evidence.
window.addEventListener('error', (e) =>
  api.logRenderer({ message: e.message, stack: e.error?.stack }));
window.addEventListener('unhandledrejection', (e) =>
  api.logRenderer({ message: `unhandled rejection: ${e.reason?.message || e.reason}`,
    stack: e.reason?.stack }));

(async function boot() {
  const badge = document.getElementById('st-ai');
  api.aiStatus().then(s => {
    badge.textContent = s.ok ? 'AI: local' : 'AI: offline';
    badge.classList.toggle('on', s.ok);
  });
  initPomodoro();
  // Exactly one initial render: assigning a NEW hash fires hashchange (which
  // routes), so calling route() as well would double-render — the two async
  // renders interleave and end up attaching duplicate click handlers.
  if (!location.hash) location.hash = '#/dashboard';
  else route();
  setInterval(refreshStatus, 60000); // keep "next block" in the status bar fresh
})();
