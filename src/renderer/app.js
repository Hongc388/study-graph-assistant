/* Study Graph — Cursor-style renderer. Shell (activity bar / sidebar tree /
   status bar / command palette) + hash-routed workspace views over window.api. */
const view = document.getElementById('view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const today = () => new Date().toISOString().slice(0, 10);

const MATERIAL_TYPES = ['lecture', 'assignment', 'exam-prep', 'paper', 'lab', 'cheatsheet', 'notes'];
const EDGE_KINDS = ['prereq', 'related', 'cross_module', 'analogy', 'exam_cluster'];

// ---------- router ----------
const routes = {
  dashboard: renderDashboard,
  module: renderModule,       // #/module/<id>
  graph: renderGraph_,
  today: renderToday,
  deadlines: renderDeadlines,
  settings: renderSettings,
};
let currentModuleId = null;
async function route() {
  const [name, arg] = location.hash.replace(/^#\//, '').split('/');
  const fn = routes[name] || renderDashboard;
  const active = routes[name] ? name : 'dashboard';
  document.querySelectorAll('.act').forEach(a =>
    a.classList.toggle('active', a.dataset.view === active
      || (name === 'module' && a.dataset.view === 'dashboard')));
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
        parts.push(`<div class="tree-file" data-path="${esc(f.path)}" data-mid="${m.id}" title="${esc(f.title)}">${esc(f.title)}</div>`);
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
    el.addEventListener('click', () => { if (el.dataset.path) api.materialsOpen(el.dataset.path); }));
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
    { icon: '▸', label: 'Plan today', run: () => { location.hash = '#/today'; } },
    { icon: '◉', label: 'Open topic graph', run: () => { location.hash = '#/graph'; } },
    { icon: '◷', label: 'Show deadlines', run: () => { location.hash = '#/deadlines'; } },
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
      run: () => api.materialsOpen(m.path),
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
  const mods = await api.modulesList();
  view.innerHTML = `
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
  const topicName = (tid) => topics.find(t => t.id === tid)?.name || '';
  const tips = notes.filter(n => n.kind === 'tip');
  const assessment = notes.find(n => n.kind === 'assessment');

  view.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <h2><span class="dot" style="background:${esc(mod.color)}"></span>${esc(mod.code)} — ${esc(mod.name)}
        ${mod.exam_pct ? `<span class="chip">exam ${mod.exam_pct}%</span>` : ''}
        <span class="chip">${esc(mod.work || '')}</span></h2>
      <button id="del-mod" class="danger-ghost">Delete module</button>
    </div>

    ${assessment || tips.length ? `<div class="panel">
      ${assessment ? `<div class="muted mono">${esc(assessment.content)}</div>` : ''}
      ${tips.length ? `<h3 style="margin-top:8px">Strategy (from strategy.md)</h3>
        <ul style="margin-left:18px">${tips.map(t => `<li class="muted">${esc(t.content)}</li>`).join('')}</ul>` : ''}
    </div>` : ''}

    <div class="row" style="margin:8px 0">
      <input id="search" placeholder="Search materials in this module…" style="width:280px">
    </div>

    <h3>Topics</h3>
    <div class="row" style="margin-bottom:8px">
      <button id="add-topic" class="primary small">+ Topic</button>
      <button id="ai-topics" class="small">✨ Suggest topics (AI)</button>
      <span id="ai-topics-msg" class="muted"></span>
    </div>
    <table><thead><tr><th>Topic</th><th>Mastery</th><th>Summary</th><th></th></tr></thead>
    <tbody>
      ${topics.map(t => `<tr>
        <td><b>${esc(t.name)}</b></td>
        <td><span class="mbar"><div style="width:${t.mastery * 100}%"></div></span>
            <span class="muted"> ${(t.mastery * 100).toFixed(0)}%</span></td>
        <td class="muted">${esc(t.summary)}</td>
        <td style="text-align:right; white-space:nowrap">
          <button class="small edit-topic" data-id="${t.id}">Edit</button>
          <button class="danger-ghost small del-topic" data-id="${t.id}">✕</button></td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted">No topics yet.</td></tr>'}
    </tbody></table>

    <h3>Materials</h3>
    <div class="row" style="margin-bottom:8px">
      <button id="import-files" class="primary small">+ Import files</button>
      <button id="add-link" class="small">+ Add link / note</button>
    </div>
    <table><thead><tr><th>Title</th><th>Type</th><th>Topic</th><th>Due</th><th></th></tr></thead>
    <tbody id="mat-body">
      ${materials.map(m => matRow(m, topicName)).join('') || '<tr><td colspan="5" class="muted">No materials yet.</td></tr>'}
    </tbody></table>`;

  function matRow(m, topicName) {
    return `<tr>
      <td title="${esc(m.path)}"><a href="#" class="open-mat" data-path="${esc(m.path)}"
        style="color:var(--ink); text-decoration:none"><b>${esc(m.title)}</b></a></td>
      <td><span class="chip">${esc(m.type)}</span></td>
      <td class="muted">${esc(topicName(m.topic_id))}</td>
      <td class="muted mono">${m.due_at ? esc(m.due_at.slice(0, 10)) : ''}</td>
      <td style="text-align:right; white-space:nowrap">
        <button class="small edit-mat" data-id="${m.id}">Edit</button>
        <button class="danger-ghost small del-mat" data-id="${m.id}">✕</button></td>
    </tr>`;
  }

  view.querySelector('#del-mod').addEventListener('click', async () => {
    if (confirm(`Delete module ${mod.code} and everything in it?`)) {
      await api.modulesDelete(id); location.hash = '#/dashboard';
    }
  });

  view.querySelector('#search').addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    const rows = q ? await api.materialsSearch(q, id) : await api.materialsList(id);
    view.querySelector('#mat-body').innerHTML =
      rows.map(m => matRow(m, topicName)).join('') || '<tr><td colspan="5" class="muted">No matches.</td></tr>';
    bindMatButtons();
  });

  const topicFields = (t = {}) => [
    { name: 'name', label: 'Name', value: t.name },
    { name: 'summary', label: 'Summary', type: 'textarea', value: t.summary },
    { name: 'mastery', label: 'Mastery (0–1)', type: 'number', step: '0.05', min: 0, max: 1, value: t.mastery ?? 0.3 },
  ];
  view.querySelector('#add-topic').addEventListener('click', async () => {
    const d = await formDialog('New topic', topicFields());
    if (d && d.name.trim()) { await api.topicsCreate({ module_id: id, ...d, mastery: Number(d.mastery) }); route(); }
  });
  view.querySelectorAll('.edit-topic').forEach(b => b.addEventListener('click', async () => {
    const t = topics.find(x => x.id === Number(b.dataset.id));
    const d = await formDialog('Edit topic', topicFields(t));
    if (d) { await api.topicsUpdate({ ...t, ...d, mastery: Number(d.mastery) }); route(); }
  }));
  view.querySelectorAll('.del-topic').forEach(b => b.addEventListener('click', async () => {
    if (confirm('Delete topic?')) { await api.topicsDelete(Number(b.dataset.id)); route(); }
  }));

  view.querySelector('#ai-topics').addEventListener('click', async () => {
    const msg = view.querySelector('#ai-topics-msg');
    msg.textContent = 'Asking local model…';
    const r = await api.aiSuggestTopics(id);
    if (!r.ok) { msg.textContent = r.error; return; }
    msg.textContent = '';
    // skip suggestions that already exist as topics
    const fresh = r.topics.filter(s => !topics.some(t => t.name.toLowerCase() === s.name.toLowerCase()));
    if (!fresh.length) { msg.textContent = 'No new topics suggested.'; return; }
    const picked = await reviewDialog(`AI topic suggestions for ${mod.code}`,
      fresh.map(s => ({ label: s.name, detail: s.summary || '' })), 'Add selected');
    if (!picked) return;
    for (const i of picked) {
      await api.topicsCreate({ module_id: id, name: fresh[i].name, summary: fresh[i].summary || '' });
    }
    if (picked.length) route();
  });

  const matFields = (m = {}) => [
    { name: 'title', label: 'Title', value: m.title },
    { name: 'type', label: 'Type', type: 'select', value: m.type || 'lecture',
      options: MATERIAL_TYPES.map(t => ({ value: t, label: t })) },
    { name: 'topic_id', label: 'Topic', type: 'select', value: m.topic_id ?? '',
      options: [{ value: '', label: '(none)' }, ...topics.map(t => ({ value: t.id, label: t.name }))] },
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
      await api.materialsCreate({ module_id: id, ...d, topic_id: d.topic_id ? Number(d.topic_id) : null,
        due_at: d.due_at || null });
      route();
    }
  });
  function bindMatButtons() {
    view.querySelectorAll('.open-mat').forEach(a => a.addEventListener('click', (e) => {
      e.preventDefault();
      if (a.dataset.path && !a.dataset.path.startsWith('http')) api.materialsOpen(a.dataset.path);
    }));
    view.querySelectorAll('.edit-mat').forEach(b => b.addEventListener('click', async () => {
      const m = materials.find(x => x.id === Number(b.dataset.id));
      const d = await formDialog('Edit material', matFields(m));
      if (d) {
        await api.materialsUpdate({ ...m, ...d, topic_id: d.topic_id ? Number(d.topic_id) : null,
          due_at: d.due_at || null });
        route();
      }
    }));
    view.querySelectorAll('.del-mat').forEach(b => b.addEventListener('click', async () => {
      if (confirm('Delete material entry? (file on disk is untouched)')) {
        await api.materialsDelete(Number(b.dataset.id)); route();
      }
    }));
  }
  bindMatButtons();
}

// ---------- Graph ----------
async function renderGraph_() {
  const [mods, topics, edges] = await Promise.all([api.modulesList(), api.topicsList(), api.edgesList()]);
  const colors = new Map(mods.map(m => [m.id, m.color]));
  view.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <h2>Topic Graph</h2>
      <div class="row">
        <button id="add-edge" class="primary">+ Link topics</button>
        <button id="ai-edges">✨ Suggest links (AI)</button>
      </div>
    </div>
    <div class="legend">
      <span class="l-prereq">prereq</span><span class="l-related">related</span>
      <span class="l-cross">cross-module</span><span class="l-analogy">analogy</span>
      <span class="l-exam">exam-cluster</span>
      <span class="muted" style="margin-left:auto">node size = mastery · click node for details · drag to move</span>
    </div>
    <svg id="graph-svg"></svg>
    <div id="topic-panel"></div>
    <p id="graph-msg" class="muted"></p>`;

  const svg = view.querySelector('#graph-svg');
  requestAnimationFrame(() => window.renderGraph(svg, topics, edges, colors, showTopicPanel));

  function showTopicPanel(t) {
    const mod = mods.find(m => m.id === t.module_id);
    const related = edges
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

  const topicOptions = topics.map(t => ({
    value: t.id,
    label: `${mods.find(m => m.id === t.module_id)?.code || '?'} / ${t.name}`,
  }));
  view.querySelector('#add-edge').addEventListener('click', async () => {
    if (topics.length < 2) return alert('Create at least two topics first.');
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
    const nameOf = (id) => topics.find(t => t.id === id)?.name || `#${id}`;
    // drop suggestions referencing unknown topics or duplicating existing edges
    const valid = r.edges.filter(s =>
      topics.some(t => t.id === s.from) && topics.some(t => t.id === s.to) && s.from !== s.to
      && !edges.some(e => e.from_topic === s.from && e.to_topic === s.to && e.kind === s.kind));
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

// ---------- Today plan ----------
async function renderToday() {
  const date = today();
  const blocks = await api.blocksList(date);
  const savedWindows = JSON.parse(await api.settingsGet('windows') || '[["18:00","21:00"]]');

  view.innerHTML = `
    <h2>Today — <span class="mono">${date}</span></h2>
    <div class="panel">
      <h3 style="margin-top:0">Available time</h3>
      <div id="windows">${savedWindows.map(w => windowRow(w)).join('')}</div>
      <div class="row" style="margin-top:8px">
        <button id="add-window" class="small">+ Window</button>
        <button id="gen" class="primary">Generate today's plan</button>
        <span class="muted">Respects prerequisites, weighs deadlines × weakness × exam %, interleaves cross-module review.</span>
      </div>
    </div>
    <div id="plan">${blocks.map(blockHtml).join('') || '<p class="muted">No plan yet — set your windows and generate.</p>'}</div>`;

  function windowRow(w) {
    return `<div class="row" style="margin-bottom:6px">
      <input type="time" class="w-start" value="${w[0]}"> →
      <input type="time" class="w-end" value="${w[1]}">
      <button class="danger-ghost small del-window">✕</button></div>`;
  }
  function blockHtml(b) {
    return `<div class="panel block ${b.status}">
      <div class="time">${fmtMin(b.start_min)}–${fmtMin(b.end_min)}</div>
      <div style="flex:1">
        <b><span class="dot" style="background:${esc(b.module_color || '#999')}"></span>
        ${esc(b.module_code || '')} ${esc(b.topic_name || '(topic removed)')}</b>
        ${b.material_title ? `<span class="chip">${esc(b.material_title)}</span>` : ''}
        <div class="why">${esc(b.reason)}</div>
      </div>
      <div class="row">
        ${b.status === 'planned'
          ? `<button class="small mark" data-id="${b.id}" data-s="done">Done</button>
             <button class="small mark" data-id="${b.id}" data-s="skipped">Skip</button>`
          : `<span class="chip">${esc(b.status)}</span>`}
      </div></div>`;
  }

  const windowsEl = view.querySelector('#windows');
  view.querySelector('#add-window').addEventListener('click', () => {
    windowsEl.insertAdjacentHTML('beforeend', windowRow(['09:00', '10:30']));
    bindDel();
  });
  function bindDel() {
    windowsEl.querySelectorAll('.del-window').forEach(b =>
      b.onclick = () => b.parentElement.remove());
  }
  bindDel();

  view.querySelector('#gen').addEventListener('click', async () => {
    const rows = [...windowsEl.children];
    const wins = rows.map(r => [r.querySelector('.w-start').value, r.querySelector('.w-end').value])
      .filter(w => w[0] && w[1] && w[0] < w[1]);
    if (!wins.length) return alert('Add at least one valid time window.');
    await api.settingsSet('windows', JSON.stringify(wins));
    const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
    await api.planGenerate({ date, windows: wins.map(w => ({ start_min: toMin(w[0]), end_min: toMin(w[1]) })) });
    route();
  });

  view.querySelectorAll('.mark').forEach(b => b.addEventListener('click', async () => {
    await api.blocksSetStatus(Number(b.dataset.id), b.dataset.s);
    route();
  }));
}

// ---------- Deadlines ----------
let dlView = null;       // 'list' | 'timeline' | 'calendar' (persisted)
let calCursor = null;    // 'YYYY-MM' shown by the calendar
async function renderDeadlines() {
  const [dls, mods, topics] = await Promise.all([api.deadlinesList(), api.modulesList(), api.topicsList()]);
  if (dlView === null) dlView = (await api.settingsGet('deadline_view')) || 'timeline';

  view.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <h2>Deadlines</h2>
      <div class="row">
        <div class="seg" role="tablist">
          ${['timeline', 'calendar', 'list'].map(v =>
            `<button class="seg-btn ${dlView === v ? 'on' : ''}" data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}
        </div>
        <button id="add-dl" class="primary">+ Deadline</button>
      </div>
    </div>
    <div id="dl-body"></div>`;
  view.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', async () => {
    dlView = b.dataset.v;
    await api.settingsSet('deadline_view', dlView);
    route();
  }));

  const body = view.querySelector('#dl-body');
  if (dlView === 'timeline') body.innerHTML = timelineHtml(dls);
  else if (dlView === 'calendar') body.innerHTML = calendarHtml(dls);
  else body.innerHTML = listHtml(dls, topics);
  if (dlView === 'calendar') bindCalendarNav();
  bindDlTooltips(dls);
  bindListButtons();

  // ----- List -----
  function listHtml(dls, topics) {
    return `<table><thead><tr><th>Due</th><th>Module</th><th>Title</th><th>Weight</th><th>Topic</th><th></th></tr></thead>
    <tbody>
      ${dls.map(d => `<tr style="${d.done ? 'opacity:.45' : ''}">
        <td class="mono" style="white-space:nowrap">${esc(d.due_at.slice(0, 16).replace('T', ' '))}</td>
        <td><span class="dot" style="background:${esc(d.module_color)}"></span>${esc(d.module_code)}</td>
        <td><b>${esc(d.title)}</b></td>
        <td>${d.weight}</td>
        <td class="muted">${esc(topics.find(t => t.id === d.topic_id)?.name || 'whole module')}</td>
        <td style="text-align:right; white-space:nowrap">
          <button class="small toggle-dl" data-id="${d.id}">${d.done ? 'Reopen' : 'Done'}</button>
          <button class="danger-ghost small del-dl" data-id="${d.id}">✕</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No deadlines.</td></tr>'}
    </tbody></table>`;
  }

  // ----- Timeline: one line, every deadline a dot, soonest first -----
  function timelineHtml(dls) {
    const open = dls.filter(d => !d.done).sort((a, b) => a.due_at.localeCompare(b.due_at));
    if (!open.length) return '<p class="muted">No open deadlines — the timeline is clear.</p>';
    const now = Date.now();
    const DAY = 86400000;
    const t0 = Math.min(now, new Date(open[0].due_at).getTime()) - 2 * DAY;
    const t1 = new Date(open[open.length - 1].due_at).getTime() + 4 * DAY;
    const W = 920, H = 190, PAD = 40, AXIS_Y = 118;
    const x = (t) => PAD + (t - t0) / (t1 - t0) * (W - 2 * PAD);

    // month ticks
    const ticks = [];
    const d0 = new Date(t0); d0.setDate(1); d0.setMonth(d0.getMonth() + 1);
    for (let d = d0; d.getTime() < t1; d.setMonth(d.getMonth() + 1)) {
      ticks.push({ t: d.getTime(), label: d.toLocaleString('en', { month: 'short' }) });
    }

    // stack same/close dates upward so dots never overlap
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
      <p class="muted" style="margin-top:6px">Dot size = weight · label = days left · hover a dot for details.
        Soonest is leftmost.</p>
    </div>
    <div id="dl-tip" class="dl-tip" hidden></div>`;
  }

  // ----- Calendar: month grid -----
  function calendarHtml(dls) {
    if (!calCursor) calCursor = today().slice(0, 7);
    const [Y, M] = calCursor.split('-').map(Number);
    const first = new Date(Y, M - 1, 1);
    const startDow = (first.getDay() + 6) % 7; // Monday-first
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
    view.querySelector('#cal-prev').addEventListener('click', () => shift(-1));
    view.querySelector('#cal-next').addEventListener('click', () => shift(1));
    view.querySelector('#cal-today').addEventListener('click', () => { calCursor = today().slice(0, 7); route(); });
  }

  // shared hover tooltip for timeline dots and calendar chips
  function bindDlTooltips(dls) {
    const tip = view.querySelector('#dl-tip');
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
    view.querySelectorAll('.dl-dot, .cal-chip').forEach(el => {
      el.addEventListener('mouseenter', () => show(el, dls[Number(el.dataset.i)]));
      el.addEventListener('mouseleave', () => { tip.hidden = true; });
    });
  }

  function bindListButtons() {
  view.querySelector('#add-dl').addEventListener('click', async () => {
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
  view.querySelectorAll('.toggle-dl').forEach(b => b.addEventListener('click', async () => {
    const d = dls.find(x => x.id === Number(b.dataset.id));
    await api.deadlinesUpdate({ ...d, done: !d.done }); route();
  }));
  view.querySelectorAll('.del-dl').forEach(b => b.addEventListener('click', async () => {
    if (confirm('Delete deadline?')) { await api.deadlinesDelete(Number(b.dataset.id)); route(); }
  }));
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
