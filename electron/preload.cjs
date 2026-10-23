const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPet", {
  isElectron: true,
  companion: {
    get:()=>ipcRenderer.invoke('pet:companion-get'),
    hover:value=>ipcRenderer.send('pet:companion-hover',value),
    click:()=>ipcRenderer.send('pet:companion-click'),
    onState:callback=>{const listener=(_e,state)=>callback(state);ipcRenderer.on('pet:companion-state',listener);return()=>ipcRenderer.removeListener('pet:companion-state',listener);}
  },
  reportStatus: (state, message) => ipcRenderer.send("pet:render-status", state, message),
  getCharacterConfig: () => ipcRenderer.invoke("pet:get-character-config"),
  showContextMenu: () => ipcRenderer.send("pet:show-context-menu"),
  beginDrag: () => ipcRenderer.send("pet:drag-start"),
  endDrag: () => ipcRenderer.send("pet:drag-end"),
  setWalking: (enabled, direction) => ipcRenderer.send("pet:set-walking", enabled, direction),
  setSupportRatio: (ratio) => ipcRenderer.send("pet:set-support-ratio", ratio),
  setCustomScale: (scale) => ipcRenderer.send("pet:set-custom-scale", scale),
  onCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("pet:command", listener);
    return () => ipcRenderer.removeListener("pet:command", listener);
  },
  onDirectionChanged: (callback) => {
    const listener = (_event, direction) => callback(direction);
    ipcRenderer.on("pet:direction", listener);
    return () => ipcRenderer.removeListener("pet:direction", listener);
  }
});
