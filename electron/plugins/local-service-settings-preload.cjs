const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('localServiceSettings',Object.freeze({
  status:()=>ipcRenderer.invoke('local-service-settings:status'),
  save:connection=>ipcRenderer.invoke('local-service-settings:save',connection),
  clear:()=>ipcRenderer.invoke('local-service-settings:clear')
}));
