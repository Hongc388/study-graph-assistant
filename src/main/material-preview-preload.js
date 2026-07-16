const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('previewApi', {
  readFile: (filePath) => ipcRenderer.invoke('material:readPreviewFile', filePath),
  saveProgress: (payload) => ipcRenderer.invoke('material:saveProgress', payload),
  saveProgressSync: (payload) => ipcRenderer.sendSync('material:saveProgressSync', payload),
  renderMarkdown: (src) => ipcRenderer.invoke('material:renderMarkdown', src),
  notesList: (materialId) => ipcRenderer.invoke('notes:listReading', materialId),
  notesCreate: (n) => ipcRenderer.invoke('notes:createReading', n),
  notesDelete: (payload) => ipcRenderer.invoke('notes:deleteReading', payload),
  notesLink: (payload) => ipcRenderer.invoke('notes:linkReading', payload),
  notesUnlink: (payload) => ipcRenderer.invoke('notes:unlinkReading', payload),
  highlightsList: (materialId) => ipcRenderer.invoke('highlights:list', materialId),
  highlightsCreate: (h) => ipcRenderer.invoke('highlights:create', h),
  highlightsDelete: (payload) => ipcRenderer.invoke('highlights:delete', payload),
  onTimer: (cb) => ipcRenderer.on('preview:timer', (_, state) => cb(state)),
  breakChoice: (accept) => ipcRenderer.invoke('preview:breakChoice', accept),
});
