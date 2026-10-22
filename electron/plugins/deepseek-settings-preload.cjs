const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('deepseekSettings',Object.freeze({
  status:()=>ipcRenderer.invoke('deepseek-settings:status'),
  save:key=>ipcRenderer.invoke('deepseek-settings:save',key),
  clear:()=>ipcRenderer.invoke('deepseek-settings:clear'),
  test:()=>ipcRenderer.invoke('deepseek-settings:test')
}));
