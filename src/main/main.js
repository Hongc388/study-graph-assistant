const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const db = require('./db');
const { planDay } = require('./scheduler');
const ai = require('./ai');
const ingest = require('./ingest');

const DEFAULT_ROOT = path.join(app.getPath('home'), 'Desktop', 'year_three');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'Study Graph Assistant',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  db.open(app.getPath('userData'));
  registerIpc();
  createWindow();
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
    // materials
    'materials:list': (_, moduleId) => db.listMaterials(moduleId),
    'materials:create': (_, m) => db.createMaterial(m),
    'materials:update': (_, m) => db.updateMaterial(m),
    'materials:delete': (_, id) => db.deleteMaterial(id),
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
    'blocks:setStatus': (_, id, status) => db.setBlockStatus(id, status),
    'plan:generate': (_, { date, windows }) => {
      const plan = planDay({
        date, windows,
        topics: db.listTopics(),
        edges: db.listEdges(),
        deadlines: db.listDeadlines(),
        materials: db.listMaterials(),
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
    // open a material with the OS default app (Preview, etc.)
    'materials:open': (_, p) => shell.openPath(p),
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
