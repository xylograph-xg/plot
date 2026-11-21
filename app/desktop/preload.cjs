const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('localFolder', {
  get: () => ipcRenderer.invoke('folder:get'),
  choose: () => ipcRenderer.invoke('folder:choose'),
  refresh: () => ipcRenderer.invoke('folder:refresh'),
  read: (id) => ipcRenderer.invoke('folder:read', id),
  saveProject: (json, name, directory) => ipcRenderer.invoke('folder:saveProject', json, name, directory),
  onChange: (callback) => on('folder:changed', callback),
});

contextBridge.exposeInMainWorld('fitWindows', {
  open: (data, title) => ipcRenderer.invoke('fit:open', data, title),
  update: (id, data) => ipcRenderer.send('fit:update', id, data),
  onClosed: (callback) => on('fit:closed', callback),
  onApply: (callback) => on('fit:applied', callback),
  get: () => ipcRenderer.invoke('fit:get'),
  onChange: (callback) => on('fit:changed', callback),
  apply: (models) => ipcRenderer.invoke('fit:apply', models),
});
