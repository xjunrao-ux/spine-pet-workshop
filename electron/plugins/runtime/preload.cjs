const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('pluginRuntime',{
  initialize:()=>ipcRenderer.invoke('plugin-runtime:init'),
  message:serialized=>ipcRenderer.invoke('plugin-runtime:message',serialized),
  onRequest:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('plugin-runtime:request',listener);return()=>ipcRenderer.removeListener('plugin-runtime:request',listener);}
});
