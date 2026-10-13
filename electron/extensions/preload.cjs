const { contextBridge, ipcRenderer } = require('electron');
const listen = (channel, callback) => {
  const handler = (_event, value) => callback(value); ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld('petFeatures', {
  snapshot: () => ipcRenderer.invoke('extensions:snapshot'),
  execute: (id,command,payload) => ipcRenderer.invoke('extensions:execute',id,command,payload),
  acknowledge: (id,items) => ipcRenderer.invoke('extensions:acknowledge',id,items),
  settings: () => ipcRenderer.send('extensions:settings'),
  regions: value => ipcRenderer.send('extensions:regions',value),
  pin: value => ipcRenderer.send('extensions:pinned',value),
  close: () => ipcRenderer.send('extensions:close-menu'),
  resize: (width,height,save=false,edge='') => ipcRenderer.invoke('extensions:resize',width,height,save,edge),
  onState: callback => listen('extensions:state',callback),
  onHover: callback => listen('extensions:hover',callback),
  onEvent: callback => listen('extensions:event',callback),
  onClose: callback => listen('extensions:close',callback)
});
