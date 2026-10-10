const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPet", {
  isElectron: true,
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
