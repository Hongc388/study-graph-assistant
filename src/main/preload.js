const { contextBridge, ipcRenderer } = require('electron');

// Expose a flat, promise-based API to the renderer. Each entry maps 1:1 to an
// ipcMain.handle channel in main.js.
const channels = [
  'modules:list', 'modules:create', 'modules:update', 'modules:delete',
  'topics:list', 'topics:create', 'topics:update', 'topics:delete',
  'materials:list', 'materials:create', 'materials:update', 'materials:delete',
  'materials:search', 'materials:pickFiles', 'materials:open',
  'ingest:run', 'ingest:defaultRoot', 'ingest:pickRoot', 'notes:list',
  'problems:list', 'problems:create', 'problems:update', 'problems:delete', 'sessions:create',
  'edges:list', 'edges:create', 'edges:delete',
  'deadlines:list', 'deadlines:create', 'deadlines:update', 'deadlines:delete',
  'blocks:list', 'blocks:setStatus', 'plan:generate',
  'settings:get', 'settings:set',
  'ai:status', 'ai:suggestTopics', 'ai:suggestEdges',
];

const api = {};
for (const ch of channels) {
  // 'modules:list' -> api.modulesList(...)
  const name = ch.replace(/:(\w)/g, (_, c) => c.toUpperCase());
  api[name] = (...args) => ipcRenderer.invoke(ch, ...args);
}

contextBridge.exposeInMainWorld('api', api);
