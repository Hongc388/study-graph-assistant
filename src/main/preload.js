const { contextBridge, ipcRenderer } = require('electron');

// Expose a flat, promise-based API to the renderer. Each entry maps 1:1 to an
// ipcMain.handle channel in main.js.
const channels = [
  'modules:list', 'modules:create', 'modules:update', 'modules:delete',
  'topics:list', 'topics:create', 'topics:update', 'topics:delete', 'topics:merge',
  'materials:list', 'materials:create', 'materials:update', 'materials:delete', 'materials:organize',
  'materials:search', 'materials:pickFiles', 'materials:open', 'materials:closePreview', 'materials:touchOpen',
  'study:todayLog', 'study:resume', 'study:recentAccessMax',
  'notes:listReading', 'notes:createReading', 'notes:updateReading', 'notes:deleteReading',
  'notes:linkReading', 'notes:unlinkReading',
  'ingest:run', 'ingest:defaultRoot', 'ingest:pickRoot', 'notes:list',
  'problems:list', 'problems:create', 'problems:update', 'problems:delete', 'problems:queue', 'sessions:create',
  'edges:list', 'edges:create', 'edges:delete',
  'deadlines:list', 'deadlines:create', 'deadlines:update', 'deadlines:delete',
  'blocks:list', 'blocks:create', 'blocks:update', 'blocks:delete', 'blocks:duplicate', 'blocks:setStatus', 'blocks:reorder', 'plan:generate',
  'cards:list', 'cards:due', 'cards:create', 'cards:update', 'cards:delete', 'cards:review', 'cards:counts',
  'pomo:log', 'pomo:stats',
  'settings:get', 'settings:set',
  'ai:status', 'ai:suggestTopics', 'ai:suggestEdges',
  'ai:classifyModule', 'ai:suggestNoteLinks', 'ai:feedback',
  'log:renderer', 'log:reveal', 'notify:show', 'preview:timerPush',
  'db:export', 'db:import', 'app:info',
];

const api = {};
for (const ch of channels) {
  // 'modules:list' -> api.modulesList(...)
  const name = ch.replace(/:(\w)/g, (_, c) => c.toUpperCase());
  api[name] = (...args) => ipcRenderer.invoke(ch, ...args);
}

function onChannel(channel, cb) {
  const handler = (_, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
api.onMaterialSessionEnd = (cb) => onChannel('material:session-end', cb);
api.onPreviewFocus = (cb) => onChannel('material:preview-focus', cb);
api.onPreviewBlur = (cb) => onChannel('material:preview-blur', cb);
api.onAiClassifyProgress = (cb) => onChannel('ai:classify-progress', cb);

contextBridge.exposeInMainWorld('api', api);
