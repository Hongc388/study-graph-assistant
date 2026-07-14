const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const db = require('./db');
const { planDay } = require('./scheduler');
const ai = require('./ai');
const ingest = require('./ingest');
const organize = require('./organize');
const { isPreviewable } = require('./preview');

const DEFAULT_ROOT = path.join(os.homedir(), 'Desktop', 'year_three');
const SESSION_IDLE_MS = 15000;

let mainWin = null;
let previewWin = null;
let sessionIdleTimer = null;
let closingPreviewInternally = false;

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sendToRenderer(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
}

function clearSessionIdleTimer() {
  if (sessionIdleTimer) { clearTimeout(sessionIdleTimer); sessionIdleTimer = null; }
}

function scheduleSessionIdleStop(reason = 'idle') {
  clearSessionIdleTimer();
  sessionIdleTimer = setTimeout(() => {
    sessionIdleTimer = null;
    sendToRenderer('material:session-end', { reason });
  }, SESSION_IDLE_MS);
}

function closePreviewWindow() {
  if (previewWin && !previewWin.isDestroyed()) {
    closingPreviewInternally = true;
    previewWin.close();
  }
}

function openMaterialPreview(filePath) {
  closePreviewWindow();
  const ext = path.extname(filePath).toLowerCase();
  previewWin = new BrowserWindow({
    width: 960,
    height: 720,
    title: path.basename(filePath),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (ext === '.pdf' || ext === '.html' || ext === '.htm') {
    previewWin.loadURL(pathToFileURL(filePath).href);
  } else {
    let text;
    try { text = fs.readFileSync(filePath, 'utf8'); }
    catch { shell.openPath(filePath); return { mode: 'external' }; }
    const body = `<pre style="white-space:pre-wrap;font-family:ui-monospace,monospace;padding:20px;line-height:1.5;color:#d6d6dd;background:#1a1a1e;margin:0">${escHtml(text)}</pre>`;
    previewWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(path.basename(filePath))}</title></head><body>${body}</body></html>`)}`);
  }

  previewWin.on('focus', () => {
    clearSessionIdleTimer();
    sendToRenderer('material:preview-focus');
  });
  previewWin.on('blur', () => {
    sendToRenderer('material:preview-blur');
    scheduleSessionIdleStop('preview-idle');
  });
  previewWin.on('closed', () => {
    previewWin = null;
    clearSessionIdleTimer();
    if (!closingPreviewInternally) {
      sendToRenderer('material:session-end', { reason: 'preview-closed' });
    }
    closingPreviewInternally = false;
  });
  previewWin.once('ready-to-show', () => {
    previewWin.focus();
    clearSessionIdleTimer();
    sendToRenderer('material:preview-focus');
  });
  return { mode: 'preview' };
}

function openMaterial(filePath) {
  if (!filePath || filePath.startsWith('http')) return { mode: 'none' };
  if (!fs.existsSync(filePath)) return { mode: 'none' };
  if (isPreviewable(filePath)) return openMaterialPreview(filePath);
  shell.openPath(filePath);
  return { mode: 'external' };
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'Study Graph Assistant',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWin.on('closed', () => { mainWin = null; closePreviewWindow(); });
}

app.whenReady().then(() => {
  db.open(app.getPath('userData'));
  registerIpc();
  createWindow();
  // CI smoke mode: boot everything (DB open, migrations, IPC, window load),
  // then exit 0. Any main-process throw exits non-zero and fails the job.
  if (process.argv.includes('--smoke')) {
    setTimeout(() => { console.log('SMOKE_OK'); app.exit(0); }, 3000);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Pick the model to use: explicit setting first, else whatever Ollama has pulled.
async function resolveModel() {
  const configured = db.getSetting('ollama_model');
  const s = await ai.status();
  if (!s.ok) throw new Error(s.error);
  if (!s.models.length) throw new Error('Ollama is running but has no models — run `ollama pull qwen2.5`');
  if (configured && s.models.includes(configured)) return configured;
  // configured-but-missing or unset: fall back to the first available model
  return s.models[0];
}

// Thin IPC layer: renderer calls api.<name>(args), we forward to db/scheduler/ai.
function registerIpc() {
  const handlers = {
    // modules
    'modules:list': () => db.listModules(),
    'modules:create': (_, m) => db.createModule(m),
    'modules:update': (_, m) => db.updateModule(m),
    'modules:delete': (_, id) => db.deleteModule(id),
    // topics
    'topics:list': (_, moduleId) => db.listTopics(moduleId),
    'topics:create': (_, t) => db.createTopic(t),
    'topics:update': (_, t) => db.updateTopic(t),
    'topics:delete': (_, id) => db.deleteTopic(id),
    'topics:merge': (_, { keepId, mergeId }) => db.mergeTopics(keepId, mergeId),
    // materials
    'materials:list': (_, moduleId) => db.listMaterials(moduleId),
    'materials:create': (_, m) => db.createMaterial(m),
    'materials:update': (_, m) => db.updateMaterial(m),
    'materials:delete': (_, id) => db.deleteMaterial(id),
    'materials:organize': (_, { materialId, topicId, slot }) => {
      const mat = db.getMaterial(materialId);
      if (!mat) throw new Error('Material not found');
      const mod = db.listModules().find(m => m.id === mat.module_id);
      if (!mod) throw new Error('Module not found');
      const libRoot = db.getSetting('library_root') || DEFAULT_ROOT;
      const slotNorm = organize.normalizeSlot(slot || mat.type);

      if (!topicId) {
        db.updateMaterial({ ...mat, topic_id: null, type: slotNorm });
        return { ok: true, renamed: false, title: mat.title };
      }

      const topic = db.listTopics(mod.id).find(t => t.id === Number(topicId));
      if (!topic) throw new Error('Section not found');

      const reserved = db.listMaterials(mod.id).map(m => m.path).filter(Boolean);
      const { path: newPath, title, renamed } = organize.organizeOnDisk({
        libRoot,
        moduleFolder: mod.folder || mod.code,
        materialPath: mat.path,
        sectionName: topic.name,
        slot: slotNorm,
        reservedPaths: reserved,
      });
      db.updateMaterial({
        ...mat,
        topic_id: Number(topicId),
        type: slotNorm,
        path: newPath,
        title,
      });
      return { ok: true, renamed, path: newPath, title };
    },
    'materials:search': (_, q, moduleId) => db.searchMaterials(q, moduleId),
    // pick files from disk to import as materials
    'materials:pickFiles': async () => {
      const r = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Study materials', extensions: ['pdf', 'md', 'txt', 'ipynb', 'py', 'c', 'cpp', 'html'] },
                  { name: 'All files', extensions: ['*'] }],
      });
      return r.canceled ? [] : r.filePaths;
    },
    // edges
    'edges:list': () => db.listEdges(),
    'edges:create': (_, e) => db.createEdge(e),
    'edges:delete': (_, id) => db.deleteEdge(id),
    // deadlines
    'deadlines:list': () => db.listDeadlines(),
    'deadlines:create': (_, d) => db.createDeadline(d),
    'deadlines:update': (_, d) => db.updateDeadline(d),
    'deadlines:delete': (_, id) => db.deleteDeadline(id),
    // schedule
    'blocks:list': (_, date) => db.listBlocks(date),
    'blocks:create': (_, b) => { db.createBlock(b); return db.listBlocks(b.date); },
    'blocks:delete': (_, id) => db.deleteBlock(id),
    'blocks:setStatus': (_, id, status) => db.setBlockStatus(id, status),
    'plan:generate': (_, { date, windows }) => {
      const plan = planDay({
        date, windows,
        topics: db.listTopics(),
        edges: db.listEdges(),
        deadlines: db.listDeadlines(),
        materials: db.listMaterials(),
        modules: db.listModules(),
      });
      db.clearPlannedBlocks(date);
      for (const b of plan) db.createBlock({ ...b, date });
      return db.listBlocks(date);
    },
    // ingest: scan the library root, upsert modules/materials/topics, parse strategy.md
    'ingest:run': (_, root) => {
      const libRoot = root || db.getSetting('library_root') || DEFAULT_ROOT;
      const scan = ingest.scanRoot(libRoot);
      let strategy = null;
      if (scan.strategyPath) {
        try { strategy = ingest.parseStrategy(scan.strategyPath); } catch { /* optional */ }
      }
      const stats = db.applyIngest(scan, strategy);
      db.setSetting('library_root', libRoot);
      return { root: libRoot, ...stats, strategyParsed: !!strategy };
    },
    'ingest:defaultRoot': () => db.getSetting('library_root') || DEFAULT_ROOT,
    'ingest:pickRoot': async () => {
      const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    },
    'notes:list': (_, moduleId) => db.listModuleNotes(moduleId),
    // problems (competence signal) + time ledger
    'problems:list': (_, topicId) => db.listProblems(topicId),
    'problems:create': (_, p) => db.createProblem(p),
    'problems:update': (_, p) => db.updateProblem(p),
    'problems:delete': (_, id) => db.deleteProblem(id),
    'problems:queue': (_, limit) => db.listProblemQueue(limit ?? 80),
    'sessions:create': (_, s) => db.createMaterialSession(s),
    // open a material with an in-app preview (pdf/md/txt) or the OS default app
    'materials:open': (_, p) => openMaterial(p),
    'materials:closePreview': () => { closePreviewWindow(); },
    'materials:touchOpen': (_, id) => { db.touchMaterialOpened(id); },
    'study:todayLog': (_, date) => db.listStudyToday(date || new Date().toISOString().slice(0, 10)),
    'study:resume': (_, limit) => db.listResumeItems(limit ?? 8),
    // settings
    'settings:get': (_, key) => db.getSetting(key),
    'settings:set': (_, key, value) => db.setSetting(key, value),
    // AI (all optional; return {ok:false} rather than throwing to the UI)
    'ai:status': () => ai.status(),
    'ai:suggestTopics': async (_, moduleId) => {
      try {
        const model = await resolveModel();
        const mod = db.listModules().find(m => m.id === moduleId);
        const titles = db.listMaterials(moduleId).map(m => m.title);
        if (!titles.length) return { ok: false, error: 'No materials in this module yet' };
        return { ok: true, topics: await ai.suggestTopics(model, mod?.name || '', titles) };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    'ai:suggestEdges': async () => {
      try {
        const model = await resolveModel();
        const topics = db.listTopics();
        if (topics.length < 2) return { ok: false, error: 'Need at least 2 topics' };
        return { ok: true, edges: await ai.suggestEdges(model, topics) };
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };
  for (const [channel, fn] of Object.entries(handlers)) ipcMain.handle(channel, fn);
}
