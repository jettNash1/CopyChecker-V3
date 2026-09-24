const { contextBridge, ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipc');

contextBridge.exposeInMainWorld('copychecker', {
  run: (payload) => ipcRenderer.invoke(IPC.RUN, payload),
  cancel: () => ipcRenderer.send(IPC.CANCEL),
  onProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(IPC.PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.PROGRESS, handler);
  },
});
