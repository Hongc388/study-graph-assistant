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
  onTimer: (cb) => ipcRenderer.on('preview:timer', (_, state) => cb(state)),
  breakChoice: (accept) => ipcRenderer.invoke('preview:breakChoice', accept),
});
