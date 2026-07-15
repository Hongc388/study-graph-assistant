const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const db = require('./db');
const { planDay } = require('./scheduler');
const ai = require('./ai');
const extract = require('./extract');
const ingest = require('./ingest');
const organize = require('./organize');
const { isPreviewable } = require('./preview');
const log = require('./log');
const reminders = require('../shared/reminders');

// E2E tests point the app at a throwaway data dir so they never touch the
// real database. Must run before app.whenReady resolves paths.
const userDataArg = process.argv.find(a => a.startsWith('--user-data='));
if (userDataArg) app.setPath('userData', userDataArg.slice('--user-data='.length));

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

function previewKind(ext) {
  if (ext === '.pdf') return 'pdf';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.md') return 'md';
  return 'text';
}

function openMaterialPreview(filePath, materialId) {
  closePreviewWindow();
  const ext = path.extname(filePath).toLowerCase();
  const mat = materialId ? db.getMaterial(materialId) : null;
  const workerUrl = pathToFileURL(
    path.join(__dirname, '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js')
  ).href;

  previewWin = new BrowserWindow({
    width: 960,
    height: 720,
    title: path.basename(filePath),
    webPreferences: {
      preload: path.join(__dirname, 'material-preview-preload.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  const bindPreviewEvents = () => {
    previewWin.on('focus', () => {
      clearSessionIdleTimer();
      sendToRenderer('material:preview-focus');
    });
    previewWin.on('blur', () => {
      sendToRenderer('material:preview-blur');
      scheduleSessionIdleStop('preview-idle');
    });
    previewWin.on('close', () => {
      if (previewWin && !previewWin.isDestroyed()) {
        previewWin.webContents.executeJavaScript(
          'typeof window.__savePreviewProgress === "function" && window.__savePreviewProgress()'
        ).catch(() => {});
      }
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
  };

  const fileUrl = pathToFileURL(filePath).href;

  previewWin.loadFile(path.join(__dirname, 'material-preview.html'), {
    query: {
      file: filePath,
      fileUrl,
      materialId: String(materialId || ''),
      ext: previewKind(ext),
      page: String(mat?.last_page || 1),
      scroll: String(mat?.last_scroll || 0),
      worker: workerUrl,
    },
  });
  bindPreviewEvents();
  return { mode: 'preview' };
}

function openMaterial(filePath, materialId) {
  if (!filePath || filePath.startsWith('http')) return { mode: 'none' };
  if (!fs.existsSync(filePath)) return { mode: 'none' };
  if (isPreviewable(filePath)) return openMaterialPreview(filePath, materialId);
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
  // A dead renderer looks like a white window with no console — record why.
  mainWin.webContents.on('render-process-gone', (_, details) =>
    log.error('renderer.gone', `${details.reason} (exitCode ${details.exitCode})`));
  mainWin.on('unresponsive', () => log.warn('renderer', 'window unresponsive'));
  mainWin.on('closed', () => { mainWin = null; closePreviewWindow(); });
}

app.whenReady().then(() => {
  log.init(path.join(app.getPath('userData'), 'logs'));
  log.captureProcessErrors((err) => {
    // Smoke/CI must fail loudly; a user should see what happened, not a vanish.
    if (process.argv.includes('--smoke')) { console.error(err); app.exit(1); return; }
    dialog.showErrorBox('Study Graph Assistant — unexpected error',
      `${err?.stack || err}\n\nDetails were saved to the log (Settings → Open log).`);
  });
  log.info('app', `started v${app.getVersion()} electron ${process.versions.electron}`);
  db.open(app.getPath('userData'));
  registerIpc();
  createWindow();
  // Study reminders (deadlines, due cards, planned blocks, streak): every
  // minute a DB snapshot goes through the pure engine in shared/reminders.js.
  // Sent keys persist in settings, so a restart never repeats a notification.
  if (!process.argv.includes('--smoke')) {
    setTimeout(checkReminders, 5000); // let the window settle first
    setInterval(checkReminders, 60000);
  }
  // CI smoke mode: boot everything (DB open, migrations, IPC, window load),
  // then walk every view so renderer errors fail the job too, then exit 0.
  if (process.argv.includes('--smoke')) {
    const rendererErrors = [];
    mainWin.webContents.on('console-message', (event, level, message) => {
      const lvl = typeof event === 'object' && 'level' in event ? event.level : level;
      if (lvl === 3 || lvl === 'error') rendererErrors.push(event.message ?? message);
    });
    const views = ['#/dashboard', '#/graph', '#/queue', '#/cards', '#/schedule/today',
                   '#/schedule/timeline', '#/settings'];
    let i = 0;
    const step = () => {
      if (i < views.length) {
        mainWin.webContents.executeJavaScript(`location.hash='${views[i++]}'`).catch(() => {});
        setTimeout(step, 400);
      } else if (rendererErrors.length) {
        console.error('SMOKE_RENDERER_ERRORS\n' + rendererErrors.join('\n'));
        app.exit(1);
      } else {
        console.log('SMOKE_OK');
        app.exit(0);
      }
    };
    mainWin.webContents.once('did-finish-load', () => setTimeout(step, 600));
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function showOsNotification(title, body) {
  return new Promise((resolve) => {
    if (!Notification.isSupported()) return resolve(false);
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const n = new Notification({ title: String(title || ''), body: String(body || '') });
      n.once('show', () => finish(true));
      n.once('failed', () => finish(false));
      n.show();
      // Darwin always emits show/failed; elsewhere some hosts are silent — treat
      // "no failure" as delivered so we don't re-spam every minute.
      setTimeout(() => finish(process.platform !== 'darwin'), 2000);
    } catch {
      finish(false);
    }
  });
}

async function checkReminders(now = new Date()) {
  try {
    if (!Notification.isSupported()) return;
    const prefs = reminders.normalizePrefs(db.getSetting('reminders.prefs'));
    if (!prefs.enabled) return;
    let sent = {};
    try { sent = JSON.parse(db.getSetting('reminders.sent') || '{}'); } catch { /* start fresh */ }
    const today = reminders.localDateStr(now);
    const due = reminders.dueReminders({
      now, prefs, sent,
      deadlines: db.listDeadlines(),
      dueCards: db.cardCounts(now.toISOString()).reduce((n, r) => n + (r.due || 0), 0),
      blocks: db.listBlocks(today),
      stats: db.pomodoroStats(today),
    });
    if (!due.length) return;
    let changed = false;
    for (const r of due) {
      const delivered = await showOsNotification(r.title, r.body);
      if (!delivered) {
        log.info('reminders', `not delivered (${r.category}): ${r.title}`);
        continue;
      }
      sent[r.key] = today;
      changed = true;
      log.info('reminders', `${r.category}: ${r.title}`);
    }
    if (changed) db.setSetting('reminders.sent', JSON.stringify(reminders.pruneSent(sent, now)));
  } catch (e) { log.error('reminders', e); }
}

// Pick the model to use: explicit setting first, else whatever Ollama has pulled.
async function resolveModel() {
  const configured = db.getSetting('ollama_model');
  const s = await ai.ensureRunning();
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
    'blocks:listRange': (_, { from, to }) => db.listBlocksRange(from, to),
    'blocks:create': (_, b) => { db.createBlock(b); return db.listBlocks(b.date); },
    'blocks:update': (_, b) => db.updateBlock(b),
    'blocks:delete': (_, id) => db.deleteBlock(id),
    'blocks:duplicate': (_, id) => {
      const newId = db.duplicateBlock(id);
      const b = db.getBlock(newId);
      return b ? db.listBlocks(b.date) : [];
    },
    'blocks:setStatus': (_, id, status) => db.setBlockStatus(id, status),
    'blocks:reorder': (_, payload) => db.reorderBlocks(payload),
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
    'materials:open': (_, payload) => {
      const filePath = typeof payload === 'string' ? payload : payload?.path;
      const materialId = typeof payload === 'object' ? payload?.materialId : null;
      return openMaterial(filePath, materialId);
    },
    'materials:closePreview': () => { closePreviewWindow(); },
    'material:readPreviewFile': (_, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      return ext === '.pdf' ? fs.readFileSync(filePath) : fs.readFileSync(filePath, 'utf8');
    },
    'material:renderMarkdown': (_, src) => require('../shared/markdown-lite').renderMarkdown(src),
    'material:saveProgress': (_, payload) => {
      if (!payload?.materialId) return;
      const fields = {};
      if ('last_page' in payload) fields.last_page = payload.last_page;
      if ('last_scroll' in payload) fields.last_scroll = payload.last_scroll;
      db.saveMaterialProgress(payload.materialId, fields);
    },
    'materials:touchOpen': (_, id) => { db.touchMaterialOpened(id); },
    'notes:listReading': (_, materialId) => db.getReadingNoteGraph(materialId),
    'notes:createReading': (_, n) => {
      db.createReadingNote(n);
      return db.getReadingNoteGraph(n.material_id);
    },
    'notes:updateReading': (_, n) => {
      db.updateReadingNote(n);
      return db.getReadingNoteGraph(n.material_id);
    },
    'notes:deleteReading': (_, { id, materialId }) => {
      db.deleteReadingNote(id);
      return db.getReadingNoteGraph(materialId);
    },
    'notes:linkReading': (_, { fromId, toId, materialId, kind }) => {
      db.linkReadingNotes(fromId, toId, kind);
      return db.getReadingNoteGraph(materialId);
    },
    'notes:unlinkReading': (_, { id, materialId }) => {
      db.unlinkReadingNotes(id);
      return db.getReadingNoteGraph(materialId);
    },
    'study:todayLog': (_, date) => db.listStudyToday(date || reminders.localDateStr(new Date())),
    'study:resume': (_, limit) => db.listResumeItems(Math.min(limit ?? 8, db.MAX_RECENT_ACCESS)),
    'study:recentAccessMax': () => db.MAX_RECENT_ACCESS,
    // flashcards (SM-2 spaced repetition)
    'cards:list': (_, topicId) => db.listCards(topicId),
    'cards:due': (_, limit) => db.listDueCards(new Date().toISOString(), limit ?? 50),
    'cards:create': (_, c) => db.createCard(c),
    'cards:update': (_, c) => db.updateCard(c),
    'cards:delete': (_, id) => db.deleteCard(id),
    'cards:review': (_, { id, rating }) => db.reviewCard(id, rating),
    'cards:counts': () => db.cardCounts(new Date().toISOString()),
    // pomodoro log
    'pomo:log': (_, p) => db.logPomodoro(p),
    'pomo:stats': () => db.pomodoroStats(),
    // settings
    'settings:get': (_, key) => db.getSetting(key),
    'settings:set': (_, key, value) => db.setSetting(key, value),
    // AI (all optional; return {ok:false} rather than throwing to the UI)
    'ai:status': () => ai.ensureRunning(),
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
    // Read each file's actual text and classify it — the filename heuristic
    // can't tell a "welcome to this module" PDF from a real lecture.
    // Read one course-info file and distill labeled module facts for the
    // About panel. Triggered when a file is dragged into the About box.
    'ai:summarizeOverview': async (_, { moduleId, materialId }) => {
      try {
        const model = await resolveModel();
        const mod = db.listModules().find(m => m.id === moduleId);
        const mat = db.listMaterials(moduleId).find(m => m.id === materialId);
        if (!mat || !mat.path || /^https?:/i.test(mat.path)) {
          return { ok: false, error: 'No local file to read' };
        }
        const { text } = await extract.extractText(mat.path);
        const items = await ai.summarizeOverview(model, {
          moduleName: mod?.name || '', title: mat.title, text,
        });
        if (!items.length) return { ok: false, error: 'The model found no module facts in this file' };
        db.setAboutNotes(moduleId, items, mat.title);
        log.info('ai', `about summary for module ${moduleId} from "${mat.title}" (${items.length} facts)`);
        return { ok: true, count: items.length };
      } catch (e) {
        log.warn('ai', `about summary failed for module ${moduleId}: ${e.message}`);
        return { ok: false, error: e.message };
      }
    },
    'ai:classifyModule': async (ev, moduleId) => {
      try {
        const model = await resolveModel();
        const mod = db.listModules().find(m => m.id === moduleId);
        const mats = db.listMaterials(moduleId).filter(m => m.path && !/^https?:/i.test(m.path));
        if (!mats.length) return { ok: false, error: 'No local files in this module' };
        const examples = db.listAiFeedback('material-type', 20)
          .filter(f => f.accepted).map(f => f.payload).slice(0, 5);
        const items = [];
        let done = 0;
        for (const m of mats) {
          const { text, reason } = await extract.extractText(m.path);
          try {
            const j = await ai.classifyMaterial(model, {
              title: m.title, moduleName: mod?.name || '', text,
            }, examples);
            items.push({ id: m.id, title: m.title, from: m.type, to: j.type,
              confidence: text ? j.confidence : Math.min(j.confidence ?? 0, 0.4),
              reason: j.reason, textStatus: text ? 'text' : reason });
          } catch (e) {
            items.push({ id: m.id, title: m.title, from: m.type, to: m.type,
              confidence: 0, reason: `skipped: ${e.message}`, textStatus: 'error' });
          }
          done++;
          ev.sender.send('ai:classify-progress', { done, total: mats.length });
        }
        return { ok: true, items };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    'ai:suggestNoteLinks': async (_, materialId) => {
      try {
        const model = await resolveModel();
        const { notes, links } = db.getReadingNoteGraph(materialId);
        if (notes.length < 3) return { ok: false, error: 'Need at least 3 notes to suggest links' };
        const mat = db.getMaterial(materialId);
        const examples = db.listAiFeedback('note-link', 16).map(f => ({ ...f.payload, accepted: f.accepted }));
        const ids = new Set(notes.map(n => n.id));
        const linked = new Set(links.map(l => `${Math.min(l.from_note, l.to_note)}-${Math.max(l.from_note, l.to_note)}`));
        const raw = await ai.suggestNoteLinks(model, mat?.title || '', notes, examples);
        const fresh = raw.filter(s => ids.has(s.from) && ids.has(s.to) && s.from !== s.to
          && !linked.has(`${Math.min(s.from, s.to)}-${Math.max(s.from, s.to)}`));
        return { ok: true, links: fresh };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    'ai:feedback': (_, f) => db.logAiFeedback(f),
    'app:info': () => ({ version: app.getVersion(), electron: process.versions.electron }),
    // data safety: user-driven backup and restore of the whole database
    'db:export': async () => {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
        title: 'Export database backup',
        defaultPath: `study-graph-backup-${new Date().toISOString().slice(0, 10)}.db`,
      });
      if (canceled || !filePath) return { ok: false, error: 'canceled' };
      try {
        db.exportTo(filePath);
        log.info('db', `exported backup to ${filePath}`);
        return { ok: true, path: filePath };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    'db:import': async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWin, {
        title: 'Restore database from a backup (replaces current data)',
        filters: [{ name: 'SQLite database', extensions: ['db'] }],
        properties: ['openFile'],
      });
      if (canceled || !filePaths.length) return { ok: false, error: 'canceled' };
      try {
        db.importFrom(filePaths[0]);
        log.info('db', `imported database from ${filePaths[0]}`);
        mainWin.webContents.reload(); // renderer state is all derived from the DB
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    // Timer relay: the main window computes the focus/pomodoro display state
    // every second; the preview window (where reading happens) renders it.
    'preview:timerPush': (_, state) => {
      if (previewWin && !previewWin.isDestroyed()) {
        previewWin.webContents.send('preview:timer', state);
      }
    },
    // Preview overlay's answer to "take the break?" — forward to the main
    // window renderer, which owns the pomodoro state.
    'preview:breakChoice': (_, accept) => {
      sendToRenderer('pomo:break-choice', { accept: !!accept });
    },
    // "Take the break?" when no preview window is open — native dialog.
    'pomo:askBreak': async (_, { min, long }) => {
      const { response } = await dialog.showMessageBox(mainWin, {
        type: 'question',
        buttons: [`Take the ${min}-minute break`, 'Keep working'],
        defaultId: 0,
        cancelId: 1,
        message: 'Pomodoro done 🍅',
        detail: long ? `You earned the long break — ${min} minutes away from the screen.`
                     : `A ${min}-minute break keeps the next interval sharp.`,
      });
      return response === 0;
    },
    // OS notification for renderer events (pomodoro done / break over). Shown
    // only when the window is unfocused — in focus the in-app toast suffices.
    'notify:show': async (_, n) => {
      const prefs = reminders.normalizePrefs(db.getSetting('reminders.prefs'));
      if (!prefs.enabled || !prefs.pomodoro) return false;
      if (mainWin?.isFocused() || !Notification.isSupported()) return false;
      return showOsNotification(n?.title, n?.body);
    },
    // crash log (renderer exceptions land in the same file as main's)
    'log:renderer': (_, e) => log.error('renderer.uncaught',
      `${e?.message || 'unknown'}${e?.stack ? '\n' + e.stack : ''}`),
    'log:reveal': () => { if (log.path) shell.showItemInFolder(log.path); },
  };
  for (const [channel, fn] of Object.entries(handlers)) ipcMain.handle(channel, fn);
  ipcMain.on('material:saveProgressSync', (_, payload) => {
    if (!payload?.materialId) return;
    const fields = {};
    if ('last_page' in payload) fields.last_page = payload.last_page;
    if ('last_scroll' in payload) fields.last_scroll = payload.last_scroll;
    db.saveMaterialProgress(payload.materialId, fields);
  });
}
