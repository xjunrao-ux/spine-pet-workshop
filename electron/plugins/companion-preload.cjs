const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('petCompanion',{
 get:()=>ipcRenderer.invoke('pet:companion-get'),
 execute:(id,epoch,command,text)=>ipcRenderer.invoke('pet:companion-execute',id,epoch,command,text),
 settings:()=>ipcRenderer.send('pet:companion-settings'),
 interaction:value=>ipcRenderer.send('pet:companion-interaction',value),
 close:()=>ipcRenderer.send('pet:companion-close'),
 move:(dx,dy,phase)=>ipcRenderer.invoke('pet:companion-move',dx,dy,phase),
 onState:callback=>{const listener=(_e,state)=>callback(state);ipcRenderer.on('companion:state',listener);return()=>ipcRenderer.removeListener('companion:state',listener);},
 onClose:callback=>{const listener=()=>callback();ipcRenderer.on('companion:closed',listener);return()=>ipcRenderer.removeListener('companion:closed',listener);}
});
