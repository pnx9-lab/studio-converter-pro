const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  saveFile: (data, extension) => ipcRenderer.send('save-file', { data, extension })
});
